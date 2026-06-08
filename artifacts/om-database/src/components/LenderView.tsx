import { useState } from "react";
import type { Deal } from "../lib/idb";
import { DETAIL_MAX_WIDTH } from "../lib/constants";
import { lenderKey, lenderLabel } from "../lib/utils";

interface Props {
  lenderName: string;
  deals: Deal[];
  onBack: () => void;
  onOpenDeal: (deal: Deal) => void;
}

function fmt$(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${v.toLocaleString()}`;
}

function fmtDate(s: string | null | undefined): string {
  if (!s) return "—";
  const d = new Date(s.includes("T") ? s : s + "T00:00:00");
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

function daysUntil(s: string | null | undefined): number | null {
  if (!s) return null;
  const d = new Date(s.includes("T") ? s : s + "T00:00:00");
  if (isNaN(d.getTime())) return null;
  return Math.round((d.getTime() - Date.now()) / 86400000);
}

function maturityColor(days: number | null): string {
  if (days == null) return "#a69e91";
  if (days < 0) return "#dc2626";
  if (days < 365) return "#ea6000";
  if (days < 730) return "#b08000";
  return "#2d7a0e";
}

interface LoanRow {
  deal: Deal;
  loanType: "Senior" | "Pref Equity";
  lender: string;
  amount: number | null;
  rate: number | null;
  rateType: string | null;
  maturity: string | null;
  ltv: number | null;
  notes: string | null;
}

export default function LenderView({ lenderName, deals, onBack, onOpenDeal }: Props) {
  const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const normKey = lenderKey(lenderName);

  const rows: LoanRow[] = [];
  for (const d of deals) {
    const seniorMatch = d.debtLender && lenderKey(d.debtLender) === normKey;
    const prefMatch   = d.prefLender  && lenderKey(d.prefLender)  === normKey;
    if (seniorMatch) rows.push({
      deal: d, loanType: "Senior", lender: d.debtLender!,
      amount: num(d.debtLoanAmount), rate: num(d.debtRate),
      rateType: d.debtRateType ?? null, maturity: d.debtMaturityDate ?? null,
      ltv: num(d.debtLTV), notes: d.debtNotes ?? null,
    });
    if (prefMatch) rows.push({
      deal: d, loanType: "Pref Equity", lender: d.prefLender!,
      amount: num(d.prefAmount), rate: num(d.prefRateCurrent),
      rateType: d.prefReturnType ?? null, maturity: d.prefMaturityDate ?? null,
      ltv: null, notes: d.prefNotes ?? null,
    });
  }

  type SortKey = "property" | "type" | "amount" | "rate" | "maturity" | "ltv";
  const [sortKey, setSortKey] = useState<SortKey>("maturity");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");

  const setSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(x => x === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("asc"); }
  };

  const sorted = [...rows].sort((a, b) => {
    const dir = sortDir === "asc" ? 1 : -1;
    switch (sortKey) {
      case "property": return String(a.deal.propertyName || "").toLowerCase().localeCompare(String(b.deal.propertyName || "").toLowerCase()) * dir;
      case "type":     return a.loanType.localeCompare(b.loanType) * dir;
      case "amount":   { const av = a.amount ?? -Infinity, bv = b.amount ?? -Infinity; return (av - bv) * dir; }
      case "rate":     { const av = a.rate ?? -Infinity,   bv = b.rate ?? -Infinity;   return (av - bv) * dir; }
      case "maturity": { const av = a.maturity ?? "9999",  bv = b.maturity ?? "9999";  return av.localeCompare(bv) * dir; }
      case "ltv":      { const av = a.ltv ?? -Infinity,    bv = b.ltv ?? -Infinity;    return (av - bv) * dir; }
      default: return 0;
    }
  });

  const totalExposure = rows.reduce((s, r) => s + (r.amount ?? 0), 0);
  const seniorRows    = rows.filter(r => r.loanType === "Senior");
  const prefRows      = rows.filter(r => r.loanType === "Pref Equity");
  const rateRows      = rows.filter(r => r.rate != null);
  const wtAvgRate     = rateRows.length
    ? rateRows.reduce((s, r) => s + (r.rate! * (r.amount ?? 0)), 0) / rateRows.reduce((s, r) => s + (r.amount ?? 0), 0)
    : null;
  const nearest       = rows.filter(r => r.maturity).sort((a, b) => (a.maturity ?? "9999").localeCompare(b.maturity ?? "9999"))[0];

  const Th = ({ label, k }: { label: string; k: SortKey }) => (
    <th onClick={() => setSort(k)} style={{
      padding: "8px 10px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
      color: sortKey === k ? "#2d4ecf" : "#7d766a", textTransform: "uppercase",
      cursor: "pointer", whiteSpace: "nowrap", textAlign: k === "property" ? "left" : "right",
      background: "transparent", border: "none", userSelect: "none",
      borderBottom: "2px solid #e8e2d6",
    }}>
      {label}{sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
    </th>
  );

  return (
    <div style={{ padding: "24px 28px", maxWidth: DETAIL_MAX_WIDTH, margin: "0 auto", width: "100%", boxSizing: "border-box", fontFamily: "'Inter',sans-serif" }}>
      {/* Back */}
      <button onClick={onBack} style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, marginBottom: 20 }}>
        ← Back
      </button>

      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.1em", color: "#a69e91", textTransform: "uppercase", marginBottom: 4 }}>Lender Summary</div>
        <div style={{ fontFamily: "'Fraunces',serif", fontSize: 28, fontWeight: 700, color: "#262724", marginBottom: 4 }}>{lenderLabel(lenderName)}</div>
        <div style={{ fontSize: 13, color: "#7d766a" }}>
          {rows.length} loan{rows.length !== 1 ? "s" : ""} across {new Set(rows.map(r => r.deal.id)).size} propert{new Set(rows.map(r => r.deal.id)).size !== 1 ? "ies" : "y"}
        </div>
      </div>

      {/* Summary stat tiles */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(160px, 1fr))", gap: 12, marginBottom: 24 }}>
        {[
          { label: "Total Exposure", value: fmt$(totalExposure), sub: `${seniorRows.length} senior${prefRows.length ? ` · ${prefRows.length} pref` : ""}` },
          { label: "Wtd Avg Rate", value: wtAvgRate != null ? `${wtAvgRate.toFixed(2)}%` : "—", sub: "across all loans" },
          { label: "Nearest Maturity", value: nearest ? fmtDate(nearest.maturity) : "—", sub: nearest?.deal.propertyName ?? "", color: nearest ? maturityColor(daysUntil(nearest.maturity)) : undefined },
          { label: "Senior Debt", value: fmt$(seniorRows.reduce((s, r) => s + (r.amount ?? 0), 0)), sub: `${seniorRows.length} loan${seniorRows.length !== 1 ? "s" : ""}` },
          ...(prefRows.length ? [{ label: "Pref Equity", value: fmt$(prefRows.reduce((s, r) => s + (r.amount ?? 0), 0)), sub: `${prefRows.length} tranche${prefRows.length !== 1 ? "s" : ""}` }] : []),
        ].map((tile, i) => (
          <div key={i} style={{ background: "#fff", border: "1px solid #e8e2d6", borderRadius: 10, padding: "14px 16px" }}>
            <div style={{ fontSize: 9, letterSpacing: "0.08em", color: "#a69e91", textTransform: "uppercase", marginBottom: 4 }}>{tile.label}</div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 700, color: tile.color ?? "#262724", lineHeight: 1.1 }}>{tile.value}</div>
            {tile.sub && <div style={{ fontSize: 10, color: "#a69e91", marginTop: 3, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{tile.sub}</div>}
          </div>
        ))}
      </div>

      {/* Table */}
      <div style={{ background: "#fff", border: "1px solid #e8e2d6", borderRadius: 10, overflow: "hidden" }}>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ background: "#faf8f5" }}>
                <Th label="Property" k="property" />
                <Th label="Type" k="type" />
                <Th label="Amount" k="amount" />
                <Th label="Rate" k="rate" />
                <Th label="Maturity" k="maturity" />
                <Th label="LTV" k="ltv" />
              </tr>
            </thead>
            <tbody>
              {sorted.map((row, i) => {
                const days = daysUntil(row.maturity);
                const matColor = maturityColor(days);
                const isPref = row.loanType === "Pref Equity";
                return (
                  <tr key={i} style={{ background: i % 2 === 0 ? "#fff" : "#fafaf7", borderBottom: "1px solid #f1eadc" }}>
                    <td style={{ padding: "10px 10px" }}>
                      <button onClick={() => onOpenDeal(row.deal)} style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", textAlign: "left" }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#262724" }}>{row.deal.propertyName || row.deal.fileName}</div>
                        <div style={{ fontSize: 10, color: "#a69e91" }}>{[row.deal.city, row.deal.state].filter(Boolean).join(", ")}</div>
                      </button>
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right" }}>
                      <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 4, background: isPref ? "#f0e6ff" : "#e8f0ff", color: isPref ? "#7c3aed" : "#2d4ecf", fontWeight: 600 }}>
                        {row.loanType}
                      </span>
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right", fontWeight: 600, color: "#262724" }}>{fmt$(row.amount)}</td>
                    <td style={{ padding: "10px 10px", textAlign: "right", color: "#5c5f57" }}>
                      {row.rate != null ? `${row.rate}%` : "—"}
                      {row.rateType && <span style={{ fontSize: 10, color: "#a69e91", marginLeft: 4 }}>{row.rateType}</span>}
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right", color: matColor, fontWeight: days != null && days < 365 ? 700 : 400 }}>
                      {fmtDate(row.maturity)}
                      {days != null && days < 365 && days >= 0 && <div style={{ fontSize: 9, color: matColor }}>{days}d</div>}
                      {days != null && days < 0 && <div style={{ fontSize: 9, color: "#dc2626" }}>MATURED</div>}
                    </td>
                    <td style={{ padding: "10px 10px", textAlign: "right", color: "#5c5f57" }}>{row.ltv != null ? `${row.ltv}%` : "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 10, color: "#a69e91" }}>Click any property to open its deal page.</div>
    </div>
  );
}
