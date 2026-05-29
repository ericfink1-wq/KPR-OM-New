import { useMemo } from "react";
import type { Deal } from "../lib/idb";
import { parentCompany, tenantKey, tenantLabel, cityState } from "../lib/utils";

interface Props {
  parentName: string;
  deals: Deal[];
  onBack: () => void;
  onTenantClick?: (name: string) => void;
  onOpenDeal: (d: Deal) => void;
}

function fmtRent(v: number): string {
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${(v / 1_000).toFixed(0)}K`;
  return `$${v.toFixed(0)}`;
}

function StatBox({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ background:"#faf7f0", border:"1px solid #efe8da", borderRadius:10, padding:"12px 16px", flex:"1 1 140px", minWidth:120 }}>
      <div style={{ fontSize:10, color:"#a89f8f", fontWeight:600, letterSpacing:"0.08em", textTransform:"uppercase", marginBottom:5 }}>{label}</div>
      <div style={{ fontSize:22, fontWeight:700, color:"#2a2c28", fontFamily:"'Fraunces',Georgia,serif" }}>{value}</div>
    </div>
  );
}

export default function ParentCompanyView({ parentName, deals, onBack, onTenantClick, onOpenDeal }: Props) {
  const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);

  const { brands, dealRows } = useMemo(() => {
    const brandMap = new Map<string, { displayName: string; locationCount: number; totalAnnualRent: number }>();
    const dealBrandMap = new Map<string, { deal: Deal; brands: Set<string> }>();

    for (const deal of deals) {
      for (const t of (deal.tenants || [])) {
        if (parentCompany(t.name, t.parentCompany) !== parentName) continue;
        const rawName = t.canonicalName || t.name || "";
        const key = tenantKey(rawName);
        if (!key) continue;
        const label = tenantLabel(rawName, t.canonicalName);
        const annualRent = num(t.annualRent) ?? 0;

        if (!brandMap.has(key)) brandMap.set(key, { displayName: label, locationCount: 0, totalAnnualRent: 0 });
        const br = brandMap.get(key)!;
        br.locationCount += 1;
        br.totalAnnualRent += annualRent;

        if (!dealBrandMap.has(deal.id)) dealBrandMap.set(deal.id, { deal, brands: new Set() });
        dealBrandMap.get(deal.id)!.brands.add(label);
      }
    }

    const brands = [...brandMap.values()].sort((a, b) => b.totalAnnualRent - a.totalAnnualRent);
    const dealRows = [...dealBrandMap.values()]
      .map(r => ({ deal: r.deal, brands: [...r.brands].sort() }))
      .sort((a, b) => (a.deal.propertyName || "").localeCompare(b.deal.propertyName || ""));

    return { brands, dealRows };
  }, [parentName, deals]);

  const totalLocations = brands.reduce((s, b) => s + b.locationCount, 0);
  const totalRent = brands.reduce((s, b) => s + b.totalAnnualRent, 0);

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
      <div style={{ marginBottom:16 }}>
        <button onClick={onBack} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>← BACK</button>
      </div>

      <div style={{ marginBottom:6 }}>
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:30, fontWeight:600, color:"#26281f", margin:0 }}>{parentName}</h1>
        <div style={{ fontSize:11, color:"#a89f8f", marginTop:4 }}>Parent company — brand portfolio exposure</div>
      </div>

      <div style={{ display:"flex", flexWrap:"wrap", gap:10, marginBottom:24, marginTop:16 }}>
        <StatBox label="Total Brands" value={brands.length.toString()} />
        <StatBox label="Total Locations" value={totalLocations.toLocaleString()} />
        <StatBox label="Total Annual Rent" value={totalRent > 0 ? fmtRent(totalRent) : "—"} />
      </div>

      <div style={{ marginBottom:24 }}>
        <div style={{ fontSize:11, letterSpacing:"0.08em", textTransform:"uppercase", color:"#a89f8f", fontWeight:600, marginBottom:10 }}>Brands in Portfolio</div>
        <div style={{ background:"#fff", border:"1px solid #efe8da", borderRadius:12, overflow:"hidden" }}>
          {brands.map((b, i) => (
            <div key={b.displayName} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"10px 16px", borderTop:i > 0 ? "1px solid #f1ece1" : "none" }}>
              <button
                onClick={() => onTenantClick?.(b.displayName)}
                style={{ background:"transparent", border:"none", padding:0, cursor:onTenantClick ? "pointer" : "default", fontFamily:"'Inter',sans-serif", fontSize:13, fontWeight:600, color:"#2d4ecf", textDecoration:"underline", textAlign:"left" }}
              >
                {b.displayName}
              </button>
              <div style={{ display:"flex", gap:16, alignItems:"center", flexShrink:0 }}>
                <span style={{ fontSize:11, color:"#a89f8f" }}>{b.locationCount} loc{b.locationCount !== 1 ? "s" : ""}</span>
                {b.totalAnnualRent > 0 && <span style={{ fontSize:12, fontWeight:600, color:"#0f7a4e" }}>{fmtRent(b.totalAnnualRent)}</span>}
              </div>
            </div>
          ))}
          {brands.length === 0 && (
            <div style={{ padding:"20px 16px", color:"#a89f8f", fontSize:13, textAlign:"center" }}>No brands found for this parent company.</div>
          )}
        </div>
      </div>

      <div>
        <div style={{ fontSize:11, letterSpacing:"0.08em", textTransform:"uppercase", color:"#a89f8f", fontWeight:600, marginBottom:10 }}>Properties</div>
        <div style={{ background:"#fff", border:"1px solid #efe8da", borderRadius:12, overflow:"hidden" }}>
          {dealRows.map((row, i) => (
            <div key={row.deal.id} style={{ padding:"10px 16px", borderTop:i > 0 ? "1px solid #f1ece1" : "none" }}>
              <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", marginBottom:2 }}>
                <button
                  onClick={() => onOpenDeal(row.deal)}
                  style={{ background:"transparent", border:"none", padding:0, cursor:"pointer", fontFamily:"'Fraunces',serif", fontSize:14, fontWeight:600, color:"#2d4ecf", textDecoration:"underline", textAlign:"left" }}
                >
                  {row.deal.propertyName || row.deal.fileName || "Untitled"}
                </button>
                <span style={{ fontSize:11, color:"#a89f8f", flexShrink:0, marginLeft:8 }}>{row.deal.market || cityState(row.deal) || ""}</span>
              </div>
              <div style={{ fontSize:11, color:"#6f6a5f" }}>{row.brands.join(" · ")}</div>
            </div>
          ))}
          {dealRows.length === 0 && (
            <div style={{ padding:"20px 16px", color:"#a89f8f", fontSize:13, textAlign:"center" }}>No properties found.</div>
          )}
        </div>
      </div>
    </div>
  );
}
