import { useState, useMemo } from "react";
import type { Deal } from "../lib/idb";
import { getJurisdiction, calculateClosingCosts, formatRate, DEFAULT_LTV } from "../lib/closingCosts";

interface Props {
  deal: Deal;
}

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtPct = (r: number) => `${(r * 100).toFixed(2)}%`;

export default function ClosingCostsCard({ deal }: Props) {
  const defaultPrice = Number(deal.txnPurchasePrice ?? deal.askingPrice ?? 0) || 0;
  // Loan defaults to known balance, else 65% LTV of price (DEFAULT_LTV)
  const knownLoan = Number(deal.loanBalance ?? 0) || 0;
  const defaultLoan = knownLoan || (defaultPrice ? Math.round(defaultPrice * DEFAULT_LTV) : 0);

  const [priceInput, setPriceInput] = useState<string>(defaultPrice ? String(defaultPrice) : "");
  const [loanInput, setLoanInput] = useState<string>(defaultLoan ? String(defaultLoan) : "");

  const price = Number(priceInput) || 0;
  const loan = Number(loanInput) || 0;
  const jurisdiction = useMemo(() => getJurisdiction(deal.state), [deal.state]);
  const breakdown = useMemo(() => calculateClosingCosts(jurisdiction, price, loan), [jurisdiction, price, loan]);

  const hasPrice = price > 0;
  // Loan was auto-derived (not a known balance and not manually different from the 65% default)
  const loanIsAssumed = !knownLoan && hasPrice && loan === Math.round(price * DEFAULT_LTV);

  return (
    <div
      id="section-closing-costs"
      style={{ background: "#fff", border: "1px solid #efe8da", borderRadius: 12, padding: "16px 20px", marginBottom: 14, boxShadow: "0 1px 2px rgba(56,58,55,0.04)" }}
    >
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "#a69e91", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>
          Estimated Closing Costs
        </div>
        <div style={{ fontSize: 11, color: "#7d766a", lineHeight: 1.45 }}>
          {jurisdiction.stateName} customary practices. Rates shown apply whether or not a price is entered; dollar amounts fill in once you add a purchase price.
        </div>
      </div>

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 6 }}>
        <label style={{ display: "block", fontSize: 10, color: "#a69e91", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Purchase Price
          <input type="number" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} placeholder="optional"
            style={{ display: "block", width: "100%", fontSize: 13, padding: "7px 10px", border: "1px solid #e3dccd", borderRadius: 6, color: "#383a37", background: "#fafaf8", marginTop: 4, fontFamily: "'Inter',sans-serif", boxSizing: "border-box" }} />
        </label>
        <label style={{ display: "block", fontSize: 10, color: "#a69e91", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Loan Amount
          <input type="number" value={loanInput} onChange={(e) => setLoanInput(e.target.value)} placeholder="optional"
            style={{ display: "block", width: "100%", fontSize: 13, padding: "7px 10px", border: "1px solid #e3dccd", borderRadius: 6, color: "#383a37", background: "#fafaf8", marginTop: 4, fontFamily: "'Inter',sans-serif", boxSizing: "border-box" }} />
        </label>
      </div>
      {loanIsAssumed && (
        <div style={{ fontSize: 10, color: "#a69e91", marginBottom: 12 }}>
          Loan assumed at {Math.round(DEFAULT_LTV * 100)}% LTV — edit above to override.
        </div>
      )}
      {!loanIsAssumed && <div style={{ marginBottom: 12 }} />}

      {/* Summary tiles — only when a price is entered */}
      {hasPrice && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
          <div style={{ background: "#f6f9f0", border: "1px solid #d6e9bd", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: "#5c7a3c", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>Buyer</div>
            <div style={{ fontSize: 16, color: "#3f7a1f", fontWeight: 600 }}>{fmt(breakdown.totals.buyer)}</div>
            <div style={{ fontSize: 10, color: "#7d766a", marginTop: 2 }}>{fmtPct(breakdown.totals.buyer / price)} of price</div>
          </div>
          <div style={{ background: "#fff8ec", border: "1px solid #ead9b3", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: "#7a5c2c", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>Seller</div>
            <div style={{ fontSize: 16, color: "#8a5a14", fontWeight: 600 }}>{fmt(breakdown.totals.seller)}</div>
            <div style={{ fontSize: 10, color: "#7d766a", marginTop: 2 }}>{fmtPct(breakdown.totals.seller / price)} of price</div>
          </div>
          <div style={{ background: "#f4f1ea", border: "1px solid #ddd4c2", borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 9, color: "#6f6a5f", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>Combined</div>
            <div style={{ fontSize: 16, color: "#383a37", fontWeight: 600 }}>{fmt(breakdown.totals.combined)}</div>
            <div style={{ fontSize: 10, color: "#7d766a", marginTop: 2 }}>{fmtPct(breakdown.totals.combined / price)} of price</div>
          </div>
        </div>
      )}

      {/* Rate table — ALWAYS visible */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ fontSize: 9, color: "#a69e91", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              <th style={{ textAlign: "left", padding: "7px 8px", borderBottom: "1px solid #ece5d7" }}>Item</th>
              <th style={{ textAlign: "left", padding: "7px 8px", borderBottom: "1px solid #ece5d7", whiteSpace: "nowrap" }}>Rate</th>
              <th style={{ textAlign: "right", padding: "7px 8px", borderBottom: "1px solid #ece5d7" }}>Buyer</th>
              <th style={{ textAlign: "right", padding: "7px 8px", borderBottom: "1px solid #ece5d7" }}>Seller</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.lines.map((l, i) => (
              <tr key={i} style={{ borderBottom: "1px solid #f5efe2" }}>
                <td style={{ padding: "8px 8px", color: "#383a37", verticalAlign: "top" }}>
                  <div>{l.name}</div>
                  {l.notes && <div style={{ fontSize: 9.5, color: "#a69e91", marginTop: 2, lineHeight: 1.4 }}>{l.notes}</div>}
                </td>
                <td style={{ padding: "8px 8px", textAlign: "left", color: "#52554e", whiteSpace: "nowrap", verticalAlign: "top", fontVariantNumeric: "tabular-nums" }}>
                  {l.rate === 0 && l.rateMin == null ? `flat ${fmt(l.amount)}` : formatRate(l)}
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: hasPrice && l.buyer > 0 ? "#3f7a1f" : "#c9c2b3", fontWeight: hasPrice && l.buyer > 0 ? 500 : 400, verticalAlign: "top" }}>
                  {!hasPrice ? "—" : l.buyer > 0 ? fmt(l.buyer) : "—"}
                </td>
                <td style={{ padding: "8px 8px", textAlign: "right", color: hasPrice && l.seller > 0 ? "#8a5a14" : "#c9c2b3", fontWeight: hasPrice && l.seller > 0 ? 500 : 400, verticalAlign: "top" }}>
                  {!hasPrice ? "—" : l.seller > 0 ? fmt(l.seller) : "—"}
                </td>
              </tr>
            ))}
            {hasPrice && (
              <tr style={{ background: "#faf7f0" }}>
                <td style={{ padding: "10px 8px", color: "#26281f", fontWeight: 700 }} colSpan={2}>Total</td>
                <td style={{ padding: "10px 8px", textAlign: "right", color: "#3f7a1f", fontWeight: 700 }}>{fmt(breakdown.totals.buyer)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right", color: "#8a5a14", fontWeight: 700 }}>{fmt(breakdown.totals.seller)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {jurisdiction.notes && (
        <div style={{ fontSize: 10, color: "#7d766a", lineHeight: 1.5, marginTop: 12, padding: "8px 10px", background: "#faf7f0", borderRadius: 6, border: "1px solid #f0e8d6" }}>
          <span style={{ fontWeight: 600 }}>&#9432; </span>{jurisdiction.notes}
        </div>
      )}

      <div style={{ fontSize: 9, color: "#a69e91", marginTop: 10, lineHeight: 1.5 }}>
        Estimates only. Sliding-scale items show the rate range; the dollar figure uses a representative rate. Customary splits vary by deal and negotiation. Verify with title company and counsel before relying on for an offer.
      </div>
    </div>
  );
}
