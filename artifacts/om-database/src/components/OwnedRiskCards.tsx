import { fmtMoney } from "../lib/money";
import { useEffect, useMemo, useState } from "react";
import type { Deal, LeaseAbstract } from "../lib/idb";
import { getOwnedProperties } from "../lib/ownedPortfolio";
import { useWatchlist, lookupWatch } from "../lib/useWatchlist";
import { tenantLabel } from "../lib/utils";
import { liveTenants } from "../lib/assetMgmt";
import { brandFamilyKey, brandDisplayName } from "../lib/tenantCredit";
import { resolveTenantRisk, computeExposure, anchorsReferenced, anchorLabel } from "../lib/leaseRisk";
import { apiListAllLeaseAbstracts } from "../lib/api";

// Two numbers for the OWNED portfolio (Eric, 10/16/26):
//   • "$X of KPR rent is with tenants on the retailer watchlist" (credit risk), and
//   • per owned center, the rent at risk if its most important anchor goes dark
//     (co-tenancy cascade, tier 1 = trips on that anchor alone).
// Both computed live from the roster + the watchlist + lease abstracts; nothing stored.

const money = (n: number) => fmtMoney(n);
const STATUS_TONE: Record<string, string> = { liquidating: "#b3261e", bankruptcy: "#b3261e", distressed: "#c2410c", watch: "#a16207" };

export default function OwnedRiskCards({ deals, onOpenDeal, onNav }: { deals: Deal[]; onOpenDeal: (id: string) => void; onNav?: (dest: string) => void }) {
  const watch = useWatchlist();
  const owned = useMemo(() => getOwnedProperties(deals), [deals]);
  const [abstracts, setAbstracts] = useState<LeaseAbstract[] | null>(null);
  useEffect(() => { apiListAllLeaseAbstracts().then(setAbstracts).catch(() => setAbstracts([])); }, []);

  // Same tenants and brand grouping as Asset Mgmt → Credit Watch (Datex where a snapshot is
  // loaded, else the OM roster; one row per brand family, store numbers stripped) so the two
  // never show different rent for the same brand (AMC $283K vs $437K, 10/19/26).
  const watchRollup = useMemo(() => {
    let total = 0, onWatch = 0;
    const byBrand = new Map<string, { brand: string; status: string; rent: number; centers: Set<string> }>();
    for (const d of owned) {
      for (const t of liveTenants(d).tenants) {
        const rent = Number(t.annualRent) || 0;
        total += rent;
        const nm = t.nationalTenant || t.name;
        const w = lookupWatch(watch, nm) ?? lookupWatch(watch, t.name);
        if (!w) continue;
        onWatch += rent;
        const key = brandFamilyKey(nm);
        const row = byBrand.get(key) ?? { brand: brandDisplayName(tenantLabel(nm)), status: w.status, rent: 0, centers: new Set<string>() };
        row.rent += rent; row.centers.add(d.id);
        byBrand.set(key, row);
      }
    }
    return { total, onWatch, brands: [...byBrand.values()].sort((a, b) => b.rent - a.rent) };
  }, [owned, watch]);

  const cascade = useMemo(() => {
    if (!abstracts) return null;
    const byDeal = new Map<string, LeaseAbstract[]>();
    for (const a of abstracts) { const id = (a as { dealId?: string }).dealId; if (id) { const l = byDeal.get(id); if (l) l.push(a); else byDeal.set(id, [a]); } }
    const rows: Array<{ d: Deal; anchor: string; rent: number; tenants: number }> = [];
    for (const d of owned) {
      const resolved = resolveTenantRisk(d, byDeal.get(d.id) || []);
      let best: { anchor: string; rent: number; tenants: number } | null = null;
      for (const anchor of anchorsReferenced(resolved)) {
        const e = computeExposure(resolved, anchor);
        if (e.tier1Rent > 0 && (!best || e.tier1Rent > best.rent)) best = { anchor: anchorLabel(d, anchor), rent: e.tier1Rent, tenants: e.tier1Count };
      }
      if (best) rows.push({ d, ...best });
    }
    return rows.sort((a, b) => b.rent - a.rent);
  }, [owned, abstracts]);

  if (!owned.length) return null;
  const card: React.CSSProperties = { background: "#fff", border: "1px solid #ebeae5", borderRadius: 12, padding: "14px 16px", minWidth: 0 };
  const label: React.CSSProperties = { fontSize: 9.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "#9b9992", fontWeight: 700 };
  const link = (text: string, dest: string) => onNav ? (
    <button onClick={() => onNav(dest)} style={{ background: "none", border: "none", padding: 0, color: "#3e8a2f", fontWeight: 600, fontSize: 11.5, cursor: "pointer", marginTop: 8 }}>{text} ›</button>
  ) : null;
  const pctOnWatch = watchRollup.total > 0 ? Math.round((watchRollup.onWatch / watchRollup.total) * 1000) / 10 : 0;

  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 12, marginBottom: 16 }}>
      <div style={card}>
        <div style={label}>Owned rent with watchlist tenants</div>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
          <span style={{ fontFamily: "'Lora',Georgia,serif", fontSize: 24, fontWeight: 600, color: watchRollup.onWatch > 0 ? "#b3261e" : "#0f7a43" }}>{money(watchRollup.onWatch)}</span>
          <span style={{ fontSize: 12, color: "#6b6a65" }}>/yr · {pctOnWatch}% of owned base rent</span>
        </div>
        {watchRollup.brands.length === 0 ? (
          <div style={{ fontSize: 12, color: "#6b6a65", marginTop: 6 }}>No owned tenants are on the retailer watchlist.</div>
        ) : (
          <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
            {watchRollup.brands.slice(0, 5).map(b => (
              <div key={b.brand} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5 }}>
                <span style={{ flex: 1, minWidth: 0, color: "#383a37", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{b.brand}</span>
                <span style={{ fontSize: 10, fontWeight: 700, color: STATUS_TONE[b.status] ?? "#a16207", textTransform: "uppercase" }}>{b.status}</span>
                <span style={{ color: "#6b6a65", whiteSpace: "nowrap" }}>{money(b.rent)} · {b.centers.size} ctr</span>
              </div>
            ))}
          </div>
        )}
        {link("Retailer Watchlist", "watchlist")}
      </div>

      <div style={card}>
        <div style={label}>Rent at risk if the key anchor goes dark</div>
        {cascade == null ? (
          <div style={{ fontSize: 12, color: "#9b9992", marginTop: 8 }}>Loading lease abstracts…</div>
        ) : cascade.length === 0 ? (
          <div style={{ fontSize: 12, color: "#6b6a65", marginTop: 8, lineHeight: 1.5 }}>No owned center has a co-tenancy clause that trips on a single anchor (from the abstracts and lease-risk data on file).</div>
        ) : (
          <>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8, marginTop: 4 }}>
              <span style={{ fontFamily: "'Lora',Georgia,serif", fontSize: 24, fontWeight: 600, color: "#c2410c" }}>{money(cascade.reduce((s, r) => s + r.rent, 0))}</span>
              <span style={{ fontSize: 12, color: "#6b6a65" }}>/yr across {cascade.length} center{cascade.length === 1 ? "" : "s"} (worst anchor each)</span>
            </div>
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {cascade.slice(0, 6).map(r => (
                <button key={r.d.id} onClick={() => onOpenDeal(r.d.id)} style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, background: "none", border: "none", padding: "2px 0", cursor: "pointer", textAlign: "left", fontFamily: "inherit" }}>
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "#383a37" }}>
                    <b>{r.d.propertyName || r.d.fileName}</b> <span style={{ color: "#6b6a65" }}>if {r.anchor} goes dark</span>
                  </span>
                  <span style={{ color: "#c2410c", fontWeight: 700, whiteSpace: "nowrap" }}>{money(r.rent)}</span>
                  <span style={{ color: "#9b9992", whiteSpace: "nowrap", fontSize: 11 }}>{r.tenants} tenant{r.tenants === 1 ? "" : "s"}</span>
                </button>
              ))}
            </div>
          </>
        )}
        {link("Co-Tenancy Cascade", "cotenancy-cascade")}
      </div>
    </div>
  );
}
