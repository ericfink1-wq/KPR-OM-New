import { useMemo, useState } from "react";
import type { Deal } from "../lib/idb";
import { runPortfolioAudit, type ReimbDealGroup } from "../lib/portfolioAudit";

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

// One deal's row in the reimbursement audit: deal name (click to open) + a wrapped
// set of tenant chips. `kind` picks which tenant list to show.
function ReimbDealRow({ g, kind, onOpen }: { g: ReimbDealGroup; kind: "fixedCam" | "gross"; onOpen: (id: string) => void }) {
  const tenants = kind === "fixedCam" ? g.fixedCam : g.gross;
  if (!tenants.length) return null;
  const accent = kind === "fixedCam" ? C.amber : C.red;
  return (
    <div onClick={() => onOpen(g.dealId)} role="button"
      style={{ background: "#fff", border: `1px solid ${C.line}`, borderLeft: `3px solid ${accent}`, borderRadius: 8, padding: "9px 11px", cursor: "pointer" }}>
      <div style={{ fontSize: 12.5, fontWeight: 700, color: C.ink }}>{g.dealName} <span style={{ color: C.faint, fontWeight: 500 }}>· {tenants.length} tenant{tenants.length > 1 ? "s" : ""}</span></div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 5 }}>
        {tenants.map((t, i) => (
          <span key={i} title={t.text}
            style={{ fontSize: 10.5, color: C.ink, background: kind === "fixedCam" ? C.amberBg : C.redBg, border: `1px solid ${kind === "fixedCam" ? C.amberBd : C.redBd}`, borderRadius: 5, padding: "2px 7px", whiteSpace: "nowrap" }}>{t.tenant}</span>
        ))}
      </div>
    </div>
  );
}

export default function DataAuditView({ deals, onOpenDeal }: { deals: Deal[]; onOpenDeal: (id: string) => void }) {
  const audit = useMemo(() => runPortfolioAudit(deals), [deals]);
  const taxHigh = audit.tax.filter((t) => t.severity === "high").length;
  const fixedCamDeals = audit.reimbDeals.filter((g) => g.fixedCam.length > 0);
  const grossDeals = audit.reimbDeals.filter((g) => g.gross.length > 0);
  const [showGross, setShowGross] = useState(false);

  return (
    <div style={{ padding: "20px 18px 40px", maxWidth: 1100, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      <div style={{ fontSize: 22, fontWeight: 800, color: C.ink, fontFamily: "Georgia, serif" }}>Portfolio Data Audit</div>
      <div style={{ fontSize: 12.5, color: C.sub, marginTop: 4, lineHeight: 1.5 }}>
        Deterministic checks run across all {audit.dealsScanned} deals — the same checks that caught the recent fixed-CAM and tax-value issues. Click any row to open the deal and fix it.
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginTop: 14 }}>
        <Stat n={taxHigh} label="Tax-value issues (likely errors)" tone={taxHigh ? "red" : "green"} />
        <Stat n={audit.fixedCamCount} label={`Fixed-CAM tenants · ${fixedCamDeals.length} deals (landlord bears CAM growth)`} tone={audit.fixedCamCount ? "amber" : "green"} />
        <Stat n={audit.grossCount} label={`Gross-labeled tenants · ${grossDeals.length} deals (spot-check)`} tone={audit.grossCount ? "amber" : "green"} />
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

      {/* Fixed-CAM — the real concern (was being mislabeled NNN). Grouped by deal. */}
      <div style={{ marginTop: 22 }}>
        <div style={{ fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", color: C.sub, textTransform: "uppercase", marginBottom: 8 }}>Fixed-CAM recovery — landlord bears CAM growth</div>
        {fixedCamDeals.length === 0 ? (
          <div style={{ fontSize: 12.5, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "10px 12px" }}>✓ No fixed-CAM tenants found.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {fixedCamDeals.map((g) => <ReimbDealRow key={g.dealId} g={g} kind="fixedCam" onOpen={onOpenDeal} />)}
          </div>
        )}
        <div style={{ fontSize: 10.5, color: C.faint, marginTop: 8, lineHeight: 1.5 }}>
          These tenants' CAM is a fixed/escalating amount, so the landlord — not the tenant — absorbs CAM growth above the escalator. Underwrite their expense recovery conservatively.
        </div>
      </div>

      {/* Gross — collapsed by default (often a loose extraction label; spot-check). */}
      <div style={{ marginTop: 18 }}>
        <button onClick={() => setShowGross((s) => !s)}
          style={{ display: "flex", alignItems: "center", gap: 6, background: "none", border: "none", cursor: "pointer", padding: 0, fontSize: 11, fontWeight: 800, letterSpacing: "0.05em", color: C.sub, textTransform: "uppercase" }}>
          {showGross ? "▾" : "▸"} Gross-labeled tenants ({audit.grossCount} · {grossDeals.length} deals)
        </button>
        <div style={{ fontSize: 10.5, color: C.faint, marginTop: 4, lineHeight: 1.5 }}>
          A bare "Gross" label is often a loose extraction rather than a true gross lease — these are worth spot-checking, not necessarily fixing. Genuine gross leases mean the landlord absorbs ALL expenses.
        </div>
        {showGross && (
          <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 8 }}>
            {grossDeals.map((g) => <ReimbDealRow key={g.dealId} g={g} kind="gross" onOpen={onOpenDeal} />)}
          </div>
        )}
      </div>
    </div>
  );
}
