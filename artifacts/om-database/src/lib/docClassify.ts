import type { Deal } from "./idb";
import { apiAiMessages } from "./api";
import { robustParseJSON } from "./utils";

export type DocType = "om" | "rent-roll" | "lease-options" | "sales" | "flyer" | "swap" | "loan" | "amort" | "unknown";

// Deterministic detector for a lease-OPTIONS schedule (a renewal-option report,
// not a full rent roll). These list option ladders but usually lack current SF /
// rent, so they must NOT replace a roster — they only enrich existing tenants.
// Filename hint + the distinctive option-schedule column headers; we require two
// strong signals so a normal rent roll (which may say "renewal option" once)
// doesn't trip it.
export function detectLeaseOptions(text: string, fileName: string): boolean {
  const fn = fileName.toLowerCase();
  const isOm = /\b(om|offering|memorandum|teaser|flyer|brochure)\b/.test(fn);
  const t = text.slice(0, 9000).toLowerCase();
  const headers = ["option type", "option date", "term to date", "rate descriptor", "option notes", "option number"];
  const hits = headers.filter(h => t.includes(h)).length;
  if (hits >= 2) return true;                                  // unmistakable options-schedule columns
  if (!isOm && /\boption/.test(fn) && hits >= 1) return true;  // "…Options.xlsx" + a header
  return false;
}

// Strong, unambiguous SALE-OM signals a leasing flyer never carries (a flyer, by
// definition, has no NOI / cap rate / offering summary / asking price / sale comps).
// The single source of truth used by every OM-vs-flyer safeguard: the flyer
// detector, the classifier's downgrade, and the router's final gate. Scans a
// generous window because sale figures can sit a little past the cover.
export function hasOmSaleSignals(text: string): boolean {
  const t = (text || "").slice(0, 12000).toLowerCase();
  // Only signals a LEASING flyer essentially never carries. Deliberately EXCLUDES
  // flyer-ambiguous tokens like "$/SF" (flyers quote lease rates that way) so a real
  // flyer isn't wrongly pulled onto the OM path — the guarantee is one-directional
  // (an OM must never become a flyer), not the reverse.
  return /(offering memorandum|offering summary|investment sales?|for sale\b|sale[- ]?leaseback|asking price|guidance price|whisper price|as[- ]?is[- ]?noi|net operating income|\bnoi\b|cap rate|going[- ]?in cap|sale comp|sale comparable|price per square foot)/.test(t);
}

// Deterministic detector for a LEASING FLYER (marketing one-pager for available
// space) vs a sale OM. Distinct cues: it advertises space "for lease" / "available"
// and lists a leasing contact, and is NOT a rent roll / sales / options file. Used
// only to override an "om"/"unknown" guess, so we don't reclassify real OMs.
export function detectFlyer(text: string, fileName: string): boolean {
  const fn = fileName.toLowerCase();
  // SAFEGUARD 1 — filename guard. Never reclassify an explicit rent-roll / sales /
  // options / financing file, OR a file titled as an Offering Memorandum / OM (a
  // sale package, not a marketing one-pager), mirroring the loan/amort guards.
  if (/\b(rent\s*roll|sales|option|swap|isda|loan|offering|memorandum)/.test(fn)) return false;
  if (/\bom\b/.test(fn)) return false;
  // SAFEGUARD 2 — sale-signal guard. If the body carries any sale-OM signal, this
  // is an OM, even though an OM routinely markets "available" lease-up UPSIDE
  // ("Currently Available for Lease Up") — which must NOT be read as a flyer's
  // availability list. This is the exact miss that mislabeled a full JLL OM.
  if (hasOmSaleSignals(text)) return false;
  const t = text.slice(0, 5000).toLowerCase();
  const fnHit = /flyer|leasing|availabilit|brochure/.test(fn);
  const bodyHit = /(for lease|space available|available sf|leasing department|leasing@|propertycapsule)/.test(t);
  return fnHit || bodyHit;
}

// Deterministic detector for an interest-rate SWAP confirmation (e.g. an ISDA
// dealer confirmation). Distinctive, unambiguous swap-doc phrases.
export function detectSwap(text: string, fileName: string): boolean {
  const fn = fileName.toLowerCase();
  const fnHit = /swap|isda/.test(fn);
  const t = text.slice(0, 6000).toLowerCase();
  const bodyHit = /(interest rate swap|swap transaction|isda master agreement|notional amount|fixed rate payer|floating rate payer)/.test(t);
  return fnHit || bodyHit;
}

// Deterministic detector for an AMORTIZATION schedule: a table of periodic
// payments with a running principal balance. Distinct from a loan agreement
// (legal prose) — this is the numeric schedule itself.
export function detectAmort(text: string, fileName: string): boolean {
  const fn = fileName.toLowerCase();
  if (/\b(rent\s*roll|sales|flyer|swap|isda|offering|memorandum)/.test(fn)) return false;
  const fnHit = /amort|payment schedule|loan schedule/.test(fn);
  const t = text.slice(0, 4000).toLowerCase();
  const bodyHit = /amortization schedule/.test(t)
    || (/(beginning|ending|remaining|principal)\s+balance/.test(t) && /(payment|principal|interest)/.test(t) && /(period|payment\s*(no|#|date)|month)/.test(t));
  return fnHit || bodyHit;
}

// Deterministic detector for a LOAN agreement / credit agreement / promissory
// note / loan term sheet / closing statement. Uses unambiguous loan-doc phrases
// so it won't steal a sale OM (which markets a property, not a financing).
export function detectLoan(text: string, fileName: string): boolean {
  const fn = fileName.toLowerCase();
  if (/\b(rent\s*roll|sales|option|flyer|swap|isda|offering|memorandum|amort)/.test(fn)) return false;
  const fnHit = /loan|credit agreement|promissory|term sheet|mortgage|deed of trust|financing|closing statement/.test(fn);
  const t = text.slice(0, 6000).toLowerCase();
  const bodyHit = /(loan agreement|credit agreement|promissory note|loan and security agreement|deed of trust|loan term sheet|closing (statement|disbursement)|principal amount of the loan)/.test(t);
  return fnHit || bodyHit;
}

// ── Advisory detectors for documents the site has NO build path for ───────────
// These NEVER change routing — they only let the uploader tell the user how to
// handle a document it can't build from (a raw lease, or a recorded REA/easement),
// instead of silently mis-reading it as an OM. Both are guarded so a real sale OM
// is never caught (see detectUnsupportedDoc).

// A RAW EXECUTED LEASE or lease AMENDMENT (the legal instrument itself) — distinct
// from a rent roll, a lease-OPTIONS schedule, or a broker's lease ABSTRACT (which
// has its own "Upload abstracts" reader). The site can't build a deal from a lease.
export function detectLease(text: string, fileName: string): boolean {
  const fn = fileName.toLowerCase();
  // Don't second-guess a file explicitly named as a supported type or an abstract.
  if (/(rent\s*roll|abstract|offering|memorandum|\bom\b|sales|flyer|swap|isda|\bloan\b|amort)/.test(fn)) return false;
  const t = text.slice(0, 8000).toLowerCase();
  // Unmistakable executed-lease / amendment legal language.
  const strong = /(this lease( agreement)? is made|in consideration of the mutual covenants|witnesseth|demised premises|amendment to lease|lease amendment|(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) amendment to (the )?lease)/.test(t);
  if (strong) return true;
  // Filename hints lease/amendment AND the body reads like a lease.
  const fnHit = /lease|amendment|estoppel|\bsnda\b/.test(fn);
  const bodyLease = /\blandlord\b/.test(t) && /\btenant\b/.test(t) && /(base rent|minimum rent|commencement date|term of th(e|is) lease|demised premises)/.test(t);
  return fnHit && bodyLease;
}

// A recorded PROPERTY-LEVEL agreement — REA / OEA / CC&R / declaration of easements.
// The site records these in Site Agreements but can't read the recorded PDF itself.
export function detectREA(text: string, fileName: string): boolean {
  const fn = fileName.toLowerCase();
  if (/(rent\s*roll|abstract|offering|memorandum|\bom\b|sales|flyer|swap|isda|\bloan\b|amort)/.test(fn)) return false;
  const t = text.slice(0, 8000).toLowerCase();
  const strong = /(reciprocal easement agreement|operation and easement agreement|construction, operation and reciprocal easement|declaration of covenants,? conditions,? and restrictions|declaration of easements|declaration of restrictions|easements,? covenants,? and restrictions)/.test(t);
  if (strong) return true;
  const fnHit = /\b(rea|oea|ccr|cc&r)\b|reciprocal easement|easement|covenants|declaration/.test(fn);
  const bodyHit = /(reciprocal easement|operation and easement|covenants, conditions and restrictions|declaration of easement)/.test(t);
  return fnHit && bodyHit;
}

export interface UnsupportedDoc {
  kind: "lease" | "rea";
  title: string;    // short label for the badge
  message: string;  // friendly, actionable line for the upload queue
}

// Advisory-only: identify a dropped document the site has no build path for, so the
// uploader can tell the user how to handle it (via Claude Code → JSON import)
// INSTEAD of mis-processing it. Returns null for every document the site DOES
// handle. The hasOmSaleSignals guard guarantees a real sale OM is never flagged.
export function detectUnsupportedDoc(text: string, fileName: string): UnsupportedDoc | null {
  if (hasOmSaleSignals(text)) return null;   // a sale OM is always handled — never flag it
  if (detectLease(text, fileName)) {
    return {
      kind: "lease",
      title: "Looks like a lease / amendment",
      message: "This looks like a raw lease or amendment. The site builds deals from OMs and rent rolls, not from a lease itself. Run it through Claude Code to get a lease-abstract JSON, then load it on the deal with “Upload abstracts.” Nothing was uploaded.",
    };
  }
  if (detectREA(text, fileName)) {
    return {
      kind: "rea",
      title: "Looks like an REA / easement",
      message: "This looks like an REA, easement, or CC&R document. The site can’t read these directly. Run it through Claude Code to get JSON, then add it in the deal’s Site Agreements section. Nothing was uploaded.",
    };
  }
  return null;
}

export interface Classification {
  type: DocType;
  propertyName: string | null;
  address: string | null;
  confidence: "high" | "medium" | "low";
}

// A leasing flyer is a short marketing one-pager; a document this many pages or
// more is a full package (OM / rent roll / brochure), never a flyer.
const FLYER_MAX_PAGES = 8;

// Apply the deterministic type overrides on top of the LLM's guess. Pure and
// exported so the routing rules are unit-testable without a model call. Order
// matters: the more specific financing detectors run before flyer, and the
// page-count guard runs LAST so a long document can never end up a flyer.
export function applyDeterministicOverrides(
  llmType: DocType, text: string, fileName: string, pageCount?: number | null,
): DocType {
  let type = llmType;
  // An options schedule must never be treated as a roster-replacing rent roll.
  if ((type === "rent-roll" || type === "unknown") && detectLeaseOptions(text, fileName)) type = "lease-options";
  // Swap and loan docs are financing, never a sale OM (swap first — more specific).
  if ((type === "om" || type === "unknown") && detectSwap(text, fileName)) type = "swap";
  // Amortization (numeric payment table) before "loan" so a "loan schedule" isn't grabbed by the loan detector.
  if ((type === "om" || type === "loan" || type === "unknown") && detectAmort(text, fileName)) type = "amort";
  if ((type === "om" || type === "unknown") && detectLoan(text, fileName)) type = "loan";
  // A leasing flyer must never be read as a sale OM (which would mine it for
  // financials / treat available space as in-place tenants).
  if ((type === "om" || type === "unknown") && detectFlyer(text, fileName)) type = "flyer";
  // SAFEGUARD 3 — sale-signal downgrade. Even if the LLM returned "flyer" DIRECTLY
  // (so detectFlyer's guards were never consulted), a document carrying sale-OM
  // signals is an OM. This closes the LLM-misfire hole regardless of length.
  if (type === "flyer" && hasOmSaleSignals(text)) type = "om";
  // SAFEGUARD 4 — length guard. A flyer is a short one-pager; a document this long
  // is a full package, never a flyer (catches a loose cue AND an LLM misfire).
  if (type === "flyer" && pageCount != null && pageCount >= FLYER_MAX_PAGES) type = "om";
  return type;
}

// Cheap first-pass classification: read the opening of a document and decide
// what KIND it is and which property it refers to. Uses Haiku on a truncated
// slice (classification needs the top of the doc, not the whole thing).
export async function classifyDocument(text: string, fileName: string, pageCount?: number | null): Promise<Classification> {
  const slice = text.slice(0, 6000);
  const prompt = `You are a commercial real estate document classifier. Given the START of a document (and its file name), identify what it is and which property it concerns.

Return ONLY JSON: {"type":"om|rent-roll|lease-options|sales|flyer|swap|loan|amort|unknown","propertyName":string|null,"address":string|null,"confidence":"high|medium|low"}

Definitions:
- "om" = an Offering Memorandum / investment-SALE package for a property being sold (has sections like investment highlights, sale financials/NOI/cap rate, rent abstracts, sale comps).
- "rent-roll" = a tenant rent roll / lease schedule: a table of tenants with SF, rent, lease dates. NOT a marketing narrative.
- "lease-options" = a renewal-OPTIONS schedule: rows of option periods per tenant (columns like Option Type, Option Date, Term To Date, Rate, Rate Descriptor, Option Notes). It lists option ladders, usually WITHOUT current SF/rent. Distinct from a rent roll.
- "sales" = a tenant SALES report: tenant sales volumes / sales-per-SF / occupancy-cost figures, usually by year or trailing 12 months.
- "flyer" = a LEASING flyer / availability brochure: a SHORT marketing one-pager (typically 1–4 pages) advertising AVAILABLE space FOR LEASE at a center. Has property highlights, demographics, a co-tenant lineup, available suites, and a leasing-contact — but NO sale price/NOI/cap rate and NO per-tenant rents. Distinct from an "om". CRITICAL: a document that mentions "available space", "lease-up", or "for lease" but ALSO has sale financials (NOI, cap rate, offering summary, asking price, sale comps) is an "om", NOT a flyer — a sale OM routinely markets vacancy lease-up as UPSIDE. When in doubt between "om" and "flyer", if any sale financials are present it is "om".
- "swap" = an interest-rate SWAP confirmation (e.g. an ISDA dealer confirmation): a notional amount, fixed rate, floating rate option (SOFR), spread, trade/effective/termination dates, and a Fixed/Floating Rate Payer.
- "loan" = a LOAN document: a loan agreement, credit agreement, promissory note, loan term sheet, or closing statement — the FINANCING terms (lender, loan amount, rate, maturity, LTV, prepayment). Distinct from an "om" (a sale-marketing package, not a loan).
- "amort" = an AMORTIZATION SCHEDULE: a table of periodic payments with a running principal balance (columns like Period/Date, Payment, Interest, Principal, Balance). The numeric schedule itself, not a legal loan agreement.
- "unknown" = none of the above, or can't tell.

Rules:
- propertyName / address: the subject property this document is about, if stated (clean name, no boilerplate). null if not clear.
- confidence: "high" only if the type is obvious from clear structural cues. Use the file name as a weak hint only.
- Output JSON only, no prose.

FILE NAME: ${fileName}

DOCUMENT START:
${slice}`;

  try {
    const res = await apiAiMessages({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });
    const raw = res.content?.[0]?.text ?? "";
    const parsed = robustParseJSON(raw) as Partial<Classification>;
    const llmType = (["om", "rent-roll", "lease-options", "sales", "flyer", "swap", "loan", "amort", "unknown"] as const).includes(parsed.type as DocType)
      ? (parsed.type as DocType) : "unknown";
    const type = applyDeterministicOverrides(llmType, text, fileName, pageCount);
    const confidence = (["high", "medium", "low"] as const).includes(parsed.confidence as Classification["confidence"])
      ? (parsed.confidence as Classification["confidence"]) : "low";
    return {
      type,
      propertyName: typeof parsed.propertyName === "string" && parsed.propertyName.trim() ? parsed.propertyName.trim() : null,
      address: typeof parsed.address === "string" && parsed.address.trim() ? parsed.address.trim() : null,
      confidence,
    };
  } catch {
    return { type: "unknown", propertyName: null, address: null, confidence: "low" };
  }
}

// ── Deal matching ───────────────────────────────────────────────────────────

export interface DealMatch {
  deal: Deal | null;
  confidence: "high" | "medium" | "none";
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

// Filler words common to shopping-center names that frequently differ between an
// OM and its rent roll (e.g. "Haymarket Center" vs "Haymarket Village Center", or
// "… Shopping Center" vs "… Marketplace"). Matching on the DISTINCTIVE tokens that
// remain after dropping these lets those naming variants still link.
const CENTER_FILLER = new Set([
  "the", "at", "of", "and", "on", "a", "an",
  "center", "centre", "shopping", "village", "plaza", "square", "mall", "marketplace",
  "market", "commons", "common", "crossing", "crossings", "station", "shoppes", "shops",
  "shoppe", "corner", "corners", "place", "park", "retail", "outlets", "outlet", "gateway",
  "town", "towne", "pavilion", "promenade", "galleria", "court", "junction", "village",
  "shoppingcenter", "shoppingcentre",
]);
const distinctiveTokens = (s: string): string[] =>
  s.toLowerCase().split(/[^a-z0-9]+/).filter(t => t.length >= 3 && !CENTER_FILLER.has(t));

// Every name a deal answers to: its propertyName plus any "also known as" aliases
// (borrowing entity, broker's phase name, etc.). Lets a document under a different
// name still route to the right deal.
const dealNames = (d: Deal): string[] =>
  [d.propertyName, ...(Array.isArray(d.aka) ? d.aka : [])].map(s => (s || "").trim()).filter(Boolean);

/**
 * Match a classified document to an existing deal by property name / address /
 * file name. Returns a confidence so callers can auto-commit only when sure.
 * (Generalizes UploadQueue's findDuplicate with a confidence signal.)
 */
export function matchDeal(
  hint: { propertyName?: string | null; address?: string | null; fileName?: string | null },
  existing: Deal[],
): DealMatch {
  const active = existing.filter(d => !d.trashedAt);

  // Address guard: when BOTH sides have an address, they must be compatible —
  // otherwise two different properties that share a NAME (e.g. "Crossroads Plaza"
  // in two states) would wrongly match. If either address is missing/too short we
  // can't tell, so we don't block (fall back to the name/token signals).
  const na = norm(hint.address || "");
  const addrConflict = (d: Deal) => {
    const da = norm(d.address || "");
    if (na.length < 6 || da.length < 6) return false;
    return !(na === da || na.includes(da) || da.includes(na));
  };

  // 1) Exact file-name match (strong) — but never across conflicting addresses.
  const cleanFile = (hint.fileName || "").replace(/\.(pdf|xlsx?|xlsm|xlsb|csv)$/i, "").toLowerCase().trim();
  if (cleanFile) {
    const byFile = active.find(d => (d.fileName || "").toLowerCase() === cleanFile && !addrConflict(d));
    if (byFile) return { deal: byFile, confidence: "high" };
  }

  // 2) Property-name match (rejected when the addresses clearly differ) — checks
  // the deal's propertyName AND any "also known as" alias.
  const np = norm(hint.propertyName || "");
  if (np.length > 4) {
    const exact = active.find(d => !addrConflict(d) && dealNames(d).some(n => { const p = norm(n); return p.length > 4 && p === np; }));
    if (exact) return { deal: exact, confidence: "high" };
    // Containment (e.g. "Maple Plaza" vs "Maple Plaza Shopping Center")
    const partial = active.find(d => !addrConflict(d) && dealNames(d).some(n => { const p = norm(n); return p.length > 6 && (p.includes(np) || np.includes(p)); }));
    if (partial) return { deal: partial, confidence: "medium" };
  }

  // 2b) Distinctive-token match — links naming variants that aren't substrings of
  // each other ("Haymarket Center" vs "Haymarket Village Center"). Require every
  // distinctive token of the shorter name to appear in the other, with at least one
  // solid (≥4-char) shared token, so generic single-word overlaps don't false-match.
  // Checked against each of the deal's names (propertyName + aliases).
  const htoks = distinctiveTokens(hint.propertyName || "");
  if (htoks.length) {
    const tokMatch = active.find(d => {
      if (addrConflict(d)) return false;
      return dealNames(d).some(n => {
        const dtoks = distinctiveTokens(n);
        if (!dtoks.length) return false;
        const [short, long] = htoks.length <= dtoks.length ? [htoks, dtoks] : [dtoks, htoks];
        const longSet = new Set(long);
        return short.every(t => longSet.has(t)) && short.some(t => t.length >= 4);
      });
    });
    if (tokMatch) return { deal: tokMatch, confidence: "medium" };
  }

  // 3) Address match (positive signal).
  if (na.length > 8) {
    const exact = active.find(d => { const a = norm(d.address || ""); return a.length > 8 && a === na; });
    if (exact) return { deal: exact, confidence: "high" };
    const partial = active.find(d => { const a = norm(d.address || ""); return a.length > 10 && (a.includes(na) || na.includes(a)); });
    if (partial) return { deal: partial, confidence: "medium" };
  }

  return { deal: null, confidence: "none" };
}

/**
 * Is there a *possible* (but not confident) overlap between this document and an
 * existing deal — i.e. a near-miss that's worth a human confirm? Broader than
 * matchDeal's auto-merge tiers: it fires when the doc shares ANY distinctive
 * name token, or a partial name/address overlap, with some existing property.
 * Used to decide between "just create the new property" (no overlap at all) and
 * "ask the user to match-or-create" (a near-miss exists).
 */
export function hasPossibleMatch(
  hint: { propertyName?: string | null; address?: string | null; fileName?: string | null },
  existing: Deal[],
): boolean {
  const active = existing.filter(d => !d.trashedAt);
  const np = norm(hint.propertyName || "");
  const na = norm(hint.address || "");
  const htoks = distinctiveTokens(hint.propertyName || "");
  for (const d of active) {
    for (const name of dealNames(d)) {                 // check propertyName + aliases
      const p = norm(name);
      if (htoks.length) {
        const dset = new Set(distinctiveTokens(name));
        if (htoks.some(t => t.length >= 4 && dset.has(t))) return true; // a shared distinctive token
      }
      if (np.length >= 4 && p.length >= 4 && (p.includes(np) || np.includes(p))) return true; // loose name overlap
    }
    const da = norm(d.address || "");
    if (na.length >= 6 && da.length >= 6 && (na.includes(da) || da.includes(na))) return true; // address overlap
  }
  return false;
}
