import { parseLeaseDate } from "./tenantIndex";
import { AUDIT_ID_PREFIX } from "./extractionAudit";

// TRIAGE OF STORED "AI CAPTURE" QUESTIONS.
//
// The deterministic audit self-heals: a check that now passes drops off. AI questions
// never did — they are raised once when a document is first read and then accumulate
// forever, because answering one means opening that deal and ruling on it by hand.
// Across the real library that reached 1,469 open items on 231 of 301 deals, of which
// only about 60 were genuine arithmetic contradictions. The real findings were buried.
//
// A large share of the backlog is answerable from data the app now holds. The single
// biggest group — 42 deals asking which WALT to keep after a merge — is answerable
// because WALT is computable from the rent roll. So: recompute, and where the data now
// ANSWERS the question, mark it resolved with the answer recorded.
//
// THREE RULES, deliberately conservative, because wrongly clearing a real question is
// far worse than leaving it:
//   1. Resolve ONLY where a recomputation genuinely answers the question. Never resolve
//      to tidy the queue, never on "probably fine", never by age.
//   2. Never DELETE. Set resolvedAt and record the reasoning, so every clearance is
//      auditable and reversible by reading the record.
//   3. Touch nothing but AI questions. Audit ids self-heal already and lease-risk
//      validators are a separate discipline.
//
// This MUTATES deal data, so per the house rule it stays human-triggered — it is not
// wired into the daily self-improvement loop.

export const TRIAGE_MARK = "auto-triage";

export interface TriageOutcome {
  questions: Array<Record<string, unknown>>;
  resolved: number;
  byReason: Record<string, number>;
}

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "string" ? Number(String(v).replace(/[$,%\s]/g, "")) : Number(v);
  return Number.isFinite(n) ? n : null;
};

const isVacantish = (name: unknown): boolean => {
  const s = String(name ?? "").trim().toLowerCase();
  return !s || s === "-" || /^(vacant|vacancy|available|avail|spec|white\s*box)\b/.test(s);
};

/** SF-weighted remaining term from the roster, as of the roll date. Mirrors the
 *  calculation the deal page and the audit both use, so a question resolved here is
 *  resolved against the same number the user will see. */
export function waltFromRoster(tenants: unknown, asOf: unknown): { walt: number; covered: number; total: number } | null {
  if (!Array.isArray(tenants)) return null;
  const ref = typeof asOf === "string" && !isNaN(new Date(asOf).getTime()) ? new Date(asOf) : new Date();
  const occupied = (tenants as Array<Record<string, unknown>>).filter(t => !isVacantish(t.name) && !t.isNAP);
  let num_ = 0, den = 0, covered = 0;
  for (const t of occupied) {
    const iso = parseLeaseDate(t.leaseExpiry);
    const sf = num(t.sf);
    if (!iso || !sf || sf <= 0) continue;
    const exp = new Date(iso + "T00:00:00Z");
    if (isNaN(exp.getTime())) continue;
    covered++;
    const years = Math.max(0, (exp.getTime() - ref.getTime()) / (365.25 * 86_400_000));
    num_ += sf * years; den += sf;
  }
  if (den <= 0) return null;
  return { walt: Math.round((num_ / den) * 10) / 10, covered, total: occupied.length };
}

/** Does this stored question look like an AI capture question (not audit, not lease-risk)? */
function isAiQuestion(q: Record<string, unknown>): boolean {
  const id = String(q?.id ?? "");
  if (id.startsWith(AUDIT_ID_PREFIX)) return false;
  if (id.startsWith("check-") || id.startsWith("calc-") || id.startsWith("src-")) return false;
  const source = String(q?.source ?? "");
  return source !== "check";
}

const fieldOf = (q: Record<string, unknown>) => `${String(q?.field ?? "")} ${String(q?.question ?? "")}`.toLowerCase();

/**
 * Resolve the stored AI questions that the current data can now answer.
 * Returns a NEW question array; never mutates the input.
 */
export function triageAiQuestions(data: Record<string, unknown>): TriageOutcome {
  const existing = Array.isArray(data.reviewQuestions) ? (data.reviewQuestions as Array<Record<string, unknown>>) : [];
  if (!existing.length) return { questions: existing, resolved: 0, byReason: {} };

  const byReason: Record<string, number> = {};
  let resolved = 0;
  const stamp = (q: Record<string, unknown>, reason: string, resolution: string) => {
    byReason[reason] = (byReason[reason] ?? 0) + 1;
    resolved++;
    return { ...q, resolvedAt: new Date().toISOString(), resolvedBy: TRIAGE_MARK, resolution };
  };

  const tenants = data.tenants;
  const asOf = typeof data.tenantsAsOf === "string" ? data.tenantsAsOf : null;
  const roster = waltFromRoster(tenants, asOf);
  const storedWalt = num(data.walt);
  const totalSF = num(data.totalSF);

  const questions = existing.map((q) => {
    if (!q || q.resolvedAt || !isAiQuestion(q)) return q;
    const f = fieldOf(q);

    // ── WALT ────────────────────────────────────────────────────────────────────
    // "the merged deals had different WALT values — keep the one shown or use the
    // other?" The rent roll settles it: WALT is SF-weighted remaining term, and the
    // roster is the roll. Require good expiry coverage, or the recompute is not an
    // answer — a WALT built from half the roster is a different number, not a check.
    if (/\bwalt\b|weighted average lease term/.test(f)) {
      if (roster && roster.total > 0 && roster.covered / roster.total >= 0.8) {
        if (storedWalt != null && Math.abs(storedWalt - roster.walt) <= Math.max(0.3, roster.walt * 0.05)) {
          return stamp(q, "walt-matches-roster",
            `Recomputed from the rent roll as ${roster.walt} years (SF-weighted, ${roster.covered} of ${roster.total} ` +
            `occupied tenants carrying an expiry date${asOf ? `, as of ${asOf}` : ""}). The stored value of ${storedWalt} ` +
            `agrees, so the roster answers the question.`);
        }
      }
      return q;   // disagrees, or too little coverage — a real question, leave it
    }

    // ── Roster as-of date ───────────────────────────────────────────────────────
    // "What is the 'as of' date for this rent roll?" — answered once the field holds
    // a real date.
    if (/as.?of date|rent roll.*as.?of/.test(f)) {
      if (asOf && /^\d{4}-\d{2}-\d{2}/.test(asOf)) {
        return stamp(q, "asof-now-recorded", `The roster as-of date is recorded as ${asOf.slice(0, 10)}.`);
      }
      return q;
    }

    // ── Roster vs building SF reconciliation ────────────────────────────────────
    // "Does occupied SF reconcile with the individual tenant SF figures?" — the sum
    // either ties to stated GLA or it does not, and the SF audit check owns the case
    // where it does not, so resolving here only when it ties creates no blind spot.
    if (/reconcil/.test(f) && /\bsf\b|square f/.test(f)) {
      if (Array.isArray(tenants) && totalSF && totalSF > 0) {
        const sum = (tenants as Array<Record<string, unknown>>)
          .filter(t => !t.isNAP)
          .reduce((s, t) => s + (num(t.sf) ?? 0), 0);
        if (sum > 0 && Math.abs(sum - totalSF) / totalSF <= 0.02) {
          return stamp(q, "roster-sf-ties",
            `The roster now sums to ${Math.round(sum).toLocaleString()} SF against a stated GLA of ` +
            `${Math.round(totalSF).toLocaleString()} SF — within 2%, so it reconciles.`);
        }
      }
      return q;
    }

    return q;
  });

  return { questions, resolved, byReason };
}

/** Portfolio-level roll-up of what a triage pass would clear, for reporting. */
export function summarizeTriage(results: TriageOutcome[]): { dealsTouched: number; resolved: number; byReason: Record<string, number> } {
  const byReason: Record<string, number> = {};
  let dealsTouched = 0, resolved = 0;
  for (const r of results) {
    if (!r.resolved) continue;
    dealsTouched++;
    resolved += r.resolved;
    for (const [k, v] of Object.entries(r.byReason)) byReason[k] = (byReason[k] ?? 0) + v;
  }
  return { dealsTouched, resolved, byReason };
}
