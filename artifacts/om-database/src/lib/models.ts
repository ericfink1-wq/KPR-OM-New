// THE ONE PLACE the site names Claude models (Eric, 10/21/26). Every AI call imports from here,
// so when Anthropic retires or upgrades a model it is a ONE-LINE change. A test fails if a model
// string appears anywhere else in the code, and another fails if the server and web copies of
// this file drift — change BOTH copies (artifacts/api-server/src/lib/models.ts and
// artifacts/om-database/src/lib/models.ts) or neither.
// A monthly scheduled task checks these against Anthropic's model-deprecations page.

/** High-stakes reads: OM extraction, rent rolls, lease abstracts, loan/pref/sales docs, Analyst chat. */
export const MODEL_SONNET = "claude-sonnet-4-6";
/** Quick, simple jobs: classifying uploads, flyers, swap/amort schedules, re-grading deals. */
export const MODEL_HAIKU = "claude-haiku-4-5-20251001";
/** Local-news web research scans (needs the newest web-search tool). */
export const MODEL_RESEARCH = "claude-sonnet-5-5";
/** Retired names an old open browser tab may still send — the server quietly upgrades them. */
export const LEGACY_MODEL_UPGRADES: Record<string, string> = {
  "claude-sonnet-4-5": MODEL_SONNET,
};

/** Every model the site uses (the server's AI proxy allowlist is built from this). */
export const ALL_MODELS: readonly string[] = [MODEL_SONNET, MODEL_HAIKU, MODEL_RESEARCH];
