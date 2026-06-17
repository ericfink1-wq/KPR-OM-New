// Phase A of the self-improving loop: LEARN FROM CORRECTIONS.
// Every time a human resolves an Import-Review question — confirms it, fixes the
// value, or dismisses it — that resolution is stored on the deal (reviewQuestions).
// This miner reads those stored resolutions across the WHOLE database and groups the
// RECURRING ones, so a correction the system keeps making becomes a proposed
// extraction LESSON (which a human approves → it flows into future extractions).
// Pure + deterministic; reads only data already on the deals. No new schema.

import type { Deal, ReviewQuestion } from "./idb";
import type { LessonScope } from "./api";

export interface CorrectionPattern {
  key: string;            // stable grouping key (a field or a check family)
  label: string;          // human label
  fixed: number;          // times a human CORRECTED the value (the strong signal)
  dismissed: number;      // times dismissed (the CHECK may be too aggressive)
  confirmed: number;      // times confirmed as already-right (benign)
  deals: { dealId: string; dealName: string; state: string | null }[];
  sampleQuestion: string;
  scope: LessonScope;
  suggestedLesson: string;
}

const dealName = (d: Deal) => d.propertyName || d.fileName || "Untitled deal";

// Field-specific lesson seeds (the admin edits before approving). Falls back to a
// generic template for anything not listed.
const FIELD_HINTS: Record<string, { label: string; scope: LessonScope; lesson: string }> = {
  currentAssessedValue: { label: "Current assessed value", scope: "om",
    lesson: "On a property-tax / parcel table, capture the ASSESSED value — the column the bill is computed on, which in many states is a FRACTION of market value (e.g. Ohio ~35%). It is the SMALLER column; never capture the Market value as the assessed value." },
  totalSF: { label: "Total SF / GLA", scope: "om",
    lesson: "Reconcile the building GLA against the rent-roll SF total before finalizing — don't drop outlots/NAP or double-count; the roster SF should tie to stated occupied SF." },
  noi: { label: "NOI", scope: "om", lesson: "Capture the headline NOI exactly and verify NOI ÷ cap rate ≈ price; if they don't tie, a figure was mis-read." },
  capRate: { label: "Cap rate", scope: "om", lesson: "Only capture an explicitly stated cap rate; verify NOI ÷ cap ≈ price and that it's a percent (not basis points)." },
  annualRent: { label: "Annual (base) rent", scope: "om", lesson: "annualRent is BASE rent only; reconcile rentPerSF × SF ≈ annualRent and keep recoveries out of base rent." },
  rentPerSF: { label: "Rent / SF", scope: "om", lesson: "Reconcile rentPerSF to annualRent ÷ SF; a normal inline rent is ~$10–$120/SF." },
  sf: { label: "Tenant SF", scope: "om", lesson: "Capture each tenant's SF from the rent roll; sanity-check it against the brand's typical footprint." },
  occupancy: { label: "Occupancy", scope: "om", lesson: "Occupancy is a percent 0–100; reconcile it to the roster's occupied ÷ leasable SF." },
  reimbursementMethod: { label: "Reimbursement / recovery", scope: "om", lesson: "Capture the FULL recovery structure (CAM cap %/basis, admin fee, fixed-CAM, mgmt-fee in/out) — don't collapse to bare 'Net' when the roll discloses caps/fees." },
};

function classify(q: ReviewQuestion): { key: string; label: string; scope: LessonScope } {
  const fk = q.target?.fieldKey;
  if (fk && FIELD_HINTS[fk]) return { key: "field:" + fk, label: FIELD_HINTS[fk].label, scope: FIELD_HINTS[fk].scope };
  if (fk) return { key: "field:" + fk, label: fk, scope: "all" };
  // No structured target — group by the check FAMILY (first 3 id segments), so per-
  // tenant variants (audit-rent-tie-<name>) collapse into one pattern.
  const fam = String(q.id || "").split("-").slice(0, 3).join("-") || "other";
  return { key: "check:" + fam, label: q.field || fam, scope: "all" };
}

export function mineCorrectionPatterns(deals: Deal[]): CorrectionPattern[] {
  const acc = new Map<string, CorrectionPattern>();
  for (const d of deals || []) {
    if (d.trashedAt) continue;
    for (const q of (d.reviewQuestions || [])) {
      if (!q || !q.resolvedAt || !q.resolution) continue;
      const { key, label, scope } = classify(q);
      let p = acc.get(key);
      if (!p) {
        const fk = q.target?.fieldKey;
        p = { key, label, fixed: 0, dismissed: 0, confirmed: 0, deals: [], sampleQuestion: q.question || "",
          scope, suggestedLesson: (fk && FIELD_HINTS[fk]?.lesson) || "" };
        acc.set(key, p);
      }
      if (q.resolution === "fixed") p.fixed++;
      else if (q.resolution === "dismissed") p.dismissed++;
      else if (q.resolution === "confirmed") p.confirmed++;
      if (!p.deals.some((x) => x.dealId === d.id)) p.deals.push({ dealId: d.id, dealName: dealName(d), state: d.state ?? null });
      if (!p.sampleQuestion && q.question) p.sampleQuestion = q.question;
    }
  }
  // Fill a generic draft lesson where we don't have a seed.
  for (const p of acc.values()) {
    if (!p.suggestedLesson) {
      const states = [...new Set(p.deals.map((x) => x.state).filter(Boolean))];
      p.suggestedLesson = `Recurring correction: "${p.label}" was fixed on ${p.fixed} deal${p.fixed !== 1 ? "s" : ""}${states.length ? ` (often in ${states.slice(0, 4).join(", ")})` : ""}. Add a rule so the extractor captures ${p.label.toLowerCase()} correctly next time.`;
    }
  }
  // Surface only RECURRING corrections (≥2 fixes), strongest first. A pattern that's
  // mostly DISMISSED is flagged too — it means the CHECK is over-firing.
  return [...acc.values()]
    .filter((p) => p.fixed >= 2 || p.dismissed >= 3)
    .sort((a, b) => b.fixed - a.fixed || b.dismissed - a.dismissed);
}
