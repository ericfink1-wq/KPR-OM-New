import { useMemo } from "react";
import type { Deal } from "../lib/idb";
import { runPortfolioAudit } from "../lib/portfolioAudit";

// Portfolio Data Audit — surfaces the deterministic checks that recently caught
// real data errors, across every deal at once. Click any row to open the deal.

const C = {
  ink: "#383a37", sub: "#6f6a5f", faint: "#a69e91", line: "#efe8da", panel: "#faf7f0", panelBd: "#e7e0d2",
  green: "#3f7a1f", greenBg: "#eef3e6", greenBd: "#b8d49a",
  amber: "#c97a18", amberBg: "#fbf1e4", amberBd: "#e0c9a8",
  red: "#b3261e", redBg: "#fdecec", redBd: "#f3c0c0",
};

const sev = (s: "high" | "medium" | "info") =>
  s === "high" ? { fg: C.red, bg: C.redBg, bd: C.redBd } : s === "medium" ? { fg: C.amber, bg: C.amberBg, bd: C.amberBd } : { fg: C.sub, bg: "#fff", bd: C.line };

function Stat({ n, label, tone }: { n: number; label: string; tone: "red" | "amber" | "green" }) {
  const c = tone === "red" ? { fg: C.red, bg: C.redBg, bd: C.redBd } : tone === "amber" ? { fg: C.amber, bg: C.amberBg, bd: C.amberBd } : { fg: C.green, bg: C.greenBg, bd: C.greenBd };
  return (
    <div style={{ flex: "1 1 150px", background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 10, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontSize: 26, fontWeight: 800, color: c.fg, lineHeight: 1 }}>{n}</div>
      <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>{label}</div>
    </div>
  );
}

export default function DataAuditView({ deals, onOpenDeal }: { deals: Deal[]; onOpenDeal: (id: string) => void }) {
  const audit = useMemo(() => runPortfolioAudit(deals), [deals]);
  const taxHigh = audit.tax.filter((t) => t.severity === "high").length;

  return (
    <div style={{ padding: "20px 18px 40px", maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, fontFamily: "Georgia, serif" }}>Portfolio Data Audit</div>
      <div style={{ fontSize: 12.5, color: C.sub, marginTop: 4, lineHeight: 1.5 }}>
        Deterministic checks run across all {audit.dealsScanned} deals — the same checks that caught the recent fixed-CAM and tax-value issues. Click any row to open the deal and fix it.
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
        <Stat n={taxHigh} label="Tax-value issues (likely errors)" tone={taxHigh ? "red" : "green"} />
        <Stat n={audit.tax.length - taxHigh} label="Tax notes to verify" tone={audit.tax.length - taxHigh ? "amber" : "green"} />
        <Stat n={audit.reimbursement.length} label="Fixed-CAM / Gross tenants (landlord bears expense growth)" tone={audit.reimbursement.length ? "amber" : "green"} />
      </div>

      {/* Tax capture */}
      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", color: C.sub, textTransform: "uppercase", marginBottom: 8 }}>Tax data checks</div>
        {audit.tax.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "10px 12px" }}>✓ No tax-capture problems found across the portfolio.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {audit.tax.map((t, i) => {
              const s = sev(t.severity);
              return (
                <div key={i} onClick={() => onOpenDeal(t.dealId)} role="button"
                  style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${s.fg}`, borderRadius: 8, padding: "9px 11px", cursor: "pointer" }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: s.fg, background: s.bg, border: `1px solid ${s.bd}`, borderRadius: 5, padding: "1px 6px", flexShrink: 0, marginTop: 1 }}>{t.severity.toUpperCase()}</span>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{t.dealName}</div>
                    <div style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.45, marginTop: 2 }}>{t.message}</div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Reimbursement */}
      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", color: C.sub, textTransform: "uppercase", marginBottom: 8 }}>Fixed-CAM / Gross recovery (landlord bears expense growth)</div>
        {audit.reimbursement.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "10px 12px" }}>✓ No fixed-CAM or gross tenants found — all recoveries read as pro-rata NNN.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {audit.reimbursement.map((t, i) => (
              <div key={i} onClick={() => onOpenDeal(t.dealId)} role="button"
                style={{ display: "flex", gap: 10, alignItems: "flex-start", background: "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${t.label === "GROSS" ? C.red : C.amber}`, borderRadius: 8, padding: "9px 11px", cursor: "pointer" }}>
                <span style={{ fontSize: 9, fontWeight: 800, color: t.label === "GROSS" ? C.red : C.amber, background: t.label === "GROSS" ? C.redBg : C.amberBg, border: `1px solid ${t.label === "GROSS" ? C.redBd : C.amberBd}`, borderRadius: 5, padding: "1px 6px", flexShrink: 0, marginTop: 1, whiteSpace: "nowrap" }}>{t.label}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: 12.5, color: C.ink }}><b>{t.tenant}</b> · <span style={{ color: C.sub }}>{t.dealName}</span></div>
                  {t.method && <div style={{ fontSize: 11, color: C.sub, lineHeight: 1.45, marginTop: 2 }}>{t.method.length > 200 ? t.method.slice(0, 200) + "…" : t.method}</div>}
                </div>
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
          These tenants' CAM is a fixed/escalating amount (or the lease is gross), so the landlord — not the tenant — absorbs CAM growth above the escalator. Underwrite their expense recovery conservatively.
        </div>
      </div>
    </div>
  );
}
