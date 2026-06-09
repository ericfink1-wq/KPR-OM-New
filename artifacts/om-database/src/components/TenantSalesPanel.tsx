import { useState, useMemo, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import type { TenantSalesYear, TenantSalesRecord, OccBreakdown, Tenant } from "../lib/idb";
import { tenantKey, stripSuiteCode, isVacant } from "../lib/utils";
import { useIsMobile } from "../hooks/use-mobile";

interface Props {
  salesHistory: TenantSalesYear[];
  omTenants?: Tenant[];         // existing roster tenants — used to seed OM sales data
  omDate?: string | null;       // OM date — used to estimate the sales year
  recoveries?: Map<string, { value: number; estimated: boolean }>; // per-tenant recovery estimate
  onUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  uploadBusy: boolean;
  uploadError: string | null;
  onChangeSalesHistory?: (next: TenantSalesYear[]) => void; // persist link/remove edits
  onLinkRoster?: (rosterName: string, salesPSF: number | null, salesYear: number | null) => void; // relay a link to the roster above
  onEraseAllSales?: () => void; // wipe ALL sales — uploaded snapshots AND OM-derived roster figures
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
  const [pos, setPos] = useState<{ top: number; left: number; flip: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const isMobile = useIsMobile();

  // Fixed-position portal so the tooltip is never clipped by the scrolling table.
  // Opens above by default, but flips BELOW when too close to the viewport top.
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const w = 240;
    const flip = r.top < 220; // not enough room above → open downward instead
    setPos({ top: flip ? r.bottom + 8 : r.top - 8, left: Math.min(r.right, window.innerWidth - 12) - w, flip });
  };
  const show = () => { place(); setOpen(true); };

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
        onMouseEnter={isMobile ? undefined : show}
        onMouseLeave={isMobile ? undefined : () => setOpen(false)}
        onClick={e => { e.stopPropagation(); if (open) setOpen(false); else show(); }}
        style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}
      >
        {val.toFixed(1)}%
        <span style={{ fontSize: 8, letterSpacing: "0.04em", color: isStated ? "#0f9d63" : "#7d766a", background: isStated ? "#e7f8f0" : "#f3f4f6", border: `1px solid ${isStated ? "#a7f3d0" : "#d1d5db"}`, borderRadius: 3, padding: "0px 3px", fontWeight: 700, fontFamily: "'Inter',sans-serif" }}>
          {source}
        </span>
      </span>
      {open && pos && createPortal(
        <div style={{
          position: "fixed", top: pos.top, left: pos.left, transform: pos.flip ? "none" : "translateY(-100%)",
          background: "#fff", border: "1px solid #e6dfd0", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(56,58,55,0.18)", padding: "10px 14px",
          zIndex: 10000, width: 240, maxWidth: "calc(100vw - 24px)",
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
        </div>,
        document.body
      )}
    </span>
  );
}

interface MergedRow {
  name: string;
  key: string;      // tenantKey of the sales name — used to match the roster + apply link/remove edits
  byYear: Record<number, TenantSalesRecord>;
  removed?: boolean; // soft-deleted — render at the bottom struck-through, re-addable
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
  const key = tenantKey(stripSuiteCode(t.name));
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
  // Show the clean brand (matched roster name, else suite-stripped) so the panel
  // mirrors the roster instead of "A06 Elite Nutrition".
  const cleanName = rt ? (rt.canonicalName || rt.name || stripSuiteCode(t.name)) : stripSuiteCode(t.name);
  return { ...t, name: cleanName, sf, salesPSF: psf, annualSales: gross, occupancyCost, occSource, occBreakdown };
}

function mergeRows(
  history: TenantSalesYear[],
  rosterByKey: Map<string, Tenant>,
  recByKey: Map<string, { value: number; estimated: boolean }>,
): MergedRow[] {
  const map: Record<string, MergedRow> = {};
  for (const snap of history) {
    for (const raw of snap.tenants) {
      const key = tenantKey(stripSuiteCode(raw.name));
      if (!key) continue;
      const t = deriveSalesRecord(raw, rosterByKey, recByKey);
      if (!map[key]) map[key] = { name: t.name, key, byYear: {} };
      if (raw.removed) map[key].removed = true;
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

export default function TenantSalesPanel({ salesHistory, omTenants, omDate, recoveries, onUpload, uploadBusy, uploadError, onChangeSalesHistory, onLinkRoster, onEraseAllSales }: Props) {
  // Key the roster the SAME way deriveSalesRecord/mergeRows look it up (suite-stripped)
  // so a freshly-linked sales row actually registers as linked.
  const rosterByKey = useMemo(() => new Map((omTenants || []).map(t => [tenantKey(stripSuiteCode(t.canonicalName || t.name)), t])), [omTenants]);
  const recByKey = recoveries ?? new Map();
  const fileRef = useRef<HTMLInputElement>(null);
  const [selectedYear, setSelectedYear] = useState<number | "all">("all");
  const [filter, setFilter] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("annualSales");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [collapsed, setCollapsed] = useState(false);
  const [linkEditKey, setLinkEditKey] = useState<string | null>(null);

  // Roster tenants a sales row can be linked to (the rent roll), alphabetized.
  const rosterOptions = useMemo(() =>
    (omTenants || [])
      .filter(t => !isVacant(t.name))
      .map(t => ({ key: tenantKey(t.canonicalName || t.name), label: (t.canonicalName || t.name || "").trim() }))
      .filter(o => o.key && o.label)
      .sort((a, b) => a.label.localeCompare(b.label)),
    [omTenants]);

  // Link a sales row to a roster tenant (rename it so it matches), or remove it
  // entirely (tenant no longer at the property). Applies across every uploaded
  // year snapshot, then persists.
  const applySalesEdit = (rowKey: string, action: { type: "link"; toName: string } | { type: "remove" } | { type: "readd" }) => {
    setLinkEditKey(null);
    // On link, relay the sales figure to the matching roster tenant above.
    if (action.type === "link" && onLinkRoster) {
      let best: { year: number; rec: TenantSalesRecord } | null = null;
      for (const snap of salesHistory) for (const t of snap.tenants) {
        if (tenantKey(stripSuiteCode(t.name)) === rowKey && (!best || snap.year > best.year)) best = { year: snap.year, rec: t };
      }
      if (best) {
        const nv = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
        let psf = nv(best.rec.salesPSF);
        const gross = nv(best.rec.annualSales), sf = nv(best.rec.sf);
        if (psf == null && gross != null && sf != null && sf > 0) psf = Math.round((gross / sf) * 100) / 100;
        onLinkRoster(action.toName, psf, best.year || null);
      }
    }
    if (!onChangeSalesHistory) return;
    // Soft delete: mark removed (kept, shown struck-through) rather than dropping.
    const next = salesHistory.map(snap => ({
      ...snap,
      tenants: snap.tenants.map(t => {
        if (tenantKey(stripSuiteCode(t.name)) !== rowKey) return t;
        if (action.type === "remove") return { ...t, removed: true };
        if (action.type === "readd") return { ...t, removed: false };
        return { ...t, name: action.toName, removed: false }; // link
      }),
    }));
    onChangeSalesHistory(next);
  };

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
      return snap.tenants.map(raw => { const t = deriveSalesRecord(raw, rosterByKey, recByKey); return { name: t.name, key: tenantKey(stripSuiteCode(raw.name)), removed: !!raw.removed, byYear: { [selectedYear]: t } as Record<number, TenantSalesRecord> }; });
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
    // Removed (soft-deleted) tenants always sink to the bottom.
    return [...r.filter(x => !x.removed), ...r.filter(x => x.removed)];
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

  // Erase ALL tenant sales for this property — the escape hatch after a bad import.
  // Covers BOTH sources shown in this box: uploaded sales-year snapshots AND figures
  // pulled from the OM roster (so it works even on an OM-only property like the one
  // that has no uploaded file). Clears everything so you can re-upload from scratch.
  const eraseSales = () => {
    if (!onEraseAllSales) return;
    const yrs = [...new Set(fullHistory.map(s => s.year).filter(Boolean))].sort((a, b) => a - b);
    const label = yrs.length ? ` (${yrs.join(", ")})` : "";
    if (!window.confirm(
      `Erase ALL tenant sales${label} for this property?\n\n` +
      `This clears every sales figure shown here — uploaded sales years AND figures ` +
      `pulled from the OM — so you can start clean and re-upload. This can't be undone.`
    )) return;
    onEraseAllSales();
  };

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
            {hasAnySales && onEraseAllSales && (
              <button onClick={eraseSales} disabled={uploadBusy} title="Remove ALL tenant sales (uploaded + OM-pulled) so you can re-upload clean" style={{
                background: "#fff", color: "#c0563b", border: "1px solid #e7c3b8", borderRadius: 6,
                padding: "5px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer",
                opacity: uploadBusy ? 0.6 : 1, whiteSpace: "nowrap",
              }}>
                🗑 Erase Sales
              </button>
            )}
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
                    <tr key={row.name} style={{ background: row.removed ? "#f6f4ef" : (i % 2 === 0 ? "#fff" : "#f8fbf5"), borderBottom: "1px solid #eef0eb", opacity: row.removed ? 0.65 : 1 }}>
                      <td style={{ padding: "7px 10px", fontWeight: 600, color: "#262724", whiteSpace: "nowrap" }}>
                        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                          <span style={row.removed ? { textDecoration: "line-through", color: "#a89f8f", fontWeight: 500 } : undefined}>{row.name}</span>
                          {onChangeSalesHistory && (
                            row.removed ? (
                              <button onClick={() => applySalesEdit(row.key, { type: "readd" })} title="Removed — click to re-add if that was a mistake / the tenant is back" style={{ fontSize: 9, fontWeight: 700, color: "#3f7a1f", background: "#f4f8ef", border: "1px solid #cfe3b8", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>↩ Re-add</button>
                            ) : linkEditKey === row.key ? (
                              <select autoFocus defaultValue=""
                                onChange={e => {
                                  const v = e.target.value;
                                  if (!v) { setLinkEditKey(null); return; }
                                  if (v === "__remove__") applySalesEdit(row.key, { type: "remove" });
                                  else applySalesEdit(row.key, { type: "link", toName: v });
                                }}
                                onBlur={() => setLinkEditKey(null)}
                                style={{ fontSize: 10, padding: "2px 4px", borderRadius: 5, border: "1px solid #c8ddb8", background: "#fff", color: "#383a37", maxWidth: 190 }}>
                                <option value="">{rosterByKey.has(row.key) ? "Re-link to…" : "Link to tenant…"}</option>
                                {rosterOptions.map(o => <option key={o.key} value={o.label}>{o.label}</option>)}
                                <option value="__remove__">✕ Remove — no longer here</option>
                              </select>
                            ) : rosterByKey.has(row.key) ? (
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <span title="Matched to a tenant on the rent roll" style={{ fontSize: 8, fontWeight: 700, letterSpacing: "0.04em", color: "#0f9d63", background: "#e7f8f0", border: "1px solid #a7f3d0", borderRadius: 3, padding: "0 4px" }}>LINKED</span>
                                <button onClick={() => setLinkEditKey(row.key)} title="Linked to the wrong tenant? Re-link or remove." style={{ background: "transparent", border: "none", color: "#a89f8f", cursor: "pointer", fontSize: 9.5, padding: 0, textDecoration: "underline" }}>edit</button>
                              </span>
                            ) : (
                              <button onClick={() => setLinkEditKey(row.key)} title="Not matched to a rent-roll tenant — link it, or remove if it's gone." style={{ fontSize: 8.5, fontWeight: 700, letterSpacing: "0.04em", color: "#b45309", background: "#fff7ed", border: "1px solid #fed7aa", borderRadius: 3, padding: "1px 6px", cursor: "pointer" }}>UNLINKED ▾</button>
                            )
                          )}
                        </div>
                      </td>
                      {selectedYear === "all"
                        ? displayYears.map((y, yi) => {
                            const rec = row.byYear[y];
                            // On the most recent year (leftmost), color the PSF by whether
                            // it's up/down vs the prior year shown, and append the % change.
                            const priorRec = yi === 0 && displayYears.length > 1 ? row.byYear[displayYears[1]] : null;
                            const cur = rec?.salesPSF ?? null;
                            const prior = priorRec?.salesPSF ?? null;
                            const pct = (cur != null && prior != null && prior > 0 && cur !== prior) ? ((cur - prior) / prior) * 100 : null;
                            const psfColor = cur == null ? "#bbb" : pct == null ? "#262724" : pct > 0 ? "#0f9d63" : "#dc2626";
                            return (
                              <>
                                <td key={`${y}-psf`} style={{ padding: "7px 10px", textAlign: "right", color: psfColor, fontWeight: cur ? 600 : 400, borderLeft: "2px solid #c8ddb8" }}>
                                  {fmtPSF(cur)}
                                  {pct != null && <span style={{ marginLeft: 4, fontSize: 11 }}>({pct > 0 ? "+" : "−"}{Math.abs(pct).toFixed(1)}%)</span>}
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
                                <td style={{ padding: "7px 10px", textAlign: "right", color: rec?.salesPSF ? "#262724" : "#bbb", fontWeight: rec?.salesPSF ? 600 : 400 }}>{fmtPSF(rec?.salesPSF)}</td>
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
