// Live, token-free flag for SPECIAL ASSESSMENTS — non-ad-valorem special-district
// charges (CDD / Mello-Roos / BID / PACE / lighting/fire/drainage districts) the OM
// disclosed. These are recurring costs on TOP of property taxes, they don't reduce on
// a tax appeal, and they're easy to miss when underwriting NOI. Present = remind.
import type { Deal } from "./idb";
import type { DerivedFlag } from "./expenseRisk";

export function deriveSpecialAssessmentFlag(deal: Deal): DerivedFlag | null {
  const s = (deal.specialAssessments || "").trim();
  if (!s || /^(none|n\/?a|no\b|not\s|—|-)$/i.test(s)) return null;
  const snippet = s.length > 180 ? s.slice(0, 180).trim() + "…" : s;
  return {
    severity: "low",
    description: `Special-district charges on the tax bill — ${snippet}. These non-ad-valorem assessments (CDD / Mello-Roos / BID / PACE) recur on top of property taxes and don't drop on an appeal; confirm the annual amount, escalation and remaining term and load them into expenses.`,
  };
}
