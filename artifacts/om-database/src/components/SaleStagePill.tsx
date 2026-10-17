import type { Deal } from "../lib/idb";
import { saleStageLabel, isClosingDate } from "../lib/saleStage";

/** Small amber pill shown next to the OWNED tag while a property is being sold. */
export default function SaleStagePill({ deal, size = "md" }: { deal: Pick<Deal, "status" | "saleStage" | "txnBuyer" | "txnSalePrice" | "saleExpectedClosing" | "txnSaleDate">; size?: "sm" | "md" }) {
  // A deal marked Sold with no closing date on file breaks the "Sold = closed" rule —
  // flag it so it gets fixed (either add the closing date or move it back to Owned).
  if (deal.status === "Sold" && !isClosingDate(deal.txnSaleDate)) {
    return (
      <span title="Marked Sold, but no closing date is on file. A property is Sold only once the sale has closed: add the closing date (Transaction tab), or set it back to Owned with a Sale stage."
        style={{ display: "inline-flex", alignItems: "center", whiteSpace: "nowrap", fontSize: size === "sm" ? 9 : 10, fontWeight: 700, color: "#b91c1c", background: "#fdecea", border: "1px solid #f5c2bd", borderRadius: 20, padding: size === "sm" ? "1px 7px" : "3px 10px" }}>
        ⚠ no closing date
      </span>
    );
  }
  const label = saleStageLabel(deal);
  if (!label) return null;
  const uc = deal.saleStage === "Under Contract";
  return (
    <span title={`Still OWNED — counts in every owned total until the sale closes. ${label}.`}
      style={{
        display: "inline-flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
        fontSize: size === "sm" ? 9 : 10, fontWeight: 700, letterSpacing: "0.02em",
        color: uc ? "#9a3412" : "#8a5a12", background: uc ? "#fdecdc" : "#f6efe0",
        border: `1px solid ${uc ? "#f0c08a" : "#e0c98a"}`, borderRadius: 20,
        padding: size === "sm" ? "1px 7px" : "3px 10px", maxWidth: "100%", overflow: "hidden", textOverflow: "ellipsis",
      }}>
      {uc ? "⏳" : "📣"} {label}
    </span>
  );
}
