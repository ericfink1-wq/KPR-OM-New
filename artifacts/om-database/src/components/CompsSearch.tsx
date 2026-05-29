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
}

const EMPTY_FORM: ManualForm = {
  name: "", market: "", saleDate: "", salePrice: "",
  address: "", sf: "", capRate: "", occupancy: "",
  anchor: "", propertyType: "", sourceNotes: "",
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
function AddCompModal({ onClose, onSaved }: { onClose: () => void; onSaved: (row: CompRow) => void }) {
  const [form, setForm] = useState<ManualForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const set = (k: keyof ManualForm, v: string) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { setErr("Property Name is required."); return; }
    if (!form.market.trim()) { setErr("Market / City is required."); return; }
    if (!form.saleDate) { setErr("Sale Date is required."); return; }
    if (!form.salePrice.trim()) { setErr("Sale Price is required."); return; }
    setSaving(true);
    setErr(null);
    try {
      const body: Record<string, unknown> = {
        name: form.name.trim(),
        market: form.market.trim(),
        saleDate: form.saleDate,
        salePrice: parseFloat(form.salePrice.replace(/,/g, "")),
      };
      if (form.address.trim()) body.address = form.address.trim();
      if (form.sf.trim()) body.sf = parseFloat(form.sf.replace(/,/g, ""));
      if (form.capRate.trim()) body.capRate = parseFloat(form.capRate);
      if (form.occupancy.trim()) body.occupancy = parseFloat(form.occupancy);
      if (form.anchor.trim()) body.anchor = form.anchor.trim();
      if (form.propertyType.trim()) body.propertyType = form.propertyType.trim();
      if (form.sourceNotes.trim()) body.sourceNotes = form.sourceNotes.trim();

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
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#26281f" }}>Add Manual Comp</div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", cursor: "pointer", fontSize: 18, color: "#a89f8f", lineHeight: 1, padding: 4 }}>×</button>
        </div>

        {/* Body */}
        <div style={{ overflowY: "auto", padding: "18px 22px", flex: 1 }}>
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
            <div>
              {label("Anchor Tenant(s)")}
              <input style={inp} value={form.anchor} onChange={e => set("anchor", e.target.value)} placeholder="e.g. Kroger" />
            </div>
            <div>
              {label("Property Type")}
              <input style={inp} value={form.propertyType} onChange={e => set("propertyType", e.target.value)} placeholder="e.g. Grocery-Anchored" />
            </div>
            <div style={{ gridColumn: "1 / -1" }}>
              {label("Source / Notes")}
              <input style={inp} value={form.sourceNotes} onChange={e => set("sourceNotes", e.target.value)} placeholder="e.g. CoStar, Broker" />
            </div>
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
              {saving ? "Saving…" : "Save Comp"}
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [expandedCells, setExpandedCells] = useState<Set<string>>(new Set());
  const importRef = useRef<HTMLInputElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const handleDelete = async (id: number) => {
    try {
      const r = await fetch(`/api/comps/manual/${id}`, { method: "DELETE", credentials: "include" });
      if (!r.ok) throw new Error();
      setRows(prev => prev.filter(row => row.id !== id));
    } catch {
      alert("Failed to delete comp.");
    }
  };

  const handleImportFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";
    setImportMsg(null);
    try {
      const text = await file.text();
      const parsed = JSON.parse(text);
      const arr: unknown[] = Array.isArray(parsed) ? parsed : (parsed?.comps ?? null);
      if (!Array.isArray(arr)) throw new Error("Expected an array or { comps: [...] }");
      const r = await fetch("/api/comps/manual/bulk", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(arr),
      });
      const data = await r.json() as { ok?: boolean; inserted?: number; skipped?: number; error?: string };
      if (!r.ok) throw new Error(data.error ?? "Server error");
      setImportMsg({ ok: true, text: `Imported ${data.inserted} comp${data.inserted !== 1 ? "s" : ""}${data.skipped ? ` (${data.skipped} skipped)` : ""}` });
      setTimeout(() => setImportMsg(null), 5000);
      fetch_(filters, sort);
    } catch (err) {
      setImportMsg({ ok: false, text: err instanceof Error ? err.message : "Import failed" });
    }
  };

  const hasFilters = Object.values(filters).some(v => v.trim() !== "");

  // Determine if optional columns should show (only when data present)
  const hasAnchor  = rows.some(r => r.anchor);
  const hasType    = rows.some(r => r.propertyType);
  const hasState   = rows.some(r => r.state);
  const hasBuyer   = rows.some(r => r.buyer);
  const hasSeller  = rows.some(r => r.seller);
  const colCount   = 9
    + (hasAnchor ? 1 : 0) + (hasType ? 1 : 0)
    + (hasState ? 1 : 0) + (hasBuyer ? 1 : 0) + (hasSeller ? 1 : 0);

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
      {addOpen && (
        <AddCompModal
          onClose={() => setAddOpen(false)}
          onSaved={row => setRows(prev => [row, ...prev])}
        />
      )}
      <input
        ref={importRef}
        type="file"
        accept=".json"
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
            {loading ? "Loading…" : `${rows.length} comp${rows.length !== 1 ? "s" : ""}${hasFilters ? " matching filters" : " in index"}`}
          </div>
          {importMsg && (
            <div style={{ marginTop: 6, fontSize: 11.5, color: importMsg.ok ? "#6dba43" : "#c0392b", fontFamily: "'Inter',sans-serif" }}>
              {importMsg.ok ? "✓ " : "⚠ "}{importMsg.text}
            </div>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {hasFilters && (
            <button
              onClick={() => { setFilters(EMPTY_FILTERS); fetch_(EMPTY_FILTERS, sort); }}
              style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#a89f8f", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif" }}
            >
              Clear filters
            </button>
          )}
          <button
            onClick={() => importRef.current?.click()}
            style={{
              background: "transparent", border: "1px solid #6dba43", color: "#6dba43",
              padding: "7px 14px", borderRadius: 7, cursor: "pointer",
              fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif",
              letterSpacing: "-0.01em",
            }}
          >
            ↑ Import JSON
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
                  <SortTh label="Property" sortKey="name_asc" current={sort} onSort={handleSort} style={{ minWidth: 180 }} />
                  <SortTh label="Market"   sortKey="market_asc" current={sort} onSort={handleSort} style={{ minWidth: 100 }} />
                  {hasState   && <SortTh label="State"  sortKey="state_asc"  current={sort} onSort={handleSort} style={{ minWidth: 50 }} />}
                  {hasAnchor  && <SortTh label="Anchor" sortKey="anchor_asc" current={sort} onSort={handleSort} style={{ maxWidth: 220 }} />}
                  {hasType    && <SortTh label="Type"   sortKey="type_asc"   current={sort} onSort={handleSort} />}
                  {hasBuyer   && <SortTh label="Buyer"  sortKey="buyer_asc"  current={sort} onSort={handleSort} style={{ minWidth: 120 }} />}
                  {hasSeller  && <SortTh label="Seller" sortKey="seller_asc" current={sort} onSort={handleSort} style={{ minWidth: 120 }} />}
                  <SortTh label="Sale Date"  sortKey="date_desc"          current={sort} onSort={handleSort} />
                  <SortTh label="Cap Rate"   sortKey="cap_rate_asc"       current={sort} onSort={handleSort} />
                  <SortTh label="Price/SF"   sortKey="price_per_sf_asc"   current={sort} onSort={handleSort} />
                  <SortTh label="Sale Price" sortKey="sale_price_desc"    current={sort} onSort={handleSort} />
                  <SortTh label="SF"         sortKey="sf_desc"            current={sort} onSort={handleSort} style={{ textAlign: "right" }} />
                  <SortTh label="Occ"        sortKey="occ_desc"           current={sort} onSort={handleSort} style={{ textAlign: "right" }} />
                  <th style={{ padding: "9px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: "#a89f8f", textTransform: "uppercase", minWidth: 120 }}>Source</th>
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
                {!loading && rows.length === 0 && (
                  <tr>
                    <td colSpan={colCount} style={{ padding: "48px 0", textAlign: "center" }}>
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
                        background: row.isOwnTransaction ? "#f5fbf2" : row.isManual ? "#f8fbf5" : undefined,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = row.isOwnTransaction ? "#e8f5e3" : row.isManual ? "#eef7e8" : "#faf7f0")}
                      onMouseLeave={e => (e.currentTarget.style.background = row.isOwnTransaction ? "#f5fbf2" : row.isManual ? "#f8fbf5" : "")}
                    >
                      <td style={{ padding: "9px 10px", maxWidth: 240 }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6, flexWrap: "nowrap" }}>
                          <span style={{ fontSize: 12, fontWeight: 600, color: "#26281f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</span>
                          {row.isOwnTransaction ? (
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: "#3a7d44", background: "#d6f0da", border: "1px solid #a8d9b0", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap", flexShrink: 0 }}>
                              OWNED
                            </span>
                          ) : row.isManual ? (
                            <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.06em", color: "#5a7c9e", background: "#e8f1f8", border: "1px solid #c3d9ec", borderRadius: 4, padding: "1px 5px", whiteSpace: "nowrap", flexShrink: 0 }}>
                              MANUAL
                            </span>
                          ) : null}
                        </div>
                        {sub && <div style={{ fontSize: 10.5, color: "#a89f8f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", marginTop: 1 }}>{sub}</div>}
                      </td>
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#5c5850", whiteSpace: "nowrap" }}>{row.market || "—"}</td>
                      {hasState  && <td style={{ padding: "9px 10px", fontSize: 11, color: "#7d766a", whiteSpace: "nowrap" }}>{row.state || "—"}</td>}
                      {hasAnchor && (
                        <td style={{ padding: "9px 10px", maxWidth: 230 }}>
                          {row.anchor
                            ? <TruncCell text={row.anchor} isExpanded={expandedCells.has(`${row.id}:anchor`)} onToggle={() => toggleCell(row.id, "anchor")} maxWidth={210} />
                            : <span style={{ fontSize: 11, color: "#c9c2b8" }}>—</span>}
                        </td>
                      )}
                      {hasType   && <td style={{ padding: "9px 10px", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{row.propertyType || "—"}</td>}
                      {hasBuyer  && <td style={{ padding: "9px 10px", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{row.buyer || "—"}</td>}
                      {hasSeller && <td style={{ padding: "9px 10px", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{row.seller || "—"}</td>}
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#383a37", fontWeight: 500, whiteSpace: "nowrap" }}>{fmtDate(row.saleDate)}</td>
                      <td style={{ padding: "9px 10px", fontSize: 12, color: row.capRate != null ? "#26281f" : "#c9c2b8", fontWeight: row.capRate != null ? 600 : 400, whiteSpace: "nowrap" }}>
                        {fmtCapRate(row.capRate)}
                      </td>
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#383a37", whiteSpace: "nowrap" }}>{fmtPsf(row.pricePerSf)}</td>
                      <td style={{ padding: "9px 10px", fontSize: 11.5, color: "#383a37", whiteSpace: "nowrap" }}>{fmtM(row.salePrice)}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{fmtSf(row.sf)}</td>
                      <td style={{ padding: "9px 10px", textAlign: "right", fontSize: 11, color: "#5c5850", whiteSpace: "nowrap" }}>{fmtPct(row.occupancy)}</td>
                      <td style={{ padding: "9px 10px", maxWidth: 180 }}>
                        {row.isManual ? (
                          <div style={{ display: "flex", alignItems: "flex-start", gap: 5 }}>
                            <TruncCell
                              text={row.sourceNotes || "Manual"}
                              isExpanded={expandedCells.has(`${row.id}:notes`)}
                              onToggle={() => toggleCell(row.id, "notes")}
                              maxWidth={130}
                              color="#7d766a"
                            />
                            <button
                              onClick={() => handleDelete(row.id)}
                              title="Delete this manual comp"
                              style={{
                                background: "transparent", border: "1px solid #e7ddd0", borderRadius: 4,
                                cursor: "pointer", color: "#b05050", fontSize: 11, padding: "1px 5px",
                                fontFamily: "'Inter',sans-serif", lineHeight: 1.2, flexShrink: 0,
                              }}
                            >
                              ×
                            </button>
                          </div>
                        ) : row.sourceDealName ? (
                          <div style={{ maxWidth: 160 }}>
                            {onOpenDeal ? (
                              <button
                                onClick={() => onOpenDeal(row.sourceDealId)}
                                style={{ background: "transparent", border: "none", cursor: "pointer", padding: 0, textAlign: "left" }}
                              >
                                <TruncCell
                                  text={row.sourceDealName}
                                  isExpanded={expandedCells.has(`${row.id}:notes`)}
                                  onToggle={() => toggleCell(row.id, "notes")}
                                  maxWidth={150}
                                  color="#6dba43"
                                  fontSize={11}
                                />
                              </button>
                            ) : (
                              <TruncCell
                                text={row.sourceDealName}
                                isExpanded={expandedCells.has(`${row.id}:notes`)}
                                onToggle={() => toggleCell(row.id, "notes")}
                                maxWidth={150}
                                color="#7d766a"
                                fontSize={11}
                              />
                            )}
                          </div>
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
