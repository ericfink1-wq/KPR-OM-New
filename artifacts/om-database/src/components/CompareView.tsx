import { useState, useMemo, Fragment } from "react";
import type { Deal } from "../lib/idb";
import { DETAIL_MAX_WIDTH } from "../lib/constants";
import { isInvestmentGrade } from "../lib/tenantCredit";
import { isVacant, tenantKey, tenantLabel, cityState } from "../lib/utils";
import { exportAggregateToExcel, type AggColumn } from "../lib/exportExcel";
import { useCreateAiMessage } from "@workspace/api-client-react";
import { useIsMobile } from "../hooks/use-mobile";

// ── small formatters ─────────────────────────────────────────────────────────
const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
const fmtUSD = (v: unknown) => { const x = n(v); return x == null ? "—" : `$${Math.round(x).toLocaleString()}`; };
const fmtUSD2 = (v: unknown) => { const x = n(v); return x == null ? "—" : `$${x.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; };
const fmtPct = (v: unknown) => { const x = n(v); return x == null ? "—" : `${x}%`; };
const fmtPct1 = (v: unknown) => { const x = n(v); return x == null ? "—" : `${x.toFixed(1)}%`; };
const fmtSF = (v: unknown) => { const x = n(v); return x == null ? "—" : `${Math.round(x).toLocaleString()} SF`; };
const fmtYrs = (v: unknown) => { const x = n(v); return x == null ? "—" : `${x} yrs`; };
const fmtBps = (v: unknown) => { const x = n(v); return x == null ? "—" : `${x} bps`; };
const fmtNum = (v: unknown) => { const x = n(v); return x == null ? "—" : Math.round(x).toLocaleString(); };

// Per-row "winner" direction: "high" = bigger is better, "low" = smaller is
// better, undefined = not comparable (text/no winner).
type Better = "high" | "low" | undefined;

interface Row {
  label: string;
  // raw numeric value for winner comparison (null = not comparable for this deal)
  val: (d: Deal) => number | null;
  // display string
  disp: (d: Deal) => string;
  better: Better;
}

interface Section {
  title: string;
  // a section only shows if at least one of its rows has data for some deal
  rows: Row[];
  // optional gate: only render when true (e.g. KPR economics)
  show?: (deals: Deal[]) => boolean;
}

// ── derived per-deal helpers ─────────────────────────────────────────────────
function igRentPct(d: Deal): number | null {
  const occ = (d.tenants || []).filter(t => !isVacant(t.name));
  const totalRent = occ.reduce((s, t) => s + (n(t.annualRent) ?? 0), 0);
  if (totalRent <= 0) return null;
  const igRent = occ.filter(t => t.name && isInvestmentGrade(t.name, t.creditRating))
    .reduce((s, t) => s + (n(t.annualRent) ?? 0), 0);
  return Math.round(igRent / totalRent * 100);
}
function anchorCount(d: Deal): number {
  return (d.tenants || []).filter(t => t.isAnchor && t.name && !isVacant(t.name)).length;
}
function darkCount(d: Deal): number {
  return (d.tenants || []).filter(t => t.isDark).length;
}
function napCount(d: Deal): number {
  return (d.tenants || []).filter(t => t.isNAP).length;
}
function vacantCount(d: Deal): number {
  return (d.tenants || []).filter(t => isVacant(t.name)).length;
}
function pricePerSF(d: Deal): number | null {
  const p = n(d.pricePerSF);
  if (p != null) return p;
  const price = n(d.askingPrice), sf = n(d.totalSF);
  return (price && sf) ? Math.round(price / sf) : null;
}
function kprPricePerSF(d: Deal): number | null {
  const price = n(d.txnPurchasePrice), sf = n(d.totalSF);
  return (price && sf) ? Math.round(price / sf) : null;
}
const isKprDeal = (d: Deal) => d.status === "Owned" || d.status === "Under Contract" || d.status === "Sold";

export default function CompareView({ deals, onBack, onOpen, onTenantClick }: {
  deals: Deal[];
  onBack: () => void;
  onOpen: (id: string) => void;
  onTenantClick?: (name: string) => void;
}) {
  const isMobile = useIsMobile();
  const { mutateAsync: sendMessage } = useCreateAiMessage();
  const [aiText, setAiText] = useState<string>("");
  const [aiLoading, setAiLoading] = useState(false);

  // ── Section / row definitions ──────────────────────────────────────────────
  const sections: Section[] = [
    {
      title: "Pricing",
      rows: [
        { label: "Asking Price", val: d => n(d.askingPrice), disp: d => fmtUSD(d.askingPrice), better: "low" },
        { label: "Cap Rate (OM)", val: d => n(d.capRate), disp: d => fmtPct(d.capRate), better: "high" },
        { label: "Price / SF", val: d => pricePerSF(d), disp: d => { const x = pricePerSF(d); return x == null ? "—" : `$${x.toLocaleString()}`; }, better: "low" },
        { label: "NOI (OM)", val: d => n(d.noi), disp: d => fmtUSD(d.noi), better: "high" },
        { label: "NOI / SF", val: d => { const noi = n(d.noi), sf = n(d.totalSF); return (noi && sf) ? noi / sf : null; }, disp: d => { const noi = n(d.noi), sf = n(d.totalSF); return (noi && sf) ? fmtUSD2(noi / sf) : "—"; }, better: "high" },
      ],
    },
    {
      title: "Physical",
      rows: [
        { label: "Total SF", val: d => n(d.totalSF), disp: d => fmtSF(d.totalSF), better: "high" },
        { label: "Center Type", val: () => null, disp: d => d.centerType || d.assetType || "—", better: undefined },
        { label: "Market", val: () => null, disp: d => cityState(d) || d.market || "—", better: undefined },
      ],
    },
    {
      title: "Income & Tenancy",
      rows: [
        { label: "Occupancy", val: d => n(d.occupancy), disp: d => fmtPct(d.occupancy), better: "high" },
        { label: "WALT", val: d => n(d.walt), disp: d => fmtYrs(d.walt), better: "high" },
        { label: "Avg Rent / SF", val: d => n(d.weightedAvgRentPSF), disp: d => { const x = n(d.weightedAvgRentPSF); return x == null ? "—" : `$${x.toFixed(2)}`; }, better: "high" },
        { label: "# Tenants", val: d => (d.tenants || []).length || null, disp: d => String((d.tenants || []).length || "—"), better: undefined },
        { label: "Anchors", val: d => anchorCount(d) || null, disp: d => String(anchorCount(d) || "—"), better: "high" },
        { label: "IG Tenant Rent %", val: d => igRentPct(d), disp: d => { const x = igRentPct(d); return x == null ? "—" : `${x}%`; }, better: "high" },
        { label: "Dark Stores", val: d => darkCount(d), disp: d => darkCount(d) ? `${darkCount(d)} ⚠` : "0", better: "low" },
        { label: "Vacant Units", val: d => vacantCount(d), disp: d => String(vacantCount(d)), better: "low" },
        { label: "NAP Parcels", val: d => napCount(d) || null, disp: d => String(napCount(d) || "—"), better: undefined },
      ],
    },
    {
      title: "Demographics",
      rows: [
        { label: "Population 3mi", val: d => n(d.marketDemographics?.pop3mi), disp: d => fmtNum(d.marketDemographics?.pop3mi), better: "high" },
        { label: "Avg HH Income 3mi", val: d => n(d.marketDemographics?.avgHHI3mi), disp: d => fmtUSD(d.marketDemographics?.avgHHI3mi), better: "high" },
      ],
    },
    {
      title: "Deal Score",
      rows: [
        { label: "KPR Score", val: d => n(d.dealScore?.score), disp: d => { const x = n(d.dealScore?.score); return x == null ? "—" : `${x}${d.dealScore?.grade ? ` (${d.dealScore.grade})` : ""}`; }, better: "high" },
        { label: "Red Flags", val: d => (d.redFlags || []).length, disp: d => String((d.redFlags || []).length), better: "low" },
      ],
    },
    {
      title: "KPR Economics (owned / contracted / sold)",
      show: ds => ds.some(isKprDeal),
      rows: [
        { label: "KPR Purchase Price", val: d => n(d.txnPurchasePrice), disp: d => fmtUSD(d.txnPurchasePrice), better: "low" },
        { label: "KPR Price / SF", val: d => kprPricePerSF(d), disp: d => { const x = kprPricePerSF(d); return x == null ? "—" : `$${x.toLocaleString()}`; }, better: "low" },
        { label: "Going-In Cap (actual)", val: d => n(d.acqCapRate), disp: d => fmtPct(d.acqCapRate), better: "high" },
        { label: "NOI at Close", val: d => n(d.acqNOIAtClose), disp: d => fmtUSD(d.acqNOIAtClose), better: "high" },
        { label: "Loan Amount", val: d => n(d.debtLoanAmount), disp: d => fmtUSD(d.debtLoanAmount), better: undefined },
        { label: "Loan Rate", val: d => n(d.debtRate), disp: d => fmtPct(d.debtRate), better: "low" },
        { label: "Spread over Index", val: d => n(d.debtSpread), disp: d => fmtBps(d.debtSpread), better: "low" },
        { label: "LTV", val: d => n(d.debtLTV), disp: d => fmtPct(d.debtLTV), better: undefined },
        { label: "IO Period", val: d => n(d.debtIOPeriod), disp: d => fmtYrs(d.debtIOPeriod), better: "high" },
        { label: "Pref Equity", val: d => n(d.prefAmount), disp: d => fmtUSD(d.prefAmount), better: undefined },
        { label: "Pref Pay Rate", val: d => n(d.prefRateCurrent), disp: d => fmtPct(d.prefRateCurrent), better: "low" },
        { label: "Sale Price (exit)", val: d => n(d.txnSalePrice), disp: d => fmtUSD(d.txnSalePrice), better: undefined },
      ],
    },
  ];

  // Winner per row: index(es) of the best deal. Only when ≥2 deals have a value
  // AND the values aren't all identical.
  const winnersFor = (row: Row): Set<number> => {
    if (!row.better) return new Set();
    const vals = deals.map(row.val);
    const present = vals.map((v, i) => ({ v, i })).filter(x => x.v != null) as { v: number; i: number }[];
    if (present.length < 2) return new Set();
    const allSame = present.every(x => x.v === present[0].v);
    if (allSame) return new Set();
    const best = row.better === "high" ? Math.max(...present.map(x => x.v)) : Math.min(...present.map(x => x.v));
    return new Set(present.filter(x => x.v === best).map(x => x.i));
  };

  // Only render a section if at least one deal has at least one value in it.
  const visibleSections = sections.filter(s => {
    if (s.show && !s.show(deals)) return false;
    return s.rows.some(r => deals.some(d => r.disp(d) !== "—" && r.disp(d) !== "0"));
  });

  // ── Tenant overlap ───────────────────────────────────────────────────────
  const overlap = useMemo(() => {
    const map = new Map<string, { label: string; deals: Set<number>; anchor: boolean }>();
    deals.forEach((d, di) => {
      (d.tenants || []).forEach(t => {
        if (!t.name || isVacant(t.name)) return;
        const k = tenantKey(t.canonicalName || t.name);
        if (!k) return;
        const cur = map.get(k) || { label: tenantLabel(t.name, t.canonicalName), deals: new Set<number>(), anchor: false };
        cur.deals.add(di);
        if (t.isAnchor) cur.anchor = true;
        map.set(k, cur);
      });
    });
    return [...map.values()].filter(x => x.deals.size >= 2)
      .sort((a, b) => (b.anchor ? 1 : 0) - (a.anchor ? 1 : 0) || b.deals.size - a.deals.size);
  }, [deals]);

  // ── AI side-by-side analysis ───────────────────────────────────────────────
  const runAiAnalysis = async () => {
    if (aiLoading) return;
    setAiLoading(true);
    setAiText("");
    try {
      const compact = deals.map(d => ({
        name: d.propertyName || d.fileName, status: d.status, market: cityState(d) || d.market,
        centerType: d.centerType || d.assetType, totalSF: d.totalSF,
        askingPrice: d.askingPrice, capRate: d.capRate, noi: d.noi, pricePerSF: pricePerSF(d),
        occupancy: d.occupancy, walt: d.walt, avgRentPSF: d.weightedAvgRentPSF,
        anchors: (d.tenants || []).filter(t => t.isAnchor && t.name && !isVacant(t.name)).map(t => t.name),
        igRentPct: igRentPct(d), darkStores: darkCount(d), vacants: vacantCount(d),
        dealScore: d.dealScore?.score, grade: d.dealScore?.grade,
        pop3mi: d.marketDemographics?.pop3mi, avgHHI3mi: d.marketDemographics?.avgHHI3mi,
        kpr: isKprDeal(d) ? {
          purchasePrice: d.txnPurchasePrice, acqCap: d.acqCapRate, loanAmount: d.debtLoanAmount,
          loanRate: d.debtRate, ltv: d.debtLTV, ioYears: d.debtIOPeriod, prefAmount: d.prefAmount,
        } : undefined,
      }));
      const system = `You are KPR Centers' in-house retail real estate analyst. Compare the shopping centers below SIDE BY SIDE for an acquisitions principal. Be specific and reference each property by name with real numbers. Reason from the data — never invent figures; if something isn't given, say so.

Structure your answer:
### Verdict
One paragraph: which is the more compelling buy and why (or the key trade-off if it depends on strategy).
### Head-to-head
A few bullets on the sharpest contrasts (pricing/basis, income durability/WALT, credit/anchor quality, occupancy/dark risk, demographics).
### Per property
For each: one line of its biggest strength and biggest risk.

Statuses: Owned/Under Contract/Sold are KPR's actual deals (kpr object = real economics: what KPR paid, actual cap, financing). Prospect/Passed are pipeline/library (askingPrice/capRate are seller-stated, not KPR's basis). Keep it tight and institutional.`;
      const resp = await sendMessage({ data: {
        system,
        messages: [{ role: "user", content: `Compare these ${deals.length} retail centers:\n${JSON.stringify(compact, null, 2)}` }],
        max_tokens: 1500,
      }});
      const text = (resp as any)?.content?.[0]?.text || (resp as any)?.text || "Couldn't generate an analysis.";
      setAiText(text);
    } catch (err) {
      setAiText(`Error: ${err instanceof Error ? err.message : "analysis failed"}`);
    } finally {
      setAiLoading(false);
    }
  };

  // ── Excel export ───────────────────────────────────────────────────────────
  const exportXlsx = () => {
    // One row per metric, one column per deal — mirrors the on-screen table.
    const metricRows: Record<string, unknown>[] = [];
    visibleSections.forEach(s => {
      s.rows.forEach(r => {
        if (!deals.some(d => r.disp(d) !== "—")) return;
        const row: Record<string, unknown> = { Section: s.title, Metric: r.label };
        deals.forEach(d => { row[d.propertyName || d.fileName || d.id] = r.disp(d); });
        metricRows.push(row);
      });
    });
    const columns: AggColumn[] = [
      { header: "Section", width: 22, get: r => (r.Section as string) || "" },
      { header: "Metric", width: 24, get: r => (r.Metric as string) || "" },
      ...deals.map(d => ({ header: d.propertyName || d.fileName || "Deal", width: 22, get: (r: Record<string, unknown>) => (r[d.propertyName || d.fileName || d.id] as string) ?? "" })),
    ];
    exportAggregateToExcel(metricRows, columns, "Comparison", `KPR_Compare_${deals.length}_properties.xlsx`);
  };

  // ── styles ───────────────────────────────────────────────────────────────
  const winCell: React.CSSProperties = { background: "#f0fae8", color: "#2f6e10", fontWeight: 700 };
  const darkBtn: React.CSSProperties = { background: "#26281f", border: "none", color: "#e8e0cf", padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" };
  const ghostBtn: React.CSSProperties = { background: "#fff", border: "1px solid #d9d2c4", color: "#5c5047", padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" };

  return (
    <div style={{ padding: isMobile ? "14px 14px 40px" : "20px 28px 40px", maxWidth: DETAIL_MAX_WIDTH, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {/* Toolbar */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center", marginBottom: 18 }}>
        <button onClick={onBack} style={{ ...ghostBtn, padding: "5px 10px", fontSize: 11, fontWeight: 400, color: "#7d766a", border: "1px solid #e7e0d2" }}>← Back</button>
        <div style={{ fontFamily: "'Fraunces',serif", fontSize: isMobile ? 18 : 21, fontWeight: 500, color: "#26281f", flex: 1, minWidth: 140 }}>
          Comparing {deals.length} properties
        </div>
        <button onClick={runAiAnalysis} disabled={aiLoading} style={{ ...darkBtn, opacity: aiLoading ? 0.6 : 1 }}>
          {aiLoading ? "Analyzing…" : "✨ Analyze side-by-side"}
        </button>
        <button onClick={exportXlsx} style={ghostBtn}>⬇ Export Excel</button>
      </div>

      {/* AI analysis panel */}
      {(aiText || aiLoading) && (
        <div style={{ background: "#fffaf2", border: "1px solid #ece0c8", borderRadius: 12, padding: isMobile ? "14px 16px" : "18px 22px", marginBottom: 22 }}>
          <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", color: "#b08a3e", textTransform: "uppercase", marginBottom: 8 }}>AI side-by-side analysis</div>
          {aiLoading && !aiText ? (
            <div style={{ display: "flex", gap: 5 }}>{[0, 1, 2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#d8b878", display: "block", animation: `dotPulse 1.2s ease ${i * 0.2}s infinite` }} />)}</div>
          ) : (
            <div style={{ fontSize: 13.5, lineHeight: 1.7, color: "#383a37" }}><CompareMarkdown text={aiText} /></div>
          )}
        </div>
      )}

      {/* ── Comparison body ─────────────────────────────────────────────────── */}
      {isMobile ? (
        // MOBILE: stacked per-property cards, section by section
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {visibleSections.map(s => (
            <div key={s.title}>
              <div style={sectionLabelStyle}>{s.title}</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                {deals.map((d, di) => (
                  <div key={d.id} style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 12, overflow: "hidden" }}>
                    <button onClick={() => onOpen(d.id)} style={{ width: "100%", textAlign: "left", background: "#faf7f0", border: "none", borderBottom: "1px solid #f1eadc", padding: "10px 14px", cursor: "pointer" }}>
                      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 14, fontWeight: 500, color: "#26281f" }}>{d.propertyName || d.fileName || "Untitled"}</div>
                      <div style={{ fontSize: 10, color: "#a89f8f" }}>{statusBadge(d)} · {cityState(d) || d.market || ""}</div>
                    </button>
                    <div>
                      {s.rows.filter(r => deals.some(x => r.disp(x) !== "—")).map(r => {
                        const win = winnersFor(r).has(di);
                        return (
                          <div key={r.label} style={{ display: "flex", justifyContent: "space-between", padding: "7px 14px", borderTop: "1px solid #f6f1e7", fontSize: 12.5 }}>
                            <span style={{ color: "#8b8578" }}>{r.label}</span>
                            <span style={{ fontWeight: 600, color: win ? "#2f6e10" : "#383a37" }}>{r.disp(d)}{win ? " ★" : ""}</span>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : (
        // DESKTOP: classic side-by-side table with section bands + winner highlight
        <div style={{ overflowX: "auto" }}>
          <table style={{ borderCollapse: "collapse", width: "100%", background: "#fff", border: "1px solid #ece5d7", borderRadius: 12, overflow: "hidden" }}>
            <thead>
              <tr style={{ background: "#faf7f0" }}>
                <th className="freeze-col" style={{ padding: "12px 14px", textAlign: "left", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#a89f8f", textTransform: "uppercase", width: 180, position: "sticky", left: 0, background: "#faf7f0", zIndex: 1 }}>Metric</th>
                {deals.map(d => (
                  <th key={d.id} style={{ padding: "12px 14px", textAlign: "left", minWidth: 175 }}>
                    <button onClick={() => onOpen(d.id)} style={{ background: "transparent", border: "none", cursor: "pointer", textAlign: "left", padding: 0 }}>
                      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 14, fontWeight: 500, color: "#26281f" }}>{d.propertyName || d.fileName || "Untitled"}</div>
                      <div style={{ fontSize: 10, color: "#a89f8f", marginTop: 2 }}>{statusBadge(d)} · {cityState(d) || d.market || ""}</div>
                    </button>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {visibleSections.map(s => (
                <Fragment key={`sec-${s.title}`}>
                  <tr>
                    <td colSpan={deals.length + 1} style={{ background: "#f3efe6", padding: "6px 14px", fontSize: 9, fontWeight: 700, letterSpacing: "0.1em", color: "#9a8f76", textTransform: "uppercase" }}>{s.title}</td>
                  </tr>
                  {s.rows.filter(r => deals.some(d => r.disp(d) !== "—")).map(r => {
                    const winners = winnersFor(r);
                    return (
                      <tr key={r.label} style={{ borderTop: "1px solid #f1eadc" }}>
                        <td className="freeze-col" style={{ padding: "9px 14px", fontSize: 11, fontWeight: 600, color: "#7d766a", whiteSpace: "nowrap", position: "sticky", left: 0, background: "#fff", zIndex: 1 }}>{r.label}</td>
                        {deals.map((d, di) => (
                          <td key={d.id} style={{ padding: "9px 14px", fontSize: 12.5, color: "#383a37", fontWeight: 500, ...(winners.has(di) ? winCell : {}) }}>
                            {r.disp(d)}{winners.has(di) ? " ★" : ""}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Tenant overlap ──────────────────────────────────────────────────── */}
      <div style={sectionLabelStyle}>Shared tenants {overlap.length > 0 ? `(${overlap.length})` : ""}</div>
      {overlap.length === 0 ? (
        <div style={{ background: "#faf7f0", border: "1px dashed #e3dccd", borderRadius: 12, padding: "12px 16px", fontSize: 12.5, color: "#9a917f" }}>
          No tenants appear in more than one of these centers — fully diversified across this set.
        </div>
      ) : (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
          {overlap.map(o => (
            <span key={o.label} onClick={() => onTenantClick?.(o.label)}
              title={`In ${o.deals.size} of ${deals.length} centers`}
              style={{ background: o.anchor ? "#f0fae8" : "#f6f2ea", border: `1px solid ${o.anchor ? "#c6e6a0" : "#e3dccd"}`, color: o.anchor ? "#3d7a1c" : "#5c5047", borderRadius: 7, padding: "4px 9px", fontSize: 11.5, fontWeight: 600, cursor: onTenantClick ? "pointer" : "default" }}>
              {o.label}{o.anchor ? " ⚓" : ""} <span style={{ color: "#a89f8f", fontWeight: 500 }}>×{o.deals.size}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

const sectionLabelStyle: React.CSSProperties = {
  fontSize: 9, fontWeight: 700, letterSpacing: "0.14em", color: "#a89f8f",
  textTransform: "uppercase", marginTop: 26, marginBottom: 10,
};

function statusBadge(d: Deal): string {
  return d.status || "Prospect";
}

// Minimal markdown for the AI panel (headers, bold, bullets).
function CompareMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  return <>{lines.map((line, i) => {
    if (line.startsWith("### ")) return <div key={i} style={{ fontFamily: "'Fraunces',serif", fontSize: 14, fontWeight: 600, color: "#26281f", marginTop: 12, marginBottom: 3 }}>{inl(line.slice(4))}</div>;
    if (line.startsWith("## ")) return <div key={i} style={{ fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 600, color: "#26281f", marginTop: 12, marginBottom: 3 }}>{inl(line.slice(3))}</div>;
    if (/^[-*] /.test(line)) return <div key={i} style={{ display: "flex", gap: 7, marginLeft: 2 }}><span style={{ color: "#c89a3e", flexShrink: 0 }}>›</span><span>{inl(line.slice(2))}</span></div>;
    if (line === "") return <div key={i} style={{ height: 5 }} />;
    return <span key={i}>{inl(line)}<br /></span>;
  })}</>;
}
function inl(text: string): React.ReactNode {
  return text.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith("**") && p.endsWith("**") ? <strong key={i}>{p.slice(2, -2)}</strong> : p);
}
