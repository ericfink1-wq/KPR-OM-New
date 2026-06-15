import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON, toStepString, tenantKey, stripSuiteCode, isVacant } from "./utils";
import type { Deal, ReviewQuestion } from "./idb";

export interface RentRollResult {
  asOf: string | null;
  totalSF?: number | null;     // roll's stated total (gross leasable) SF, if shown
  occupancy?: number | null;   // roll's stated % occupied (0–100), if shown
  tenants: NonNullable<Deal["tenants"]>;
  reviewQuestions?: ReviewQuestion[];
}

// Extract a tenant roster from rent-roll text (PDF or spreadsheet-derived).
// Shared by the deal page's "Refresh tenants" button and the smart uploader.
export async function extractRentRoll(text: string): Promise<RentRollResult> {
  const prompt = `You are a CRE data extraction engine. Extract every occupied tenant from this rent roll.
Return ONLY JSON: {"asOf":"YYYY-MM-DD or null","totalSF":number or null,"occupancy":number or null,"tenants":[{...}],"reviewQuestions":[{...}]}

Each tenant object (omit unknown fields):
{"name","suite","sf","rentPerSF","annualRent","leaseStart","leaseExpiry","leaseType","reimbursementMethod","camCapPct","camCapBasis","adminFeePct","mgmtFeeInCam","grossUpPct","recoverySF","leaseStatus","rentBumps","rentSchedule","renewalOptions","recentlyExercisedRenewal","assumptionNote","percentageRentClause","expenseReimbursements","percentageRent","otherRent","creditRating","salesPSF","isAnchor","isDark","remainingTermYears"}

Rules:
- Brand name only (no store #).
- Dates ISO YYYY-MM-DD.
- VACANT SUITES: INCLUDE every vacant/available unit as its OWN row — set name to "Vacant", capture its suite and sf, and leave ALL lease/rent fields null. Do NOT merge multiple vacant suites into one row, and do NOT drop them. A large vacant box (e.g. a former anchor) MUST appear. (This is how the app shows availability and reconciles occupied vs. total SF.)
- rentSchedule: future steps only as of the asOf date.
- SF and rents as plain numbers (no $ or commas).
- If a value isn't shown, omit it.
- remainingTermYears: compute from asOf to leaseExpiry if possible.
- KEEP EVERY FIELD CONCISE — output structured DATA, not prose. assumptionNote / percentageRentClause / recentlyExercisedRenewal / rentSchedule / renewalOptions must be SHORT one-line summaries (each ≤ ~160 characters). NEVER copy a lease's verbatim legal language (full percentage-rent, CAM-cap, co-tenancy, reimbursement or commencement-clause paragraphs) into any field — distill it to the key terms (e.g. "% rent 4% over natural breakpoint", "CAM cap 5%/yr non-cumulative"). A "Comments" column full of long legal text is a SOURCE to read, NOT text to reproduce. (Copying it verbatim bloats the response so much the extraction times out and fails — so summarize, never echo.)

CRITICAL LESSONS (past extractions failed on these — do NOT repeat):
- CAPTURE EVERY occupied line, never drop tenants. Anchors / junior anchors (the largest-SF tenants — grocers, Burlington, Marshalls, banks) are the MOST important to never omit. Before finishing, confirm the sum of your tenant SF reconciles with the rent roll's stated occupied SF; if it doesn't, you missed tenants — add them (largest first).
- isAnchor: SET IT TRUE for anchor / junior-anchor tenants — the large-format draws: grocers/supermarkets, big-box discounters & department stores (Walmart, Target box, Burlington, Ross, TJ Maxx/Marshalls, Kohl's), and large sporting-goods / pet / craft / furniture / fitness boxes (Dick's, Academy, PetSmart, Michaels, Bob's, Planet Fitness) — generally the biggest-SF occupants (roughly 15,000+ SF, or the 1–3 largest tenants in the center). Set FALSE for small inline shops, restaurants, services, and outparcel pads. A rent roll does NOT label anchors, so you MUST JUDGE from SF + brand — do NOT leave every tenant isAnchor:false just because the roll has no anchor column.
- leaseExpiry = CURRENT contractual expiration, NOT an unexercised option-extended date. If the roll shows a pro-forma "End" that assumes options are exercised, use the current expiry and put option dates in renewalOptions.
- BILLING BREAKDOWN → base rent vs reimbursements. Some rent rolls show the "Base Rent" / "Rate PSF" column as the TOTAL monthly billing, then a "Breakdown:" sub-section that splits it into "RNT - Rent" (the TRUE base rent) plus recovery lines ("CAM", "TAX" or "RET", "INS", etc.). When a breakdown is present: annualRent = the RNT/Rent line × 12 (NOT the gross total); expenseReimbursements = the SUM of the CAM + TAX/RET + INS + other recovery lines × 12; rentPerSF = base annualRent ÷ SF; set reimbursementMethod to "NNN" when CAM/TAX/INS are billed back. If there is NO breakdown, treat the base-rent column as base rent.
- SEPARATE RECOVERY COLUMNS layout: some rolls have distinct columns "Monthly CAM", "Monthly Taxes", "Monthly Ins", "Monthly Rent" (= base), plus totals "Annual Rent" (base) and "Gross Annual Rent" (base + recoveries), and a "Rent/SF" column. In that layout: annualRent = the "Annual Rent" column (base only) — NEVER the "Gross Annual Rent" column. rentPerSF = the "Rent/SF" column. expenseReimbursements = (Monthly CAM + Monthly Taxes + Monthly Ins) × 12. reimbursementMethod = "NNN" when CAM/Tax/Ins are billed back.
- "ANNUAL RENT INCREASE" vs "ANNUAL OPTION RENT" — CRITICAL, these are TWO DIFFERENT column groups; never conflate them. KPR's rent rolls show a "Term Comm. Date" / "Term Exp. Date" pair, then an "Annual Rent Increase" group (columns: Date / Amount / Incr-PSF) and SEPARATELY an "Option Term" / "Option Notice Date" / "Annual Option Rent" group (columns: Date / Amount / Incr-PSF). THE LEASE EXPIRATION DATE IS THE DIVIDER:
  • "Annual Rent Increase" rows = CONTRACTUAL fixed rent steps DURING the current lease term → rentSchedule. Their dates fall BEFORE the Term Exp. Date — that is the tell: an increase dated before expiration is a scheduled bump inside the lease, NOT an option. The "Incr/SF" column is the new $/SF rate; the "Amount" column is the new ANNUAL base rent. Emit each future-dated one as a step "YYYY-MM-DD: $<Incr/SF> PSF". NEVER leave rentSchedule empty when an Annual Rent Increase schedule exists for the tenant.
  • "Annual Option Rent" rows = renewal-OPTION period rents → renewalOptions ONLY (never rentSchedule). Their dates fall AT or AFTER the Term Exp. Date. Emit as "Opt: $<Incr/SF>/SF → <Mon YYYY>" using the option date.
  • Do NOT lump the contractual "Annual Rent Increase" steps into the renewalOptions string. If a date is before expiry it is a rent step; if it is at/after expiry it is an option.
- SKIP summary rows: a final "Total" / "Totals for Occupied Suites" / "Totals for Vacant Suites" row (a count like "24" with grand-total SF and rent) is NOT a tenant — never emit it as a row.
- DEAL-LEVEL TOTALS (top-level "totalSF" and "occupancy", NOT a tenant): from that same summary/"Total" line (usually at the very bottom), capture the center's STATED total/gross leasable SF as "totalSF" and the STATED percent occupied as "occupancy" (a number 0–100, e.g. 99.49). Many rolls print "Total: 240,710 SF ... 99.49% occupied". If the roll shows total SF but not a % occupied, still return totalSF and leave occupancy null. If neither is shown, set both null (the app will derive them by summing the roster).
- MONTHLY vs ANNUAL: amounts in these rolls are MONTHLY. annualRent and expenseReimbursements must be ANNUAL — multiply monthly figures by 12. Sanity-check: rentPerSF ≈ annualRent ÷ SF (a normal inline rent is ~$10–$120/SF, never thousands).
- rentSchedule = ONLY clean dated rent steps ("2027-12-01: $33.01 PSF") or "Flat at $X PSF through YYYY-MM-DD". NEVER put prose, explanations, or renewal narratives in rentSchedule — that belongs in assumptionNote. The "Future Rent Increases" columns/sub-rows (Cat / Date / Monthly Amount / PSF) ARE the steps — capture each future-dated one as a dated step (convert monthly amount to PSF or annual as needed).
- EXECUTED RENEWAL (extends the term): if a tenant appears in a "New Leases" section with a term that BEGINS the day after its current "Occupied" expiration (a contiguous, already-executed renewal), the lease has been extended — set leaseExpiry to the NEW (later) end date, and note it in recentlyExercisedRenewal (e.g. "10-yr renewal executed, now through 2037-01-18"). This is DIFFERENT from an unexercised OPTION (which stays in renewalOptions and does NOT change leaseExpiry).
- EXCLUDE non-inline / outparcel rows: shadow anchors and ground-lease pads that are NOT part of this property — typically 0 SF with a placeholder far-future or 12/31/00 expiration, or explicitly marked "(NAP)" / "Not A Part", such as Costco, Target, a theater, or a separately-owned bank/restaurant pad. Do NOT list these as tenants. (A real lease that happens to show 0 SF but has a NORMAL near-term expiration and ordinary rent — e.g. a gas station — IS a real tenant; keep it.)
- FUTURE RENT COMMENCEMENT (signed, not yet paying — IMPORTANT): a tenant whose rent has NOT YET commenced — its rent-commencement / lease-start date is AFTER the rent-roll "as of" date (often shown with $0 or blank current rent, a "Rent Commences MM/DD/YYYY" note, or in a "New Leases"/pre-opening section) — is a REAL, signed inline tenant in build-out / free-rent. It is NOT vacant and NOT a NAP/outparcel. ALWAYS include it as a normal tenant. Set leaseStart to the rent-commencement date, capture its leaseExpiry, and capture its CONTRACTUAL base rent (from the future/scheduled rent — the "when commenced" rent column or the first rent step) into rentPerSF and annualRent so it is NOT recorded as $0. Add assumptionNote "Rent commences YYYY-MM-DD". Do NOT drop it, zero it out, or mark it NAP just because current rent is $0.
- DEDUPE SECTIONS: a rent roll may have separate sections like "New Leases" / "Occupied" / "Vacant". If the same tenant or suite appears in BOTH a future/"New Leases" section AND an in-place "Occupied" section, output ONE row. Use the OCCUPIED current rent/SF; apply the EXECUTED RENEWAL rule above for the expiry. Never emit two rows for the same tenant/suite. Emit each "Vacant" suite as its own "Vacant" row per the VACANT SUITES rule (do NOT skip them) — but if a suite is listed BOTH as Vacant and as occupied/new-leased to a named tenant, keep only the occupied/named row.
- suite: always capture the suite/unit id when present — it's the most reliable key for matching this tenant to an existing roster. The suite is the value in the LEFTMOST "Suite" / "Suite/Space" / "Unit" column, which is SEPARATE from the tenant-name column. CAPTURE IT EVEN WHEN IT IS PURELY NUMERIC — e.g. "38", "1", a zero-padded code like "00002"/"00011" (KPR rent rolls use these), or a range like "23-24" / "19N20". Do NOT mistake a numeric suite for a row number and skip it: every tenant row in these rolls leads with its suite code, so a leading number before the tenant name IS the suite → put it in the suite field (you may strip leading zeros, e.g. "00002" → "2"). Alphanumeric forms like "14-WALM", "15908A", "B" also go in suite. Never fold the suite into the tenant name.
- leaseType is the REIMBURSEMENT / LEASE STRUCTURE (NNN, Gross, Modified Gross, NN, Base Year). It is NOT a renewal-option type. NEVER put option-type codes like "AUT" (automatic) or "REN" (renewal) in leaseType — those describe the renewal option; put that detail in renewalOptions, or omit it. Leave leaseType null if the structure isn't stated.
- RECOVERY DETAIL → structured fields. When the roll's recovery / "Comments" column discloses recovery terms, ALSO populate the structured fields (not just the reimbursementMethod string): camCapPct (annual cap on controllable CAM, e.g. 5), camCapBasis ("cumulative"|"non-cumulative"), adminFeePct (admin fee % of CAM), mgmtFeeInCam (true=mgmt fee in CAM / false=excluded), grossUpPct (gross-up %), and recoverySF (the SF recoveries are BILLED on when it differs from the leased sf). Leave each null when not stated.
- leaseStatus: set "executed" for a normal in-place tenant; "signed-not-open" when the lease is signed but rent has not commenced / store not open; "loi" or "proposed" when the deal is only an LOI / proposed (not executed) but the roll models it in place. These overstate income until signed.
- ATM vs BANK BRANCH: a standalone ATM (e.g. "Chase Bank ATM", "Bank of America ATM", usually 0 or tiny SF) is NOT a bank branch. KEEP "ATM" in the name and list it as its OWN tenant row — never merge it into the bank's branch lease.

reviewQuestions: a SHORT list (max ~4) of values you could NOT capture with confidence from THIS rent roll — e.g. an unlabeled/ambiguous SF or rent column, a number that was blurry or split oddly, two rows that might be the same tenant, or an "as of" date you had to guess. Each: {"severity":"high|medium|low","field":"human label e.g. 'Five Below — SF'","question":"short confirm question","detail":"1 sentence on the ambiguity","suggestedValue":"what you captured, as a string","target":{"kind":"tenant","fieldKey":"exact tenant field key (sf, rentPerSF, annualRent, leaseStart, leaseExpiry, remainingTermYears, salesPSF)","tenantName":"exact tenant name from the tenants array","valueType":"number|text"}}. ALWAYS set target when the question is about one tenant's field so the user can fix it in one click; set target null only for non-field questions (e.g. possible duplicate rows). Only flag genuine uncertainty — NOT values simply absent from the roll. Empty array if the roll was clean.`;

  const taught = await lessonGuidanceClient("rent-roll");
  const baseContent = prompt + taught + "\n\nRENT ROLL TEXT:\n" + text;
  const callRoll = async (suffix: string, maxTokens: number) => {
    const res = await apiAiMessages({
      // Sonnet (not Haiku) — rent rolls are dense and accuracy-critical (suites,
      // rent steps vs options, tricky multi-line layouts). Worth the extra cost.
      model: "claude-sonnet-4-6",
      max_tokens: maxTokens,
      messages: [{ role: "user", content: baseContent + suffix }],
    });
    return {
      raw: res.content?.[0]?.text ?? "",
      stop: (res as unknown as { stop_reason?: string }).stop_reason,
    };
  };

  // Bound each request so no single synchronous call runs for minutes (a long
  // generation gets cut by the hosting gateway → the upload fails with a generic
  // "AI request failed"). 16k comfortably holds ~50 concise tenants in one pass;
  // genuinely large malls finish via the continuation loop below — each round is
  // its own bounded request, so none of them time out either.
  const first = await callRoll("", 16000);
  let parsed: { asOf?: string | null; totalSF?: unknown; occupancy?: unknown; tenants?: unknown[]; reviewQuestions?: unknown[] };
  try { parsed = robustParseJSON(first.raw) as typeof parsed; }
  catch { throw new Error("Couldn't parse the rent roll. Try a clearer file."); }
  let tenants = (Array.isArray(parsed.tenants) ? parsed.tenants : []) as NonNullable<Deal["tenants"]>;
  if (tenants.length === 0) throw new Error("No tenants found in the rent roll.");

  // Completeness backstop: big, detail-heavy rolls (long rent-step + option
  // schedules per tenant) can overrun the output budget and truncate the tail of
  // the tenant list. If the model stopped on the token limit, keep asking for the
  // tenants we don't yet have so NONE are dropped. Mirrors the OM extractor.
  let stop = first.stop;
  let rounds = 0;
  while (stop === "max_tokens" && rounds < 6) {
    rounds++;
    const have = (tenants as Array<{ name?: string }>).map(t => t?.name).filter(Boolean) as string[];
    const cont = await callRoll(
      `\n\nYour previous answer was TRUNCATED before the end of the rent roll. Return ONLY JSON {"tenants":[...]} containing ONLY the occupied or vacant suites NOT already in the list below — same per-tenant schema and same rules. If none remain, return {"tenants":[]}.\nAlready captured (${have.length}): ${have.join(", ")}`,
      16000,
    );
    let more: unknown[] = [];
    try { more = (robustParseJSON(cont.raw) as { tenants?: unknown[] }).tenants || []; } catch { break; }
    const haveSet = new Set(have.map(n => n.toLowerCase()));
    const fresh = (more as Array<{ name?: string }>).filter(t => t?.name && !haveSet.has(t.name.toLowerCase()));
    if (fresh.length === 0) break;
    tenants = tenants.concat(fresh as NonNullable<Deal["tenants"]>);
    stop = cont.stop;
  }
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
  const posNum = (v: unknown) => { const x = Number(v); return Number.isFinite(x) && x > 0 ? x : null; };
  return {
    asOf: parsed.asOf || new Date().toISOString().slice(0, 10),
    totalSF: posNum(parsed.totalSF),
    occupancy: posNum(parsed.occupancy),
    tenants, reviewQuestions,
  };
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
    model: "claude-sonnet-4-6",
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

// Parse a lease date (ISO YYYY-MM-DD preferred; MM/DD/YYYY and YYYY-MM
// fallbacks) to a Date at local noon so a bare date never shifts a day across
// time zones. Returns null when unparseable.
function parseRollDate(raw: unknown): Date | null {
  const s = String(raw ?? "").trim();
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) { const d = new Date(s + "T12:00:00"); return isNaN(d.getTime()) ? null : d; }
  if (/^\d{4}-\d{2}$/.test(s)) { const [y, m] = s.split("-").map(Number); return new Date(y, m, 0, 12); }
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [mo, d, y] = s.split("/").map(Number);
    const fy = y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
    const dt = new Date(fy, mo - 1, d, 12); return isNaN(dt.getTime()) ? null : dt;
  }
  const d = new Date(s); return isNaN(d.getTime()) ? null : d;
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
  const prior = (deal.reviewQuestions ?? []).filter(q => !(q.source === "ai" && (q.id ?? "").startsWith("ai-rr-")));
  const reviewQuestions = [...prior, ...fresh];

  // Fields that an options-focused or partial rent roll often omits. When the new
  // row leaves one blank but the existing OM roster had it, carry the old value
  // forward — so a "Lease Options" upload never wipes SF / rent / start dates.
  const CARRY_OVER = [
    "sf", "annualRent", "rentPerSF", "leaseStart", "leaseExpiry", "remainingTermYears",
    "leaseType", "reimbursementMethod", "camCapPct", "camCapBasis", "adminFeePct",
    "mgmtFeeInCam", "grossUpPct", "recoverySF", "leaseStatus", "rentBumps", "rentSchedule",
    "salesPSF", "salesYear", "expenseReimbursements", "percentageRent", "otherRent",
    "creditRating", "isAnchor", "isNAP", "isDark", "parentCompany",
  ];
  const blank = (v: unknown) => v == null || v === "";
  const nrm = (s: unknown) => String(s ?? "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  // Canonical suite key: lowercase alphanumeric with leading zeros stripped from
  // each segment, so an OM's zero-padded "16-005" and a rent roll's "16-5" (or
  // "008A" vs "8a") resolve to the same suite and merge instead of duplicating.
  const suiteN = (s: unknown) => String(s ?? "").toLowerCase()
    .split(/[^a-z0-9]+/).filter(Boolean)
    .map(part => part.replace(/^0+(?=[0-9])/, ""))
    .join("");

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

  // Freshen each tenant's remaining term from its lease-expiry against THIS
  // roll's as-of date. The model's stored remainingTermYears can be stale from
  // an earlier as-of (a lease with 5y left a year ago still said 5y), which made
  // WALT drift after a roster paste. Recompute deterministically wherever a
  // lease-expiry exists; leave the model's value only when the date is missing.
  const asOfRef = parseRollDate(result.asOf) ?? new Date();
  for (const t of tenants as Array<Record<string, unknown>>) {
    const exp = parseRollDate(t.leaseExpiry);
    if (exp) {
      const yrs = Math.max(0, (exp.getTime() - asOfRef.getTime()) / (365.25 * 86_400_000));
      t.remainingTermYears = Math.round(yrs * 10) / 10;
    }
  }

  // Recompute occupancy / WALT from the FULL merged roster (not just the new
  // rows), so a partial file doesn't understate occupancy.
  // Vacant rows count toward total SF but NOT toward occupied SF or WALT, and
  // NAP/outparcel rows (not part of this property) count toward neither.
  const occTenants = tenants.filter(t => {
    const r = t as Record<string, unknown>;
    return !isVacant(r.name) && r.isNAP !== true;
  });
  const occupiedSF = occTenants.reduce((s, t) => s + (nv((t as Record<string, unknown>).sf) ?? 0), 0);

  // Total GLA: a rent-roll-only deal has no OM-stated totalSF, which left it flagged
  // "thin" with blank SF/occupancy. Use the roll's STATED total when captured, else
  // derive it by summing every non-NAP suite (occupied + vacant) in the roster. Gap-fill
  // only — never override an existing or user-verified totalSF (the OM's GLA wins).
  const statedTotalSF = nv(result.totalSF);
  const grossRosterSF = (tenants as Array<Record<string, unknown>>)
    .filter(t => t.isNAP !== true)
    .reduce((s, t) => s + (nv(t.sf) ?? 0), 0);
  let effectiveTotalSF = nv(deal.totalSF);
  if (effectiveTotalSF == null && !deal.verified?.totalSF) {
    const t = statedTotalSF ?? (grossRosterSF > 0 ? grossRosterSF : null);
    if (t != null) { recomputed.totalSF = Math.round(t); effectiveTotalSF = t; }
  }

  // Occupancy: prefer the roll's stated %, else compute occupied ÷ total GLA.
  if (!deal.verified?.occupancy) {
    const statedOcc = nv(result.occupancy);
    if (statedOcc != null && statedOcc > 0 && statedOcc <= 100) {
      recomputed.occupancy = Math.round(statedOcc * 10) / 10;
    } else if (effectiveTotalSF) {
      const occ = Math.round(occupiedSF / effectiveTotalSF * 1000) / 10;
      if (occ > 0 && occ <= 100) recomputed.occupancy = occ;
    }
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
