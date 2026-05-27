import { useState, useEffect, useCallback, useRef } from "react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface CompRow {
  id: number;
  sourceDealId: string;
  sourceDealName: string | null;
  sourceDealMarket: string | null;
  name: string | null;
  address: string | null;
  market: string | null;
  saleDateRaw: string | null;
  saleDate: string | null;
  salePrice: number | null;
  capRate: number | null;
  pricePerSf: number | null;
  sf: number | null;
  occupancy: number | null;
}

type SortKey = "date_desc" | "date_asc" | "cap_rate_asc" | "cap_rate_desc" | "price_per_sf_asc" | "price_per_sf_desc" | "sale_price_desc" | "sale_price_asc";

interface Filters {
  market: string;
  dateFrom: string;
  dateTo: string;
  capRateMin: string;
  capRateMax: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(s: string | null): string {
  if (!s) return "—";
  // YYYY-MM-DD → Mon YYYY
  const m = s.match(/^(\d{4})-(\d{2})/);
  if (!m) return s;
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const mo = months[parseInt(m[2]) - 1] ?? "";
  return `${mo} ${m[1]}`;
}

function fmtM(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function fmtSf(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M sf`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}k sf`;
  return `${Math.round(n)} sf`;
}

function fmtPct(n: number | null): string {
  if (n == null) return "—";
  return `${n}%`;
}

function fmtCapRate(n: number | null): string {
  if (n == null) return "—";
  return `${n}%`;
}

function fmtPsf(n: number | null): string {
  if (n == null) return "—";
  return `$${n.toFixed(2)}/sf`;
}

function buildQuery(filters: Filters, sort: SortKey): string {
  const p = new URLSearchParams();
  if (filters.market.trim()) p.set("market", filters.market.trim());
  if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) p.set("dateTo", filters.dateTo);
  if (filters.capRateMin) p.set("capRateMin", filters.capRateMin);
  if (filters.capRateMax) p.set("capRateMax", filters.capRateMax);
  p.set("sort", sort);
  return `/api/comps?${p.toString()}`;
}

const EMPTY_FILTERS: Filters = { market: "", dateFrom: "", dateTo: "", capRateMin: "", capRateMax: "" };

// ---------------------------------------------------------------------------
// Sort header cell
// ---------------------------------------------------------------------------
function SortTh({
  label, sortKey, current, onSort, style,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  onSort: (k: SortKey) => void;
  style?: React.CSSProperties;
}) {
  const active = current === sortKey;
  const isDesc = sortKey.endsWith("_desc");
  // toggle: if this key is active asc → desc, desc → asc; otherwise go to this key
  const toggle: SortKey = active
    ? (isDesc ? (sortKey.replace("_desc", "_asc") as SortKey) : (sortKey.replace("_asc", "_desc") as SortKey))
    : sortKey;
  return (
    <th
      onClick={() => onSort(toggle)}
      style={{
        padding: "9px 10px",
        textAlign: "left",
        fontSize: 9.5,
        fontWeight: 700,
        letterSpacing: "0.08em",
        color: active ? "#6dba43" : "#a89f8f",
        textTransform: "uppercase" as const,
        cursor: "pointer",
        userSelect: "none" as const,
        whiteSpace: "nowrap" as const,
        ...style,
      }}
    >
      {label}{active ? (isDesc ? " ↓" : " ↑") : ""}
    </th>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function CompsSearch({ onOpenDeal }: { onOpenDeal?: (id: string) => void }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [rows, setRows] = useState<CompRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetch_ = useCallback((f: Filters, s: SortKey) => {
    setLoading(true);
    setError(null);
    fetch(buildQuery(f, s), { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<CompRow[]>; })
      .then(d => { setRows(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  // Debounce text/number filters, immediate on date/sort change
  const handleFilter = useCallback((patch: Partial<Filters>) => {
    const next = { ...filters, ...patch };
    setFilters(next);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => fetch_(next, sort), 280);
  }, [filters, sort, fetch_]);

  const handleSort = useCallback((s: SortKey) => {
    setSort(s);
    fetch_(filters, s);
  }, [filters, fetch_]);

  useEffect(() => { fetch_(filters, sort); }, []); // initial load

  const hasFilters = Object.values(filters).some(v => v.trim() !== "");

  const In = (placeholder: string, key: keyof Filters, type = "text", extra?: React.InputHTMLAttributes<HTMLInputElement>) => (
    <input
      type={type}
      placeholder={placeholder}
      value={filters[key]}
      onChange={e => handleFilter({ [key]: e.target.value })}
      style={{
        height: 32, borderRadius: 7, border: "1px solid #ddd4c2", background: "#fff",
        padding: "0 10px", fontSize: 12, fontFamily: "'Inter',sans-serif", color: "#383a37",
        outline: "none", width: "100%",
      }}
      {...extra}
    />
  );

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1280, margin: "0 auto" }}>
      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 21, fontWeight: 500, color: "#26281f", letterSpacing: "-0.02em" }}>
            Comp Sales Database
          </div>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 3 }}>
            {loading ? "Loading…" : `${rows.length} comp${rows.length !== 1 ? "s" : ""}${hasFilters ? " matching filters" : " in index"}`}
          </div>
        </div>
        {hasFilters && (
          <button
            onClick={() => { setFilters(EMPTY_FILTERS); fetch_(EMPTY_FILTERS, sort); }}
            style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#a89f8f", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif" }}
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Filter bar */}
      <div style={{
        background: "#fff", border: "1px solid #ece5d7", borderRadius: 10, padding: "14px 16px",
        marginBottom: 16, display: "grid",
        gridTemplateColumns: "1fr 140px 140px 110px 110px",
        gap: 10, alignItems: "end",
      }}>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 5 }}>Market / MSA</div>
          {In("e.g. Chicago, MSA, Midwest…", "market")}
        </div>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 5 }}>Sold After</div>
          {In("", "dateFrom", "date")}
        </div>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 5 }}>Sold Before</div>
          {In("", "dateTo", "date")}
        </div>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 5 }}>Cap Rate ≥</div>
          {In("e.g. 5.5", "capRateMin", "number", { min: 0, max: 30, step: 0.25 })}
        </div>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 5 }}>Cap Rate ≤</div>
          {In("e.g. 8.0", "capRateMax", "number", { min: 0, max: 30, step: 0.25 })}
        </div>
      </div>

      {/* Error */}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 9, padding: "12px 16px", color: "#b91c1c", fontSize: 13, marginBottom: 14 }}>
          Failed to load comps: {error}
        </div>
      )}

      {/* Table */}
      {!error && (
        <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
              <thead>
                <tr style={{ background: "#faf7f0", borderBottom: "1px solid #f1eadc" }}>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: "#a89f8f", textTransform: "uppercase", minWidth: 180 }}>Property / Address</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: "#a89f8f", textTransform: "uppercase", minWidth: 100 }}>Market</th>
                  <SortTh label="Sale Date" sortKey="date_desc" current={sort} onSort={handleSort} />
                  <SortTh label="Cap Rate" sortKey="cap_rate_asc" current={sort} onSort={handleSort} />
                  <SortTh label="Price/SF" sortKey="price_per_sf_asc" current={sort} onSort={handleSort} />
                  <SortTh label="Sale Price" sortKey="sale_price_desc" current={sort} onSort={handleSort} />
                  <th style={{ padding: "9px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: "#a89f8f", textTransform: "uppercase" }}>SF</th>
                  <th style={{ padding: "9px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: "#a89f8f", textTransform: "uppercase" }}>Occ</th>
                  <th style={{ padding: "9px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: "#a89f8f", textTransform: "uppercase", minWidth: 120 }}>Source Deal</th>
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={9} style={{ padding: "40px 0", textAlign: "center", color: "#a89f8f", fontSize: 13 }}>
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={9} style={{ padding: "48px 0", textAlign: "center" }}>
                      <div style={{ color: "#a89f8f", fontSize: 13 }}>
                        {hasFilters ? "No comps match these filters." : "No comps in the index yet. Comps are extracted automatically from OM PDFs."}
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && rows.map((row, idx) => {
                  const label = row.name || row.address || "—";
                  const sub = row.name ? row.address : null;
                  return (
                    <tr
                      key={row.id}
                      style={{
                        borderTop: idx === 0 ? "none" : "1px solid #f5f1ea",
                        transition: "background 0.12s",
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#faf7f0")}
                      onMouseLeave={e => (e.currentTarget.style.background = "")}
                    >
                      <td style={{ padding: "9px 10px", maxWidth: 240 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#26281f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
                        {sub && <div style={{ fontSize: 10.5, color: "#a89f8f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{sub}</div>}
                      </td>
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#5c5850", whiteSpace: "nowrap" }}>{row.market || "—"}</td>
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#383a37", fontWeight: 500, whiteSpace: "nowrap" }}>{fmtDate(row.saleDate)}</td>
                      <td style={{ padding: "9px 10px", fontSize: 12, color: row.capRate != null ? "#26281f" : "#c9c2b8", fontWeight: row.capRate != null ? 600 : 400, whiteSpace: "nowrap" }}>
                        {fmtCapRate(row.capRate)}
                      </td>
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#383a37", whiteSpace: "nowrap" }}>{fmtPsf(row.pricePerSf)}</td>
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#383a37", whiteSpace: "nowrap" }}>{fmtM(row.salePrice)}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{fmtSf(row.sf)}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{fmtPct(row.occupancy)}</td>
                      <td style={{ padding: "9px 10px" }}>
                        {row.sourceDealName ? (
                          onOpenDeal ? (
                            <button
                              onClick={() => onOpenDeal(row.sourceDealId)}
                              style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
                            >
                              <div style={{ fontSize: 11, color: "#6dba43", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{row.sourceDealName}</div>
                            </button>
                          ) : (
                            <div style={{ fontSize: 11, color: "#7d766a", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{row.sourceDealName}</div>
                          )
                        ) : (
                          <div style={{ fontSize: 11, color: "#c9c2b8" }}>—</div>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
