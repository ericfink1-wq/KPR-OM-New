// Bump this ONLY for LARGER BATCHES or MAJOR scoring-logic changes — NOT for
// minor prompt tweaks. (Eric's call: bumping lights up the "outdated" refresh
// badge on every existing deal and invites a token spend to catch them up, so
// we don't want it firing after every small change. Accumulate minor wording
// tweaks and bump once when a meaningful batch has landed.)
//
// Bumping makes existing deals' saved AI analysis count as "outdated" (UI shows
// a refresh badge; the bulk-refresh endpoint picks them up). This is about
// AI-written output (narrative, grade rationale, strengths/risks, benchmark
// red-flag wording) — NOT the live, token-free badges/score adjustments, which
// always reflect the latest logic without any refresh.
//
// History:
//   1 — baseline
//   2 — below-market mark-to-market logic, lease-commencement weighting,
//       trimmed "confidence" prose (2026-05)
//   3 — lease-risk / co-tenancy exposure folded into Risks + narrative
//       (anchor-dependency: base rent at risk if an anchor goes dark, plus any
//       executed-lease mitigation) (2026-06)
export const ANALYSIS_VERSION = 3;
