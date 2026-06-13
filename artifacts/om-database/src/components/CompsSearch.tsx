import { useState, useEffect, useCallback, useRef, useMemo, Fragment } from "react";
import { EyeOff } from "lucide-react";
import { exportCompsToExcel } from "../lib/exportExcel";
import { extractAnyFile, isPdf, isSpreadsheet } from "../lib/fileExtract";
import { extractCompsFromText } from "../lib/compsImport";
import { stickyFirstCol } from "../lib/stickyCol";

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
  state: string | null;
  saleDateRaw: string | null;
  saleDate: string | null;
  salePrice: number | null;
  capRate: number | null;
  pricePerSf: number | null;
  sf: number | null;
  occupancy: number | null;
  isManual: boolean;
  isOwnTransaction: boolean;
  txnKind: string | null;
  anchor: string | null;
  propertyType: string | null;
  sourceNotes: string | null;
  buyer: string | null;
  seller: string | null;
}

type SortKey =
  | "date_desc" | "date_asc"
  | "cap_rate_asc" | "cap_rate_desc"
  | "price_per_sf_asc" | "price_per_sf_desc"
  | "sale_price_desc" | "sale_price_asc"
  | "name_asc" | "name_desc"
  | "market_asc" | "market_desc"
  | "state_asc" | "state_desc"
  | "sf_asc" | "sf_desc"
  | "occ_asc" | "occ_desc"
  | "anchor_asc" | "anchor_desc"
  | "type_asc" | "type_desc"
  | "buyer_asc" | "buyer_desc"
  | "seller_asc" | "seller_desc";

interface Filters {
  q: string;
  market: string;
  dateFrom: string;
  dateTo: string;
  capRateMin: string;
  capRateMax: string;
}

interface ManualForm {
  name: string;
  market: string;
  saleDate: string;
  salePrice: string;
  address: string;
  sf: string;
  capRate: string;
  occupancy: string;
  anchor: string;
  propertyType: string;
  sourceNotes: string;
  state: string;
  buyer: string;
  seller: string;
}

const EMPTY_FORM: ManualForm = {
  name: "", market: "", saleDate: "", salePrice: "",
  address: "", sf: "", capRate: "", occupancy: "",
  anchor: "", propertyType: "", sourceNotes: "",
  state: "", buyer: "", seller: "",
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtDate(s: string | null): string {
  if (!s) return "—";
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

// Strip a trailing state from a "City, ST" market string so the City column
// doesn't repeat the separate State column (e.g. "Kokomo, IN" + state "IN" -> "Kokomo").
function cityOnly(market: string | null, state: string | null): string {
  if (!market) return "—";
  const m = market.trim();
  if (!state) {
    // No separate state value — still trim a trailing 2-letter state code.
    return m.replace(/,\s*[A-Za-z]{2}\.?$/, "").trim() || m;
  }
  const st = state.trim();
  const re = new RegExp(`,\\s*${st.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?$`, "i");
  const stripped = m.replace(re, "").trim();
  return stripped || m;
}

function buildQuery(filters: Filters, sort: SortKey): string {
  const p = new URLSearchParams();
  if (filters.q.trim()) p.set("q", filters.q.trim());
  if (filters.market.trim()) p.set("market", filters.market.trim());
  if (filters.dateFrom) p.set("dateFrom", filters.dateFrom);
  if (filters.dateTo) p.set("dateTo", filters.dateTo);
  if (filters.capRateMin) p.set("capRateMin", filters.capRateMin);
  if (filters.capRateMax) p.set("capRateMax", filters.capRateMax);
  p.set("sort", sort);
  return `/api/comps?${p.toString()}`;
}

const EMPTY_FILTERS: Filters = { q: "", market: "", dateFrom: "", dateTo: "", capRateMin: "", capRateMax: "" };

// ---------------------------------------------------------------------------
// Duplicate-detection helpers (module-level, pure)
// ---------------------------------------------------------------------------
function normComp(s: string | null | undefined): string {
  if (!s) return "";
  return s.toLowerCase().replace(/[^a-z0-9]/g, " ").replace(/\s+/g, " ").trim();
}
function daysBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  if (!a || !b) return null;
  const da = Date.parse(a), db = Date.parse(b);
  if (isNaN(da) || isNaN(db)) return null;
  return Math.abs(da - db) / 86_400_000;
}
function withinPct(a: number | null, b: number | null, pct: number): boolean {
  if (a == null || b == null || a === 0 || b === 0) return false;
  return Math.abs(a - b) / Math.min(Math.abs(a), Math.abs(b)) <= pct / 100;
}
type DupInfo = {
  clusterId: number; otherNames: string[]; reasons: string[];
  betterSourceExists: boolean; bestTierName: string;
};
function fmtVolume(v: number): string {
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${Math.round(v / 1e6)}M`;
  return `$${Math.round(v).toLocaleString()}`;
}

// ---------------------------------------------------------------------------
// Sort header cell
// ---------------------------------------------------------------------------
function SortTh({
  label, sortKey, current, onSort, style, className,
}: {
  label: string;
  sortKey: SortKey;
  current: SortKey;
  onSort: (k: SortKey) => void;
  style?: React.CSSProperties;
  className?: string;
}) {
  const active = current === sortKey;
  const isDesc = sortKey.endsWith("_desc");
  const toggle: SortKey = active
    ? (isDesc ? (sortKey.replace("_desc", "_asc") as SortKey) : (sortKey.replace("_asc", "_desc") as SortKey))
    : sortKey;
  return (
    <th
      onClick={() => onSort(toggle)}
      className={className}
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
// Truncating cell with expand toggle
// ---------------------------------------------------------------------------
function TruncCell({ text, isExpanded, onToggle, maxWidth = 200, color = "#5c5850", fontSize = 11 }: {
  text: string;
  isExpanded: boolean;
  onToggle: () => void;
  maxWidth?: number;
  color?: string;
  fontSize?: number;
}) {
  const showChevron = text.length > 38;
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 3 }}>
      <span style={{
        fontSize, color,
        ...(isExpanded
          ? { wordBreak: "break-word" as const }
          : { whiteSpace: "nowrap" as const, overflow: "hidden", textOverflow: "ellipsis", maxWidth }),
      }}>
        {text}
      </span>
      {showChevron && (
        <button
          onClick={e => { e.stopPropagation(); onToggle(); }}
          style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, color: "#c9c2b8", fontSize: 9, flexShrink: 0, lineHeight: "15px" }}
          title={isExpanded ? "Collapse" : "Expand"}
        >
          {isExpanded ? "▾" : "▸"}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Add Comp Modal
// ---------------------------------------------------------------------------
function AddCompModal({
  onClose, onSaved, editRow, onUpdated, onOmUpdated,
}: {
  onClose: () => void;
  onSaved: (row: CompRow) => void;
  editRow?: CompRow;
  onUpdated?: (row: CompRow) => void;
  onOmUpdated?: () => void;
}) {
  const isEdit = !!editRow;
  // OM-sourced comp (not manual, not an own KPR transaction): edits flow to the
  // parent deal's comparableSales via the /api/comps/om endpoint.
  const isOm = isEdit && !editRow.isManual && !editRow.isOwnTransaction;
  const [form, setForm] = useState<ManualForm>(isEdit ? {
    name:         editRow.name         ?? "",
    market:       editRow.market       ?? "",
    saleDate:     editRow.saleDate     ?? "",
    salePrice:    editRow.salePrice    != null ? String(editRow.salePrice) : "",
    address:      editRow.address      ?? "",
    sf:           editRow.sf           != null ? String(editRow.sf)        : "",
    capRate:      editRow.capRate      != null ? String(editRow.capRate)   : "",
    occupancy:    editRow.occupancy    != null ? String(editRow.occupancy) : "",
    anchor:       editRow.anchor       ?? "",
    propertyType: editRow.propertyType ?? "",
    sourceNotes:  editRow.sourceNotes  ?? "",
    state:        editRow.state        ?? "",
    buyer:        editRow.buyer        ?? "",
    seller:       editRow.seller       ?? "",
  } : EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof ManualForm, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    // OM comps can legitimately have a blank name/market/date — only price is required.
    if (!isOm && !form.name.trim()) { setErr("Property Name is required."); return; }
    if (!isOm && !form.market.trim()) { setErr("Market / City is required."); return; }
    if (!isOm && !form.saleDate) { setErr("Sale Date is required."); return; }
    if (!form.salePrice.trim()) { setErr("Sale Price is required."); return; }
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        name:         form.name.trim(),
        market:       form.market.trim(),
        saleDate:     form.saleDate,
        salePrice:    parseFloat(form.salePrice.replace(/,/g, "")),
        address:      form.address.trim()      || null,
        sf:           form.sf.trim()           ? parseFloat(form.sf.replace(/,/g, ""))  : null,
        capRate:      form.capRate.trim()      ? parseFloat(form.capRate)               : null,
        occupancy:    form.occupancy.trim()    ? parseFloat(form.occupancy)             : null,
        anchor:       form.anchor.trim()       || null,
        propertyType: form.propertyType.trim() || null,
        sourceNotes:  form.sourceNotes.trim()  || null,
        state:        form.state.trim()        || null,
        buyer:        form.buyer.trim()        || null,
        seller:       form.seller.trim()       || null,
      };

      if (isOm) {
        const r = await fetch(`/api/comps/om/${editRow.id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({})) as { error?: string };
          throw new Error(e.error || `HTTP ${r.status}`);
        }
        // Rebuild reassigns row ids for the source deal — refetch the full list.
        onOmUpdated?.();
      } else if (isEdit) {
        const r = await fetch(`/api/comps/manual/${editRow.id}`, {
          method: "PUT",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({})) as { error?: string };
          throw new Error(e.error || `HTTP ${r.status}`);
        }
        const updated = await r.json() as CompRow;
        onUpdated?.(updated);
      } else {
        const r = await fetch("/api/comps/manual", {
          method: "POST",
          credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!r.ok) {
          const e = await r.json().catch(() => ({})) as { error?: string };
          throw new Error(e.error || `HTTP ${r.status}`);
        }
        const inserted = await r.json() as CompRow;
        onSaved(inserted);
      }
      onClose();
    } catch (e: unknown) {
      setErr(e instanceof Error ? e.message : "Failed to save comp");
      setSaving(false);
    }
  };

  const inp: React.CSSProperties = {
    display: "block", width: "100%", fontSize: 13, padding: "7px 10px",
    border: "1px solid #e3dccd", borderRadius: 6, color: "#383a37",
    background: "#fafaf8", fontFamily: "'Inter',sans-serif", boxSizing: "border-box",
  };
  const label = (text: string, required = false) => (
    <div style={{ fontSize: 10, color: "#a69e91", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 3 }}>
      {text}{required && <span style={{ color: "#dc2626", marginLeft: 2 }}>*</span>}
    </div>
  );

  return (
    <div style={{
      position: "fixed", inset: 0, zIndex: 600, background: "rgba(56,58,55,0.45)",
      display: "flex", alignItems: "center", justifyContent: "center", padding: 20,
    }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div style={{
        background: "#fff", borderRadius: 14, width: "100%", maxWidth: 520,
        boxShadow: "0 24px 64px rgba(0,0,0,0.22)", overflow: "hidden",
        maxHeight: "90vh", display: "flex", flexDirection: "column",
      }}>
        {/* Header */}
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #f0e9da", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#26281f" }}>{isOm ? "Edit OM-Sourced Comp" : isEdit ? "Edit Comp" : "Add Manual Comp"}</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18, color: "#a89f8f", lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", padding: "18px 22px", flex: 1 }}>
          {isOm && (
            <div style={{
              fontSize: 11.5, color: "#7d6a3a", background: "#fdf8ec", border: "1px solid #f0e3c4",
              borderRadius: 6, padding: "8px 11px", marginBottom: 16, lineHeight: 1.45,
            }}>
              This comp was extracted from an OM. Your edits update the source deal’s
              comparable-sales data, so they’ll stick through future rebuilds.
            </div>
          )}
          {/* Required */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginBottom: 12 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              {label("Property Name", true)}
              <input style={inp} value={form.name} onChange={e => set("name", e.target.value)} placeholder="e.g. Gateway Plaza" />
            </div>
            <div>
              {label("Market / City", true)}
              <input style={inp} value={form.market} onChange={e => set("market", e.target.value)} placeholder="e.g. Chicago, IL" />
            </div>
            <div>
              {label("Sale Date", true)}
              <input type="date" style={inp} value={form.saleDate} onChange={e => set("saleDate", e.target.value)} />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              {label("Sale Price ($)", true)}
              <input style={inp} inputMode="numeric" value={form.salePrice} onChange={e => set("salePrice", e.target.value)} placeholder="e.g. 28000000" />
            </div>
          </div>

          {/* Optional separator */}
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 12 }}>
            <div style={{ flex: 1, height: 1, background: "#f0e9da" }} />
            <span style={{ fontSize: 10, color: "#b5ab9c", fontWeight: 600, letterSpacing: "0.06em", textTransform: "uppercase" }}>Optional</span>
            <div style={{ flex: 1, height: 1, background: "#f0e9da" }} />
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <div style={{ gridColumn: "1 / -1" }}>
              {label("Address")}
              <input style={inp} value={form.address} onChange={e => set("address", e.target.value)} placeholder="Street address" />
            </div>
            <div>
              {label("GLA / SF")}
              <input style={inp} inputMode="numeric" value={form.sf} onChange={e => set("sf", e.target.value)} placeholder="e.g. 125000" />
            </div>
            <div>
              {label("Cap Rate (%)")}
              <input style={inp} inputMode="decimal" value={form.capRate} onChange={e => set("capRate", e.target.value)} placeholder="e.g. 7.50" />
            </div>
            <div>
              {label("Occupancy at Sale (%)")}
              <input style={inp} inputMode="decimal" value={form.occupancy} onChange={e => set("occupancy", e.target.value)} placeholder="e.g. 95" />
            </div>
            {/* Fields below aren't carried on OM-sourced comps — hide them when editing one. */}
            {!isOm && (
              <div>
                {label("Anchor Tenant(s)")}
                <input style={inp} value={form.anchor} onChange={e => set("anchor", e.target.value)} placeholder="e.g. Kroger" />
              </div>
            )}
            {!isOm && (
              <div>
                {label("Property Type")}
                <input style={inp} value={form.propertyType} onChange={e => set("propertyType", e.target.value)} placeholder="e.g. Grocery-Anchored" />
              </div>
            )}
            <div>
              {label("State (e.g. IL, TX)")}
              <input style={inp} value={form.state} onChange={e => set("state", e.target.value)} placeholder="e.g. IL" />
            </div>
            {!isOm && <div>{/* spacer */}</div>}
            {!isOm && (
              <div>
                {label("Buyer")}
                <input style={inp} value={form.buyer} onChange={e => set("buyer", e.target.value)} placeholder="e.g. Inland Real Estate" />
              </div>
            )}
            {!isOm && (
              <div>
                {label("Seller")}
                <input style={inp} value={form.seller} onChange={e => set("seller", e.target.value)} placeholder="e.g. Regency Centers" />
              </div>
            )}
            {!isOm && (
              <div style={{ gridColumn: "1 / -1" }}>
                {label("Source / Notes")}
                <input style={inp} value={form.sourceNotes} onChange={e => set("sourceNotes", e.target.value)} placeholder="e.g. CoStar, Broker" />
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: "14px 22px 18px", borderTop: "1px solid #f0e9da" }}>
          {err && (
            <div style={{ fontSize: 12, color: "#b91c1c", background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 6, padding: "7px 10px", marginBottom: 10 }}>
              {err}
            </div>
          )}
          <div style={{ display: "flex", gap: 9, justifyContent: "flex-end" }}>
            <button onClick={onClose} disabled={saving}
              style={{ padding: "8px 16px", borderRadius: 7, border: "1px solid #e3dccd", background: "#fff", color: "#7d766a", fontSize: 12, fontFamily: "'Inter',sans-serif", cursor: "pointer" }}>
              Cancel
            </button>
            <button onClick={handleSave} disabled={saving}
              style={{ padding: "8px 18px", borderRadius: 7, border: "none", background: saving ? "#a8d98a" : "#6dba43", color: "#fff", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif", cursor: saving ? "default" : "pointer" }}>
              {saving ? "Saving…" : isEdit ? "Save Changes" : "Save Comp"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------
export default function CompsSearch({ onOpenDeal }: { onOpenDeal?: (id: string) => void }) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [sort, setSort] = useState<SortKey>("date_desc");
  const [rows, setRows] = useState<CompRow[]>([]);
  // Client-side multi-select state filter (the full list is already fetched).
  // State filter — persisted to localStorage so it survives a refresh.
  const [selectedStates, setSelectedStatesRaw] = useState<string[]>(() => {
    try { const s = localStorage.getItem("cs-selected-states"); return s ? JSON.parse(s) as string[] : []; }
    catch { return []; }
  });
  const setSelectedStates: typeof setSelectedStatesRaw = (v) => {
    setSelectedStatesRaw(prev => {
      const next = typeof v === "function" ? (v as (p: string[]) => string[])(prev) : v;
      try { localStorage.setItem("cs-selected-states", JSON.stringify(next)); } catch {}
      return next;
    });
  };
  const [stateMenuOpen, setStateMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());
  const [pendingImport, setPendingImport] = useState<unknown[] | null>(null);
  const [editRow, setEditRow] = useState<CompRow | null>(null);
  const [showDupsOnly, setShowDupsOnly] = useState(false);
  const importRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Clear any pending debounced fetch on unmount so it can't fire setState after
  // the component is gone (avoids the React unmounted-setState warning / wasted work).
  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

  // Per-row hide/ignore — persisted to localStorage
  const [ignoredComps, setIgnoredComps] = useState<Set<number>>(() => {
    try {
      const s = localStorage.getItem("cs-ignored-comps");
      return s ? new Set<number>(JSON.parse(s) as number[]) : new Set<number>();
    } catch { return new Set<number>(); }
  });
  const toggleIgnoreComp = useCallback((id: number) => {
    setIgnoredComps(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      try { localStorage.setItem("cs-ignored-comps", JSON.stringify([...next])); } catch {}
      return next;
    });
  }, []);

  const toggleCell = useCallback((rowId: number, col: string) => {
    setExpandedCells(prev => {
      const next = new Set(prev);
      const key = `${rowId}:${col}`;
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const fetch_ = useCallback((f: Filters, s: SortKey) => {
    setLoading(true);
    setError(null);
    fetch(buildQuery(f, s), { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<CompRow[]>; })
      .then(d => { setRows(d); setLoading(false); })
      .catch(e => { setError((e as Error).message); setLoading(false); });
  }, []);

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

  const handleDelete = async (row: CompRow) => {
    const isOm = !row.isManual && !row.isOwnTransaction;
    if (isOm && !window.confirm("Delete this OM-sourced comp? It will be removed from the deal's comparable-sales data.")) return;
    try {
      const endpoint = isOm ? `/api/comps/om/${row.id}` : `/api/comps/manual/${row.id}`;
      const r = await fetch(endpoint, { method: "DELETE", credentials: "include" });
      if (!r.ok) {
        const e = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(e.error || `HTTP ${r.status}`);
      }
      if (isOm) {
        // Rebuild reassigns row ids for the source deal — refetch the full list.
        fetch_(filters, sort);
      } else {
        setRows(prev => prev.filter(rw => rw.id !== row.id));
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to delete comp.");
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImportMsg(null);
    try {
      if (isSpreadsheet(file) || isPdf(file)) {
        // Excel / CSV / PDF → read to text, then AI-map rows into comp objects.
        setImportMsg({ ok: true, text: `Reading ${isPdf(file) ? "PDF" : "spreadsheet"} & extracting comps…` });
        const { text } = await extractAnyFile(file);
        const comps = await extractCompsFromText(text, isPdf(file) ? "a PDF comps sheet" : "a spreadsheet");
        setImportMsg(null);
        setPendingImport(comps as unknown[]);
        return;
      }
      // JSON
      const text = await file.text();
      const parsed = JSON.parse(text);
      const arr: unknown[] = Array.isArray(parsed) ? parsed : (parsed?.comps ?? null);
      if (!Array.isArray(arr)) throw new Error("Expected an array or { comps: [...] }");
      setPendingImport(arr);
    } catch (err) {
      setImportMsg({ ok: false, text: err instanceof Error ? err.message : "Import failed" });
    }
  };

  const doImport = async (arr: unknown[]) => {
    setPendingImport(null);
    try {
      const r = await fetch("/api/comps/manual/bulk", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(arr),
      });
      const data = await r.json() as { ok?: boolean; inserted?: number; skipped?: number; duplicates?: number; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Server error");
      const parts: string[] = [`Imported ${data.inserted} comp${data.inserted !== 1 ? "s" : ""}`];
      if (data.duplicates) parts.push(`${data.duplicates} duplicate${data.duplicates !== 1 ? "s" : ""} skipped`);
      if (data.skipped) parts.push(`${data.skipped} skipped`);
      setImportMsg({ ok: true, text: parts.join(", ") });
      setTimeout(() => setImportMsg(null), 5000);
      fetch_(filters, sort);
    } catch (err) {
      setImportMsg({ ok: false, text: err instanceof Error ? err.message : "Import failed" });
    }
  };

  const hasFilters = Object.values(filters).some(v => v.trim() !== "") || selectedStates.length > 0;

  // Determine if optional columns should show (only when data present)
  const hasAnchor  = rows.some(r => r.anchor);
  const hasType    = rows.some(r => r.propertyType);
  const hasState   = rows.some(r => r.state);
  const hasBuyer   = rows.some(r => r.buyer);
  const hasSeller  = rows.some(r => r.seller);
  const colCount   = 9  // Property, City, Sale Date, Price, Cap, SF, Price PSF, Occupancy, Actions
    + (hasAnchor ? 1 : 0) + (hasType ? 1 : 0)
    + (hasState ? 1 : 0) + (hasBuyer ? 1 : 0) + (hasSeller ? 1 : 0);

  const dupMap = useMemo<Map<number, DupInfo>>(() => {
    const tierOf = (r: CompRow) => r.isOwnTransaction ? 2 : r.isManual ? 1 : 0;
    const edges: { a: number; b: number; reasons: string[] }[] = [];

    for (let i = 0; i < rows.length; i++) {
      for (let j = i + 1; j < rows.length; j++) {
        const a = rows[i], b = rows[j];
        const reasons: string[] = [];
        const na = normComp(a.name), nb = normComp(b.name);
        if (na && na === nb) {
          const pOk = withinPct(a.salePrice, b.salePrice, 2);
          const days = daysBetween(a.saleDate, b.saleDate);
          const dOk = days != null && days <= 90;
          if (pOk && dOk) reasons.push("same name, price & date");
          else if (pOk)   reasons.push("same name & ~price");
          else if (dOk)   reasons.push("same name & ~date");
        }
        if (reasons.length === 0 && a.state && b.state &&
            a.state.toLowerCase() === b.state.toLowerCase() &&
            withinPct(a.salePrice, b.salePrice, 1)) {
          const days = daysBetween(a.saleDate, b.saleDate);
          if (days != null && days <= 45) reasons.push("same price & date");
        }
        if (reasons.length === 0) {
          const aa = normComp(a.address), ab = normComp(b.address);
          if (aa && aa === ab) reasons.push("same address");
        }
        if (reasons.length > 0) edges.push({ a: a.id, b: b.id, reasons });
      }
    }
    if (edges.length === 0) return new Map();

    const par = new Map<number, number>();
    const find = (x: number): number => {
      if (!par.has(x)) par.set(x, x);
      const p = par.get(x)!;
      if (p === x) return x;
      const root = find(p); par.set(x, root); return root;
    };
    for (const { a, b } of edges) par.set(find(a), find(b));

    const rowById = new Map(rows.map(r => [r.id, r]));
    const flagged = new Set(edges.flatMap(e => [e.a, e.b]));
    const clusters = new Map<number, number[]>();
    for (const id of flagged) {
      const root = find(id);
      if (!clusters.has(root)) clusters.set(root, []);
      clusters.get(root)!.push(id);
    }

    const result = new Map<number, DupInfo>();
    let cid = 0;
    for (const [, members] of clusters) {
      if (members.length < 2) continue;
      const thisCid = cid++;
      const mRows = members.map(id => rowById.get(id)).filter((r): r is CompRow => !!r);
      const maxTier = Math.max(...mRows.map(tierOf));
      const bestTierName = maxTier === 2 ? "OWNED" : "Manual";
      for (const row of mRows) {
        const others = mRows.filter(m => m.id !== row.id);
        const myEdges = edges.filter(e => e.a === row.id || e.b === row.id);
        const reasons = [...new Set(myEdges.flatMap(e => e.reasons))];
        result.set(row.id, {
          clusterId: thisCid,
          otherNames: others.map(m => m.name || m.address || "Unknown"),
          reasons,
          betterSourceExists: maxTier > tierOf(row),
          bestTierName,
        });
      }
    }
    return result;
  }, [rows]);

  // States present in the data, for the multi-select dropdown options.
  const availableStates = useMemo(
    () => Array.from(new Set(rows.map(r => (r.state || "").trim().toUpperCase()).filter(Boolean))).sort(),
    [rows]
  );

  const displayRows = useMemo(() => {
    const stateSet = selectedStates.length ? new Set(selectedStates) : null;
    const stateFilter = (r: CompRow) => !stateSet || stateSet.has((r.state || "").trim().toUpperCase());
    if (!showDupsOnly) return rows.filter(stateFilter);
    const tierOf = (r: CompRow) => r.isOwnTransaction ? 2 : r.isManual ? 1 : 0;
    return rows
      .filter(r => dupMap.has(r.id) && stateFilter(r))
      .sort((a, b) => {
        const ca = dupMap.get(a.id)!.clusterId, cb = dupMap.get(b.id)!.clusterId;
        if (ca !== cb) return ca - cb;
        return tierOf(b) - tierOf(a);
      });
  }, [rows, dupMap, showDupsOnly, selectedStates]);

  // Tile stats — derived from displayRows minus hidden rows (client-side, filter-aware)
  const activeTileStats = useMemo(() => {
    const active = displayRows.filter(r => !ignoredComps.has(r.id));
    const hiddenCount = displayRows.filter(r => ignoredComps.has(r.id)).length;
    const totalVolume = active.reduce((sum, r) => sum + (r.salePrice != null && r.salePrice > 0 ? r.salePrice : 0), 0);
    const stateSet = new Set(active.map(r => r.state).filter((s): s is string => !!s));
    const years = active
      .map(r => r.saleDate?.slice(0, 4))
      .filter((y): y is string => !!y)
      .map(Number)
      .filter(n => !isNaN(n));
    const minY = years.length ? Math.min(...years) : null;
    const maxY = years.length ? Math.max(...years) : null;
    const span = minY == null ? "—" : minY === maxY ? String(minY) : `${minY}–${maxY}`;
    return { count: active.length, totalVolume, states: stateSet.size, span, hiddenCount };
  }, [displayRows, ignoredComps]);

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
      {(addOpen || editRow) && (
        <AddCompModal
          onClose={() => { setAddOpen(false); setEditRow(null); }}
          onSaved={row => { setRows(prev => [row, ...prev]); }}
          editRow={editRow ?? undefined}
          onUpdated={updated => { setRows(prev => prev.map(r => r.id === updated.id ? updated : r)); }}
          onOmUpdated={() => { fetch_(filters, sort); }}
        />
      )}
      {pendingImport && (
        <div style={{
          position: "fixed", inset: 0, background: "rgba(36,35,30,0.45)",
          display: "flex", alignItems: "center", justifyContent: "center", zIndex: 300,
        }}>
          <div style={{
            background: "#fff", borderRadius: 14, padding: "28px 32px",
            boxShadow: "0 8px 40px rgba(0,0,0,0.18)", maxWidth: 380, width: "90%",
            fontFamily: "'Inter',sans-serif",
          }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#26281f", marginBottom: 8 }}>
              Import {pendingImport.length} comp{pendingImport.length !== 1 ? "s" : ""}
            </div>
            <div style={{ fontSize: 13, color: "#5c5850", marginBottom: 22, lineHeight: 1.5 }}>
              These will be added to your comp database. Any that duplicate a comp already
              in the database (or each other) are skipped automatically — nothing is ever
              replaced or deleted.
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <button
                onClick={() => doImport(pendingImport)}
                style={{
                  flex: 1, padding: "9px 0", borderRadius: 8, border: "none",
                  background: "#6dba43", color: "#fff", fontSize: 13, fontWeight: 600,
                  cursor: "pointer", fontFamily: "'Inter',sans-serif",
                }}
              >
                Import {pendingImport.length} comp{pendingImport.length !== 1 ? "s" : ""}
              </button>
              <button
                onClick={() => setPendingImport(null)}
                style={{
                  padding: "9px 14px", borderRadius: 8, border: "1px solid #e7e0d2",
                  background: "transparent", color: "#a89f8f", fontSize: 13,
                  cursor: "pointer", fontFamily: "'Inter',sans-serif",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
      <input
        ref={importRef}
        type="file"
        accept=".json,.xlsx,.xls,.xlsm,.xlsb,.csv,.pdf,application/pdf"
        style={{ display: "none" }}
        onChange={handleImportFile}
      />

      {/* Header row */}
      <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", marginBottom: 16 }}>
        <div>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 21, fontWeight: 500, color: "#26281f", letterSpacing: "-0.02em" }}>
            Comp Sales Database
          </div>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 3 }}>
            {loading ? "Loading…" : `${displayRows.length} comp${displayRows.length !== 1 ? "s" : ""}${hasFilters ? " matching filters" : " in index"}`}
          </div>
          {importMsg && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: importMsg.ok ? "#6dba43" : "#c0392b", fontFamily: "'Inter',sans-serif" }}>
              {importMsg.ok ? "✓ " : "⚠ "}{importMsg.text}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {dupMap.size > 0 && (
            <button
              onClick={() => setShowDupsOnly(v => !v)}
              style={{
                background: showDupsOnly ? "#fff8ec" : "transparent",
                border: `1px solid ${showDupsOnly ? "#d9890c" : "#e8d9a0"}`,
                color: "#d9890c", padding: "6px 12px", borderRadius: 7,
                cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif",
                fontWeight: showDupsOnly ? 600 : 400,
              }}
            >
              ⚠ Possible duplicates ({dupMap.size})
            </button>
          )}
          {hasFilters && (
            <button
              onClick={() => { setFilters(EMPTY_FILTERS); setSelectedStates([]); fetch_(EMPTY_FILTERS, sort); }}
              style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#a89f8f", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif" }}
            >
              Clear filters
            </button>
          )}
          <button
            onClick={() => exportCompsToExcel(rows)}
            disabled={rows.length === 0}
            style={{
              background: "transparent", border: "1px solid #c8ddb5",
              color: rows.length === 0 ? "#c9c2b8" : "#5a9c30",
              padding: "7px 14px", borderRadius: 7, cursor: rows.length === 0 ? "default" : "pointer",
              fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif",
              letterSpacing: "-0.01em",
            }}
          >
            ↓ Excel
          </button>
          <button
            onClick={() => importRef.current?.click()}
            style={{
              background: "transparent", border: "1px solid #6dba43", color: "#6dba43",
              padding: "7px 14px", borderRadius: 7, cursor: "pointer",
              fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif",
              letterSpacing: "-0.01em",
            }}
            title="Import comps from JSON, Excel/CSV, or a PDF comps sheet"
          >
            ↑ Import file
          </button>
          <button
            onClick={() => setAddOpen(true)}
            style={{
              background: "#6dba43", border: "none", color: "#fff",
              padding: "7px 14px", borderRadius: 7, cursor: "pointer",
              fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif",
              letterSpacing: "-0.01em",
            }}
          >
            + Add Comp
          </button>
        </div>
      </div>

      {/* Stats banner — client-computed from active (filtered + visible) rows */}
      {(() => {
        const items = [
          { label: "Comps",        value: activeTileStats.count.toLocaleString(),    sub: activeTileStats.hiddenCount > 0 ? `${activeTileStats.hiddenCount} hidden` : null, accent: false },
          { label: "Total Volume", value: fmtVolume(activeTileStats.totalVolume),    sub: null, accent: true  },
          { label: "States",       value: String(activeTileStats.states),            sub: null, accent: false },
          { label: "Span",         value: activeTileStats.span,                      sub: null, accent: false },
        ];
        return (
          <div style={{
            background: "#fff", border: "1px solid #efe8da", borderRadius: 10,
            padding: "11px 18px", marginBottom: 14,
            display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(90px, 1fr))", alignItems: "center",
          }}>
            {items.map((item, i) => (
              <div key={i} style={{
                display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
                padding: "3px 8px",
                borderRight: i < items.length - 1 ? "1px solid #f0e9da" : "none",
              }}>
                <span style={{ fontSize: 9.5, letterSpacing: "0.08em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>
                  {item.label}
                </span>
                <span style={{ fontFamily: "'Fraunces',serif", fontSize: item.accent ? 22 : 18, fontWeight: 500, color: item.accent ? "#3f7a1f" : "#26281f", lineHeight: 1.1 }}>
                  {item.value}
                </span>
                {item.sub && (
                  <span style={{ fontSize: 10, color: "#a89f8f", fontFamily: "'Inter',sans-serif", marginTop: 1 }}>
                    {item.sub}
                  </span>
                )}
              </div>
            ))}
          </div>
        );
      })()}

      {/* Search */}
      <div style={{ marginBottom: 10 }}>
        <input
          type="text"
          placeholder="Search name, address, market, state, anchor, buyer, seller, notes…"
          value={filters.q}
          onChange={e => handleFilter({ q: e.target.value })}
          style={{
            width: "100%", height: 36, borderRadius: 8, border: "1px solid #ddd4c2",
            background: "#fff", padding: "0 14px", fontSize: 13,
            fontFamily: "'Inter',sans-serif", color: "#383a37", outline: "none",
            boxSizing: "border-box",
          }}
        />
      </div>

      {/* Filter bar */}
      <div style={{
        background: "#fff", border: "1px solid #ece5d7", borderRadius: 10, padding: "14px 16px",
        marginBottom: 16, display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(150px, 1fr))",
        width: "100%", boxSizing: "border-box",
        gap: 10, alignItems: "end",
      }}>
        <div>
          <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 5 }}>Market / MSA</div>
          {In("e.g. Chicago, MSA, Midwest…", "market")}
        </div>
        <div style={{ position: "relative" }}>
          <div style={{ fontSize: 9.5, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 5 }}>State</div>
          <button
            type="button"
            onClick={() => setStateMenuOpen(o => !o)}
            onBlur={() => setTimeout(() => setStateMenuOpen(false), 150)}
            style={{
              width: "100%", boxSizing: "border-box", textAlign: "left",
              padding: "8px 10px", fontSize: 13, borderRadius: 8,
              border: `1px solid ${selectedStates.length ? "#6dba43" : "#e0d8c8"}`,
              background: selectedStates.length ? "#f0fae8" : "#fff",
              color: selectedStates.length ? "#3f7a1f" : "#8b8578",
              fontWeight: selectedStates.length ? 600 : 400, cursor: "pointer",
              fontFamily: "'Inter',sans-serif", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 6,
            }}
          >
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
              {selectedStates.length === 0 ? "All states" : selectedStates.length === 1 ? selectedStates[0] : `${selectedStates.length} states`}
            </span>
            <span style={{ fontSize: 9, flexShrink: 0 }}>▾</span>
          </button>
          {stateMenuOpen && (
            <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 50, background: "#fff", border: "1px solid #e0d8c8", borderRadius: 8, boxShadow: "0 8px 24px rgba(56,58,55,0.15)", maxHeight: 240, overflowY: "auto" }}>
              {selectedStates.length > 0 && (
                <button type="button" onMouseDown={e => { e.preventDefault(); setSelectedStates([]); }}
                  style={{ width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 12, color: "#9a6a1e", background: "transparent", border: "none", borderBottom: "1px solid #f1eadc", cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                  Clear ({selectedStates.length})
                </button>
              )}
              {availableStates.length === 0 && <div style={{ padding: "10px 12px", fontSize: 12, color: "#a89f8f" }}>No states in data</div>}
              {availableStates.map(st => {
                const on = selectedStates.includes(st);
                return (
                  <button key={st} type="button"
                    onMouseDown={e => { e.preventDefault(); setSelectedStates(prev => on ? prev.filter(s => s !== st) : [...prev, st]); }}
                    style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", padding: "8px 12px", fontSize: 13, background: on ? "#f0fae8" : "transparent", border: "none", cursor: "pointer", fontFamily: "'Inter',sans-serif", color: "#383a37" }}>
                    <input type="checkbox" checked={on} readOnly style={{ pointerEvents: "none" }} />
                    {st}
                  </button>
                );
              })}
            </div>
          )}
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

      {/* Table — swipeable on all screen sizes */}
      {!error && (
        <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 12, overflow: "hidden" }}>
          <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
              <thead>
                <tr style={{ background: "#faf7f0", borderBottom: "1px solid #f1eadc" }}>
                  <SortTh label="Property" sortKey="name_asc"   current={sort} onSort={handleSort} className="freeze-col" style={{ minWidth: 180, ...stickyFirstCol("#faf7f0", true) }} />
                  <SortTh label="City"     sortKey="market_asc" current={sort} onSort={handleSort} style={{ minWidth: 100 }} />
                  {hasState   && <SortTh label="State"  sortKey="state_asc"  current={sort} onSort={handleSort} style={{ minWidth: 50 }} />}
                  <SortTh label="Sale Date"  sortKey="date_desc"          current={sort} onSort={handleSort} />
                  <SortTh label="Price"      sortKey="sale_price_desc"    current={sort} onSort={handleSort} />
                  <SortTh label="Cap Rate"   sortKey="cap_rate_asc"       current={sort} onSort={handleSort} />
                  {hasBuyer   && <SortTh label="Buyer"  sortKey="buyer_asc"  current={sort} onSort={handleSort} style={{ minWidth: 120 }} />}
                  {hasSeller  && <SortTh label="Seller" sortKey="seller_asc" current={sort} onSort={handleSort} style={{ minWidth: 120 }} />}
                  <SortTh label="SF"         sortKey="sf_desc"            current={sort} onSort={handleSort} style={{ textAlign: "right" }} />
                  <SortTh label="Price PSF"  sortKey="price_per_sf_asc"   current={sort} onSort={handleSort} />
                  <SortTh label="Occupancy"  sortKey="occ_desc"           current={sort} onSort={handleSort} style={{ textAlign: "right" }} />
                  {hasAnchor  && <SortTh label="Anchor" sortKey="anchor_asc" current={sort} onSort={handleSort} style={{ maxWidth: 220 }} />}
                  {hasType    && <SortTh label="Type"   sortKey="type_asc"   current={sort} onSort={handleSort} />}
                  <th className="freeze-col" style={{
                    padding: "9px 6px", width: 72,
                    position: "sticky", right: 0, zIndex: 3,
                    background: "#faf7f0",
                    borderLeft: "1px solid #efe8da",
                    boxShadow: "-6px 0 6px -6px rgba(0,0,0,0.12)",
                  }} />
                </tr>
              </thead>
              <tbody>
                {loading && (
                  <tr>
                    <td colSpan={colCount} style={{ padding: "40px 0", textAlign: "center", color: "#a89f8f", fontSize: 13 }}>
                      Loading…
                    </td>
                  </tr>
                )}
                {!loading && displayRows.length === 0 && (
                  <tr>
                    <td colSpan={colCount} style={{ padding: "48px 0", textAlign: "center" }}>
                      <div style={{ color: "#a89f8f", fontSize: 13 }}>
                        {showDupsOnly ? "No possible duplicates detected." : hasFilters ? "No comps match these filters." : "No comps in the index yet. Comps are extracted automatically from OM PDFs."}
                      </div>
                    </td>
                  </tr>
                )}
                {!loading && displayRows.map((row, idx) => {
                  const label = row.name || row.address || "—";
                  const sub = row.name ? row.address : null;
                  return (
                    <tr
                      key={row.id}
                      style={{
                        borderTop: idx === 0 ? "none" : "1px solid #f5f1ea",
                        background: row.isOwnTransaction ? "#f5fbf2" : row.isManual ? "#f8fbf5" : undefined,
                        opacity: ignoredComps.has(row.id) ? 0.35 : 1,
                        transition: "background 0.12s, opacity 0.15s",
                      }}
                      onMouseEnter={e => {
                        const bg = row.isOwnTransaction ? "#e8f5e3" : row.isManual ? "#eef7e8" : "#faf7f0";
                        e.currentTarget.style.background = bg;
                        (e.currentTarget.firstElementChild as HTMLElement).style.background = bg;
                        (e.currentTarget.lastElementChild as HTMLElement).style.background = bg;
                      }}
                      onMouseLeave={e => {
                        const bg = row.isOwnTransaction ? "#f5fbf2" : row.isManual ? "#f8fbf5" : "";
                        e.currentTarget.style.background = bg;
                        (e.currentTarget.firstElementChild as HTMLElement).style.background = bg || "#fff";
                        (e.currentTarget.lastElementChild as HTMLElement).style.background = bg || "#fff";
                      }}
                    >
                      <td className="freeze-col" style={{ padding: "9px 10px", maxWidth: 240, ...stickyFirstCol(row.isOwnTransaction ? "#f5fbf2" : row.isManual ? "#f8fbf5" : "#fff") }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#26281f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                          {row.isOwnTransaction ? (
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: "#3a7d44", background: "#d6f0da", border: "1px solid #a8d9b0", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap", flexShrink: 0 }}>
                              OWNED
                            </span>
                          ) : row.isManual && row.sourceDealId === "__upload__" ? (
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: "#7a6aa0", background: "#efeaf7", border: "1px solid #d4c9ec", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap", flexShrink: 0 }}>
                              UPLOAD
                            </span>
                          ) : row.isManual ? (
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: "#5a7c9e", background: "#e8f1f8", border: "1px solid #c3d9ec", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap", flexShrink: 0 }}>
                              MANUAL
                            </span>
                          ) : null}
                          {dupMap.has(row.id) && (() => {
                            const info = dupMap.get(row.id)!;
                            let tip = `Possible duplicate of: ${info.otherNames.join(", ")} — ${info.reasons.join(", ")}`;
                            if (info.betterSourceExists) tip += `\nHigher-quality ${info.bestTierName} version exists — consider deleting the lower-quality one.`;
                            return (
                              <span title={tip} style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: "#d9890c", background: "#fff8ec", border: "1px solid #f5c842", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap", flexShrink: 0, cursor: "default" }}>
                                ⚠ dup?
                              </span>
                            );
                          })()}
                        </div>
                        {sub && <div style={{ fontSize: 10.5, color: "#a89f8f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{sub}</div>}
                      </td>
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#5c5850", whiteSpace: "nowrap" }}>{hasState ? cityOnly(row.market, row.state) : (row.market || "—")}</td>
                      {hasState  && <td style={{ padding: "9px 10px", fontSize: 11, color: "#7d766a", whiteSpace: "nowrap" }}>{row.state || "—"}</td>}
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#383a37", fontWeight: 500, whiteSpace: "nowrap" }}>{fmtDate(row.saleDate)}</td>
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#383a37", whiteSpace: "nowrap" }}>{fmtM(row.salePrice)}</td>
                      <td style={{ padding: "9px 10px", fontSize: 12, color: row.capRate != null ? "#26281f" : "#c9c2b8", fontWeight: row.capRate != null ? 600 : 400, whiteSpace: "nowrap" }}>
                        {fmtCapRate(row.capRate)}
                      </td>
                      {hasBuyer  && <td style={{ padding: "9px 10px", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{row.buyer || "—"}</td>}
                      {hasSeller && <td style={{ padding: "9px 10px", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{row.seller || "—"}</td>}
                      <td style={{ padding: "9px 10px", textAlign: "right", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{fmtSf(row.sf)}</td>
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#383a37", whiteSpace: "nowrap" }}>{fmtPsf(row.pricePerSf)}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{fmtPct(row.occupancy)}</td>
                      {hasAnchor && (
                        <td style={{ padding: "9px 10px", maxWidth: 230 }}>
                          {row.anchor
                            ? <TruncCell text={row.anchor} isExpanded={expandedCells.has(`${row.id}:anchor`)} onToggle={() => toggleCell(row.id, "anchor")} maxWidth={210} />
                            : <span style={{ fontSize: 11, color: "#c9c2b8" }}>—</span>}
                        </td>
                      )}
                      {hasType   && <td style={{ padding: "9px 10px", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{row.propertyType || "—"}</td>}
                      <td className="freeze-col" style={{
                        padding: "9px 8px", whiteSpace: "nowrap",
                        position: "sticky", right: 0, zIndex: 2,
                        background: row.isOwnTransaction ? "#f5fbf2" : row.isManual ? "#f8fbf5" : "#fff",
                        borderLeft: "1px solid #efe8da",
                        boxShadow: "-6px 0 6px -6px rgba(0,0,0,0.10)",
                      }}>
                        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
                          <button
                            onClick={() => toggleIgnoreComp(row.id)}
                            title={ignoredComps.has(row.id) ? "Re-include in list" : "Hide from list"}
                            style={{
                              background: "transparent", border: "1px solid #e7ddd0", borderRadius: 4,
                              cursor: "pointer", padding: "3px 5px", display: "flex", alignItems: "center",
                              color: ignoredComps.has(row.id) ? "#d9890c" : "#c9c2b8",
                            }}
                          >
                            <EyeOff size={12} strokeWidth={1.75} />
                          </button>
                          {/* Own-transaction (OWNED) comps come from KPR underwriting — read-only.
                              Manual and OM-sourced comps can both be edited/deleted. */}
                          {!row.isOwnTransaction && (
                            <>
                              <button
                                onClick={() => setEditRow(row)}
                                title={row.isManual ? "Edit this comp" : "Edit this OM-sourced comp"}
                                style={{
                                  background: "transparent", border: "1px solid #e7ddd0", borderRadius: 4,
                                  cursor: "pointer", color: "#7d766a", fontSize: 10, padding: "2px 6px",
                                  fontFamily: "'Inter',sans-serif", lineHeight: 1.2,
                                }}
                              >
                                ✎
                              </button>
                              <button
                                onClick={() => handleDelete(row)}
                                title={row.isManual ? "Delete this comp" : "Delete this OM-sourced comp"}
                                style={{
                                  background: "transparent", border: "1px solid #e7ddd0", borderRadius: 4,
                                  cursor: "pointer", color: "#b05050", fontSize: 11, padding: "2px 6px",
                                  fontFamily: "'Inter',sans-serif", lineHeight: 1.2,
                                }}
                              >
                                ×
                              </button>
                            </>
                          )}
                        </div>
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
