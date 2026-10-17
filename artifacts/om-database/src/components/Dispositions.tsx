import { useMemo } from "react";
import type { Deal } from "../lib/idb";
import { getOwnedProperties } from "../lib/ownedPortfolio";
import { useIsMobile } from "../hooks/use-mobile";

// Dispositions (Eric, 10/16/26): the app only followed deals KPR was BUYING. This is
// the sell side — every OWNED property with a sale stage (it stays Owned until the
// sale closes), with buyer, price, deposit and the PSA / diligence / closing dates,
// plus sales that closed in the last 12 months.

const DAY = 86_400_000;
const isoDay = (v?: string | null) => (v && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);
const daysFromToday = (v?: string | null) => {
  const d = isoDay(v);
  if (!d) return null;
  const t = Date.parse(d + "T00:00:00");
  const today = new Date(); today.setHours(0, 0, 0, 0);
  return Math.round((t - today.getTime()) / DAY);
};
const money = (v: unknown) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return "—";
  return n >= 1e6 ? `$${(n / 1e6).toFixed(n >= 1e8 ? 0 : 1)}M` : `$${Math.round(n / 1e3)}K`;
};
const fmtDate = (v?: string | null) => {
  const d = isoDay(v);
  return d ? new Date(d + "T00:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "—";
};

interface Row {
  d: Deal;
  closingIn: number | null;
  ddIn: number | null;
  alert: { tone: "red" | "amber"; text: string } | null;
}

export default function Dispositions({ deals, onOpenDeal }: { deals: Deal[]; onOpenDeal: (id: string) => void }) {
  const isMobile = useIsMobile();
  const { pipeline, closed, totalValue } = useMemo(() => {
    const owned = getOwnedProperties(deals).filter(d => d.saleStage);
    const pipeline: Row[] = owned.map(d => {
      const closingIn = daysFromToday(d.saleExpectedClosing);
      const ddIn = daysFromToday(d.saleDiligenceEnd);
      let alert: Row["alert"] = null;
      if (closingIn != null && closingIn < 0) alert = { tone: "red", text: "Expected closing has passed — mark it Sold with the closing date, or update the date" };
      else if (ddIn != null && ddIn >= 0 && ddIn <= 14 && d.saleDepositStatus !== "Hard") alert = { tone: "amber", text: `Diligence ends in ${ddIn} day${ddIn === 1 ? "" : "s"} — deposit should go hard` };
      else if (closingIn != null && closingIn <= 30) alert = { tone: "amber", text: `Closing in ${closingIn} day${closingIn === 1 ? "" : "s"}` };
      return { d, closingIn, ddIn, alert };
    }).sort((a, b) => (a.d.saleStage === b.d.saleStage ? 0 : a.d.saleStage === "Under Contract" ? -1 : 1) || (a.closingIn ?? 1e9) - (b.closingIn ?? 1e9));
    const yearAgo = Date.now() - 365 * DAY;
    const closed = deals.filter(d => !d.trashedAt && d.status === "Sold" && isoDay(d.txnSaleDate) && Date.parse(isoDay(d.txnSaleDate)!) >= yearAgo)
      .sort((a, b) => String(b.txnSaleDate).localeCompare(String(a.txnSaleDate)));
    const totalValue = pipeline.reduce((s, r) => s + (Number(r.d.txnSalePrice) || 0), 0);
    return { pipeline, closed, totalValue };
  }, [deals]);

  const C = { ink: "#26281f", sub: "#7d766a", faint: "#a89f8f", line: "#ece5d7" };
  const pill = (stage?: string | null) => (
    <span style={{ fontSize: 10, fontWeight: 700, color: stage === "Under Contract" ? "#9a3412" : "#8a5a12", background: stage === "Under Contract" ? "#fdecdc" : "#f6efe0", border: `1px solid ${stage === "Under Contract" ? "#f0c08a" : "#e0c98a"}`, borderRadius: 20, padding: "2px 8px", whiteSpace: "nowrap" }}>
      {stage === "Under Contract" ? "Under contract" : "Marketed"}
    </span>
  );
  const deposit = (d: Deal) => d.saleDeposit ? `${money(d.saleDeposit)}${d.saleDepositStatus ? ` · ${d.saleDepositStatus.toLowerCase()}` : ""}` : (d.saleDepositStatus || "—");
  const psf = (d: Deal) => { const p = Number(d.txnSalePrice), sf = Number(d.totalSF); return p > 0 && sf > 0 ? `$${Math.round(p / sf)}/SF` : null; };

  return (
    <div style={{ padding: isMobile ? "16px" : "28px 32px", maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box", fontFamily: "'Inter',sans-serif" }}>
      <h1 style={{ margin: 0, fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 500, color: C.ink }}>Dispositions</h1>
      <div style={{ fontSize: 12, color: C.faint, marginTop: 3, marginBottom: 16, lineHeight: 1.5 }}>
        Owned properties KPR is selling. They stay Owned, and count in every owned total, until the sale closes.
        {pipeline.length > 0 && <> · <b style={{ color: C.ink }}>{pipeline.length}</b> in progress{totalValue > 0 ? <>, <b style={{ color: C.ink }}>{money(totalValue)}</b> in contract value</> : null}</>}
      </div>

      {pipeline.length === 0 ? (
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, padding: "22px 18px", color: C.sub, fontSize: 13, lineHeight: 1.6 }}>
          No sales in progress. To start one, open an owned deal → <b>Transaction Details</b> → set <b>Sale Stage</b> (Marketed or Under Contract), with the buyer, price, deposit and dates.
        </div>
      ) : isMobile ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {pipeline.map(({ d, closingIn, alert }) => (
            <button key={d.id} onClick={() => onOpenDeal(d.id)} style={{ textAlign: "left", background: "#fff", border: `1px solid ${C.line}`, borderLeft: alert ? `3px solid ${alert.tone === "red" ? "#b3261e" : "#c97a18"}` : `1px solid ${C.line}`, borderRadius: 12, padding: "11px 13px", cursor: "pointer", fontFamily: "inherit" }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "flex-start" }}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.ink }}>{d.propertyName || d.fileName}</span>
                {pill(d.saleStage)}
              </div>
              <div style={{ fontSize: 12, color: C.sub, marginTop: 4 }}>{[d.txnBuyer, money(d.txnSalePrice) !== "—" ? money(d.txnSalePrice) : null, psf(d)].filter(Boolean).join(" · ") || "Buyer / price not entered"}</div>
              <div style={{ fontSize: 11.5, color: C.sub, marginTop: 3 }}>Deposit {deposit(d)} · PSA {fmtDate(d.salePsaDate)} · DD {fmtDate(d.saleDiligenceEnd)}</div>
              <div style={{ fontSize: 11.5, color: C.ink, marginTop: 3, fontWeight: 600 }}>Closing {fmtDate(d.saleExpectedClosing)}{closingIn != null && closingIn >= 0 ? ` · in ${closingIn} days` : ""}</div>
              {alert && <div style={{ fontSize: 11.5, color: alert.tone === "red" ? "#b3261e" : "#9a5a0e", marginTop: 5 }}>⚠ {alert.text}</div>}
            </button>
          ))}
        </div>
      ) : (
        <div style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900, fontSize: 12 }}>
              <thead>
                <tr style={{ background: "#faf7f0", borderBottom: `1px solid ${C.line}` }}>
                  {["Property", "Stage", "Buyer", "Price", "Deposit", "PSA signed", "Diligence ends", "Expected closing", ""].map((h, i) => (
                    <th key={i} style={{ padding: "10px 10px", textAlign: i === 3 ? "right" : "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: C.faint, textTransform: "uppercase", whiteSpace: "nowrap" }}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pipeline.map(({ d, closingIn, alert }) => (
                  <tr key={d.id} onClick={() => onOpenDeal(d.id)} className="kpr-row-hover" style={{ borderBottom: "1px solid #f4f0e8", cursor: "pointer" }}>
                    <td style={{ padding: "10px", fontWeight: 600, color: C.ink }}>{d.propertyName || d.fileName}<div style={{ fontSize: 10.5, color: C.faint, fontWeight: 400 }}>{[d.city, d.state].filter(Boolean).join(", ")}</div></td>
                    <td style={{ padding: "10px" }}>{pill(d.saleStage)}</td>
                    <td style={{ padding: "10px", color: d.txnBuyer ? C.ink : C.faint }}>{d.txnBuyer || "—"}</td>
                    <td style={{ padding: "10px", textAlign: "right", whiteSpace: "nowrap", color: C.ink }}>{money(d.txnSalePrice)}{psf(d) && <div style={{ fontSize: 10.5, color: C.faint }}>{psf(d)}</div>}</td>
                    <td style={{ padding: "10px", whiteSpace: "nowrap", color: d.saleDepositStatus === "Hard" ? "#0f7a43" : C.sub }}>{deposit(d)}</td>
                    <td style={{ padding: "10px", whiteSpace: "nowrap", color: C.sub }}>{fmtDate(d.salePsaDate)}</td>
                    <td style={{ padding: "10px", whiteSpace: "nowrap", color: C.sub }}>{fmtDate(d.saleDiligenceEnd)}</td>
                    <td style={{ padding: "10px", whiteSpace: "nowrap", color: C.ink, fontWeight: 600 }}>{fmtDate(d.saleExpectedClosing)}{closingIn != null && closingIn >= 0 && <div style={{ fontSize: 10.5, color: C.faint, fontWeight: 400 }}>in {closingIn} days</div>}</td>
                    <td style={{ padding: "10px", fontSize: 11, color: alert?.tone === "red" ? "#b3261e" : "#9a5a0e", maxWidth: 220 }}>{alert ? `⚠ ${alert.text}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {closed.length > 0 && (
        <div style={{ marginTop: 22 }}>
          <div style={{ fontSize: 10, letterSpacing: "0.12em", color: C.faint, fontWeight: 700, textTransform: "uppercase", marginBottom: 8 }}>Closed in the last 12 months</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {closed.map(d => (
              <button key={d.id} onClick={() => onOpenDeal(d.id)} style={{ display: "flex", gap: 10, justifyContent: "space-between", flexWrap: "wrap", textAlign: "left", background: "#fff", border: `1px solid ${C.line}`, borderRadius: 10, padding: "9px 12px", cursor: "pointer", fontFamily: "inherit", fontSize: 12.5 }}>
                <span style={{ fontWeight: 600, color: C.ink }}>{d.propertyName || d.fileName}</span>
                <span style={{ color: C.sub }}>{[`closed ${fmtDate(d.txnSaleDate)}`, money(d.txnSalePrice) !== "—" ? money(d.txnSalePrice) : null, d.txnBuyer].filter(Boolean).join(" · ")}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
