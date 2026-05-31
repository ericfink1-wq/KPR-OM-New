// Bump this whenever the SCORING / NARRATIVE LOGIC changes in a way that should
// make existing deals' saved AI analysis count as "outdated" (so the UI shows a
// refresh badge and the bulk-refresh endpoint will pick them up). This is about
// AI-written output (narrative, grade rationale, strengths/risks, benchmark
// red-flag wording) — NOT the live, token-free badges/score adjustments, which
// always reflect the latest logic without any refresh.
//
// History:
//   1 — baseline
//   2 — below-market mark-to-market logic, lease-commencement weighting,
//       trimmed "confidence" prose (2026-05)
export const ANALYSIS_VERSION = 2;
