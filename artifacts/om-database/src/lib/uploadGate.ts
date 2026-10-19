// Upload gate (Eric, 10/19/26). On 10/19 the Project Evergreen drop — 17 sales reports,
// a rent roll, tax bills, a utility bill and a signed contract alongside the OMs — made
// four junk deals: a tax bill, a utility bill, a portfolio sales report and a contract
// were each read as an OM and saved as a new property. The rule now:
//   • every upload is classified BEFORE anything is saved;
//   • supporting paperwork (tax / utility bills, sales reports, rent rolls, leases,
//     estoppels, contracts…) only ever ATTACHES to a deal that already exists (matched by
//     name, address or also-known-as);
//   • nothing matched → no deal is created; the file shows "Not an OM — not added", and
//     only the owner can override that.
// Pure; tests: __tests__/uploadGate.test.ts.
import { hasOmSaleSignals } from "./docClassify";

export const NOT_ADDED_MSG = "Not an OM — not added.";

/** Does an OM-path document actually read like an offering package (so it may create a deal)?
 *  Sale signals (NOI, cap rate, offering summary…) are enough; otherwise it needs a real
 *  roster AND some length — a 1-page notice with three names on it is not a package. */
export function looksLikeOm(text: string, pages: number | null | undefined, extracted: { tenants?: unknown[] | null } | null | undefined): boolean {
  if (hasOmSaleSignals(text)) return true;
  const n = Array.isArray(extracted?.tenants) ? extracted!.tenants!.length : 0;
  return n >= 3 && (pages ?? 0) >= 4;
}

export type UploadOutcome = "created" | "attached" | "skipped" | "rejected" | "failed";
/** The upload-log outcome for a queue item's final state. */
export function uploadResultFor(it: { status?: string; result?: UploadOutcome; createdNew?: boolean; appliedDealId?: string; deal?: { id?: string } | null; msg?: string }): UploadOutcome {
  if (it.result) return it.result;
  if (it.status === "error") return "failed";
  if (it.status === "not_added") return "rejected";
  if (/^(skipped|discarded)\b/i.test(it.msg || "")) return "skipped";
  if (it.createdNew) return "created";
  return it.appliedDealId || it.deal?.id ? "attached" : "skipped";
}
