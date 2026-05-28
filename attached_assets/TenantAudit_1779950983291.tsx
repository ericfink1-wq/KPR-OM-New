import { useMemo, useState } from "react";
import type { Deal } from "../lib/idb";
import { tenantKey } from "../lib/utils";

interface Props {
  deals: Deal[];
}

interface Group {
  key: string;
  rawNames: Map<string, string[]>; // raw name -> list of deal labels
  dealCount: number;
  locationCount: number;
}

export default function TenantAudit({ deals }: Props) {
  const [showAll, setShowAll] = useState(false);

  const { groups, splits, stats } = useMemo(() => {
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

    // Detect potential splits: pairs of DIFFERENT keys that look like the same brand.
    // Heuristic: one key is a prefix of the other ("gap" vs "gap factory"),
    // or they share a significant (4+ char) first word.
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
  }, [deals]);

  const multiLoc = groups.filter((g) => g.locationCount > 1);
  const displayedGroups = showAll ? groups : multiLoc;

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
          ["Possible splits", stats.splitWarnings],
        ].map(([label, val]) => (
          <div key={label as string} style={{ flex: "1 1 130px", background: "#fff", border: "1px solid #efe8da", borderRadius: 12, padding: "13px 16px" }}>
            <div style={{ fontSize: 10, letterSpacing: "0.06em", color: "#a69e91", marginBottom: 6, fontWeight: 500, textTransform: "uppercase" }}>{label}</div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 600, color: label === "Possible splits" && (val as number) > 0 ? "#b45309" : "#383a37", lineHeight: 1 }}>{val as number}</div>
          </div>
        ))}
      </div>

      {/* Possible splits — the actionable section */}
      {splits.length > 0 && (
        <div style={{ ...card, borderLeft: "3px solid #d9890c" }}>
          <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "#b45309", fontWeight: 700, textTransform: "uppercase", marginBottom: 10 }}>
            Possible Splits — Review These
          </div>
          {splits.map((s, i) => (
            <div key={i} style={{ padding: "10px 0", borderBottom: i < splits.length - 1 ? "1px solid #f5efe2" : "none" }}>
              <div style={{ fontSize: 10, color: "#a69e91", marginBottom: 5 }}>Likely same tenant — {s.reason}:</div>
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
          <div style={{ fontSize: 10.5, color: "#7d766a", marginTop: 10, lineHeight: 1.5 }}>
            To merge these: tell Claude the exact two names and they'll add a normalization rule, or rename the tenant in the source deal so both read identically.
          </div>
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
