// Deterministic checks on the AI's written analysis (Eric's 10/16/26 review, §3).
// The prompt already carries these rules; the model still broke them on Township
// Plaza, so the code enforces them after every analysis — token-free.
//
//   1. Above-market rent is NEVER upside. An upside item whose own text puts the
//      in-place rent ABOVE the market figure ("IWG pays $41.13 vs a $24 market") is
//      moved to red flags as roll-down risk.
//   2. The AI's numbers must match the deal's stored numbers. A percentage it quotes
//      for occupancy, or for a tenant's share of base rent, that is more than
//      0.5 points off the stored field becomes a review question (never a silent edit
//      — the stored field might be the wrong one).

export interface UpsideItem { priority?: string; item?: string; detail?: string }
export interface RedFlag { severity?: string; description?: string }

const num = (s: string) => Number(s.replace(/,/g, ""));

/** Does this text claim an in-place rent ABOVE market? */
export function claimsAboveMarket(text: string): boolean {
  const t = text.replace(/\s+/g, " ");
  // "above-market rent GROWTH" is a market-tailwind claim, not an in-place premium.
  const noGrowth = t.replace(/\babove[- ](?:the )?market (?:rent )?(?:growth|increases|appreciation)\b/gi, "");
  if (/\bover-?rented\b|\broll[- ]?down\b|\bpremium (?:to|over|above) (?:the )?market\b/i.test(noGrowth)) return true;
  // The in-place rent itself is above market: "at $41.13/SF … well above the OM's assumed office market rent".
  // (A "." inside a number like $41.13 is not a sentence end.)
  const S = "(?:[^.;]|\\.(?=\\d))";
  if (new RegExp(`\\b(?:at|pays|paying|in-place|rent (?:of|is)|leases?)\\b${S}{0,70}?\\babove\\b${S}{0,45}?\\bmarket\\b`, "i").test(noGrowth)) return true;
  if (/\babove[- ](?:the )?market (?:rent|lease|leases|tenant|tenants|in-place)\b/i.test(noGrowth) && !/\bbelow[- ](?:the )?market\b/i.test(noGrowth)) return true;
  // "$41.13 … vs/against/versus … $24 market" — the in-place figure comes first.
  const re = /\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)(?:\s*(?:\/\s*SF|PSF|per SF))?[^$]{0,70}?\b(?:vs\.?|versus|against|compared (?:to|with)|relative to)\b[^$]{0,30}?\$\s?(\d{1,3}(?:,\d{3})*(?:\.\d+)?)([^.;]{0,40})/gi;
  for (let m; (m = re.exec(noGrowth)); ) {
    const a = num(m[1]), b = num(m[2]);
    const marketNearB = /market|median|comp|average|typical/i.test(m[3]) || /market|median/i.test(noGrowth.slice(Math.max(0, m.index - 10), m.index + m[0].length));
    if (marketNearB && a > b * 1.05) return true;
  }
  return false;
}

/** Move above-market "upside" into red flags. Returns new arrays + how many moved. */
export function reclassifyAboveMarketUpside(upside: unknown, redFlags: unknown): { upsideItems: UpsideItem[]; redFlags: RedFlag[]; moved: number } {
  const ups = Array.isArray(upside) ? (upside as UpsideItem[]) : [];
  const flags = Array.isArray(redFlags) ? [...(redFlags as RedFlag[])] : [];
  const keep: UpsideItem[] = [];
  let moved = 0;
  for (const u of ups) {
    const text = `${u.item ?? ""} ${u.detail ?? ""}`;
    if (claimsAboveMarket(text)) {
      moved++;
      const label = (u.item ?? "Above-market rent").replace(/\b(mark[- ]to[- ]market )?(rent )?upside\b/i, "").trim() || "Above-market rent";
      flags.push({
        severity: u.priority === "high" ? "high" : "medium",
        description: `**Above-market rent — roll-down risk, not upside** (${label}): ${u.detail ?? ""} An in-place rent above market tends to reset DOWN at renewal or the tenant leaves, and it inflates today's NOI. Check the tenant's sales support it.`.replace(/\s+/g, " ").trim(),
      });
    } else keep.push(u);
  }
  return { upsideItems: keep, redFlags: flags, moved };
}

// ── stored-figure tie-out ────────────────────────────────────────────────────
export interface FigureMismatch { field: string; quoted: number; stored: number; excerpt: string }

const toNum = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Every string the analysis wrote, flattened (notes, grade rationale, strengths, risks, flags, upside). */
export function analysisTexts(a: Record<string, unknown>): string[] {
  const out: string[] = [];
  const push = (v: unknown) => { if (typeof v === "string" && v.trim()) out.push(v); };
  push(a.notes);
  const ds = a.dealScore as Record<string, unknown> | undefined;
  if (ds) { push(ds.rationale); for (const k of ["strengths", "risks"]) if (Array.isArray(ds[k])) (ds[k] as unknown[]).forEach(push); }
  if (Array.isArray(a.redFlags)) for (const f of a.redFlags as RedFlag[]) push(f?.description);
  if (Array.isArray(a.upsideItems)) for (const u of a.upsideItems as UpsideItem[]) { push(u?.item); push(u?.detail); }
  return out;
}

export function checkQuotedFigures(deal: Record<string, unknown>, texts: string[]): FigureMismatch[] {
  const out: FigureMismatch[] = [];
  const seen = new Set<string>();
  const add = (m: FigureMismatch) => { const k = `${m.field}|${m.quoted}`; if (!seen.has(k)) { seen.add(k); out.push(m); } };
  const occ = toNum(deal.occupancy);
  const tenants = Array.isArray(deal.tenants) ? (deal.tenants as Array<Record<string, unknown>>) : [];
  const gpr = toNum(deal.grossPotentialRent);
  const rentSum = tenants.reduce((s, t) => s + (toNum(t.annualRent) ?? 0), 0);
  const base = gpr && gpr > 0 ? gpr : rentSum > 0 ? rentSum : null;

  for (const text of texts) {
    const t = text.replace(/\s+/g, " ");
    // Occupancy: "88.93% occupied", "occupancy of 88.9%", "88.9% leased".
    if (occ != null) {
      const re = /(\d{1,3}(?:\.\d+)?)\s?%[\s-]*(?:occupied|occupancy|leased)\b|\b(?:occupancy|occupied|leased)\s*(?:of|at|is|was|:)?\s*(\d{1,3}(?:\.\d+)?)\s?%/gi;
      for (let m; (m = re.exec(t)); ) {
        const q = Number(m[1] ?? m[2]);
        // Skip forward-looking / hypothetical statements ("could fall below 85%").
        const before = t.slice(Math.max(0, m.index - 40), m.index).toLowerCase();
        if (/\b(below|above|under|over|fall|drop|reach|target|stabiliz|pro ?forma|if|could|would|threshold|trigger|covenant|than)\b/.test(before)) continue;
        if (q > 0 && q <= 100 && Math.abs(q - occ) > 0.5) add({ field: "occupancy", quoted: q, stored: occ, excerpt: t.slice(Math.max(0, m.index - 50), m.index + m[0].length + 20).trim() });
      }
    }
    // A named tenant's share of base rent: "IWG … 39% of base rent".
    if (base) {
      const re = /(\d{1,3}(?:\.\d+)?)\s?%\s*of\s*(?:(?:in-?place|total|base|gross|potential|annual|scheduled|the property's|the center's)\s*)*(?:base\s*)?rent/gi;
      for (let m; (m = re.exec(t)); ) {
        const q = Number(m[1]);
        const window = t.slice(Math.max(0, m.index - 90), m.index);
        // The tenant named closest before the figure.
        let best: { name: string; at: number; rent: number } | null = null;
        for (const tn of tenants) {
          const name = String(tn.name ?? "").trim();
          const rent = toNum(tn.annualRent);
          if (name.length < 3 || !rent) continue;
          const key = name.split(/[\s/(]/)[0];
          if (key.length < 3) continue;
          const at = window.toLowerCase().lastIndexOf(key.toLowerCase());
          if (at >= 0 && (!best || at > best.at)) best = { name, at, rent };
        }
        if (!best) continue;
        const actual = Math.round((best.rent / base) * 1000) / 10;
        if (Math.abs(q - actual) > 0.5) add({ field: `${best.name} share of base rent`, quoted: q, stored: actual, excerpt: t.slice(Math.max(0, m.index - 60), m.index + m[0].length).trim() });
      }
    }
  }
  // "already in holdover / expired" for a lease that hasn't expired yet. The OM's
  // rent-roll date is often in the FUTURE (an assumed closing), so "before the roll
  // date" is not "expired" — only a date before TODAY is.
  const today = (deal.__today as string) || new Date().toISOString().slice(0, 10);
  for (const text of texts) {
    const t = text.replace(/\s+/g, " ");
    const re = /\b(?:in holdover|holdover|already expired|has expired|lease expired|lapsed)\b/gi;
    for (let m; (m = re.exec(t)); ) {
      const window = t.slice(Math.max(0, m.index - 110), m.index);
      let best: { name: string; at: number; exp: string } | null = null;
      for (const tn of tenants) {
        const name = String(tn.name ?? "").trim();
        const exp = typeof tn.leaseExpiry === "string" ? tn.leaseExpiry.slice(0, 10) : "";
        if (name.length < 3 || !/^\d{4}-\d{2}-\d{2}$/.test(exp)) continue;
        const at = window.toLowerCase().lastIndexOf(name.toLowerCase().slice(0, Math.min(name.length, 14)));
        if (at >= 0 && (!best || at > best.at)) best = { name, at, exp };
      }
      if (best && best.exp >= today) {
        const k = `holdover|${best.name}`;
        if (!seen.has(k)) {
          seen.add(k);
          out.push({ field: `${best.name} lease status`, quoted: NaN, stored: NaN, excerpt: `${t.slice(Math.max(0, m.index - 70), m.index + m[0].length).trim()} — but the lease runs to ${best.exp}, after today (${today}); say "expires before the OM's rent-roll date" instead` });
        }
      }
    }
  }
  return out;
}

/** Review questions for the mismatches — the person decides which figure is right. */
export function figureMismatchQuestions(ms: FigureMismatch[]): Array<Record<string, unknown>> {
  return ms.map((m, i) => ({
    id: `ai-figure-${m.field.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}-${i}`,
    source: "check", severity: "medium", field: m.field,
    question: Number.isNaN(m.quoted)
      ? `The AI write-up calls ${m.field.replace(/ lease status$/, "")}'s lease expired or in holdover, but it hasn't expired yet.`
      : `The AI write-up says ${m.quoted}% for ${m.field}, but the deal's stored figure gives ${m.stored}%.`,
    detail: `"…${m.excerpt}…" — the written analysis should match the deal's numbers. Refresh the analysis, or correct the stored field if the write-up is right.`,
    suggestedValue: null, target: null,
  }));
}

/** Apply every guardrail to a fresh analysis result (mutates and returns it). */
export function applyAnalysisGuardrails(deal: Record<string, unknown>, analysis: Record<string, unknown>): Record<string, unknown> {
  if (analysis.upsideItems != null || analysis.redFlags != null) {
    const r = reclassifyAboveMarketUpside(analysis.upsideItems ?? deal.upsideItems, analysis.redFlags ?? deal.redFlags);
    if (r.moved) { analysis.upsideItems = r.upsideItems; analysis.redFlags = r.redFlags; }
  }
  const mism = checkQuotedFigures({ ...deal, ...analysis }, analysisTexts(analysis));
  const prior = Array.isArray(deal.reviewQuestions) ? (deal.reviewQuestions as Array<Record<string, unknown>>) : [];
  const kept = prior.filter(q => !String(q?.id ?? "").startsWith("ai-figure-"));
  const fresh = figureMismatchQuestions(mism);
  if (fresh.length || kept.length !== prior.length) analysis.reviewQuestions = [...kept, ...fresh];
  return analysis;
}
