import type { Deal } from "../lib/idb";
import { isClosingDate } from "../lib/closingDate";

/** Red pill on a deal marked Sold with no closing date on file ("Sold" means the sale closed). */
export default function NoClosingDatePill({ deal, size = "md" }: { deal: Pick<Deal, "status" | "txnSaleDate">; size?: "sm" | "md" }) {
  if (deal.status !== "Sold" || isClosingDate(deal.txnSaleDate)) return null;
  return (
    <span title="Marked Sold, but no closing date is on file. Add the closing date on the Transaction tab."
      style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", fontSize: size === "sm" ? 9 : 10, fontWeight: 700, color: "#b91c1c", background: "#fdecea", border: "1px solid #f5c2bd", borderRadius: 20, padding: size === "sm" ? "1px 7px" : "3px 10px" }}>
      ⚠ no closing date
    </span>
  );
}
