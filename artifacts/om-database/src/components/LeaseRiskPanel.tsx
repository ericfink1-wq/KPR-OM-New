import { useMemo, useState } from "react";
import type { Deal, LeaseAbstract } from "../lib/idb";
import {
  resolveTenantRisk, computeExposure, computeCombinedExposure, anchorsReferenced,
  buildAnchorDependencyGraph, buildDiligenceList, buildRiskMatrix, type ExposureResult,
} from "../lib/leaseRisk";
import { exportLeaseRiskMatrix } from "../lib/leaseRiskExcel";
import { useWatchlist } from "../lib/useWatchlist";
import { useIsMobile } from "../hooks/use-mobile";

// Lease Risk — Anchor Dependency. Reads the resolver LIVE (token-free): OM-disclosed
// co-tenancy/kickout clauses, overridden per tenant by any pasted lease abstract
// (which flips a clause to "verified"). Select ONE anchor to see the tiered "what if
// it goes dark" exposure, or MULTIPLE anchors to model them going dark together
// (surfacing cascade exposure a single-anchor view misses). When an executed abstract
// has de-linked or weakened a clause, the panel shows it as MITIGATED.

const C = {
  ink: "#383a37", sub: "#6f6a5f", faint: "#a69e91", line: "#efe8da", panel: "#faf7f0", panelBd: "#e7e0d2",
  green: "#3f7a1f", greenBg: "#eef3e6", greenBd: "#b8d49a",
  amber: "#c97a18", amberBg: "#fbf1e4", amberBd: "#e0c9a8",
  red: "#b3261e", redBg: "#fdecec", redBd: "#f3c0c0",
  graybg: "#f3efe7",
};

const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

function TierCard({ label, sub, amount, count, tone }: { label: string; sub: string; amount: number; count: number; tone: "red" | "amber" | "gray" }) {
  const c = tone === "red" ? { fg: C.red, bg: C.redBg, bd: C.redBd } : tone === "amber" ? { fg: C.amber, bg: C.amberBg, bd: C.amberBd } : { fg: C.sub, bg: C.graybg, bd: C.line };
  return (
    <div style={{ flex: "1 1 150px", background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 9, padding: "9px 11px", minWidth: 0 }}>
      <div style={{ fontSize: 9.5, fontWeight: 800, letterSpacing: "0.05em", color: c.fg, textTransform: "uppercase" }}>{label}</div>
      <div style={{ fontSize: 10, color: C.sub, marginBottom: 3 }}>{sub}</div>
      <div style={{ fontSize: 17, fontWeight: 800, color: C.ink, lineHeight: 1.1 }}>{money(amount)}</div>
      <div style={{ fontSize: 10.5, color: C.faint }}>{count} tenant{count === 1 ? "" : "s"}</div>
    </div>
  );
}

const tierMeta = (t: 1 | 2 | 3) =>
  t === 1 ? { label: "Tier 1", fg: C.red, bg: C.redBg, bd: C.redBd, txt: "trips on this anchor alone" }
  : t === 2 ? { label: "Tier 2", fg: C.amber, bg: C.amberBg, bd: C.amberBd, txt: "needs a second event" }
  : { label: "Tier 3", fg: C.sub, bg: C.graybg, bd: C.line, txt: "linked, deeper trigger" };

function remedyText(remedy: { mechanism?: string | null; value?: number | null } | null, termDays: number | null) {
  let s = "";
  if (remedy?.mechanism) s += ` · Remedy: ${remedy.mechanism.replace(/_/g, " ")}${remedy.value != null ? ` ${remedy.value}${/pct|percent/.test(remedy.mechanism) ? "%" : ""}` : ""}`;
  if (termDays) s += ` · ${termDays}-day termination`;
  return s;
}

export default function LeaseRiskPanel({ deal, abstracts }: { deal: Deal; abstracts: LeaseAbstract[] }) {
  const isMobile = useIsMobile();
  const watch = useWatchlist();

  const resolvedOM = useMemo(() => resolveTenantRisk(deal, []), [deal]);
  const resolved = useMemo(() => resolveTenantRisk(deal, abstracts), [deal, abstracts]);
  const anchors = useMemo(() => anchorsReferenced(resolved), [resolved]);
  const diligence = useMemo(() => buildDiligenceList(deal, abstracts), [deal, abstracts]);

  // How many tenants depend on each anchor — drives the per-chip count.
  const depByAnchor = useMemo(() => {
    const m = new Map<string, number>();
    for (const g of buildAnchorDependencyGraph(resolved)) m.set(g.anchor, g.dependents.length);
    return m;
  }, [resolved]);
  // Tier-1 rent at stake per anchor (base rent that trips if THIS anchor alone goes
  // dark) — the same engine the export matrix uses. Drives chip ORDER so the biggest
  // dollar exposure leads, not merely the anchor with the most dependent leases.
  const tier1ByAnchor = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of buildRiskMatrix(resolved).anchors) m.set(a.anchor, a.tier1Rent);
    return m;
  }, [resolved]);
  const isGeneric = (a: string) => /anchor tenant|premises|exhibit|replacement/i.test(a) || a.length > 34;
  const sortedAnchors = useMemo(() =>
    [...anchors].sort((x, y) =>
      (Number(isGeneric(x)) - Number(isGeneric(y))) ||
      ((tier1ByAnchor.get(y) ?? 0) - (tier1ByAnchor.get(x) ?? 0)) ||
      ((depByAnchor.get(y) ?? 0) - (depByAnchor.get(x) ?? 0)) ||
      x.localeCompare(y)),
    [anchors, tier1ByAnchor, depByAnchor]);

  const [selected, setSelected] = useState<string[]>([]);
  const [showDil, setShowDil] = useState(false);
  const [exporting, setExporting] = useState(false);

  // Whether there's anything to export (≥1 anchor with ≥1 dependent tenant).
  const hasMatrix = useMemo(() => {
    const m = buildRiskMatrix(resolved);
    return m.anchors.length > 0 && m.tenants.length > 0;
  }, [resolved]);
  const doExport = async () => {
    setExporting(true);
    try { await exportLeaseRiskMatrix(deal, abstracts, watch); }
    finally { setExporting(false); }
  };

  // Active set = exactly what the user picked. NOTHING is auto-selected.
  const active = useMemo(() => selected.filter((a) => anchors.includes(a)), [selected, anchors]);
  const toggle = (a: string) => setSelected((prev) => prev.includes(a) ? prev.filter((x) => x !== a) : [...prev, a]);

  if (!anchors.length && !diligence.length) return null;

  const multi = active.length >= 2;
  const single = active[0] || "";
  const exp: ExposureResult | null = (!multi && single) ? computeExposure(resolved, single) : null;
  const expOM: ExposureResult | null = (!multi && single) ? computeExposure(resolvedOM, single) : null;
  const combined = multi ? computeCombinedExposure(resolved, active) : null;

  // Single-anchor mitigations (executed leases de-linking / weakening a clause).
  const mitigations = (exp && expOM) ? expOM.clauses.flatMap((om) => {
    const now = exp.clauses.find((c) => c.tenant === om.tenant);
    if (!now) return [{ tenant: om.tenant, toTier: 0, fromTier: om.tier, rent: om.baseRentAnnual ?? 0 }];
    if (now.tier > om.tier) return [{ tenant: om.tenant, toTier: now.tier, fromTier: om.tier, rent: om.baseRentAnnual ?? 0 }];
    return [];
  }) : [];
  const tier1Delta = (exp && expOM && expOM.tier1Rent !== exp.tier1Rent);

  return (
    <div id="section-lease-risk" data-jump="Lease Risk" style={{ background: C.panel, border: `1px solid ${C.panelBd}`, borderRadius: 8, padding: isMobile ? "12px 13px" : "14px 16px", marginTop: 14, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10 }}>
        <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "#958d80", marginBottom: 2 }}>LEASE RISK · ANCHOR DEPENDENCY</div>
        {hasMatrix && (
          <button onClick={doExport} disabled={exporting}
            title="Download the anchor × tenant risk matrix (who trips if an anchor goes dark, and how much rent is at stake) as Excel"
            style={{ flexShrink: 0, fontSize: 11.5, fontWeight: 700, color: exporting ? C.faint : C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 7, padding: "5px 11px", cursor: exporting ? "default" : "pointer", minHeight: 32 }}>
            {exporting ? "Exporting…" : "⬇ Export matrix (Excel)"}
          </button>
        )}
      </div>
      <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.5, marginBottom: 10 }}>
        Co-tenancy / kickout clauses that let a tenant cut or stop rent when an anchor leaves — invisible in a rent roll. Tap an anchor to model its departure; tap more than one to model them going dark <b>together</b>.
      </div>

      {anchors.length > 0 && (
        <>
          {/* Multi-select scenario chips. The trailing number = tenants whose
              co-tenancy depends on that anchor. Long/generic anchor descriptors are
              shortened; the full text shows on tap/hover (title). */}
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 4 }}>
            {sortedAnchors.map((a) => {
              const on = active.includes(a);
              const n = depByAnchor.get(a) ?? 0;
              const short = a.length > 30 ? a.slice(0, 28).trimEnd() + "…" : a;
              return (
                <button key={a} onClick={() => toggle(a)} title={`${a}${n ? ` — ${n} dependent tenant${n === 1 ? "" : "s"}` : ""}`}
                  style={{ fontSize: 12, fontWeight: on ? 800 : 600, color: on ? "#fff" : C.ink, background: on ? C.red : "#fff", border: `1px solid ${on ? C.red : C.line}`, borderRadius: 999, padding: "5px 12px", cursor: "pointer", maxWidth: "100%" }}>
                  {on ? "✓ " : ""}{short}{n ? <span style={{ opacity: 0.7, fontWeight: 700 }}> · {n}</span> : null}
                </button>
              );
            })}
          </div>
          <div style={{ fontSize: 11, color: active.length ? C.faint : C.sub, margin: "2px 0 10px" }}>
            {active.length === 0
              ? "Tap an anchor to model its departure — the number is how many tenants' leases depend on it. Tap more than one to model them going dark together."
              : multi ? `${active.length} anchors selected — modeling them dark together.` : "Tap another anchor to model a combined departure."}
          </div>

          {/* SINGLE-ANCHOR tiered view */}
          {!multi && single && exp && (
            <>
              <div style={{ fontSize: 12.5, color: C.ink, fontWeight: 700, marginBottom: 8 }}>
                If <span style={{ color: C.red }}>{single}</span> goes dark / relocates — base rent at risk:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                <TierCard label="Tier 1" sub="trips on this anchor alone" amount={exp.tier1Rent} count={exp.tier1Count} tone="red" />
                <TierCard label="Tier 2" sub="needs a second event" amount={exp.tier2Rent} count={exp.tier2Count} tone="amber" />
                <TierCard label="Tier 3" sub="any linkage (total)" amount={exp.tier3Rent} count={exp.tier3Count} tone="gray" />
              </div>
              {tier1Delta && expOM && (
                <div style={{ fontSize: 11.5, color: C.green, marginTop: 4 }}>
                  Tier-1 was <b>{money(expOM.tier1Rent)}</b> from the OM alone → <b>{money(exp.tier1Rent)}</b> after executed leases.
                </div>
              )}
              {mitigations.length > 0 && (
                <div style={{ background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "9px 11px", marginTop: 10 }}>
                  <div style={{ fontSize: 10.5, fontWeight: 800, color: C.green, letterSpacing: "0.04em", marginBottom: 4 }}>✓ MITIGATED BY EXECUTED LEASES</div>
                  {mitigations.map((m, i) => (
                    <div key={i} style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.5 }}>
                      <b>{m.tenant}</b> — {m.toTier === 0
                        ? <>co-tenancy on {single} <b>removed</b> by the executed lease; no longer triggers if {single} leaves ({money(m.rent)} no longer at risk).</>
                        : <>reduced from Tier {m.fromTier} to <b>Tier {m.toTier}</b> — now needs more than just {single} to trip.</>}
                    </div>
                  ))}
                </div>
              )}
              {exp.clauses.length > 0 ? (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                  {exp.clauses.map((c, i) => {
                    const m = tierMeta(c.tier);
                    return (
                      <div key={i} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px" }}>
                        <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, marginBottom: 3 }}>
                          <span style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>{c.tenant}</span>
                          <span style={{ fontSize: 9.5, fontWeight: 800, color: m.fg, background: m.bg, border: `1px solid ${m.bd}`, borderRadius: 5, padding: "1px 6px" }}>{m.label} · {m.txt}</span>
                          {c.baseRentAnnual != null && <span style={{ fontSize: 11.5, color: C.sub }}>{money(c.baseRentAnnual)} base</span>}
                          <span style={{ fontSize: 9, fontWeight: 800, color: c.verified ? C.green : C.amber, background: c.verified ? C.greenBg : C.amberBg, border: `1px solid ${c.verified ? C.greenBd : C.amberBd}`, borderRadius: 5, padding: "1px 6px" }}>
                            {c.verified ? "✓ VERIFIED LEASE" : "OM — UNVERIFIED"}
                          </span>
                        </div>
                        <div style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.45 }}>Trigger: {c.triggerSummary || "—"}{remedyText(c.remedy, c.terminationNoticeDays)}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div style={{ marginTop: 10, fontSize: 12.5, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "9px 11px" }}>
                  No tenant co-tenancy currently trips if {single} leaves.
                </div>
              )}
            </>
          )}

          {/* COMBINED multi-anchor view */}
          {multi && combined && (
            <>
              <div style={{ fontSize: 12.5, color: C.ink, fontWeight: 700, marginBottom: 8 }}>
                If <span style={{ color: C.red }}>{active.join(" + ")}</span> all go dark together — base rent at risk:
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 4 }}>
                <TierCard label="Combined exposure" sub="trips when all selected go dark" amount={combined.totalRent} count={combined.clauses.length} tone="red" />
                <TierCard label="Cascade-only" sub="trips ONLY in combination" amount={combined.comboOnlyRent} count={combined.clauses.filter((c) => c.comboOnly).length} tone="amber" />
              </div>
              {combined.clauses.length > 0 ? (
                <div style={{ marginTop: 12, display: "flex", flexDirection: "column", gap: 7 }}>
                  {combined.clauses.map((c, i) => (
                    <div key={i} style={{ background: "#fff", border: `1px solid ${C.line}`, borderRadius: 8, padding: "8px 10px" }}>
                      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 7, marginBottom: 3 }}>
                        <span style={{ fontWeight: 700, fontSize: 13, color: C.ink }}>{c.tenant}</span>
                        {c.comboOnly && <span style={{ fontSize: 9.5, fontWeight: 800, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBd}`, borderRadius: 5, padding: "1px 6px" }}>CASCADE · needs the combination</span>}
                        {c.baseRentAnnual != null && <span style={{ fontSize: 11.5, color: C.sub }}>{money(c.baseRentAnnual)} base</span>}
                        <span style={{ fontSize: 9, fontWeight: 800, color: c.verified ? C.green : C.amber, background: c.verified ? C.greenBg : C.amberBg, border: `1px solid ${c.verified ? C.greenBd : C.amberBd}`, borderRadius: 5, padding: "1px 6px" }}>
                          {c.verified ? "✓ VERIFIED LEASE" : "OM — UNVERIFIED"}
                        </span>
                      </div>
                      <div style={{ fontSize: 11.5, color: C.sub, lineHeight: 1.45 }}>Trigger: {c.triggerSummary || "—"}{remedyText(c.remedy, c.terminationNoticeDays)}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 10, fontSize: 12.5, color: C.green, background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 8, padding: "9px 11px" }}>
                  No tenant co-tenancy trips even if {active.join(" + ")} all go dark.
                </div>
              )}
            </>
          )}
        </>
      )}

      {/* Auto diligence to-do. "Verified none" confirmations are listed but NOT counted
          as to-dos (they're cleared items: the executed lease was pulled and has no clause). */}
      {diligence.length > 0 && (() => {
        const todoCount = diligence.filter((d) => d.kind !== "cotenancy_none_verified").length;
        return (
        <div style={{ marginTop: 12 }}>
          <button onClick={() => setShowDil((s) => !s)}
            style={{ fontSize: 11.5, fontWeight: 700, color: C.sub, background: "none", border: "none", cursor: "pointer", padding: 0 }}>
            {showDil ? "▾" : "▸"} {todoCount > 0 ? `Diligence to-do (${todoCount})` : "Lease risk — co-tenancy verified"}
          </button>
          {showDil && (
            <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 4 }}>
              {diligence.map((d, i) => (
                <div key={i} style={{ fontSize: 12, color: C.ink, lineHeight: 1.45, paddingLeft: 4 }}>
                  <span style={{ color: d.kind === "verify_unverified" ? C.amber : d.kind === "cotenancy_none_verified" ? C.green : C.faint }}>{d.kind === "cotenancy_none_verified" ? "✓ " : "• "}</span>{d.message}
                </div>
              ))}
            </div>
          )}
        </div>
        );
      })()}
    </div>
  );
}
