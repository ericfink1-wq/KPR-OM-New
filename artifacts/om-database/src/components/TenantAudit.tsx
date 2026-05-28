import { useMemo, useState } from "react";
import type { Deal } from "../lib/idb";
import { tenantKey, addUserMerge, removeUserMerge, getUserMerges, _normTenant } from "../lib/utils";

interface Props {
  deals: Deal[];
}

interface Group {
  key: string;
  rawNames: Map<string, string[]>; // raw name -> list of deal labels
  dealCount: number;
  locationCount: number;
}

const LS_KEY = "kpr_dismissed_tenant_splits";

function loadDismissed(): string[] {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveDismissed(ids: string[]) {
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(ids));
  } catch { /**/ }
}

export default function TenantAudit({ deals }: Props) {
  const [showAll, setShowAll] = useState(false);
  const [dismissed, setDismissed] = useState<string[]>(loadDismissed);
  const [showRestored, setShowRestored] = useState(false);
  const [showMergeRestored, setShowMergeRestored] = useState(false);
  // Incrementing this forces useMemo to recompute after user merges change
  const [aliasVersion, setAliasVersion] = useState(0);

  const { groups, splits, stats } = useMemo(() => {
    // aliasVersion in deps ensures recompute when user merges change
    void aliasVersion;

    const map = new Map<string, Group>();

    for (const d of deals) {
      const label = d.propertyName || d.fileName || d.id || "Unknown deal";
      for (const t of d.tenants || []) {
        if (!t.name || /^vacant$/i.test(String(t.name).trim())) continue;
        const key = tenantKey(t.canonicalName || t.name);
        if (!key) continue;
        if (!map.has(key)) {
          map.set(key, { key, rawNames: new Map(), dealCount: 0, locationCount: 0 });
        }
        const g = map.get(key)!;
        if (!g.rawNames.has(t.name)) g.rawNames.set(t.name, []);
        g.rawNames.get(t.name)!.push(label);
        g.locationCount++;
      }
    }
    for (const g of map.values()) {
      g.dealCount = new Set(Array.from(g.rawNames.values()).flat()).size;
    }

    const groups = Array.from(map.values()).sort((a, b) => b.locationCount - a.locationCount);

    const splits: { a: Group; b: Group; reason: string }[] = [];
    for (let i = 0; i < groups.length; i++) {
      for (let j = i + 1; j < groups.length; j++) {
        const ka = groups[i].key;
        const kb = groups[j].key;
        const prefix = ka.startsWith(kb + " ") || kb.startsWith(ka + " ");
        const firstA = ka.split(" ")[0];
        const firstB = kb.split(" ")[0];
        const sameFirst = firstA === firstB && firstA.length >= 4;
        if (prefix || sameFirst) {
          splits.push({
            a: groups[i],
            b: groups[j],
            reason: prefix ? "one name extends the other" : `share first word "${firstA}"`,
          });
        }
      }
    }

    const multiLoc = groups.filter((g) => g.locationCount > 1);
    const stats = {
      uniqueTenants: groups.length,
      multiLocation: multiLoc.length,
      totalPlacements: groups.reduce((s, g) => s + g.locationCount, 0),
      splitWarnings: splits.length,
    };

    return { groups, splits, stats };
  }, [deals, aliasVersion]);

  const getPairId = (s: { a: Group; b: Group }) =>
    [s.a.key, s.b.key].sort().join("||");

  const mergedIds = new Set(getUserMerges().map(m => m.id));

  const visibleSplits = splits.filter(s => {
    const id = getPairId(s);
    return !dismissed.includes(id) && !mergedIds.has(id);
  });
  const dismissedSplits = splits.filter(s => dismissed.includes(getPairId(s)));

  // Dismiss (incorrect)
  const dismiss = (s: { a: Group; b: Group }) => {
    const id = getPairId(s);
    const next = dismissed.includes(id) ? dismissed : [...dismissed, id];
    setDismissed(next);
    saveDismissed(next);
  };
  const restoreDismissed = (s: { a: Group; b: Group }) => {
    const id = getPairId(s);
    const next = dismissed.filter(d => d !== id);
    setDismissed(next);
    saveDismissed(next);
  };

  // Merge (correct)
  const merge = (s: { a: Group; b: Group }) => {
    const pairId = getPairId(s);
    // Collect all raw names from both groups
    const allVariants: string[] = [
      ...Array.from(s.a.rawNames.keys()),
      ...Array.from(s.b.rawNames.keys()),
    ];
    // Choose canonical = raw name with most locations; tiebreak shortest, then alpha
    const locationsByName = new Map<string, number>();
    for (const [raw, deals] of s.a.rawNames) locationsByName.set(raw, (locationsByName.get(raw) || 0) + deals.length);
    for (const [raw, deals] of s.b.rawNames) locationsByName.set(raw, (locationsByName.get(raw) || 0) + deals.length);
    const canonical = allVariants.slice().sort((a, b) => {
      const da = locationsByName.get(a) || 0;
      const db = locationsByName.get(b) || 0;
      if (db !== da) return db - da;
      if (a.length !== b.length) return a.length - b.length;
      return a.localeCompare(b);
    })[0];
    addUserMerge({ id: pairId, canonical, variants: allVariants });
    setAliasVersion(v => v + 1);
  };

  const restoreMerge = (id: string) => {
    removeUserMerge(id);
    setAliasVersion(v => v + 1);
  };

  const userMerges = getUserMerges();
  const multiLoc = groups.filter((g) => g.locationCount > 1);
  const displayedGroups = showAll ? groups : multiLoc;

  // Stat: only non-dismissed, non-merged pairs
  const activeSplitCount = visibleSplits.length;
  const hasSplitSection = visibleSplits.length > 0 || dismissedSplits.length > 0 || mergedIds.size > 0;

  const card: React.CSSProperties = {
    background: "#fff",
    border: "1px solid #efe8da",
    borderRadius: 12,
    padding: "16px 20px",
    marginBottom: 14,
    boxShadow: "0 1px 2px rgba(56,58,55,0.04)",
  };

  return (
    <div style={{ padding: "20px 24px", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontFamily: "'Fraunces',serif", fontSize: 26, fontWeight: 600, color: "#26281f", margin: "0 0 4px 0" }}>
        Tenant Name Audit
      </h1>
      <p style={{ fontSize: 12, color: "#9a917f", margin: "0 0 18px 0", lineHeight: 1.5 }}>
        How tenant names group across your portfolio. "Possible splits" are name variants that may be the same brand
        but aren't grouping together when clicked — review these.
      </p>

      {/* Stats */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 18 }}>
        {[
          ["Unique tenants", stats.uniqueTenants],
          ["In 2+ deals", stats.multiLocation],
          ["Total placements", stats.totalPlacements],
          ["Possible splits", activeSplitCount],
        ].map(([label, val]) => (
          <div key={label as string} style={{ flex: "1 1 130px", background: "#fff", border: "1px solid #efe8da", borderRadius: 12, padding: "13px 16px" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.06em", color: "#a69e91", marginBottom: 6, fontWeight: 500, textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 600, color: label === "Possible splits" && (val as number) > 0 ? "#b45309" : "#383a37", lineHeight: 1 }}>{val as number}</div>
          </div>
        ))}
      </div>

      {/* Possible splits — the actionable section */}
      {hasSplitSection && (
        <div style={{ ...card, borderLeft: "3px solid #d9890c" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "#b45309", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            Possible Splits — Review These
          </div>

          {visibleSplits.length === 0 && (
            <div style={{ fontSize: 12, color: "#a69e91", padding: "4px 0 8px" }}>
              All flagged pairs have been reviewed.
            </div>
          )}

          {visibleSplits.map((s, i) => (
            <div key={getPairId(s)} style={{ padding: "10px 0", borderBottom: i < visibleSplits.length - 1 ? "1px solid #f5efe2" : "none" }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 6, flexWrap: "wrap" }}>
                <div style={{ fontSize: 10, color: "#a69e91" }}>Likely same tenant — {s.reason}:</div>
                <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                  <button
                    onClick={() => merge(s)}
                    style={{
                      background: "transparent",
                      border: "1px solid #3f7a1f",
                      color: "#3f7a1f",
                      padding: "2px 9px",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 10.5,
                      fontFamily: "'Inter',sans-serif",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ✓ Correct — merge them
                  </button>
                  <button
                    onClick={() => dismiss(s)}
                    style={{
                      background: "transparent",
                      border: "1px solid #ddd4c2",
                      color: "#a69e91",
                      padding: "2px 9px",
                      borderRadius: 5,
                      cursor: "pointer",
                      fontSize: 10.5,
                      fontFamily: "'Inter',sans-serif",
                      whiteSpace: "nowrap",
                    }}
                  >
                    ✕ Incorrect — keep separate
                  </button>
                </div>
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                {[s.a, s.b].map((g) => (
                  <div key={g.key} style={{ flex: "1 1 240px", background: "#faf7f0", borderRadius: 8, padding: "8px 12px", border: "1px solid #f0e8d6" }}>
                    {Array.from(g.rawNames.entries()).map(([raw, dealLabels]) => (
                      <div key={raw} style={{ marginBottom: 2 }}>
                        <span style={{ fontSize: 12.5, color: "#383a37", fontWeight: 600 }}>{raw}</span>
                        <span style={{ fontSize: 11, color: "#9a917f" }}> — {dealLabels.join(", ")}</span>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </div>
          ))}

          {visibleSplits.length > 0 && (
            <div style={{ fontSize: 10.5, color: "#7d766a", marginTop: 10, lineHeight: 1.5 }}>
              To merge: click "✓ Correct — merge them" and the two names will group as one across the whole app. To separate a pair that shouldn't merge, click "✕ Incorrect — keep separate".
            </div>
          )}

          {/* Merged pairs */}
          {userMerges.length > 0 && (
            <div style={{ marginTop: 12, paddingTop: 10, borderTop: "1px solid #f5efe2" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10.5, color: "#3f7a1f", fontWeight: 600 }}>
                  {userMerges.length} merged
                </span>
                <button
                  onClick={() => setShowMergeRestored(v => !v)}
                  style={{ background: "transparent", border: "none", color: "#a69e91", padding: 0, cursor: "pointer", fontSize: 10.5, fontFamily: "'Inter',sans-serif", textDecoration: "underline" }}
                >
                  {showMergeRestored ? "hide" : "show / restore"}
                </button>
              </div>
              {showMergeRestored && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                  {userMerges.map(m => (
                    <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#9a917f" }}>
                      <span>{m.variants.join(" + ")} → <strong style={{ color: "#383a37" }}>{m.canonical}</strong></span>
                      <button
                        onClick={() => restoreMerge(m.id)}
                        style={{ background: "transparent", border: "none", color: "#b45309", padding: 0, cursor: "pointer", fontSize: 10.5, fontFamily: "'Inter',sans-serif", textDecoration: "underline", flexShrink: 0 }}
                      >
                        Restore
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Dismissed pairs */}
          {dismissedSplits.length > 0 && (
            <div style={{ marginTop: userMerges.length > 0 ? 6 : 12, paddingTop: 10, borderTop: "1px solid #f5efe2" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ fontSize: 10.5, color: "#b3aa9b" }}>
                  {dismissedSplits.length} dismissed
                </span>
                <button
                  onClick={() => setShowRestored(v => !v)}
                  style={{ background: "transparent", border: "none", color: "#a69e91", padding: 0, cursor: "pointer", fontSize: 10.5, fontFamily: "'Inter',sans-serif", textDecoration: "underline" }}
                >
                  {showRestored ? "hide" : "show / restore"}
                </button>
              </div>
              {showRestored && (
                <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 5 }}>
                  {dismissedSplits.map((s) => {
                    const aName = Array.from(s.a.rawNames.keys())[0] ?? s.a.key;
                    const bName = Array.from(s.b.rawNames.keys())[0] ?? s.b.key;
                    return (
                      <div key={getPairId(s)} style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 11, color: "#9a917f" }}>
                        <span>{aName} &amp; {bName}</span>
                        <button
                          onClick={() => restoreDismissed(s)}
                          style={{ background: "transparent", border: "none", color: "#b45309", padding: 0, cursor: "pointer", fontSize: 10.5, fontFamily: "'Inter',sans-serif", textDecoration: "underline" }}
                        >
                          Restore
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Tenant groups */}
      <div style={card}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "#a69e91", fontWeight: 700, textTransform: "uppercase" }}>
            {showAll ? "All Tenants" : "Multi-Location Tenants"}
          </div>
          <button
            onClick={() => setShowAll((x) => !x)}
            style={{ background: "transparent", border: "1px solid #ddd4c2", color: "#52554e", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 10.5, fontFamily: "'Inter',sans-serif", fontWeight: 600 }}
          >
            {showAll ? "Show multi-location only" : `Show all ${stats.uniqueTenants}`}
          </button>
        </div>

        {displayedGroups.map((g) => {
          const variants = Array.from(g.rawNames.keys());
          const hasVariants = variants.length > 1;
          return (
            <div key={g.key} style={{ padding: "9px 0", borderBottom: "1px solid #f5efe2", display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: "#383a37", fontWeight: 600 }}>
                  {variants[0]}
                  {hasVariants && (
                    <span style={{ fontSize: 10, color: "#b45309", marginLeft: 8, fontWeight: 500 }}>
                      +{variants.length - 1} name variant{variants.length > 2 ? "s" : ""}
                    </span>
                  )}
                </div>
                {hasVariants && (
                  <div style={{ fontSize: 10.5, color: "#9a917f", marginTop: 2 }}>
                    Variants: {variants.join(" · ")}
                  </div>
                )}
              </div>
              <div style={{ fontSize: 12, color: "#6f6a5f", whiteSpace: "nowrap" }}>
                {g.locationCount} location{g.locationCount !== 1 ? "s" : ""}
              </div>
            </div>
          );
        })}

        {displayedGroups.length === 0 && (
          <div style={{ fontSize: 12, color: "#a69e91", padding: "8px 0" }}>No tenants found.</div>
        )}
      </div>
    </div>
  );
}
