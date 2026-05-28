import { useState, useMemo, useRef } from "react";
import type { TenantSalesYear, TenantSalesRecord } from "../lib/idb";

interface Props {
  salesHistory: TenantSalesYear[];
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadBusy: boolean;
  uploadError: string | null;
}

type SortKey = "name" | "salesPSF" | "annualSales" | "sf" | "occupancyCost";
type SortDir = "asc" | "desc";

function fmt$(v: number | null | undefined, sf?: number | null): string {
  if (v == null) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1000)}k`;
  return `$${v.toFixed(0)}`;
}

function fmtPSF(v: number | null | undefined): string {
  if (v == null) return "—";
  return `$${Math.round(v)} PSF`;
}

function fmtOcc(v: number | null | undefined): string {
  if (v == null) return "—";
  return `${v.toFixed(1)}%`;
}

function fmtNum(v: number | null | undefined): string {
  if (v == null) return "—";
  return v.toLocaleString();
}

// Merge rows across years so each tenant has data for every year available
interface MergedRow {
  name: string;
  byYear: Record<number, TenantSalesRecord>;
}

function mergeRows(history: TenantSalesYear[]): MergedRow[] {
  const map: Record<string, MergedRow> = {};
  for (const snap of history) {
    for (const t of snap.tenants) {
      const key = t.name.toLowerCase().trim();
      if (!map[key]) map[key] = { name: t.name, byYear: {} };
      map[key].byYear[snap.year] = t;
    }
  }
  return Object.values(map);
}

export default function TenantSalesPanel({ salesHistory, onUpload, uploadBusy, uploadError }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedYear, setSelectedYear] = useState<number | "all">("all");
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("salesPSF");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [collapsed, setCollapsed] = useState(false);

  // Sorted unique years, most-recent first
  const years = useMemo(
    () => [...new Set(salesHistory.map(s => s.year))].sort((a, b) => b - a),
    [salesHistory]
  );

  // Most recent upload timestamp
  const lastUpload = useMemo(() => {
    if (!salesHistory.length) return null;
    return salesHistory.slice().sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt))[0];
  }, [salesHistory]);

  // Rows for selected year(s)
  const allRows = useMemo(() => {
    if (selectedYear !== "all") {
      const snap = salesHistory.find(s => s.year === selectedYear);
      if (!snap) return [];
      return snap.tenants.map(t => ({ name: t.name, byYear: { [selectedYear]: t } as Record<number, TenantSalesRecord> }));
    }
    return mergeRows(salesHistory);
  }, [salesHistory, selectedYear]);

  // Which years to display as columns in "all" mode
  const displayYears = selectedYear === "all" ? years : [selectedYear];

  // Filter + sort
  const rows = useMemo(() => {
    let r = allRows.filter(row =>
      !filter.trim() || row.name.toLowerCase().includes(filter.toLowerCase())
    );
    r = [...r].sort((a, b) => {
      let av: number | null = null;
      let bv: number | null = null;
      const getVal = (row: MergedRow): number | null => {
        // Sort by most-recent year when multi-year
        const yr = displayYears[0];
        const rec = row.byYear[yr];
        if (!rec) return null;
        if (sortKey === "name") return 0;
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
      av = getVal(a);
      bv = getVal(b);
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
    <th
      onClick={() => toggleSort(k)}
      style={{
        padding: "7px 10px", fontSize: 10, fontWeight: 700, letterSpacing: "0.05em",
        color: sortKey === k ? "#3f7a1f" : "#7d766a", textTransform: "uppercase",
        cursor: "pointer", whiteSpace: "nowrap", textAlign: align,
        background: "transparent", border: "none", userSelect: "none",
        borderBottom: "1px solid #e8e2d6",
      }}
    >
      {label}<SortArrow k={k} />
    </th>
  );

  if (!salesHistory.length) {
    return (
      <div style={{
        background: "#fafaf7", border: "1px solid #e8e2d6", borderRadius: 10,
        padding: "16px 18px", marginBottom: 16,
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 15 }}>📊</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: "#383a37", fontFamily: "'Inter',sans-serif" }}>
              Tenant Sales
            </span>
            <span style={{ fontSize: 11, color: "#958d80" }}>— no sales data uploaded yet</span>
          </div>
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadBusy}
            style={{
              background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 6,
              padding: "6px 14px", fontSize: 11, fontWeight: 600, cursor: "pointer",
              opacity: uploadBusy ? 0.6 : 1, whiteSpace: "nowrap",
            }}
          >
            {uploadBusy ? "Uploading…" : "⬆ Upload Sales PDF"}
          </button>
        </div>
        {uploadError && (
          <div style={{ marginTop: 8, fontSize: 11, color: "#dc2626" }}>⚠ {uploadError}</div>
        )}
        <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={onUpload} />
        <div style={{ marginTop: 10, fontSize: 11, color: "#958d80", lineHeight: 1.55 }}>
          Upload a tenant sales report PDF (from the broker or property manager) and the year will be automatically detected. Sales data is tracked by year so you always know how current the numbers are.
        </div>
      </div>
    );
  }

  return (
    <div style={{
      background: "#f5f9f2", border: "1.5px solid #b8d9a0", borderRadius: 10,
      marginBottom: 16, overflow: "hidden",
    }}>
      {/* Header bar */}
      <div
        style={{
          display: "flex", alignItems: "center", gap: 10, padding: "11px 16px",
          background: "#eef5e8", borderBottom: collapsed ? "none" : "1px solid #c8ddb8",
          cursor: "pointer",
        }}
        onClick={() => setCollapsed(c => !c)}
      >
        <span style={{ fontSize: 15 }}>📊</span>
        <span style={{ fontSize: 13, fontWeight: 700, color: "#2d5a0e", fontFamily: "'Inter',sans-serif", flexShrink: 0 }}>
          Tenant Sales
        </span>
        {/* Year pills */}
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {years.map(y => (
            <span
              key={y}
              style={{
                background: "#3f7a1f22", border: "1px solid #3f7a1f55",
                borderRadius: 10, padding: "1px 8px", fontSize: 10,
                color: "#2d5a0e", fontWeight: 600,
              }}
            >
              {y}
            </span>
          ))}
        </div>
        {lastUpload && (
          <span style={{ fontSize: 10, color: "#6f8a5a", marginLeft: "auto", flexShrink: 0 }}>
            Last uploaded {new Date(lastUpload.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
          </span>
        )}
        <span style={{ fontSize: 10, color: "#6f8a5a", marginLeft: lastUpload ? 0 : "auto" }}>
          {collapsed ? "SHOW ▾" : "HIDE ▴"}
        </span>
      </div>

      {!collapsed && (
        <div style={{ padding: "12px 16px" }}>
          {/* Controls row */}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
            {/* Year selector */}
            <select
              value={String(selectedYear)}
              onChange={e => setSelectedYear(e.target.value === "all" ? "all" : Number(e.target.value))}
              style={{
                fontSize: 11, padding: "5px 8px", borderRadius: 6, border: "1px solid #c8ddb8",
                background: "#fff", color: "#383a37", cursor: "pointer",
              }}
            >
              <option value="all">All Years</option>
              {years.map(y => <option key={y} value={y}>{y}</option>)}
            </select>

            {/* Search */}
            <input
              type="text"
              placeholder="Filter tenants…"
              value={filter}
              onChange={e => setFilter(e.target.value)}
              style={{
                fontSize: 11, padding: "5px 10px", borderRadius: 6, border: "1px solid #c8ddb8",
                background: "#fff", color: "#383a37", flex: 1, minWidth: 120, maxWidth: 200,
              }}
            />

            {/* Upload button */}
            <button
              onClick={() => fileRef.current?.click()}
              disabled={uploadBusy}
              style={{
                background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 6,
                padding: "5px 13px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                opacity: uploadBusy ? 0.6 : 1, marginLeft: "auto", whiteSpace: "nowrap",
              }}
            >
              {uploadBusy ? "Uploading…" : "⬆ Update Sales"}
            </button>
            <input ref={fileRef} type="file" accept="application/pdf" style={{ display: "none" }} onChange={onUpload} />
          </div>

          {uploadError && (
            <div style={{ marginBottom: 8, fontSize: 11, color: "#dc2626" }}>⚠ {uploadError}</div>
          )}

          {/* Table */}
          {rows.length === 0 ? (
            <div style={{ fontSize: 12, color: "#958d80", textAlign: "center", padding: "16px 0" }}>
              No tenants match your filter.
            </div>
          ) : (
            <div style={{ overflowX: "auto" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
                <thead>
                  <tr style={{ background: "#eef5e8" }}>
                    <TH label="Tenant" k="name" align="left" />
                    {/* If multi-year, show Year as a column header segment */}
                    {selectedYear === "all"
                      ? displayYears.map(y => (
                          <th
                            key={y}
                            colSpan={3}
                            style={{
                              padding: "5px 10px", fontSize: 10, fontWeight: 700,
                              color: "#2d5a0e", textTransform: "uppercase",
                              textAlign: "center", borderBottom: "1px solid #e8e2d6",
                              borderLeft: "2px solid #c8ddb8",
                            }}
                          >
                            {y}
                          </th>
                        ))
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
                    <tr
                      key={row.name}
                      style={{ background: i % 2 === 0 ? "#fff" : "#f8fbf5", borderBottom: "1px solid #eef0eb" }}
                    >
                      <td style={{ padding: "7px 10px", fontWeight: 600, color: "#262724", whiteSpace: "nowrap" }}>
                        {row.name}
                      </td>
                      {selectedYear === "all"
                        ? displayYears.map(y => {
                            const rec = row.byYear[y];
                            return (
                              <>
                                <td key={`${y}-psf`} style={{ padding: "7px 10px", textAlign: "right", color: rec?.salesPSF ? "#2d5a0e" : "#bbb", fontWeight: rec?.salesPSF ? 600 : 400, borderLeft: "2px solid #c8ddb8" }}>
                                  {fmtPSF(rec?.salesPSF)}
                                </td>
                                <td key={`${y}-tot`} style={{ padding: "7px 10px", textAlign: "right", color: "#5c5f57" }}>
                                  {fmt$(rec?.annualSales)}
                                </td>
                                <td key={`${y}-occ`} style={{ padding: "7px 10px", textAlign: "right", color: "#5c5f57" }}>
                                  {fmtOcc(rec?.occupancyCost)}
                                </td>
                              </>
                            );
                          })
                        : (() => {
                            const rec = row.byYear[selectedYear as number];
                            return (
                              <>
                                <td style={{ padding: "7px 10px", textAlign: "right", color: rec?.salesPSF ? "#2d5a0e" : "#bbb", fontWeight: rec?.salesPSF ? 600 : 400 }}>
                                  {fmtPSF(rec?.salesPSF)}
                                </td>
                                <td style={{ padding: "7px 10px", textAlign: "right", color: "#5c5f57" }}>
                                  {fmt$(rec?.annualSales)}
                                </td>
                                <td style={{ padding: "7px 10px", textAlign: "right", color: "#5c5f57" }}>
                                  {fmtNum(rec?.sf)}
                                </td>
                                <td style={{ padding: "7px 10px", textAlign: "right", color: "#5c5f57" }}>
                                  {fmtOcc(rec?.occupancyCost)}
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

          {/* Year coverage note */}
          <div style={{ marginTop: 8, fontSize: 10, color: "#8a9a7a", lineHeight: 1.5 }}>
            {years.length > 1
              ? `${years.length} years of sales data on file (${years[years.length - 1]}–${years[0]}). Year is always shown — hover column headers to sort.`
              : `Sales data for ${years[0]}. Upload additional years to track trends.`}
          </div>

          {/* Per-year upload history */}
          {salesHistory.length > 1 && (
            <details style={{ marginTop: 8 }}>
              <summary style={{ fontSize: 10, color: "#6f8a5a", cursor: "pointer" }}>Upload history</summary>
              <div style={{ marginTop: 6, display: "flex", flexDirection: "column", gap: 3 }}>
                {[...salesHistory].sort((a, b) => b.year - a.year).map(s => (
                  <div key={`${s.year}-${s.uploadedAt}`} style={{ fontSize: 10, color: "#8a9a7a" }}>
                    <b style={{ color: "#2d5a0e" }}>{s.year}</b> — {s.tenants.length} tenants, uploaded{" "}
                    {new Date(s.uploadedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}
                    {s.source === "om" ? " (from OM)" : ""}
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
