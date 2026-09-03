import { useState, useMemo } from "react";
import type { Deal } from "../lib/idb";
import { DETAIL_MAX_WIDTH } from "../lib/constants";
import { parentCompany, tenantKey, tenantLabel, cityState, fmtLeaseDate, fmtTenantSales, fmtUSD, isNAPTenant, buildSalesByDeal, resolveSalesPSF } from "../lib/utils";
import { isInvestmentGrade } from "../lib/tenantCredit";
import { useWatchlist, lookupWatch, WATCH_STATUS_META } from "../lib/useWatchlist";
import StatusTag from "./StatusTag";
import { ExportButtons } from "./PdfDownloadButton";
import { rollupColumns, rollupTotalRow } from "./TenantView";
import { exportAggregateToExcel } from "../lib/exportExcel";
import { toAggColumns, safeFileName } from "../lib/tableExport";
import { curatedParentDescription } from "../lib/tenantDescriptions";
import EntityDescription from "./EntityDescription";
import PortfolioStressTest from "./PortfolioStressTest";
import { stickyFirstCol } from "../lib/stickyCol";

interface Props {
  parentName: string;
  deals: Deal[];
  onBack: () => void;
  onTenantClick?: (name: string) => void;
  onOpenDeal: (d: Deal) => void;
}

type SortKey = "property" | "brand" | "market" | "sf" | "rentPSF" | "annualRent" | "start" | "expiry" | "salesPSF";

export default function ParentCompanyView({ parentName, deals, onBack, onTenantClick, onOpenDeal }: Props) {
  const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const norm = (s: unknown) => String(s || "").trim().toLowerCase();

  const watchMap = useWatchlist();
  const [scope, setScope] = useState<"all" | "owned">("all");
  const [sortKey, setSortKey] = useState<SortKey>("annualRent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");

  const setSort = (k: SortKey) => {
    if (sortKey === k) setSortDir(x => x === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(["property","brand","market","start","expiry"].includes(k) ? "asc" : "desc"); }
  };
  const arrow = (k: SortKey) => sortKey !== k ? "" : sortDir === "desc" ? " ▼" : " ▲";

  const allRows: { deal: Deal; t: NonNullable<Deal["tenants"]>[number]; brandLabel: string }[] = useMemo(() => {
    const rows: { deal: Deal; t: NonNullable<Deal["tenants"]>[number]; brandLabel: string }[] = [];
    for (const d of deals) {
      for (const t of (d.tenants || [])) {
        if (parentCompany(t.name, t.parentCompany) !== parentName) continue;
        const brandLabel = tenantLabel(t.canonicalName || t.name || "", t.canonicalName);
        rows.push({ deal: d, t, brandLabel });
      }
    }
    return rows;
  }, [parentName, deals]);

  // Resolve sales the same way the deal page does — uploaded sales (tenantSalesHistory)
  // win over the raw roster salesPSF, which uploads never write back.
  const salesByDeal = useMemo(() => buildSalesByDeal(deals || []), [deals]);
  const effSales = (r: { deal: Deal; t: NonNullable<Deal["tenants"]>[number] }) => resolveSalesPSF(salesByDeal, r.deal, r.t);

  const rows = scope === "owned"
    ? allRows.filter(r => r.deal.status === "Owned" || r.deal.status === "Sold")
    : allRows;

  // Header badge aggregates (across the in-scope rows)
  const anchorCount = rows.filter(r => r.t.isAnchor).length;
  const headerCredit = rows.map(r => r.t.creditRating).find(Boolean) || null;
  const distinctBrands = new Set(rows.map(r => tenantKey(r.t.canonicalName || r.t.name || "")));
  const igBrands = new Set(rows.filter(r => (r.t.name || "") && isInvestmentGrade(r.t.name || "", r.t.creditRating))
    .map(r => tenantKey(r.t.canonicalName || r.t.name || "")));
  const allBrandsIG = distinctBrands.size > 0 && igBrands.size === distinctBrands.size;
  // Worst watchlist status among this parent's brands (for the header chip)
  const WATCH_RANK: Record<string, number> = { liquidating: 4, bankruptcy: 3, distressed: 2, watch: 1 };
  const headerWatch = rows
    .map(r => lookupWatch(watchMap, r.t.name))
    .filter((w): w is NonNullable<typeof w> => !!w)
    .sort((a, b) => (WATCH_RANK[b.status] || 0) - (WATCH_RANK[a.status] || 0))[0] || null;

  const sorted = useMemo(() => {
    return [...rows].sort((a, b) => {
      let av: string | number | null, bv: string | number | null;
      switch (sortKey) {
        case "property":   av = norm(a.deal.propertyName); bv = norm(b.deal.propertyName); break;
        case "brand":      av = norm(a.brandLabel); bv = norm(b.brandLabel); break;
        case "market":     av = norm(a.deal.market || cityState(a.deal)); bv = norm(b.deal.market || cityState(b.deal)); break;
        case "sf":         av = num(a.t.sf); bv = num(b.t.sf); break;
        case "rentPSF":    av = num(a.t.rentPerSF); bv = num(b.t.rentPerSF); break;
        case "annualRent": av = num(a.t.annualRent); bv = num(b.t.annualRent); break;
        case "start":      av = a.t.leaseStart || ""; bv = b.t.leaseStart || ""; break;
        case "expiry":     av = a.t.leaseExpiry || ""; bv = b.t.leaseExpiry || ""; break;
        case "salesPSF":   av = effSales(a); bv = effSales(b); break;
        default: av = null; bv = null;
      }
      let cmp = 0;
      if (av == null && bv == null) cmp = 0;
      else if (av == null) return 1;
      else if (bv == null) return -1;
      else cmp = (typeof av === "string" ? av.localeCompare(bv as string) : (av as number) - (bv as number)) * (sortDir === "asc" ? 1 : -1);
      // Tiebreak by property name (always ascending).
      if (cmp === 0 && sortKey !== "property") cmp = norm(a.deal.propertyName).localeCompare(norm(b.deal.propertyName));
      return cmp;
    });
  }, [rows, sortKey, sortDir]);

  // Averages — same methodology as the Tenant page so the two read consistently:
  //  • SF metrics (Avg Size; the SF denominator of Rent/SF) count only rows with
  //    real leasable SF (> 0).
  //  • Avg Annual Rent counts only rows with real base rent (> 0) — KEEPS a true
  //    ground lease (rent, no SF) and DROPS unowned $0 NAP / shadow markers.
  //  • Rent/SF is SF-weighted over rows that have BOTH SF and rent (paired), so a
  //    ground lease's rent can't inflate $/SF.
  //  • A row with neither SF nor rent is an unowned marker, excluded everywhere.
  //    (isNAPTenant only catches occupied $0-rent space; 0-SF markers are caught
  //    here by the no-SF-and-no-rent test.)
  const sfOf   = (r: typeof rows[number]) => { const v = num(r.t.sf); return v != null && v > 0 ? v : null; };
  const rentOf = (r: typeof rows[number]) => { const v = num(r.t.annualRent); return v != null && v > 0 ? v : null; };
  const isMarker = (r: typeof rows[number]) =>
    isNAPTenant(r.t)
    || /\b(shadow|vacant|outparcel)\b/i.test((r.t.name || "").toLowerCase())
    || (sfOf(r) == null && rentOf(r) == null);
  const isGroundLease = (r: typeof rows[number]) => !isMarker(r) && sfOf(r) == null && rentOf(r) != null;

  const metricRows = rows.filter(r => !isMarker(r));
  const sfVals     = metricRows.map(sfOf).filter((v): v is number => v != null);
  const rentVals   = metricRows.map(rentOf).filter((v): v is number => v != null);
  const psfRows    = metricRows.filter(r => sfOf(r) != null && rentOf(r) != null);
  const salesVals  = metricRows.map(r => effSales(r)).filter((v): v is number => v != null);
  const psfSF      = psfRows.reduce((s, r) => s + sfOf(r)!, 0);
  const psfRent    = psfRows.reduce((s, r) => s + rentOf(r)!, 0);
  const avgSF       = sfVals.length ? Math.round(sfVals.reduce((a, b) => a + b, 0) / sfVals.length) : null;
  const avgRentPSF  = psfSF ? psfRent / psfSF : null;  // SF-weighted, SF + rent paired
  const avgAnnRent  = rentVals.length ? rentVals.reduce((a, b) => a + b, 0) / rentVals.length : null;
  const avgSales    = salesVals.length ? Math.round(salesVals.reduce((a, b) => a + b, 0) / salesVals.length) : null;
  const uniqueBrands = new Set(allRows.map(r => r.brandLabel)).size;

  const napCount    = rows.filter(isMarker).length;
  const groundCount = rows.filter(isGroundLease).length;
  const extra = `${napCount > 0 ? ` · ${napCount} NAP` : ""}${groundCount > 0 ? ` · ${groundCount} ground lease` : ""}`;
  const subtitle = scope === "owned"
    ? `Across ${rows.length} owned ${rows.length === 1 ? "property" : "properties"}${extra}`
    : `${uniqueBrands} brand${uniqueBrands !== 1 ? "s" : ""} · ${allRows.length} location${allRows.length !== 1 ? "s" : ""}${extra}`;

  // Export payload — from `sorted`, i.e. exactly the rows on screen (scope + sort).
  const exportRows: Record<string, unknown>[] = sorted.map(r => ({
    property: r.deal.propertyName || r.deal.fileName || "—",
    status: r.deal.status || null,
    brand: r.brandLabel || null,
    market: r.deal.market || cityState(r.deal) || null,
    sf: num(r.t.sf),
    rentPSF: num(r.t.rentPerSF),
    annualRent: num(r.t.annualRent),
    start: fmtLeaseDate(r.t.leaseStart) || null,
    expiry: fmtLeaseDate(r.t.leaseExpiry) || null,
    sales: fmtTenantSales(effSales(r), r.t.sf) || null,
  }));
  const exportKpis = [
    { label: "Brands", value: String(uniqueBrands) },
    { label: "Locations", value: String(rows.length) },
    { label: "Avg Size (SF)", value: avgSF != null ? Math.round(avgSF).toLocaleString() : "—" },
    { label: "Avg Rent / SF", value: avgRentPSF != null ? `$${avgRentPSF.toFixed(2)}` : "—" },
    { label: "Avg Annual Rent", value: avgAnnRent != null ? `$${Math.round(avgAnnRent).toLocaleString()}` : "—" },
    { label: "Avg Sales / SF", value: avgSales != null ? `$${Math.round(avgSales).toLocaleString()}` : "—" },
  ];
  const exportBase = `KPR_${safeFileName(parentName)}${scope === "owned" ? "_Owned" : ""}`;

  const Stat = ({ label, value, sub }: { label: string; value: string; sub?: string }) => (
    <div style={{ flex:"1 1 130px", background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"13px 16px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
      <div style={{ fontSize:10, letterSpacing:"0.06em", color:"#a69e91", marginBottom:6, fontWeight:500, textTransform:"uppercase" }}>{label}</div>
      <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:600, color:"#383a37", lineHeight:1 }}>{value}</div>
      {sub && <div style={{ fontSize:9, color:"#b8b0a3", marginTop:3 }}>{sub}</div>}
    </div>
  );

  const cols: [SortKey, string, boolean][] = [
    ["property",   "Property",  false],
    ["brand",      "Brand",     false],
    ["market",     "Market",    false],
    ["sf",         "SF",        true],
    ["rentPSF",    "Rent/SF",   true],
    ["annualRent", "Ann. Rent", true],
    ["start",      "Start",     false],
    ["expiry",     "Expiry",    false],
    ["salesPSF",   "Sales/SF",  true],
  ];

  return (
    <div style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
      {/* Centered max-width column — same DETAIL_MAX_WIDTH as the deal page so a
          property's subpages all read at one consistent width on a big monitor. */}
      <div style={{ maxWidth: DETAIL_MAX_WIDTH, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {/* Back button */}
      <div style={{ marginBottom:16 }}>
        <button onClick={onBack} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>← BACK</button>
      </div>

      {/* Title row */}
      <div style={{ display:"flex", alignItems:"center", gap:10, marginBottom:4, flexWrap:"wrap" }}>
        <h1 style={{ fontFamily:"'Fraunces',serif", fontSize:30, fontWeight:600, color:"#26281f", margin:0 }}>{parentName}</h1>
        <span style={{ fontSize:10, color:"#6f6a5f", background:"#f3eee3", border:"1px solid #e7e0d2", padding:"2px 9px", borderRadius:12 }}>Parent Company</span>
        {anchorCount > 0 && <span style={{ fontSize:10, color:"#1f2b16", background:"#6dba4322", padding:"2px 9px", borderRadius:12, fontWeight:700 }}>ANCHOR · {anchorCount}</span>}
        {igBrands.size > 0 && (
          <span title={allBrandsIG ? "All brands under this company are investment grade" : `${igBrands.size} of ${distinctBrands.size} brands are investment grade`}
            style={{ fontSize:10, color:"#3f7a1f", background:"#eef3e6", border:"1px solid #b8d49a", padding:"2px 9px", borderRadius:12, fontWeight:700 }}>
            Investment Grade{allBrandsIG ? "" : ` · ${igBrands.size}/${distinctBrands.size}`}
          </span>
        )}
        {headerCredit && <span style={{ fontSize:11, color:"#5c5f57", background:"#f3eee3", border:"1px solid #e7e0d2", padding:"2px 9px", borderRadius:12 }}>Credit: {headerCredit}</span>}
        {headerWatch && (() => { const m = WATCH_STATUS_META[headerWatch.status] || WATCH_STATUS_META.watch; return (
          <span title={`Retailer watchlist — ${m.label}: ${headerWatch.note || headerWatch.brand}`}
            style={{ fontSize:10, color:m.color, background:m.bg, border:`1px solid ${m.border}`, padding:"2px 9px", borderRadius:12, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.03em" }}>
            ⚠ {m.label}
          </span>
        ); })()}
      </div>

      <EntityDescription name={parentName} kind="parent" />

      {/* "This company just filed" — every banner fails together: direct rent +
          co-tenancy knock-on across the whole library */}
      <PortfolioStressTest
        tenantName={parentName}
        brands={[...new Set(allRows.map(r => r.t.canonicalName || r.t.name || "").filter(Boolean))]}
        deals={deals}
        onOpenDeal={onOpenDeal}
      />

      {/* Subtitle + scope toggle on same row */}
      <div style={{ display:"flex", alignItems:"center", gap:12, marginBottom:18, justifyContent:"space-between" }}>
        <div style={{ fontSize:13, color:"#9a917f" }}>{subtitle}</div>
        <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", justifyContent:"flex-end" }}>
        <ExportButtons
          disabled={exportRows.length === 0}
          onExcel={() => exportAggregateToExcel(
            exportRows, toAggColumns(rollupColumns("Brand")),
            parentName.slice(0, 28) || "Locations",
            `${exportBase}_Locations.xlsx`,
          )}
          fileName={`${exportBase}_Summary.pdf`}
          makeDoc={async () => {
            const { default: TablePDF } = await import("./TablePDF");
            const cols = rollupColumns("Brand");
            return <TablePDF
              title={parentName}
              kicker="PARENT COMPANY"
              subtitle={subtitle}
              chips={[anchorCount > 0 ? `ANCHOR · ${anchorCount}` : "", headerCredit ? `Credit: ${headerCredit}` : ""].filter(Boolean)}
              description={curatedParentDescription(parentName)}
              kpis={exportKpis}
              columns={cols}
              rows={exportRows}
              totalRow={rollupTotalRow(cols, exportRows)}
              notes={`Rent/SF on the total line is BLENDED (total annual rent \u00f7 total SF), so it differs from the simple average above. Annual rent is BASE rent only \u2014 recoveries, percentage rent and other income are excluded.${scope === "owned" ? " Scope: OWNED properties only." : ""}`}
            />;
          }}
        />
        <div style={{ display:"flex", border:"1px solid #e7e0d2", borderRadius:7, overflow:"hidden", fontFamily:"'Inter',sans-serif", fontSize:12, flexShrink:0 }}>
          {(["all","owned"] as const).map(s => (
            <button key={s} onClick={() => setScope(s)}
              style={{ padding:"4px 13px", background: scope===s ? "#383a37" : "#faf7f0", color: scope===s ? "#f6f2ea" : "#7d766a", border:"none", cursor:"pointer", fontWeight: scope===s ? 600 : 400, fontFamily:"inherit", fontSize:"inherit", transition:"background 0.12s, color 0.12s" }}>
              {s === "all" ? "All" : "Owned"}
            </button>
          ))}
        </div>
        </div>
      </div>

      {scope === "owned" && rows.length === 0 ? (
        <div style={{ fontSize:14, color:"#a69e91", padding:"24px 0" }}>No owned locations for this parent company.</div>
      ) : (
        <>
          {/* Stat cards — same layout as TenantView */}
          <div style={{ display:"flex", gap:11, flexWrap:"wrap", marginBottom:22 }}>
            <Stat label="Brands"         value={String(uniqueBrands)} />
            <Stat label="Locations"      value={String(rows.length)} />
            <Stat label="Avg Size (SF)"  value={avgSF != null ? avgSF.toLocaleString() : "—"}
              sub={avgSF != null && sfVals.length < rows.length ? `over ${sfVals.length} of ${rows.length}` : undefined} />
            <Stat label="Avg Rent / SF"  value={avgRentPSF != null ? `$${avgRentPSF.toFixed(2)}` : "—"}
              sub={avgRentPSF != null && psfRows.length < rows.length ? `over ${psfRows.length} of ${rows.length}` : undefined} />
            <Stat label="Avg Annual Rent" value={avgAnnRent != null ? `$${Math.round(avgAnnRent).toLocaleString()}` : "—"}
              sub={avgAnnRent != null && rentVals.length < rows.length ? `over ${rentVals.length} of ${rows.length}` : undefined} />
            {avgSales != null && <Stat label="Avg Sales / SF" value={`$${avgSales.toLocaleString()}`} />}
          </div>

          {/* Locations table */}
          <div style={{ background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:13 }}>Locations — click a row to open the property</div>
            <div style={{ overflowX:"auto" }}>
              <table style={{ borderCollapse:"collapse", fontSize:12.5, minWidth:900, width:"100%" }}>
                <thead>
                  <tr style={{ fontSize:10, letterSpacing:"0.03em" }}>
                    {cols.map(([k, label, right], idx) => (
                      <th key={k} onClick={() => setSort(k)} className={idx === 0 ? "freeze-col" : undefined}
                        style={{ padding:"6px 10px", textAlign:right?"right":"left", cursor:"pointer", whiteSpace:"nowrap", userSelect:"none", color:sortKey===k?"#383a37":"#a69e91", fontWeight:600, ...(idx === 0 ? stickyFirstCol("#fff", true) : null) }}>
                        {label}{arrow(k)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((r, i) => {
                    const owned = r.deal.status === "Owned" || r.deal.status === "Sold";
                    return (
                      <tr key={i} onClick={() => onOpenDeal(r.deal)}
                        style={{ borderTop:"1px solid #f1eadc", cursor:"pointer", background: owned ? "#f3faef" : "transparent", borderLeft: owned ? "3px solid #6dba43" : "3px solid transparent" }}
                        onMouseEnter={e => { const bg = owned ? "#eaf5e2" : "#faf7f0"; e.currentTarget.style.background = bg; (e.currentTarget.firstElementChild as HTMLElement).style.background = bg; }}
                        onMouseLeave={e => { e.currentTarget.style.background = owned ? "#f3faef" : "transparent"; (e.currentTarget.firstElementChild as HTMLElement).style.background = owned ? "#f3faef" : "#fff"; }}>
                        <td className="freeze-col" style={{ padding:"9px 10px", color:"#383a37", fontWeight:600, whiteSpace:"nowrap", ...stickyFirstCol(owned ? "#f3faef" : "#fff") }}>
                          {r.deal.propertyName || "Untitled"}
                          {r.deal.status && <span style={{ marginLeft:6, display:"inline-block", verticalAlign:"middle" }}><StatusTag status={r.deal.status} size="sm" /></span>}
                        </td>
                        <td style={{ padding:"9px 10px", whiteSpace:"nowrap" }}>
                          <button onClick={e => { e.stopPropagation(); onTenantClick?.(r.brandLabel); }}
                            style={{ background:"transparent", border:"none", padding:0, cursor:onTenantClick?"pointer":"default", fontSize:12.5, fontWeight:600, color:"#2d4ecf", textDecoration:"underline", fontFamily:"'Inter',sans-serif" }}>
                            {r.brandLabel}
                          </button>
                          {r.t.isAnchor && <span style={{ fontSize:9, color:"#1f2b16", background:"#6dba4322", padding:"1px 6px", borderRadius:10, marginLeft:6, fontWeight:600 }}>ANCHOR</span>}
                          {isGroundLease(r) && <span style={{ fontSize:9, color:"#3a5b7c", background:"#e8eff5", border:"1px solid #b8cce0", padding:"1px 6px", borderRadius:10, marginLeft:6, fontWeight:600 }}>GROUND LEASE</span>}
                          {(isNAPTenant(r.t) || (!isGroundLease(r) && sfOf(r) == null && rentOf(r) == null)) && <span style={{ fontSize:9, color:"#7c6340", background:"#f5ede0", border:"1px solid #e0c9a8", padding:"1px 6px", borderRadius:10, marginLeft:6, fontWeight:600 }}>NAP</span>}
                          {(r.t.name || "") && isInvestmentGrade(r.t.name || "", r.t.creditRating) && <span style={{ fontSize:9, color:"#3f7a1f", background:"#eef3e6", border:"1px solid #b8d49a", padding:"1px 6px", borderRadius:4, marginLeft:6, fontWeight:700 }}>Investment Grade</span>}
                          {(() => { const w = lookupWatch(watchMap, r.t.name); if (!w) return null; const m = WATCH_STATUS_META[w.status] || WATCH_STATUS_META.watch; return (
                            <span title={`Retailer watchlist — ${m.label}: ${w.note || w.brand}`} style={{ fontSize:9, color:m.color, background:m.bg, border:`1px solid ${m.border}`, padding:"1px 6px", borderRadius:4, marginLeft:6, fontWeight:700, textTransform:"uppercase", letterSpacing:"0.03em" }}>⚠ {m.label}</span>
                          ); })()}
                        </td>
                        <td style={{ padding:"9px 10px", color:"#8b9097", whiteSpace:"nowrap" }}>{r.deal.market || cityState(r.deal) || "—"}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>{num(r.t.sf) != null ? num(r.t.sf)!.toLocaleString() : "—"}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#0f9d63", fontWeight:500, whiteSpace:"nowrap" }}>{num(r.t.rentPerSF) != null ? `$${num(r.t.rentPerSF)!.toFixed(2)}` : "—"}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#383a37", whiteSpace:"nowrap" }}>{fmtUSD(r.t.annualRent)}</td>
                        <td style={{ padding:"9px 10px", color:"#5c5f57", whiteSpace:"nowrap" }}>{fmtLeaseDate(r.t.leaseStart)}</td>
                        <td style={{ padding:"9px 10px", color:"#5c5f57", whiteSpace:"nowrap" }}>{fmtLeaseDate(r.t.leaseExpiry)}</td>
                        <td style={{ padding:"9px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>{fmtTenantSales(effSales(r), r.t.sf)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            {rows.length === 0 && <div style={{ fontSize:13, color:"#a69e91", padding:"10px 0" }}>No locations found.</div>}
          </div>
        </>
      )}
      </div>
    </div>
  );
}
