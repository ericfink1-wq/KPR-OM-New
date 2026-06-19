// Deterministic, SAFE data-quality fixes applied automatically the moment a deal is
// imported, so data lands CLEAN instead of being corrected later. Only UNAMBIGUOUS
// fixes that cannot be "wrong":
//   • occupancyCost stored as a 0.NN fraction → ×100 (a value in (0,1) is
//     mathematically a fraction; retail occupancy cost is never below ~1%).
//   • duplicate tenant rows that double-count SF → keep the LATER lease. Same tenant +
//     same suite, OR suite-less with the same expiry AND similar SF — the SF guard
//     means two genuinely different spaces of one chain are NEVER merged.
//   • recompute roster-derived metrics (occupancy / WALT / weighted-avg rent), honoring
//     `verified` locks — these are DERIVED values, always safe to recompute.
// It deliberately does NOT touch rent values or deal-level figures (cap rate, price,
// GLA) — those can be genuinely ambiguous and stay FLAGGED for human review. Pure.

const nA = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};
const isVacA = (name: unknown): boolean => {
  const s = String(name ?? "").trim().toLowerCase();
  return !s || s === "-" || /^(vacant|available|avail|spec(ulative)?|white\s*box|tbd|to\s+be\s+leased)\b/.test(s);
};
const isNAPA = (t: Record<string, unknown>): boolean => {
  if (t.isNAP === true) return true;
  if (isVacA(t.name)) return false;
  const hasLease = !!((typeof t.leaseStart === "string" && t.leaseStart.trim()) || (typeof t.leaseExpiry === "string" && t.leaseExpiry.trim()) || (typeof t.rentSchedule === "string" && t.rentSchedule.trim()));
  if (hasLease) return false;
  const sf = nA(t.sf), r = nA(t.annualRent), rp = nA(t.rentPerSF);
  return sf != null && sf > 0 && (r == null || r === 0) && (rp == null || rp === 0);
};
const parseD = (s: unknown): Date | null => {
  const str = String(s ?? "").trim(); if (!str) return null;
  const d = new Date(str + (/^\d{4}-\d{2}-\d{2}$/.test(str) ? "T12:00:00" : ""));
  return isNaN(d.getTime()) ? null : d;
};

// CLAUDE.md HARD RULE: every lease date must be ISO YYYY-MM-DD, never a "Mon-YYYY"
// string. normalizeDate converts the common OM/rent-roll formats to ISO, but ONLY when
// the parse is UNAMBIGUOUS — anything it isn't sure about is returned unchanged (null)
// so a weird value surfaces in the audit instead of being silently corrupted. A
// month-year value (the usual OM grain, e.g. "Nov-2022") normalizes to the 1st of that
// month, which is exactly how the app's date math already interprets it — so this is
// math-neutral, it just makes the STORED string conform to the rule and sort correctly.
const MONTHS: Record<string, string> = {
  jan: "01", january: "01", feb: "02", february: "02", mar: "03", march: "03",
  apr: "04", april: "04", may: "05", jun: "06", june: "06", jul: "07", july: "07",
  aug: "08", august: "08", sep: "09", sept: "09", september: "09", oct: "10", october: "10",
  nov: "11", november: "11", dec: "12", december: "12",
};
const clampDay = (mm: string, dd: number): string => {
  const maxByMonth: Record<string, number> = { "01": 31, "02": 29, "03": 31, "04": 30, "05": 31, "06": 30, "07": 31, "08": 31, "09": 30, "10": 31, "11": 30, "12": 31 };
  const d = Math.min(Math.max(dd, 1), maxByMonth[mm] ?? 31);
  return String(d).padStart(2, "0");
};
export function normalizeDate(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return null;        // empty or already ISO → no change
  let m: RegExpMatchArray | null;
  // "Nov-2022" / "August 2031" / "Sep, 2031" — month name + 4-digit year (no day → 1st)
  if ((m = s.match(/^([A-Za-z]{3,9})[\s,.\-/]+(\d{4})$/))) {
    const mm = MONTHS[m[1].toLowerCase()]; if (mm) return `${m[2]}-${mm}-01`;
  }
  // "Nov-15-2022" / "August 15, 2031" — month name + day + year
  if ((m = s.match(/^([A-Za-z]{3,9})[\s,.\-/]+(\d{1,2})[\s,.\-/]+(\d{4})$/))) {
    const mm = MONTHS[m[1].toLowerCase()]; if (mm) return `${m[3]}-${mm}-${clampDay(mm, Number(m[2]))}`;
  }
  // "11/01/2022" / "1/1/2022" / "11-01-2022" — US numeric M/D/Y
  if ((m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{4})$/))) {
    const mo = Number(m[1]), day = Number(m[2]);
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) { const mm = String(mo).padStart(2, "0"); return `${m[3]}-${mm}-${clampDay(mm, day)}`; }
  }
  // "2022/11/01" — ISO-ish with slashes
  if ((m = s.match(/^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/))) {
    const mo = Number(m[2]), day = Number(m[3]);
    if (mo >= 1 && mo <= 12 && day >= 1 && day <= 31) { const mm = String(mo).padStart(2, "0"); return `${m[1]}-${mm}-${clampDay(mm, day)}`; }
  }
  // "2020-12" / "2020/12" — year-month with no day (unambiguous → 1st of month)
  if ((m = s.match(/^(\d{4})[-/](\d{1,2})$/))) {
    const mo = Number(m[2]);
    if (mo >= 1 && mo <= 12) return `${m[1]}-${String(mo).padStart(2, "0")}-01`;
  }
  return null;                                                  // unrecognized → leave it for the audit
}
const TENANT_DATE_FIELDS = ["leaseStart", "leaseExpiry", "originalLeaseDate", "rentCommencement", "rentStart"] as const;
// Faithful port of recomputeRosterMetrics (om-database/src/lib/utils.ts) — keep in sync.
function recompute(tenants: Record<string, unknown>[], asOf: unknown, deal: Record<string, unknown>) {
  const ver = (deal.verified || {}) as Record<string, unknown>;
  const out: { occupancy?: number; walt?: number; weightedAvgRentPSF?: number } = {};
  const ref = parseD(asOf) ?? new Date();
  const occ = tenants.filter((t) => !isVacA(t.name) && !isNAPA(t));
  const totalSF = nA(deal.totalSF);
  if (!ver.occupancy && totalSF && totalSF > 0) {
    const o = Math.round(occ.reduce((s, t) => s + (nA(t.sf) ?? 0), 0) / totalSF * 1000) / 10;
    if (o > 0 && o <= 100) out.occupancy = o;
  }
  if (!ver.walt) {
    let sf = 0, w = 0;
    for (const t of occ) { const s = nA(t.sf); if (!s) continue; const e = parseD(t.leaseExpiry); const yr = e ? Math.max(0, (e.getTime() - ref.getTime()) / (365.25 * 86_400_000)) : nA(t.remainingTermYears); if (yr == null) continue; sf += s; w += s * yr; }
    if (w > 0 && sf > 0) out.walt = Math.round(w / sf * 10) / 10;
  }
  if (!ver.weightedAvgRentPSF) {
    let sf = 0, w = 0;
    for (const t of occ) { const s = nA(t.sf), r = nA(t.rentPerSF); if (s && s > 0 && r && r > 0) { sf += s; w += s * r; } }
    if (sf > 0) out.weightedAvgRentPSF = Math.round(w / sf * 100) / 100;
  }
  return out;
}

export interface ImportFixResult {
  deal: Record<string, unknown>;
  changed: boolean;
  occCostFixed: number;
  dupeFixed: number;
  metricFixes: number;
  dateFixed: number;
  rentFilled: number;
}

// Fill a blank BASE-RENT figure that's mathematically implied by the other two on the
// SAME tenant (annualRent = rentPerSF × SF). This is GATED, never a blanket assumption:
// it only runs on a deal whose rates are PROVEN to be clean base figures — i.e. enough
// tenants carry BOTH annual rent and PSF and a strong majority reconcile exactly. If
// that can't be confirmed (too few samples, or the figures don't tie out), it fills
// NOTHING and the blanks stay blank. That guard means a gross / CAM-inflated PSF is
// never multiplied into a fabricated base rent, and a bad roll can't be "completed"
// into wrong numbers. Per-value sanity bounds catch a mis-keyed rate on top of that.
export function deriveRents(tenants: Record<string, unknown>[]): { tenants: Record<string, unknown>[]; filled: number } {
  const occ = tenants.filter((t) => !isVacA(t.name) && !isNAPA(t));
  let both = 0, recon = 0;
  for (const t of occ) {
    const sf = nA(t.sf), ann = nA(t.annualRent), psf = nA(t.rentPerSF);
    if (sf && sf > 0 && ann && ann > 0 && psf && psf > 0) {
      both++;
      if (Math.abs(psf * sf - ann) / ann <= 0.02) recon++;
    }
  }
  // Need a real sample AND a strong consensus that PSF is the base rate before deriving.
  if (both < 3 || recon / both < 0.85) return { tenants, filled: 0 };
  let filled = 0;
  const out = tenants.map((src) => {
    if (isVacA(src.name) || isNAPA(src)) return src;
    const t = { ...src };
    const sf = nA(t.sf), ann = nA(t.annualRent), psf = nA(t.rentPerSF);
    if (!sf || sf <= 0) return t;
    if ((ann == null || ann === 0) && psf != null && psf >= 1 && psf <= 200) {
      t.annualRent = Math.round(psf * sf); filled++;                       // annual from a confirmed base PSF
    } else if ((psf == null || psf === 0) && ann != null && ann > 0) {
      const d = Math.round((ann / sf) * 100) / 100;
      if (d >= 0.5 && d <= 200) { t.rentPerSF = d; filled++; }             // PSF from base annual (sane band)
    }
    return t;
  });
  return { tenants: out, filled };
}

export function applyImportFixes(input: Record<string, unknown>): ImportFixResult {
  let changed = false, occCostFixed = 0, dupeFixed = 0, metricFixes = 0, dateFixed = 0;
  const raw = Array.isArray(input.tenants) ? (input.tenants as Record<string, unknown>[]) : [];

  // 1. occupancyCost fraction → ×100, and normalize any non-ISO lease dates to ISO.
  const fixed = raw.map((src) => {
    const t = { ...src };
    const oc = nA(t.occupancyCost);
    if (oc != null && oc > 0 && oc < 1) { t.occupancyCost = Math.round(oc * 100 * 100) / 100; occCostFixed++; changed = true; }
    for (const f of TENANT_DATE_FIELDS) {
      const iso = normalizeDate(t[f]);
      if (iso) { t[f] = iso; dateFixed++; changed = true; }
    }
    return t;
  });

  // 2. dedupe true duplicate rows (keep later expiry; SF guard for the suite-less case)
  const dedup: Record<string, unknown>[] = [];
  const seen = new Map<string, number>();
  for (const t of fixed) {
    if (isVacA(t.name)) { dedup.push(t); continue; }
    const name = String(t.name ?? "").trim().toLowerCase();
    const suite = String(t.suite ?? "").trim().toLowerCase();
    const exp = String(t.leaseExpiry ?? "").trim();
    const key = suite ? `${name}|s:${suite}` : (exp ? `${name}|e:${exp}` : null);
    const at = key != null ? seen.get(key) : undefined;
    if (key != null && at != null) {
      const prev = dedup[at];
      const sfPrev = nA(prev.sf), sfCur = nA(t.sf);
      const sfOk = !!suite || sfPrev == null || sfCur == null || sfPrev === 0 ||
        Math.abs(sfPrev - sfCur) / Math.max(sfPrev, sfCur) <= 0.25;
      if (sfOk) {
        const prevExp = parseD(prev.leaseExpiry), curExp = parseD(t.leaseExpiry);
        if (curExp && (!prevExp || curExp > prevExp)) dedup[at] = t;
        dupeFixed++; changed = true;
        continue;
      }
    }
    if (key != null) seen.set(key, dedup.length);
    dedup.push(t);
  }

  // 3. Fill blank base-rent figures that are mathematically implied (gated — see
  //    deriveRents). Runs before the metric recompute so a filled rentPerSF feeds the
  //    weighted-average rent.
  const { tenants: withRents, filled: rentFilled } = deriveRents(dedup);
  if (rentFilled > 0) changed = true;

  const deal: Record<string, unknown> = { ...input, tenants: withRents };

  // 4. recompute roster-derived metrics (honors verified locks)
  const m = recompute(withRents, deal.tenantsAsOf, deal);
  for (const k of ["occupancy", "walt", "weightedAvgRentPSF"] as const) {
    if (m[k] != null && nA(deal[k]) !== m[k]) { deal[k] = m[k]; metricFixes++; changed = true; }
  }

  return { deal, changed, occCostFixed, dupeFixed, metricFixes, dateFixed, rentFilled };
}
