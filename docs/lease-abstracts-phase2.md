# Lease abstracts — Phase 2 (auto-extraction): DORMANT / internal

Phase 1 (live): store + display + Analyst-chat recall of reconciled lease
abstracts, fed by Claude-reconciled JSON pasted in via the deal page
("+ Abstract" on a roster row). Source PDFs are not stored — every fact cites its
document, section, and page.

Phase 2 (built, NOT live): let the **server** reconcile a full document set into
an abstract automatically, instead of pasting Claude's JSON. The engine and
endpoint are complete and type-checked but intentionally not wired in, so nothing
changes on the live site.

## What exists

- `artifacts/api-server/src/lib/leaseAbstractExtract.ts` — the two-pass engine:
  pass 1 digests each document in full (capturing section + page per fact);
  pass 2 reconciles chronologically (latest-controlling-document-wins, guaranty
  stack, citations, reconciliation/defect flags) into a `LeaseAbstract`.
- `artifacts/api-server/src/routes/leaseAbstractExtract.ts` — `POST
  /deals/:id/lease-abstracts/auto`. **Not mounted** in `routes/index.ts`, and
  additionally admin-gated + feature-flagged off.
- `apiAutoExtractLeaseAbstract(...)` in the frontend `lib/api.ts` — ready for a
  future "Auto-extract" UI; nothing calls it yet.

## To enable one day

1. `routes/index.ts`: import and `router.use(leaseAbstractExtractRouter)`.
2. Deployment env: `ENABLE_LEASE_ABSTRACT_AUTOEXTRACT=true`.
3. Add a UI trigger (e.g. a document-set upload on the deal page) that calls
   `apiAutoExtractLeaseAbstract(dealId, tenantName, docs, dealName)`, where each
   `doc` is `{ name, date?, type?, text }` with the FULL extracted text. PDF text
   can be pulled client-side with the existing `extractPdfText` helper.

## Notes

- Models default to Sonnet for both passes (accuracy over speed). Tune in
  `leaseAbstractExtract.ts`.
- Very large documents are truncated per `maxCharsPerDoc` and the abstract gets a
  "watch" flag listing what was truncated — re-run with full text to clear it.
- Output matches the `LeaseAbstract` interface in
  `artifacts/om-database/src/lib/idb.ts` (the field-name source of truth).
