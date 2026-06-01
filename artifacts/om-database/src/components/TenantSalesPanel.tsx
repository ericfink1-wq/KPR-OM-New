import { useState, useMemo, useRef, useEffect } from "react";
import type { TenantSalesYear, TenantSalesRecord, OccBreakdown, Tenant } from "../lib/idb";
import { tenantKey } from "../lib/utils";
import { useIsMobile } from "../hooks/use-mobile";

interface Props {
  salesHistory: TenantSalesYear[];
  omTenants?: Tenant[];         // existing roster tenants — used to seed OM sales data
  omDate?: string | null;       // OM date — used to estimate the sales year
  recoveries?: Map<string, { value: number; estimated: boolean }>; // per-tenant recovery estimate
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadBusy: boolean;
  uploadError: string | null;
}

type SortKey = "name" | "salesPSF" | "annualSales" | "sf" | "occupancyCost";
type SortDir = "asc" | "desc";

function fmt$(v: number | null | undefined): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1000)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtPSF(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${Math.round(Number(v))} PSF`;
}

function fmtOcc(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${Number(v).toFixed(1)}%`;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  return Number(v).toLocaleString();
}

// Derive a synthetic OM snapshot from the tenant roster
function buildOmSnapshot(tenants: Tenant[], omDate: string | null | undefined): TenantSalesYear | null {
  const reporting = tenants.filter(t =>
    t.salesPSF != null && t.salesPSF !== "" && !isNaN(Number(t.salesPSF))
  );
  if (reporting.length === 0) return null;

  // Best-guess year: omDate year minus 1 (sales in an OM are usually prior-year actuals)
  let year: number | null = null;
  if (omDate) {
    const parsed = new Date(omDate.includes("T") ? omDate : omDate + "T00:00:00");
    if (!isNaN(parsed.getTime())) {
      year = parsed.getFullYear() - 1;
    }
  }

  return {
    year: year ?? 0,
    uploadedAt: omDate ?? new Date().toISOString(),
    source: "om",
    tenants: reporting.map(t => {
      const sp = t.salesPSF != null ? Number(t.salesPSF) : null;
      const sfn = t.sf != null ? Number(t.sf) : null;
      const sales = (sp != null && sfn != null && sp > 0 && sfn > 0) ? sp * sfn : null;

      // Occupancy cost precedence:
      // 1. OM-stated occupancyCost (already a total %)
      // 2. Computed if base rent AND reimbursements are both present AND sales > 0
      // 3. Otherwise null — never estimate from base rent alone
      const stated = t.occupancyCost != null && !isNaN(Number(t.occupancyCost))
        ? Number(t.occupancyCost) : null;
      const base = t.annualRent != null && !isNaN(Number(t.annualRent))
        ? Number(t.annualRent) : null;
      const reimb = t.expenseReimbursements != null ? Number(t.expenseReimbursements) : null;
      const pctRent = (t.percentageRent != null && typeof t.percentageRent === "number")
        ? t.percentageRent : 0;
      const other = t.otherRent != null ? Number(t.otherRent) : 0;

      let occupancyCost: number | null = null;
      let occSource: "stated" | "computed" | undefined;
      let occBreakdown: OccBreakdown | null = null;

      if (stated != null) {
        occupancyCost = stated;
        occSource = "stated";
      } else if (base != null && reimb != null && sales != null && sales > 0) {
        const total = base + reimb + pctRent + other;
        occupancyCost = (total / sales) * 100;
        occSource = "computed";
        occBreakdown = { base, reimbursements: reimb, percentRent: pctRent, other, total, sales };
      }

      return {
        name: t.canonicalName || t.name || "",
        salesPSF: sp,
        annualSales: (sp != null && sfn != null) ? Math.round(sp * sfn) : null,
        sf: sfn,
        occupancyCost,
        occIsEst: false,
        occSource,
        occBreakdown,
      };
    }),
  };
}

function OccTip({ val, source, breakdown }: { val: number; source: "stated" | "computed"; breakdown?: OccBreakdown | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const isMobile = useIsMobile();

  useEffect(() => {
    if (!open) return;
    const h = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", h);
    document.addEventListener("touchstart", h);
    return () => { document.removeEventListener("mousedown", h); document.removeEventListener("touchstart", h); };
  }, [open]);

  const fmt$ = (v: number) => v >= 1_000_000 ? `$${(v / 1_000_000).toFixed(1)}M` : `$${Math.round(v).toLocaleString()}`;
  const isStated = source === "stated";

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span
        onMouseEnter={isMobile ? undefined : () => setOpen(true)}
        onMouseLeave={isMobile ? undefined : () => setOpen(false)}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}
      >
        {val.toFixed(1)}%
        <span style={{ fontSize: 8, letterSpacing: "0.04em", color: isStated ? "#0f9d63" : "#7d766a", background: isStated ? "#e7f8f0" : "#f3f4f6", border: `1px solid ${isStated ? "#a7f3d0" : "#d1d5db"}`, borderRadius: 3, padding: "0px 3px", fontWeight: 700, fontFamily: "'Inter',sans-serif" }}>
          {source}
        </span>
      </span>
      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", right: 0,
          background: "#fff", border: "1px solid #e6dfd0", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(56,58,55,0.18)", padding: "10px 14px",
          zIndex: 9999, minWidth: 200, maxWidth: "min(280px, calc(100vw - 32px))",
          fontSize: 11, fontFamily: "'Inter',sans-serif",
        }}>
          {breakdown ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 3 }}>
                <span style={{ color: "#a89f8f" }}>Base rent</span><span style={{ fontWeight: 600 }}>{fmt$(breakdown.base)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 3 }}>
                <span style={{ color: "#a89f8f" }}>+ Recoveries{breakdown.reimbEstimated ? " (est.)" : ""}</span><span style={{ fontWeight: 600 }}>{fmt$(breakdown.reimbursements)}</span>
              </div>
              {breakdown.percentRent > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 3 }}>
                  <span style={{ color: "#a89f8f" }}>+ % Rent</span><span style={{ fontWeight: 600 }}>{fmt$(breakdown.percentRent)}</span>
                </div>
              )}
              {breakdown.other > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 3 }}>
                  <span style={{ color: "#a89f8f" }}>+ Other rent</span><span style={{ fontWeight: 600 }}>{fmt$(breakdown.other)}</span>
                </div>
              )}
              <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 3, borderTop: "1px solid #f1eadc", paddingTop: 4, marginTop: 2 }}>
                <span style={{ color: "#a89f8f" }}>= Total</span><span style={{ fontWeight: 700 }}>{fmt$(breakdown.total)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 4 }}>
                <span style={{ color: "#a89f8f" }}>÷ Sales</span><span style={{ fontWeight: 600 }}>{fmt$(breakdown.sales)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 20, borderTop: "1px solid #f1eadc", paddingTop: 4 }}>
                <span style={{ fontWeight: 600, color: "#383a37" }}>Occ Cost</span><span style={{ fontWeight: 700, color: "#383a37" }}>{val.toFixed(1)}%</span>
              </div>
            </>
          ) : (
            <div style={{ color: "#383a37" }}>OM-stated: <b>{val.toFixed(1)}%</b></div>
          )}
        </div>
      )}
    </span>
  );
}

interface MergedRow {
  name: string;
  byYear: Record<number, TenantSalesRecord>;
}

// Re-derive sales PSF (from gross) and occupancy cost (from the roster's rent
// components against this record's gross sales) LIVE on display — so existing
// stored sales snapshots benefit from the latest logic without a re-upload.
function deriveSalesRecord(
  t: TenantSalesRecord,
  rosterByKey: Map<string, Tenant>,
  recByKey: Map<string, { value: number; estimated: boolean }>,
): TenantSalesRecord {
  const nv = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const key = tenantKey(t.name);
  const rt = rosterByKey.get(key);
  let sf = nv(t.sf) ?? nv(rt?.sf) ?? null;
  let psf = nv(t.salesPSF);
  let gross = nv(t.annualSales);
  if (psf == null && gross != null && sf != null && sf > 0) psf = Math.round((gross / sf) * 100) / 100;
  if (gross == null && psf != null && sf != null && sf > 0) gross = Math.round(psf * sf);

  let occupancyCost = nv(t.occupancyCost);
  let occSource: "stated" | "computed" | undefined = occupancyCost != null ? "stated" : undefined;
  let occBreakdown: OccBreakdown | null = t.occBreakdown ?? null;
  const base = nv(rt?.annualRent);
  const disclosedReimb = nv(rt?.expenseReimbursements);
  const est = recByKey.get(key);
  const reimb = disclosedReimb ?? (est ? est.value : null);
  const reimbEstimated = disclosedReimb == null && !!est?.estimated;
  const pctRent = nv(rt?.percentageRent) ?? 0, other = nv(rt?.otherRent) ?? 0;
  if (base != null && reimb != null && gross != null && gross > 0) {
    const total = base + reimb + pctRent + other;
    occupancyCost = Math.round((total / gross) * 1000) / 10;
    occSource = "computed";
    occBreakdown = { base, reimbursements: reimb, percentRent: pctRent, other, total, sales: gross, reimbEstimated };
  }
  return { ...t, sf, salesPSF: psf, annualSales: gross, occupancyCost, occSource, occBreakdown };
}

function mergeRows(
  history: TenantSalesYear[],
  rosterByKey: Map<string, Tenant>,
  recByKey: Map<string, { value: number; estimated: boolean }>,
): MergedRow[] {
  const map: Record<string, MergedRow> = {};
  for (const snap of history) {
    for (const raw of snap.tenants) {
      const key = (raw.name || "").toLowerCase().trim();
      if (!key) continue;
      const t = deriveSalesRecord(raw, rosterByKey, recByKey);
      if (!map[key]) map[key] = { name: t.name, byYear: {} };
      map[key].byYear[snap.year] = t;
    }
  }
  return Object.values(map);
}

function yearLabel(year: number, source: "om" | "upload"): string {
  if (year === 0) return source === "om" ? "OM (yr unknown)" : "Unknown";
  if (source === "om") return `${year} est. (OM)`;
  return String(year);
}

export default function TenantSalesPanel({ salesHistory, omTenants, omDate, recoveries, onUpload, uploadBusy, uploadError }: Props) {
  const rosterByKey = useMemo(() => new Map((omTenants || []).map(t => [tenantKey(t.canonicalName || t.name), t])), [omTenants]);
  const recByKey = recoveries ?? new Map();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedYear, setSelectedYear] = useState<number | "all">("all");
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("salesPSF");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [collapsed, setCollapsed] = useState(false);

  // Build OM snapshot if not already in history
  const omSnapshot = useMemo(() => {
    if (!omTenants?.length) return null;
    const snap = buildOmSnapshot(omTenants, omDate);
    if (!snap) return null;
    // Don't synthesize if we already have an uploaded entry for that year
    const alreadyHave = salesHistory.some(s => s.year === snap.year && s.source !== "om");
    return alreadyHave ? null : snap;
  }, [omTenants, omDate, salesHistory]);

  // Full history = uploaded + OM seed (OM always goes first / lowest)
  const fullHistory = useMemo(() => {
    const all = omSnapshot ? [omSnapshot, ...salesHistory] : [...salesHistory];
    return all.sort((a, b) => a.year - b.year);
  }, [salesHistory, omSnapshot]);

  const hasAnySales = fullHistory.length > 0;

  // Sorted unique years, most-recent first
  const years = useMemo(
    () => [...new Set(fullHistory.map(s => s.year))].sort((a, b) => b - a),
    [fullHistory]
  );

  // Most recent uploaded entry (non-OM preferred)
  const lastUpload = useMemo(() => {
    const uploaded = salesHistory.filter(s => s.source !== "om");
    if (uploaded.length) return uploaded.sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
    return null;
  }, [salesHistory]);

  const allRows = useMemo(() => {
    if (selectedYear !== "all") {
      const snap = fullHistory.find(s => s.year === selectedYear);
      if (!snap) return [];
      return snap.tenants.map(raw => { const t = deriveSalesRecord(raw, rosterByKey, recByKey); return { name: t.name, byYear: { [selectedYear]: t } as Record<number, TenantSalesRecord> }; });
    }
    return mergeRows(fullHistory, rosterByKey, recByKey);
  }, [fullHistory, selectedYear, rosterByKey, recByKey]);

  const displayYears = selectedYear === "all" ? years : [selectedYear as number];

  const rows = useMemo(() => {
    let r = allRows.filter(row =>
      !filter.trim() || row.name.toLowerCase().includes(filter.toLowerCase())
    );
    r = [...r].sort((a, b) => {
      const getVal = (row: MergedRow): number | null => {
        const yr = displayYears[0];
        const rec = row.byYear[yr];
        if (!rec) return null;
        if (sortKey === "salesPSF") return rec.salesPSF ?? null;
        if (sortKey === "annualSales") return rec.annualSales ?? null;
        if (sortKey === "sf") return rec.sf ?? null;
        if (sortKey === "occupancyCost") return rec.occupancyCost ?? null;
        return null;
      };
      if (sortKey === "name") {
        const cmp = a.name.localeCompare(b.name);
        return sortDir === "asc" ? cmp : -cmp;
      }
      const av = getVal(a), bv = getVal(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      return sortDir === "desc" ? bv - av : av - bv;
    });
    return r;
  }, [allRows, filter, sortKey, sortDir, displayYears]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(key); setSortDir("desc"); }
  };

  const SortArrow = ({ k }: { k: SortKey }) => (
    <span style={{ marginLeft: 3, opacity: sortKey === k ? 1 : 0.25, fontSize: 10 }}>
      {sortKey === k ? (sortDir === "asc" ? "▲" : "▼") : "▼"}
    </span>
  );

  const TH = ({ label, k, align = "right" }: { label: string; k: SortKey; align?: "left" | "right" }) => (
    <th onClick={() => toggleSort(k)} style={{
      padding: "7px 10px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
      color: sortKey === k ? "#3f7a1f" : "#7d766a", textTransform: "uppercase",
      cursor: "pointer", whiteSpace: "nowrap", textAlign: align,
      background: "transparent", border: "none", userSelect: "none",
      borderBottom: "1px solid #e8e2d6",
    }}>
      {label}<SortArrow k={k} />
    </th>
  );

  // No sales data at all (no uploads, no OM sales)
  if (!hasAnySales) {
    return (
      <div style={{ background: "#fafaf7", border: "1px solid #e8e2d6", borderRadius: 10, padding: "16px 18px", marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15 }}>📊</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#383a37", fontFamily: "'Inter',sans-serif" }}>Tenant Sales</span>
            <span style={{ fontSize: 11, color: "#958d80" }}>— no sales data available</span>
          </div>
          <button onClick={() => fileRef.current?.click()} disabled={uploadBusy} style={{
            background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 6,
            padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
            opacity: uploadBusy ? 0.6 : 1, whiteSpace: "nowrap",
          }}>
            {uploadBusy ? "Uploading…" : "⬆ Upload Sales (PDF or Excel)"}
          </button>
        </div>
        {uploadError && <div style={{ marginTop: 8, fontSize: 11, color: "#dc2626" }}>⚠ {uploadError}</div>}
        <input ref={fileRef} type="file" accept="application/pdf,.pdf,.xlsx,.xls,.xlsm,.xlsb,.csv" style={{ display: "none" }} onChange={onUpload} />
        <div style={{ marginTop: 10, fontSize: 11, color: "#958d80", lineHeight: 1.55 }}>
          Upload a tenant sales report PDF and the year will be automatically detected. Sales data is tracked by year so you always know how current the numbers are.
        </div>
      </div>
    );
  }

  // Determine the source label for the header
  const hasUploadedData = salesHistory.length > 0;
  const omOnly = !hasUploadedData && omSnapshot != null;

  return (
    <div style={{ background: "#f5f9f2", border: "1.5px solid #b8d9a0", borderRadius: 10, marginBottom: 16, overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{ display: "flex", alignItems: "center", gap: 10, padding: "11px 16px", background: "#eef5e8", borderBottom: collapsed ? "none" : "1px solid #c8ddb8", cursor: "pointer" }}
        onClick={() => setCollapsed(c => !c)}
      >
        <span style={{ fontSize: 15 }}>📊</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#2d5a0e", fontFamily: "'Inter',sans-serif", flexShrink: 0 }}>
          Tenant Sales
        </span>

        {/* Year pills */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {years.map(y => {
            const snap = fullHistory.find(s => s.year === y);
            const isOM = snap?.source === "om";
            return (
              <span key={y} style={{
                background: isOM ? "#fff8e1" : "#3f7a1f22",
                border: `1px solid ${isOM ? "#f5c842" : "#3f7a1f55"}`,
                borderRadius: 10, padding: "1px 8px", fontSize: 10,
                color: isOM ? "#7a5e00" : "#2d5a0e", fontWeight: 600,
              }}>
                {yearLabel(y, snap?.source ?? "upload")}
              </span>
            );
          })}
        </div>

        {lastUpload ? (
          <span style={{ fontSize: 10, color: "#6f8a5a", marginLeft: "auto", flexShrink: 0 }}>
            Updated {new Date(lastUpload.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        ) : omOnly ? (
          <span style={{ fontSize: 10, color: "#9a7a20", marginLeft: "auto", flexShrink: 0 }}>From OM — upload dedicated sales report for more detail</span>
        ) : null}

        <span style={{ fontSize: 10, color: "#6f8a5a", marginLeft: lastUpload || omOnly ? 0 : "auto" }}>
          {collapsed ? "SHOW ▾" : "HIDE ▴"}
        </span>
      </div>

      {!collapsed && (
        <div style={{ padding: "12px 16px" }}>
          {/* OM data notice */}
          {omSnapshot && (
            <div style={{ display: "flex", alignItems: "flex-start", gap: 8, background: "#fffbea", border: "1px solid #f5c842", borderRadius: 7, padding: "8px 12px", marginBottom: 10, fontSize: 11, color: "#7a5e00" }}>
              <span style={{ flexShrink: 0 }}>⚠</span>
              <span>
                <b>OM data</b> — pulled from the tenant roster.{" "}
                {omSnapshot.year > 0
                  ? `Year estimated as ${omSnapshot.year} (prior year to OM date).`
                  : "Sales year could not be determined from the OM date."}{" "}
                Upload a dedicated tenant sales report (PDF or Excel) to replace with verified annual figures.
              </span>
            </div>
          )}

          {/* Controls */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            <select
              value={String(selectedYear)}
              onChange={e => setSelectedYear(e.target.value === "all" ? "all" : Number(e.target.value))}
              style={{ fontSize: 11, padding: "5px 8px", borderRadius: 6, border: "1px solid #c8ddb8", background: "#fff", color: "#383a37", cursor: "pointer" }}
            >
              <option value="all">All Years</option>
              {years.map(y => {
                const snap = fullHistory.find(s => s.year === y);
                return <option key={y} value={y}>{yearLabel(y, snap?.source ?? "upload")}</option>;
              })}
            </select>

            <input
              type="text"
              placeholder="Filter tenants…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{ fontSize: 11, padding: "5px 10px", borderRadius: 6, border: "1px solid #c8ddb8", background: "#fff", color: "#383a37", flex: 1, minWidth: 120, maxWidth: 200 }}
            />

            <button onClick={() => fileRef.current?.click()} disabled={uploadBusy} style={{
              background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 6,
              padding: "5px 13px", fontSize: 11, fontWeight: 600, cursor: "pointer",
              opacity: uploadBusy ? 0.6 : 1, marginLeft: "auto", whiteSpace: "nowrap",
            }}>
              {uploadBusy ? "Uploading…" : "⬆ Update Sales"}
            </button>
            <input ref={fileRef} type="file" accept="application/pdf,.pdf,.xlsx,.xls,.xlsm,.xlsb,.csv" style={{ display: "none" }} onChange={onUpload} />
          </div>

          {uploadError && <div style={{ marginBottom: 8, fontSize: 11, color: "#dc2626" }}>⚠ {uploadError}</div>}

          {/* Table */}
          {rows.length === 0 ? (
            <div style={{ fontSize: 12, color: "#958d80", textAlign: "center", padding: "16px 0" }}>No tenants match your filter.</div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#eef5e8" }}>
                    <TH label="Tenant" k="name" align="left" />
                    {selectedYear === "all"
                      ? displayYears.map(y => {
                          const snap = fullHistory.find(s => s.year === y);
                          const isOM = snap?.source === "om";
                          return (
                            <th key={y} colSpan={3} style={{
                              padding: "5px 10px", fontSize: 10, fontWeight: 700,
                              color: isOM ? "#7a5e00" : "#2d5a0e", textTransform: "uppercase",
                              textAlign: "center", borderBottom: "1px solid #e8e2d6",
                              borderLeft: "2px solid #c8ddb8",
                              background: isOM ? "#fffbea" : undefined,
                            }}>
                              {yearLabel(y, snap?.source ?? "upload")}
                            </th>
                          );
                        })
                      : (
                        <>
                          <TH label="Sales PSF" k="salesPSF" />
                          <TH label="Total Sales" k="annualSales" />
                          <TH label="SF" k="sf" />
                          <TH label="Occ Cost %" k="occupancyCost" />
                        </>
                      )}
                  </tr>
                  {selectedYear === "all" && (
                    <tr style={{ background: "#f5f9f2" }}>
                      <th style={{ borderBottom: "1px solid #e8e2d6" }} />
                      {displayYears.map(y => (
                        <>
                          <th key={`${y}-psf`} onClick={() => toggleSort("salesPSF")} style={{ padding: "4px 10px", fontSize: 10, color: "#7d766a", textAlign: "right", cursor: "pointer", borderLeft: "2px solid #c8ddb8", borderBottom: "1px solid #e8e2d6" }}>Sales PSF</th>
                          <th key={`${y}-tot`} onClick={() => toggleSort("annualSales")} style={{ padding: "4px 10px", fontSize: 10, color: "#7d766a", textAlign: "right", cursor: "pointer", borderBottom: "1px solid #e8e2d6" }}>Total Sales</th>
                          <th key={`${y}-occ`} onClick={() => toggleSort("occupancyCost")} style={{ padding: "4px 10px", fontSize: 10, color: "#7d766a", textAlign: "right", cursor: "pointer", borderBottom: "1px solid #e8e2d6" }}>Occ Cost %</th>
                        </>
                      ))}
                    </tr>
                  )}
                </thead>
                <tbody>
                  {rows.map((row, i) => (
                    <tr key={row.name} style={{ background: i % 2 === 0 ? "#fff" : "#f8fbf5", borderBottom: "1px solid #eef0eb" }}>
                      <td style={{ padding: "7px 10px", fontWeight: 600, color: "#262724", whiteSpace: "nowrap" }}>{row.name}</td>
                      {selectedYear === "all"
                        ? displayYears.map(y => {
                            const rec = row.byYear[y];
                            return (
                              <>
                                <td key={`${y}-psf`} style={{ padding: "7px 10px", textAlign: "right", color: rec?.salesPSF ? "#2d5a0e" : "#bbb", fontWeight: rec?.salesPSF ? 600 : 400, borderLeft: "2px solid #c8ddb8" }}>
                                  {fmtPSF(rec?.salesPSF)}
                                </td>
                                <td key={`${y}-tot`} style={{ padding: "7px 10px", textAlign: "right", color: "#5c5f57" }}>{fmt$(rec?.annualSales)}</td>
                                <td key={`${y}-occ`} style={{ padding: "7px 10px", textAlign: "right", color: "#5c5f57" }}>
                                  {rec?.occupancyCost != null && rec.occSource
                                    ? <OccTip val={rec.occupancyCost} source={rec.occSource} breakdown={rec.occBreakdown} />
                                    : rec?.occupancyCost != null ? fmtOcc(rec.occupancyCost) : "—"}
                                </td>
                              </>
                            );
                          })
                        : (() => {
                            const rec = row.byYear[selectedYear as number];
                            return (
                              <>
                                <td style={{ padding: "7px 10px", textAlign: "right", color: rec?.salesPSF ? "#2d5a0e" : "#bbb", fontWeight: rec?.salesPSF ? 600 : 400 }}>{fmtPSF(rec?.salesPSF)}</td>
                                <td style={{ padding: "7px 10px", textAlign: "right", color: "#5c5f57" }}>{fmt$(rec?.annualSales)}</td>
                                <td style={{ padding: "7px 10px", textAlign: "right", color: "#5c5f57" }}>{fmtNum(rec?.sf)}</td>
                                <td style={{ padding: "7px 10px", textAlign: "right", color: "#5c5f57" }}>
                                  {rec?.occupancyCost != null && rec.occSource
                                    ? <OccTip val={rec.occupancyCost} source={rec.occSource} breakdown={rec.occBreakdown} />
                                    : rec?.occupancyCost != null ? fmtOcc(rec.occupancyCost) : "—"}
                                </td>
                              </>
                            );
                          })()
                      }
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <div style={{ marginTop: 8, fontSize: 10, color: "#8a9a7a", lineHeight: 1.5 }}>
            {years.length > 1
              ? `${years.length} years of sales data on file. Year is always shown so you know how current the numbers are.`
              : omOnly
                ? "Figures pulled from OM — year is estimated. Upload a dedicated sales report to lock in verified annual data."
                : `Sales data for ${yearLabel(years[0], fullHistory.find(s => s.year === years[0])?.source ?? "upload")}. Upload additional years to track trends.`}
          </div>

          {fullHistory.length > 1 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 10, color: "#6f8a5a", cursor: "pointer" }}>Data sources</summary>
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                {[...fullHistory].sort((a, b) => b.year - a.year).map(s => (
                  <div key={`${s.year}-${s.uploadedAt}`} style={{ fontSize: 10, color: "#8a9a7a" }}>
                    <b style={{ color: "#2d5a0e" }}>{yearLabel(s.year, s.source)}</b> — {s.tenants.length} tenants
                    {s.source === "om" ? " (from OM, estimated year)" : ` — uploaded ${new Date(s.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}`}
                  </div>
                ))}
              </div>
            </details>
          )}
        </div>
      )}
    </div>
  );
}
