import type { LeaseAbstract } from "./idb";
import { apiAiMessages } from "./api";
import { robustParseJSON } from "./utils";

// Read a BROKER-PROVIDED lease abstract / lease-summary document (the "Summary of
// Lease Provisions" / abstract workbook that brokers hand out) and turn it into the
// app's structured LeaseAbstract objects — so a broker file can be dropped straight
// into "Upload abstracts" instead of being abstracted by hand. The PDF/Excel text is
// extracted upstream (with OCR for scans); this just does the AI structuring.
//
// HARD RULES baked into the prompt (the lease-abstracting discipline this app holds):
//   • A broker summary is NOT an executed lease — everything is verifiedAgainstExecutedDoc:false.
//   • Co-tenancy trigger fidelity: capture the EXACT structure (any-named / X-of-N /
//     occupancy-threshold) — never collapse an "X of N" into a per-anchor trigger.
//   • Never invent: an absent clause is null / "None"; an ambiguous one is flagged.

export interface AbstractExtractResult {
  abstracts: LeaseAbstract[];
  note?: string | null;
}

const PROMPT = `You convert a BROKER-PROVIDED lease abstract / "Summary of Lease Provisions" document into structured lease-abstract records for a commercial-real-estate (retail shopping center) underwriting app.

Return ONLY valid JSON — no markdown fences, no prose — with this exact shape:
{
  "abstracts": [
    {
      "tenantName": "string — the tenant/brand as it would appear on a rent roll (strip store #, entity suffixes: 'Office Depot, Inc. #3362' -> 'Office Depot')",
      "dba": "string or null — operating banner if different from the tenant of record",
      "suite": "string or null",
      "currentSF": number_or_null,
      "commencement": "YYYY-MM-DD or null",
      "expiration": "YYYY-MM-DD or null — the CURRENT lease expiration (not including unexercised options)",
      "guaranties": [ { "guarantor": "string", "scope": "string or null", "cap": "string or null", "inForce": true, "cite": { "doc": "string or null", "section": "string or null" } } ],
      "options": [ { "ordinal": 1, "number": "1st", "length": "5 years", "status": "available|exercised|expired", "optionType": "REN", "ratePSF": number_or_null, "rateDescriptor": "PSF|FMV|null", "expireDate": "YYYY-MM-DD or null", "exerciseConditions": "notice window / conditions", "cite": { "doc": "string or null", "section": "string or null" } } ],
      "percentageRent": { "value": "short description, e.g. '1% of gross sales over a $31.58M natural breakpoint'" },
      "exclusives": [ { "description": "the exclusive-use / landlord covenant, verbatim or close", "cite": { "doc": "string or null", "section": "string or null" } } ],
      "coTenancy": [ {
        "type": "opening|operating",
        "triggerLogic": {
          "type": "named_anchor_dark|anchor_count_below|occupancy_threshold",
          "anchor": "single named anchor (for named_anchor_dark) or null",
          "anchors": ["full named list (for anchor_count_below) or null"],
          "openRequired": number_or_null,
          "totalNamed": number_or_null,
          "pct": number_or_null,
          "direction": "below|above|null",
          "note": "EXACT trigger in plain English — e.g. 'any 2 of 3 named go dark', '7 of 10 must stay open', 'below 75% of GLA'"
        },
        "remedy": { "mechanism": "alternate_rent_pct_sales|percent_rent_reduction|fixed_reduction|percent_rent_waiver|unknown", "value": number_or_null, "cap": "string or null", "note": "the remedy, e.g. '50% of minimum rent' or '3% of gross sales in lieu of base rent'" },
        "reliefPeriodMonthsBeforeTermination": number_or_null,
        "terminationNoticeDays": number_or_null,
        "currentlyInEffect": boolean_or_null,
        "verbatimQuote": "the source text the trigger came from, when available"
      } ],
      "salesKickout": [ { "salesThresholdAmount": number_or_null, "salesThresholdPSF": number_or_null, "measurementPeriod": "string", "noticeWindowDays": number_or_null, "terminationFee": number_or_null } ],
      "otherRiskClauses": {
        "goDarkRight": { "present": boolean, "summary": "string" },
        "continuousOperationCovenant": { "present": boolean, "summary": "string" },
        "exclusiveUse": { "present": boolean, "summary": "string" },
        "rofrRofo": { "present": boolean, "summary": "string" },
        "recaptureAssignment": { "present": boolean, "summary": "string" },
        "earlyTerminationOption": { "present": boolean, "summary": "string — e.g. kickout/termination right, with trigger, remedy, notice" }
      },
      "assignment": { "value": "assignment/subletting terms" },
      "leaseNotes": [ { "code": "RADIUS|EXCLUSI|COTENCY|KICKTN|KICKLL|RELOCAT|GUARANT|ASSNSUB|OPC|GO DARK|SECDEP|USE", "label": "human label", "value": "the clause text, or an explicit 'None'", "cite": { "doc": "string or null", "section": "string or null" } } ],
      "narrative": "2-4 sentence plain-English summary of this tenant's key lease levers",
      "flags": [ { "severity": "info|watch|defect", "issue": "short", "detail": "what to confirm" } ],
      "verifiedAgainstExecutedDoc": false
    }
  ],
  "note": "string or null — anything notable about the document overall (format, missing tenants, illegibility)"
}

RULES — follow exactly:
1. ONE abstract object per tenant in the document. Use the tenant/brand name a rent roll would use (strip store numbers, entity suffixes, DocuSign ids).
2. A BROKER SUMMARY IS NOT THE EXECUTED LEASE. Set "verifiedAgainstExecutedDoc": false on EVERY abstract, and on every coTenancy/salesKickout/otherRiskClauses entry. Add a flag noting it's summary-sourced and to verify against the executed lease for any deal-defining right.
3. NEVER INVENT. If a clause is stated as not applicable / "None", record it as an explicit "None" (with the right leaseNotes code). If a clause is genuinely absent from the summary, leave the structured field null — do NOT guess. If a clause is ambiguous, partly illegible, or internally inconsistent, capture what it appears to say AND raise a "flag" telling the user exactly what to confirm (this is most important for purchase options, ROFR/ROFO, co-tenancy, kickout/termination, exclusives, and guaranty scope).
4. CO-TENANCY TRIGGER FIDELITY — be exact, never over- or under-state. Capture the EXACT trigger structure and never collapse it:
   - "ANY named tenant" ("relief if any Key Tenant fails to open") -> type "named_anchor_dark" per named anchor.
   - "X of N" ("at least 7 of these 10 must stay open", "5 of 10 named") -> type "anchor_count_below" with the FULL named list, openRequired = X, totalNamed = N. Losing ONE named store does NOT trip it. NEVER model an X-of-N as a per-anchor solo trigger.
   - Occupancy-threshold ("below 75% of GLA occupied") -> type "occupancy_threshold" with pct and direction "below"; no named anchor.
   Always carry the precise remedy (alternate/substitute rent = X% of gross sales, or X% of minimum rent), the relief period before a termination right opens, and the notice window. Put the EXACT trigger in triggerLogic.note and a verbatimQuote when present.
5. SURFACE EVERY MID-TERM TENANT LEVER as a clause/flag: co-tenancy outs, sales/kickout terminations, go-dark / cease-operations rights & landlord recapture, exclusive-violation remedies, early-termination options, ROFR/ROFO, relocation rights, radius restrictions, and guaranty scope/caps. KICKTN = TENANT termination/kickout; KICKLL = LANDLORD termination/recapture (keep them separate).
6. DATES in ISO YYYY-MM-DD. Money as plain numbers. For options, "expiration" is the CURRENT lease expiration (exclude unexercised option periods); options go in the options array.
7. CITATIONS: capture the source doc + section/page for each value into its "cite" ({doc, section}) — on options, exclusives, guaranties, and each leaseNotes entry — whenever the document provides one.
8. MATRIX / "Summary of Key Lease Provisions" (SKLP) format — very common from brokers (Newmark/NMRK, CBRE, JLL): a grid with ONE ROW PER TENANT where most provision columns are immediately FOLLOWED BY a "Doc/Sec" column giving the source document + section/page (e.g. "Renewal | Doc/Sec | Expansion | Doc/Sec | Contraction | Doc/Sec | Termination | Doc/Sec | Relocation | Doc/Sec | Go Dark | Doc/Sec | Co-Tenancy | Doc/Sec | Radius | Doc/Sec | Exclusivity | Doc/Sec | Other | Doc/Sec"). Read each row into ONE abstract and:
   - Use each provision's ADJACENT "Doc/Sec" cell as that field's cite (cite.doc / cite.section). Carry it through.
   - Map columns: Renewal Option(s)->options; Termination->KICKTN / otherRiskClauses.earlyTerminationOption; Relocation->RELOCAT leaseNote + otherRiskClauses; Go Dark->otherRiskClauses.goDarkRight (AND any LANDLORD recapture / unamortized-TI buyout described inside it -> KICKLL); Co-Tenancy->coTenancy (exact trigger per rule 4); Radius Restriction->RADIUS; Exclusivity->exclusives + EXCLUSI; Expansion / Contraction->a leaseNotes entry each (code "USE" or a clear label) — don't drop them.
   - MINE THE "Other" COLUMN: it routinely buries the GUARANTOR ("Guarantor: <name>" -> guaranties[]), and items like parking, signage/pylon, utilities, alterations, patio/roof rights — capture the guaranty and any genuine risk lever; briefly summarize the rest in a leaseNotes "USE"/"Other" entry.
   - Record "None." / "Intentionally Deleted" FAITHFULLY as stated (an explicit None with its cite) — never omit a provided value and never invent one.
   If instead the document is a series of per-tenant PAGES, read each page into one abstract.

DOCUMENT TEXT:
`;

// Extract structured lease abstracts from a broker abstract document's text.
// Retries once on a malformed (non-JSON) response, like the other extractors.
export async function extractLeaseAbstracts(text: string): Promise<AbstractExtractResult> {
  const prompt = PROMPT + text.slice(0, 140000);
  const callOnce = async (): Promise<string> => {
    const res = await apiAiMessages({
      model: "claude-sonnet-4-6",
      max_tokens: 16000,
      messages: [{ role: "user", content: prompt }],
    });
    return res.content.find((c: { type: string }) => c.type === "text")?.text ?? "";
  };
  type Parsed = { abstracts?: unknown; note?: unknown };
  let parsed: Parsed | null = null;
  for (let attempt = 0; attempt < 2 && !parsed; attempt++) {
    const raw = await callOnce();
    try { parsed = robustParseJSON(raw) as Parsed; } catch { parsed = null; }
  }
  if (!parsed) throw new Error("Couldn't read the abstract document — try again, or paste the abstract JSON.");
  const arr = Array.isArray(parsed.abstracts) ? (parsed.abstracts as LeaseAbstract[]) : [];
  if (!arr.length) throw new Error("No lease abstracts were found in that document.");
  // Force the summary-sourced flag regardless of what the model returned — a broker
  // abstract is never an executed-document source.
  const abstracts = arr.map(a => ({ ...a, verifiedAgainstExecutedDoc: false as const }));
  const note = typeof parsed.note === "string" && parsed.note.trim() ? parsed.note.trim() : null;
  return { abstracts, note };
}
