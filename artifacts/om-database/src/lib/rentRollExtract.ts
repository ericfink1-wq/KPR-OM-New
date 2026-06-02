import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON, toStepString, tenantKey, stripSuiteCode, isVacant } from "./utils";
import type { Deal, ReviewQuestion } from "./idb";

export interface RentRollResult {
  asOf: string | null;
  tenants: NonNullable<Deal["tenants"]>;
  reviewQuestions?: ReviewQuestion[];
}

// Extract a tenant roster from rent-roll text (PDF or spreadsheet-derived).
// Shared by the deal page's "Refresh tenants" button and the smart uploader.
export async function extractRentRoll(text: string): Promise<RentRollResult> {
  const prompt = `You are a CRE data extraction engine. Extract every occupied tenant from this rent roll.
Return ONLY JSON: {"asOf":"YYYY-MM-DD or null","tenants":[{...}],"reviewQuestions":[{...}]}

Each tenant object (omit unknown fields):
{"name","suite","sf","rentPerSF","annualRent","leaseStart","leaseExpiry","leaseType","reimbursementMethod","rentBumps","rentSchedule","renewalOptions","recentlyExercisedRenewal","assumptionNote","percentageRentClause","expenseReimbursements","percentageRent","otherRent","creditRating","salesPSF","isAnchor","isDark","remainingTermYears"}

Rules:
- Brand name only (no store #).
- Dates ISO YYYY-MM-DD.
- VACANT SUITES: INCLUDE every vacant/available unit as its OWN row — set name to "Vacant", capture its suite and sf, and leave ALL lease/rent fields null. Do NOT merge multiple vacant suites into one row, and do NOT drop them. A large vacant box (e.g. a former anchor) MUST appear. (This is how the app shows availability and reconciles occupied vs. total SF.)
- rentSchedule: future steps only as of the asOf date.
- SF and rents as plain numbers (no $ or commas).
- If a value isn't shown, omit it.
- remainingTermYears: compute from asOf to leaseExpiry if possible.

CRITICAL LESSONS (past extractions failed on these — do NOT repeat):
- CAPTURE EVERY occupied line, never drop tenants. Anchors / junior anchors (the largest-SF tenants — grocers, Burlington, Marshalls, banks) are the MOST important to never omit. Before finishing, confirm the sum of your tenant SF reconciles with the rent roll's stated occupied SF; if it doesn't, you missed tenants — add them (largest first).
- leaseExpiry = CURRENT contractual expiration, NOT an unexercised option-extended date. If the roll shows a pro-forma "End" that assumes options are exercised, use the current expiry and put option dates in renewalOptions.
- BILLING BREAKDOWN → base rent vs reimbursements. Some rent rolls show the "Base Rent" / "Rate PSF" column as the TOTAL monthly billing, then a "Breakdown:" sub-section that splits it into "RNT - Rent" (the TRUE base rent) plus recovery lines ("CAM", "TAX" or "RET", "INS", etc.). When a breakdown is present: annualRent = the RNT/Rent line × 12 (NOT the gross total); expenseReimbursements = the SUM of the CAM + TAX/RET + INS + other recovery lines × 12; rentPerSF = base annualRent ÷ SF; set reimbursementMethod to "NNN" when CAM/TAX/INS are billed back. If there is NO breakdown, treat the base-rent column as base rent.
- MONTHLY vs ANNUAL: amounts in these rolls are MONTHLY. annualRent and expenseReimbursements must be ANNUAL — multiply monthly figures by 12. Sanity-check: rentPerSF ≈ annualRent ÷ SF (a normal inline rent is ~$10–$120/SF, never thousands).
- rentSchedule = ONLY clean dated rent steps ("2027-12-01: $33.01 PSF") or "Flat at $X PSF through YYYY-MM-DD". NEVER put prose, explanations, or renewal narratives in rentSchedule — that belongs in assumptionNote. The "Future Rent Increases" columns/sub-rows (Cat / Date / Monthly Amount / PSF) ARE the steps — capture each future-dated one as a dated step (convert monthly amount to PSF or annual as needed).
- EXECUTED RENEWAL (extends the term): if a tenant appears in a "New Leases" section with a term that BEGINS the day after its current "Occupied" expiration (a contiguous, already-executed renewal), the lease has been extended — set leaseExpiry to the NEW (later) end date, and note it in recentlyExercisedRenewal (e.g. "10-yr renewal executed, now through 2037-01-18"). This is DIFFERENT from an unexercised OPTION (which stays in renewalOptions and does NOT change leaseExpiry).
- EXCLUDE non-inline / outparcel rows: shadow anchors and ground-lease pads that are NOT part of this property — typically 0 SF with a placeholder far-future or 12/31/00 expiration, or explicitly marked "(NAP)" / "Not A Part", such as Costco, Target, a theater, or a separately-owned bank/restaurant pad. Do NOT list these as tenants. (A real lease that happens to show 0 SF but has a NORMAL near-term expiration and ordinary rent — e.g. a gas station — IS a real tenant; keep it.)
- DEDUPE SECTIONS: a rent roll may have separate sections like "New Leases" / "Occupied" / "Vacant". If the same tenant or suite appears in BOTH a future/"New Leases" section AND an in-place "Occupied" section, output ONE row. Use the OCCUPIED current rent/SF; apply the EXECUTED RENEWAL rule above for the expiry. Never emit two rows for the same tenant/suite. Emit each "Vacant" suite as its own "Vacant" row per the VACANT SUITES rule (do NOT skip them) — but if a suite is listed BOTH as Vacant and as occupied/new-leased to a named tenant, keep only the occupied/named row.
- suite: always capture the suite/unit id when present (e.g. "14-WALM", "15908A", "B") — it's the most reliable key for matching this tenant to an existing roster.
- leaseType is the REIMBURSEMENT / LEASE STRUCTURE (NNN, Gross, Modified Gross, NN, Base Year). It is NOT a renewal-option type. NEVER put option-type codes like "AUT" (automatic) or "REN" (renewal) in leaseType — those describe the renewal option; put that detail in renewalOptions, or omit it. Leave leaseType null if the structure isn't stated.
- ATM vs BANK BRANCH: a standalone ATM (e.g. "Chase Bank ATM", "Bank of America ATM", usually 0 or tiny SF) is NOT a bank branch. KEEP "ATM" in the name and list it as its OWN tenant row — never merge it into the bank's branch lease.

reviewQuestions: a SHORT list (max ~4) of values you could NOT capture with confidence from THIS rent roll — e.g. an unlabeled/ambiguous SF or rent column, a number that was blurry or split oddly, two rows that might be the same tenant, or an "as of" date you had to guess. Each: {"severity":"high|medium|low","field":"human label e.g. 'Five Below — SF'","question":"short confirm question","detail":"1 sentence on the ambiguity","suggestedValue":"what you captured, as a string","target":{"kind":"tenant","fieldKey":"exact tenant field key (sf, rentPerSF, annualRent, leaseStart, leaseExpiry, remainingTermYears, salesPSF)","tenantName":"exact tenant name from the tenants array","valueType":"number|text"}}. ALWAYS set target when the question is about one tenant's field so the user can fix it in one click; set target null only for non-field questions (e.g. possible duplicate rows). Only flag genuine uncertainty — NOT values simply absent from the roll. Empty array if the roll was clean.`;

  const taught = await lessonGuidanceClient("rent-roll");
  const res = await apiAiMessages({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt + taught + "\n\nRENT ROLL TEXT:\n" + text }],
  });
  const raw = res.content?.[0]?.text ?? "";
  let parsed: { asOf?: string | null; tenants?: unknown[]; reviewQuestions?: unknown[] };
  try { parsed = robustParseJSON(raw) as typeof parsed; }
  catch { throw new Error("Couldn't parse the rent roll. Try a clearer file."); }
  const tenants = (Array.isArray(parsed.tenants) ? parsed.tenants : []) as NonNullable<Deal["tenants"]>;
  if (tenants.length === 0) throw new Error("No tenants found in the rent roll.");
  const reviewQuestions = (Array.isArray(parsed.reviewQuestions) ? parsed.reviewQuestions : [])
    .map((q, i) => {
      const r = q as Record<string, unknown>;
      const tgt = r.target as Record<string, unknown> | undefined;
      const target = tgt && tgt.kind === "tenant" && typeof tgt.fieldKey === "string"
        ? {
            kind: "tenant" as const,
            fieldKey: tgt.fieldKey,
            tenantName: typeof tgt.tenantName === "string" ? tgt.tenantName : null,
            valueType: (tgt.valueType === "text" ? "text" : "number") as "number" | "text",
          }
        : null;
      return {
        id: `ai-rr-${i}-${String(r.field ?? "").toString().toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
        source: "ai" as const,
        severity: (["high", "medium", "low"].includes(r.severity as string) ? r.severity : "medium") as ReviewQuestion["severity"],
        field: typeof r.field === "string" ? r.field : null,
        question: typeof r.question === "string" ? r.question : "",
        detail: typeof r.detail === "string" ? r.detail : null,
        suggestedValue: r.suggestedValue != null ? String(r.suggestedValue) : null,
        target,
      } as ReviewQuestion;
    })
    .filter(q => q.question);
  return { asOf: parsed.asOf || new Date().toISOString().slice(0, 10), tenants, reviewQuestions };
}

// Extract a lease-OPTIONS schedule into per-tenant renewalOptions strings. These
// files list each occupant followed by their renewal-option rows (Option Type,
// Option Date, Term To Date, Term in Months, Rate, Option Notes). The generic
// rent-roll extractor can't parse that ladder, so options came out empty — this
// builds one readable renewalOptions string per tenant. Returned as a
// RentRollResult so buildOptionsPatch can enrich the roster unchanged.
export async function extractLeaseOptions(text: string): Promise<RentRollResult> {
  const prompt = `You are a CRE data extraction engine. This is a LEASE OPTIONS schedule: each tenant has a header (Suite, Occupant Name, current Expiration), followed by one or more renewal-OPTION rows. Each option row has: an option number, Option Type (REN = renewal-by-notice, AUT = automatic), Option/Notice dates, "Term To Date" (the option period's END date), Term in Months, a Rate (PSF), and Option Notes (which often state the renewal rent $/month).

For EACH tenant, produce ONE object: {"name","suite","renewalOptions"}.
- renewalOptions: a single readable string listing every option in order, formatted "Opt N: $<rate>/SF → <Mon YYYY>" using the Term To Date (option END) for the date, e.g. "Opt 1: $18.91/SF → Jul 2040; Opt 2: $20.33/SF → Jul 2045; Opt 3: $21.85/SF → Jul 2050". Omit the rate if not given ("Opt 1: → Feb 2034"). Do NOT include the long legal "Doc. Ref / Notice Period / Subordinate Details" prose — just the rate and end date per option.
- name: brand only (strip store #). suite: the suite id.
- Skip tenants with no option rows.

Return ONLY JSON: {"tenants":[{"name","suite","renewalOptions"}]}. No prose, no code fences.

LEASE OPTIONS TEXT:
${text.slice(0, 60000)}`;
  const taught = await lessonGuidanceClient("lease-options");
  const res = await apiAiMessages({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 8000,
    messages: [{ role: "user", content: prompt + taught }],
  });
  const raw = res.content?.[0]?.text ?? "";
  let parsed: { tenants?: unknown[] };
  try { parsed = robustParseJSON(raw) as typeof parsed; }
  catch { throw new Error("Couldn't parse the lease-options file."); }
  const tenants = (Array.isArray(parsed.tenants) ? parsed.tenants : []) as NonNullable<Deal["tenants"]>;
  if (tenants.length === 0) throw new Error("No options found in the lease-options file.");
  return { asOf: new Date().toISOString().slice(0, 10), tenants, reviewQuestions: [] };
}

// Recompute occupancy + WALT from a fresh roster, respecting verified locks.
// Returns the full patch to apply to a deal (tenants + recomputed metrics).
export function buildRosterPatch(deal: Deal, result: RentRollResult): Partial<Deal> {
  const nv = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const recomputed: Partial<Deal> = {};
  // Merge fresh rent-roll questions with any existing ones on the deal: drop the
  // prior rent-roll AI flags (ids prefixed "ai-rr-") and append the new batch,
  // keeping OM-extraction and resolved questions intact.
  const fresh = result.reviewQuestions ?? [];
  const prior = (deal.reviewQuestions ?? []).filter(q => !(q.source === "ai" && q.id.startsWith("ai-rr-")));
  const reviewQuestions = [...prior, ...fresh];

  // Fields that an options-focused or partial rent roll often omits. When the new
  // row leaves one blank but the existing OM roster had it, carry the old value
  // forward — so a "Lease Options" upload never wipes SF / rent / start dates.
  const CARRY_OVER = [
    "sf", "annualRent", "rentPerSF", "leaseStart", "leaseExpiry", "remainingTermYears",
    "leaseType", "reimbursementMethod", "rentBumps", "rentSchedule", "salesPSF",
    "salesYear", "expenseReimbursements", "percentageRent", "otherRent", "creditRating",
    "isAnchor", "isNAP", "isDark", "parentCompany",
  ];
  const blank = (v: unknown) => v == null || v === "";
  const nrm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  const suiteN = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

  // Index the existing roster so a new row can be matched to it three ways, in
  // order of reliability: (1) same suite, (2) alias-aware tenant key, (3) same SF
  // with a name that contains/shares the other's. This dedupes cases where the OM
  // and rent roll name the same tenant differently ("Indish" vs "Indish, Exotic
  // Indian Cuisine"; "Wine & Liquor Dept." vs "Wine & Liquor Depot").
  const existing = (deal.tenants ?? []) as Array<Record<string, unknown>>;
  const exMeta = existing.map((pt, idx) => ({
    idx, pt, key: tenantKey(stripSuiteCode(pt.name)), suite: suiteN(pt.suite), sf: nv(pt.sf), nm: nrm(pt.name),
  }));
  const matched = new Set<number>();
  const findPrior = (x: Record<string, unknown>) => {
    const suite = suiteN(x.suite), key = tenantKey(stripSuiteCode(x.name)), sf = nv(x.sf), nm = nrm(x.name);
    let m = suite ? exMeta.find(e => !matched.has(e.idx) && e.suite && e.suite === suite) : undefined;
    if (!m) m = exMeta.find(e => !matched.has(e.idx) && e.key && e.key === key);
    if (!m && sf && sf > 0 && nm) m = exMeta.find(e =>
      !matched.has(e.idx) && e.sf === sf && e.nm &&
      (e.nm.includes(nm) || nm.includes(e.nm) || e.nm.split(" ")[0] === nm.split(" ")[0]));
    return m;
  };

  // Build the new rows (gap-filled from the matched prior row), then UNION them
  // with any existing tenants the new file didn't mention. A partial or secondary
  // file must never DELETE tenants — only add to and fill in the roster.
  const newRows = result.tenants.map(t => {
    const x = { ...(t as Record<string, unknown>) };
    const vac = isVacant(x.name);
    const m = findPrior(x);
    // A vacant row may match a now-departed prior tenant by suite — consume that
    // match so the old occupied row drops out, but NEVER carry the old tenant's
    // lease/rent data onto the vacant row (it would show a phantom lease).
    if (m) { matched.add(m.idx); if (!vac) for (const f of CARRY_OVER) { if (blank(x[f]) && !blank(m.pt[f])) x[f] = m.pt[f]; } }
    if (x.rentSchedule != null) x.rentSchedule = toStepString(x.rentSchedule);
    if (x.rentBumps != null) x.rentBumps = toStepString(x.rentBumps);
    if (x.renewalOptions != null) x.renewalOptions = toStepString(x.renewalOptions);
    // Rent-step consistency: a "Flat at $X PSF" schedule whose rate no longer
    // matches the current rentPerSF (a stale OM step carried onto a freshly
    // repriced lease) is rewritten to the current rate so the Rent Steps column
    // never contradicts the Rent/SF column. Real dated step schedules are left alone.
    const rpsf = nv(x.rentPerSF);
    if (rpsf != null) {
      const rs = String(x.rentSchedule ?? "");
      const flat = rs.match(/flat\s+at\s+\$?\s*([\d.]+)\s*psf/i);
      const exp = !blank(x.leaseExpiry) ? ` through ${x.leaseExpiry}` : "";
      if (flat && Math.abs(Number(flat[1]) - rpsf) >= 0.01) x.rentSchedule = `Flat at $${rpsf.toFixed(2)} PSF${exp}`;
      else if (blank(x.rentSchedule)) x.rentSchedule = `Flat at $${rpsf.toFixed(2)} PSF${exp}`;
    }
    return x;
  });
  const keptExisting = existing.filter((_, idx) => !matched.has(idx));
  const tenants = [...newRows, ...keptExisting] as NonNullable<Deal["tenants"]>;

  // Recompute occupancy / WALT from the FULL merged roster (not just the new
  // rows), so a partial file doesn't understate occupancy.
  // Vacant rows count toward total SF but NOT toward occupied SF or WALT.
  const occTenants = tenants.filter(t => !isVacant((t as Record<string, unknown>).name));
  if (!deal.verified?.occupancy && deal.totalSF) {
    const occupiedSF = occTenants.reduce((s, t) => s + (nv((t as Record<string, unknown>).sf) ?? 0), 0);
    const occ = Math.round(occupiedSF / Number(deal.totalSF) * 1000) / 10;
    if (occ > 0 && occ <= 100) recomputed.occupancy = occ;
  }
  if (!deal.verified?.walt) {
    const sfT = occTenants.reduce((s, t) => s + (nv((t as Record<string, unknown>).sf) ?? 0), 0);
    const wT = occTenants.reduce((s, t) => {
      const sf = nv((t as Record<string, unknown>).sf), yr = nv((t as Record<string, unknown>).remainingTermYears);
      return s + (sf ?? 0) * (yr ?? 0);
    }, 0);
    if (sfT > 0) recomputed.walt = Math.round(wT / sfT * 10) / 10;
  }

  return {
    tenants,
    tenantsAsOf: result.asOf,
    tenantsSource: "rent-roll",
    tenantsManual: true,
    analysisStale: true,
    reviewQuestions,
    ...recomputed,
  };
}

// ENRICH-ONLY patch for a lease-OPTIONS schedule. An options file lists renewal
// ladders but lacks current SF/rent, so it must never add or remove tenants —
// it only fills in renewalOptions (and option-period rent steps / lease type)
// on tenants ALREADY in the roster. Matches by normalized name. Tenants in the
// roster that aren't in the file are untouched; rows in the file with no roster
// match are ignored (we won't invent a tenant from an options sheet).
export function buildOptionsPatch(deal: Deal, result: RentRollResult): { patch: Partial<Deal>; updated: number } {
  const blank = (v: unknown) => v == null || v === "";
  const byKey = new Map<string, Record<string, unknown>>();
  for (const ot of result.tenants) {
    const k = tenantKey(stripSuiteCode((ot as Record<string, unknown>).name));
    if (k && !byKey.has(k)) byKey.set(k, ot as Record<string, unknown>);
  }
  let updated = 0;
  const tenants = (deal.tenants ?? []).map(t => {
    const x = { ...(t as Record<string, unknown>) };
    const opt = byKey.get(tenantKey(stripSuiteCode(x.name)));
    if (!opt) return x as NonNullable<Deal["tenants"]>[number];
    let touched = false;
    // renewalOptions: the file's whole point — always take it when present.
    const ro = toStepString(opt.renewalOptions);
    if (ro && ro !== toStepString(x.renewalOptions)) { x.renewalOptions = ro; touched = true; }
    // Fill (never overwrite) these supporting fields only when the roster lacks them.
    for (const f of ["rentSchedule", "rentBumps", "leaseType"] as const) {
      if (blank(x[f]) && !blank(opt[f])) { x[f] = toStepString(opt[f]); touched = true; }
    }
    if (touched) updated++;
    return x as NonNullable<Deal["tenants"]>[number];
  }) as NonNullable<Deal["tenants"]>;

  if (updated === 0) return { patch: {}, updated: 0 };
  return { patch: { tenants, analysisStale: true }, updated };
}
