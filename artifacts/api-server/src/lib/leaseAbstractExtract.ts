// ─────────────────────────────────────────────────────────────────────────────
// Lease-abstract auto-extraction engine (Phase 2) — DORMANT / INTERNAL.
//
// This module reconciles a tenant's FULL lease document set (original lease +
// amendments + assignments + guaranties + option exercises + waivers) into a
// structured LeaseAbstract — the same job we currently do by hand (Claude in a
// session, pasted in via the "no-API" path). It is fully built and type-checked
// but intentionally NOT wired into the live router or UI yet (see
// routes/leaseAbstractExtract.ts). Nothing on the site calls this until we
// deliberately enable it.
//
// Methodology encoded here (proven across King Soopers, Stop & Shop, Fresh Farms):
//   - Read every document in full; never conclude from a partial read.
//   - Two passes: (1) per-document digest, capturing each fact with the section
//     and page where it appears; (2) chronological reconciliation where the
//     LATEST controlling document wins (supersession), producing one abstract.
//   - Guaranty is a STACK (a lease can accumulate several across assignments).
//   - Every fact cites its document, section, and page — source PDFs are never
//     stored, so the citation is how the user finds the original.
//   - Surface reconciliation/defect FLAGS (gaps, possible invalid option
//     exercises, surviving consent rights, etc.) rather than silently guessing.
// ─────────────────────────────────────────────────────────────────────────────

import { callAnthropicOnce, robustParseJSON } from "./extract";

// Models: Sonnet for both passes (accuracy over speed — KPR's standing
// preference). Kept as constants so a future tuning pass is one edit.
const RECONCILE_MODEL = "claude-sonnet-4-6";
const DIGEST_MODEL = "claude-sonnet-4-6";

// A single source document fed to the engine (full extracted text + light meta).
export interface LeaseDocInput {
  name: string;            // document name, e.g. "Cub Foods (Supervalu Holdings) Lease"
  date?: string | null;    // ISO if known — drives chronological ordering
  type?: string | null;    // lease | amendment | guaranty | assignment | option | waiver | letter | license | other
  text: string;            // FULL extracted text of the document
}

export interface ReconcileOptions {
  tenantName?: string | null;   // the roster tenant this abstract links to
  dealName?: string | null;     // property name for context
  log?: MiniLog;
  // Hard cap on characters fed per document in pass 1 (very large OCR dumps are
  // truncated with a flag rather than blowing the context window).
  maxCharsPerDoc?: number;
}

type MiniLog = { info: (o: unknown, m?: string) => void; warn: (o: unknown, m?: string) => void; error: (o: unknown, m?: string) => void };
const NOOP_LOG: MiniLog = { info: () => {}, warn: () => {}, error: () => {} };

interface AnthropicTextResponse {
  content?: { type: string; text?: string }[];
  error?: unknown;
}

// One call to Claude that returns the concatenated text blocks.
async function callClaudeText(system: string, user: string, model: string, maxTokens: number): Promise<string> {
  const resp = await callAnthropicOnce({
    model,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: user }],
  });
  const data = (await resp.json()) as AnthropicTextResponse;
  if (!("content" in data) || !Array.isArray(data.content)) {
    const msg = typeof data.error === "object" && data.error
      ? JSON.stringify(data.error)
      : String(data.error ?? "Unknown upstream error");
    throw new Error(`Lease-abstract model call failed: ${msg}`);
  }
  return data.content.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
}

// ── Pass 1: per-document digest ──────────────────────────────────────────────
// Pull a structured digest of ONE document: what it establishes or changes, each
// fact tagged with the section and page it appears on. Reading the whole text.
const DIGEST_SYSTEM = `You are a commercial real estate lease analyst building an institutional lease abstract for KPR Centers (retail shopping centers). You are reading ONE document from a multi-document lease file. Read the ENTIRE text you are given — never stop early or conclude from a partial read.

Return ONLY a single valid JSON object (no prose, no markdown) with this shape:
{
  "documentName": string,
  "documentDate": string|null,        // ISO yyyy-mm-dd if determinable
  "documentType": string|null,        // lease|amendment|guaranty|assignment|option|waiver|letter|license|other
  "parties": { "landlord": string|null, "tenant": string|null, "guarantor": string|null, "other": string|null },
  "establishes": [                      // every lease term this document SETS or CHANGES
    { "topic": string,                  // e.g. "minimum rent", "option to extend", "go-dark", "exclusive", "assignment", "guaranty", "premises size", "term", "tenant succession", "landlord succession", "security deposit", "percentage rent", "CAM", "taxes", "default"
      "detail": string,                 // concise statement of the term, with key numbers/dates; include a short verbatim snippet when pivotal
      "section": string|null,           // e.g. "§9.6" or "Recital C"
      "page": string|null }             // e.g. "20 of 49" or "1"
  ],
  "supersedes": [string],               // topics/sections this document replaces in the original lease (e.g. "replaces §5.2 go-dark")
  "notes": string|null,                 // anything ambiguous, missing, or needing human confirmation
  "truncated": boolean                  // true if you were given a truncated/incomplete copy
}

Be precise. Capture real numbers and dates. For every fact, record the section and page where you found it — citations are mandatory.`;

interface DocDigest {
  documentName?: string;
  documentDate?: string | null;
  documentType?: string | null;
  parties?: { landlord?: string | null; tenant?: string | null; guarantor?: string | null; other?: string | null };
  establishes?: { topic?: string; detail?: string; section?: string | null; page?: string | null }[];
  supersedes?: string[];
  notes?: string | null;
  truncated?: boolean;
}

async function digestOneDoc(doc: LeaseDocInput, maxChars: number, log: MiniLog): Promise<DocDigest> {
  const truncated = doc.text.length > maxChars;
  const text = truncated ? doc.text.slice(0, maxChars) : doc.text;
  const user = `DOCUMENT NAME: ${doc.name}
DOCUMENT DATE (if known): ${doc.date ?? "unknown"}
DOCUMENT TYPE (if known): ${doc.type ?? "unknown"}
${truncated ? "[NOTE: this copy was truncated to fit — set \"truncated\": true]" : ""}

FULL DOCUMENT TEXT:
${text}`;

  try {
    const raw = await callClaudeText(DIGEST_SYSTEM, user, DIGEST_MODEL, 8000);
    const parsed = robustParseJSON(raw) as DocDigest;
    if (truncated) parsed.truncated = true;
    if (!parsed.documentName) parsed.documentName = doc.name;
    if (!parsed.documentDate && doc.date) parsed.documentDate = doc.date;
    if (!parsed.documentType && doc.type) parsed.documentType = doc.type;
    return parsed;
  } catch (err) {
    log.error({ err, doc: doc.name }, "Per-document digest failed");
    return { documentName: doc.name, documentDate: doc.date ?? null, documentType: doc.type ?? null, establishes: [], notes: "Digest failed — document not reconciled.", truncated };
  }
}

// ── Pass 2: chronological reconciliation ─────────────────────────────────────
const RECONCILE_SYSTEM = `You are KPR Centers' lead lease analyst. You are given per-document digests of a single tenant's COMPLETE lease file (original lease plus all amendments, assignments, guaranties, option exercises, and waivers), each fact tagged with its document, section, and page. Reconcile them into ONE institutional lease abstract.

RULES (follow exactly):
1. LATEST CONTROLLING DOCUMENT WINS. Order documents chronologically; a later amendment/assignment/waiver supersedes the original lease for the topics it changes. Carry forward original-lease terms only where nothing later changed them.
2. GUARANTY IS A STACK. A lease can carry several guaranties accumulated across successive assignments (a corporate parent plus later personal guaranties). List them all.
3. CITE EVERYTHING. Every field that has a "cite" must name the controlling document, section, and page. Source PDFs are NOT stored — the citation is how the user finds the original. Never invent a citation; if unknown, leave it null.
4. TRACK SUCCESSION. Build the tenant-succession and landlord-succession chains from the assignments/mergers/deeds.
5. FLAG, DON'T GUESS. Surface reconciliation/defect items in "flags" (severity "defect" | "watch" | "info") — e.g. an option exercise that may be missing a required signatory, surviving consent rights of a prior tenant, a net-worth condition on option exercises, a guaranty whose continued force is uncertain, or a document that came in truncated. Never fabricate a precise-looking value; use null for unknowns.
6. OPTIONS carry a status ("exercised" | "available" | "expired"), window dates, rent, and any exercise conditions found in the lease OR in assignment instruments.

Return ONLY a single valid JSON object (no prose, no markdown) matching this LeaseAbstract shape (use null/empty arrays where unknown):
{
  "tenantName": string, "dba": string|null, "status": "final",
  "currentSF": number|string|null,
  "sizeHistory": [ { "sf": any, "asOf": string|null, "cite": {"doc":string|null,"section":string|null,"page":string|null} } ],
  "tenantChain":   [ { "entity": string, "role": "tenant",   "effectiveDate": string|null, "instrument": string|null, "cite": {...} } ],
  "landlordChain": [ { "entity": string, "role": "landlord", "effectiveDate": string|null, "instrument": string|null, "cite": {...} } ],
  "guaranties": [ { "guarantor": string, "scope": string|null, "cap": string|null, "inForce": boolean|null, "cite": {...} } ],
  "commencement": string|null, "expiration": string|null,
  "term": { "value": string, "cite": {...} },
  "options": [ { "ordinal": number, "length": string|null, "status": string|null, "windowStart": string|null, "windowEnd": string|null, "rent": string|null, "exerciseConditions": string|null, "exercisedDate": string|null, "cite": {...} } ],
  "rentSchedule": [ { "periodStart": string|null, "periodEnd": string|null, "annualRent": number|null, "monthlyRent": number|null, "psf": number|null, "note": string|null, "cite": {...} } ],
  "percentageRent": { "value": string, "cite": {...} } | null,
  "securityDeposit": { "value": string, "cite": {...} } | null,
  "exclusives": [ { "description": string, "modifications": [ { "change": string, "date": string|null, "cite": {...} } ], "cite": {...} } ],
  "goDark": { "value": string, "cite": {...} } | null,
  "assignment": { "value": string, "cite": {...} } | null,
  "camTax": { "value": string, "cite": {...} } | null,
  "defaultTerms": { "value": string, "cite": {...} } | null,
  "governingLaw": string|null,
  "flags": [ { "severity": "defect"|"watch"|"info", "issue": string, "detail": string } ],
  "narrative": string,                 // 4-8 sentence institutional summary
  "sourceDocuments": [ { "name": string, "date": string|null, "type": string|null } ]
}`;

export async function runLeaseAbstractReconciliation(
  docs: LeaseDocInput[],
  opts: ReconcileOptions = {},
): Promise<Record<string, unknown>> {
  const log = opts.log ?? NOOP_LOG;
  const maxChars = opts.maxCharsPerDoc ?? 600_000;
  if (!docs.length) throw new Error("No documents supplied for reconciliation.");

  // Pass 1: digest every document fully (in parallel, but bounded).
  log.info({ count: docs.length }, "Lease-abstract pass 1: per-document digests");
  const digests: DocDigest[] = [];
  for (const doc of docs) {
    // Sequential to keep per-key rate limits comfortable; full read of each doc.
    // eslint-disable-next-line no-await-in-loop
    digests.push(await digestOneDoc(doc, maxChars, log));
  }

  // Order chronologically by best-known date (undated sinks to the end, stable).
  const dated = digests
    .map((d, i) => ({ d, i, t: Date.parse(d.documentDate ?? "") }))
    .sort((a, b) => {
      const at = Number.isNaN(a.t) ? Number.POSITIVE_INFINITY : a.t;
      const bt = Number.isNaN(b.t) ? Number.POSITIVE_INFINITY : b.t;
      return at === bt ? a.i - b.i : at - bt;
    })
    .map((x) => x.d);

  // Pass 2: reconcile.
  log.info({ count: dated.length }, "Lease-abstract pass 2: reconciliation");
  const user = `TENANT (links to roster): ${opts.tenantName ?? "(infer from documents)"}
PROPERTY: ${opts.dealName ?? "(unknown)"}

PER-DOCUMENT DIGESTS (chronological — earliest first; the LATEST controlling document wins for any topic it changes):
${JSON.stringify(dated, null, 2)}`;

  const raw = await callClaudeText(RECONCILE_SYSTEM, user, RECONCILE_MODEL, 12000);
  const abstract = robustParseJSON(raw) as Record<string, unknown>;

  // Stamp linkage + provenance the model shouldn't be trusted to set.
  if (opts.tenantName) abstract.tenantName = opts.tenantName;
  abstract.status = abstract.status ?? "final";
  abstract.asOf = new Date().toISOString().slice(0, 10);

  // If any document came in truncated, make sure that's flagged for the user.
  const truncatedDocs = digests.filter((d) => d.truncated).map((d) => d.documentName);
  if (truncatedDocs.length) {
    const flags = Array.isArray(abstract.flags) ? (abstract.flags as unknown[]) : [];
    flags.push({
      severity: "watch",
      issue: "Some documents were truncated before analysis",
      detail: `These came in too large to read in full and may be incomplete: ${truncatedDocs.join(", ")}. Re-run with the full text or confirm against the originals.`,
    });
    abstract.flags = flags;
  }

  return abstract;
}
