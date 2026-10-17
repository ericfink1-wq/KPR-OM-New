import { useState } from "react";
import { createPortal } from "react-dom";
import type { Deal } from "../lib/idb";
import { isClosingDate } from "../lib/saleStage";

// Marking a deal Sold requires the CLOSING date (Eric, 10/16/26): "a property is Sold
// only once the sale has officially closed." Under contract = still Owned + sale stage.
export default function MarkSoldDialog({ deal, onConfirm, onKeepOwned, onCancel }: {
  deal: Deal;
  onConfirm: (patch: Partial<Deal>) => void;
  onKeepOwned: () => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(deal.txnSaleDate || "");
  const [price, setPrice] = useState(deal.txnSalePrice != null ? Number(deal.txnSalePrice).toLocaleString() : "");
  const [buyer, setBuyer] = useState(deal.txnBuyer || "");
  const ok = isClosingDate(date);
  const inp: React.CSSProperties = { width: "100%", boxSizing: "border-box", minHeight: 42, padding: "8px 10px", border: "1px solid #ddd4c2", borderRadius: 8, fontSize: 14, fontFamily: "'Inter',sans-serif" };
  const lab: React.CSSProperties = { fontSize: 11, fontWeight: 700, color: "#7d766a", textTransform: "uppercase", letterSpacing: "0.04em", margin: "10px 0 4px" };
  return createPortal(
    <>
      <div onClick={onCancel} style={{ position: "fixed", inset: 0, zIndex: 9800, background: "rgba(38,40,31,0.42)" }} />
      <div role="dialog" aria-label="Mark as Sold" style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 9801, width: "min(440px, 94vw)", background: "#faf7f0", border: "1px solid #e0d8c8", borderRadius: 14, padding: 18, boxShadow: "0 18px 56px rgba(38,40,31,0.28)", fontFamily: "'Inter',sans-serif" }}>
        <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#26281f" }}>Has the sale closed?</div>
        <p style={{ fontSize: 13, lineHeight: 1.55, color: "#52554e", margin: "8px 0 0" }}>
          A property is <strong>Sold</strong> only once the sale has closed. Until then it stays <strong>Owned</strong>, keeps counting in the portfolio, and shows an "Under contract" flag.
        </p>
        <div style={lab}>Closing date (required)</div>
        <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
        <div style={lab}>Sale price</div>
        <input inputMode="numeric" value={price} onChange={e => setPrice(e.target.value)} placeholder="e.g. 39,000,000" style={inp} />
        <div style={lab}>Buyer</div>
        <input value={buyer} onChange={e => setBuyer(e.target.value)} placeholder="Buyer entity / name" style={inp} />
        <div style={{ display: "flex", gap: 8, marginTop: 16, flexWrap: "wrap" }}>
          <button disabled={!ok} onClick={() => {
            const p = Number(price.replace(/[$,\s]/g, ""));
            onConfirm({ status: "Sold", txnSaleDate: date, txnSalePrice: Number.isFinite(p) && p > 0 ? p : deal.txnSalePrice ?? null, txnBuyer: buyer.trim() || deal.txnBuyer || null, saleStage: null });
          }} style={{ flex: "1 1 180px", minHeight: 44, borderRadius: 9, border: "none", fontSize: 14, fontWeight: 700, cursor: ok ? "pointer" : "default", background: ok ? "#0d9488" : "#e3dccd", color: ok ? "#fff" : "#a89f8f" }}>
            {ok ? "Yes — mark Sold" : "Enter the closing date"}
          </button>
          <button onClick={onKeepOwned} style={{ flex: "1 1 180px", minHeight: 44, borderRadius: 9, border: "1px solid #f0c08a", background: "#fdecdc", color: "#9a3412", fontSize: 13.5, fontWeight: 700, cursor: "pointer" }}>
            Not yet — keep Owned, under contract
          </button>
        </div>
        <button onClick={onCancel} style={{ marginTop: 10, background: "transparent", border: "none", color: "#8b8578", fontSize: 12.5, cursor: "pointer", textDecoration: "underline", padding: 4 }}>Cancel</button>
      </div>
    </>,
    document.body,
  );
}
