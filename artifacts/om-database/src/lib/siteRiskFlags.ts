// Live, token-free DD flags for site-level risks the OM narrative often mentions but
// the numbers ignore: environmental (UST/solvent) exposure, flood/CAT-insurance
// exposure, and a leasehold/ground-lease interest. These are pattern-based on the text
// already captured (tenant names + notes/assumptions), so they read as "confirm/order"
// prompts at low–medium severity per the flag-uncertainty philosophy — never asserted
// as fact. No model call.
import type { Deal } from "./idb";
import type { DerivedFlag } from "./expenseRisk";
import { isVacant, isNAPTenant } from "./utils";

// Free-text the OM gave us (excludes tenant names; those are scanned separately).
function dealText(deal: Deal): string {
  const ka = Array.isArray(deal.keyAssumptions) ? deal.keyAssumptions.join(" ") : (deal.keyAssumptions || "");
  const rf = (deal.redFlags || []).map(f => f?.description || "").join(" ");
  const up = (deal.upsideItems || []).map(u => `${u?.item || ""} ${u?.detail || ""}`).join(" ");
  return [deal.notes, ka, rf, up, deal.shadowAnchors, deal.retailCotenants, deal.assetType, deal.centerType].filter(Boolean).join("  ");
}
function tenantNames(deal: Deal): string {
  return (deal.tenants || []).filter(t => !isVacant(t.name) && !isNAPTenant(t)).map(t => t.name || "").join("  ");
}

// ── Environmental / ESA ───────────────────────────────────────────────────────
const ENV_FUEL = /\b(gas station|fuel(ing)? (station|center)|service station|petroleum|truck stop|shell|exxon|mobil|chevron|texaco|citgo|sunoco|valero|marathon|gulf|phillips ?66|conoco|quiktrip|racetrac|wawa|sheetz|circle ?k|speedway|kwik trip|buc-?ee)\b/i;
const ENV_AUTO = /\b(jiffy lube|valvoline|oil change|quick lube|\blube\b|auto repair|auto service|car ?wash|midas|meineke|firestone|pep boys|transmission|muffler|collision|body shop)\b/i;
const ENV_CLEAN = /\b(dry ?clean|cleaners\b|laundromat)\b/i;
// Explicit environmental-condition language = a real (not just precautionary) issue.
const ENV_HARD = /\b(underground storage tank|\bUST\b|\bLUST\b|phase (i{1,2}|1|2) (esa|environmental)|environmental site assessment|contaminat|remediat|brownfield|groundwater (impact|contaminat)|petroleum release|vapor (intrusion|encroachment)|recognized environmental condition|\bREC\b)\b/i;

export function deriveEnvironmentalFlag(deal: Deal): DerivedFlag | null {
  const text = dealText(deal);
  const names = tenantNames(deal);
  const hard = ENV_HARD.test(text);
  const hits: string[] = [];
  if (ENV_FUEL.test(names) || ENV_FUEL.test(text)) hits.push("a fueling/gas use (USTs)");
  if (ENV_AUTO.test(names) || ENV_AUTO.test(text)) hits.push("an auto-service/lube use (used oil/solvents)");
  if (ENV_CLEAN.test(names) || ENV_CLEAN.test(text)) hits.push("a dry cleaner (PERC/solvents)");
  if (!hard && hits.length === 0) return null;

  const severity: DerivedFlag["severity"] = hard ? "medium" : "low";
  const lead = hard
    ? "The materials reference an environmental condition (UST / contamination / REC / remediation)."
    : `Tenant mix includes ${hits.join(" and ")} — classic subsurface-contamination sources.`;
  return {
    severity,
    description: `Environmental DD — ${lead} Make sure a current Phase I ESA is in hand (and budget Phase II if it recommends one); off-site sources and historical USTs can be a major closing/indemnity item. Confirm who bears remediation and whether environmental insurance is warranted.`,
  };
}

// ── Flood / CAT insurance ─────────────────────────────────────────────────────
const FLOOD_HARD = /\b(special flood hazard|\bSFHA\b|zone ae\b|zone a\b|zone ve?\b|coastal high hazard|storm surge|100-?year flood)\b/i;
const FLOOD_SOFT = /\b(flood ?zone|flood ?plain|flood insurance|fema flood|wildfire|\bWUI\b|hurricane (zone|exposure|prone)|windstorm|named storm|seismic|earthquake (zone|fault))\b/i;

export function deriveFloodClimateFlag(deal: Deal): DerivedFlag | null {
  const text = dealText(deal);
  const hard = FLOOD_HARD.test(text);
  if (!hard && !FLOOD_SOFT.test(text)) return null;
  const severity: DerivedFlag["severity"] = hard ? "medium" : "low";
  const lead = hard
    ? "The property appears to sit in a mapped flood/CAT hazard area (SFHA / Zone A/AE/VE / coastal)."
    : "Flood or climate-catastrophe exposure is referenced in the materials.";
  return {
    severity,
    description: `Flood / CAT-insurance exposure — ${lead} Confirm the FEMA flood zone and the actual cost of flood + windstorm coverage (a large, fast-rising line item that brokers often quote stale); a Zone AE/VE parcel carries lender-required flood insurance. Underwrite the real premium, not the OM's figure.`,
  };
}

// ── Leasehold / ground lease (the PROPERTY itself, not a pad tenant) ───────────
// Require property-level phrasing so a normal pad-tenant ground lease (good income)
// does NOT false-positive.
const GROUND = /\b(leasehold (interest|estate|position)|(property|center|site|shopping center|land|parcel) is (on|subject to|encumbered by)? ?(a )?ground[- ]?lease|fee simple subject to (a )?ground ?lease|ground[- ]?leased (land|site|parcel|property)|land(?: is)? ground[- ]?leased|reversion to (the )?ground lessor)\b/i;

export function deriveGroundLeaseFlag(deal: Deal): DerivedFlag | null {
  if (!GROUND.test(dealText(deal))) return null;
  return {
    severity: "medium",
    description: `Possible LEASEHOLD interest — the property itself may be on a ground lease rather than owned fee simple. A finite ground-lease term caps residual value, complicates financing (lenders want the leasehold term to outrun the loan by 10–20 yrs), and ground rent can reset/bump. Confirm fee vs leasehold; if leasehold, get the remaining term, rent resets, renewal/purchase options, and reversion. (A pad TENANT on a ground lease is different and fine.)`,
  };
}
