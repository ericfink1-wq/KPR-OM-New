import { useState, useEffect, useRef, useCallback } from "react";
import type { Deal } from "../lib/idb";
import { apiLoadImages, apiSaveImages, apiSaveDeal, apiReanalyzeDeal, apiPollDealStatus, apiAiMessages } from "../lib/api";
import { STATUS_COLORS, STATUS_OPTS } from "../lib/constants";
import { ensureUploadAllowed } from "../lib/uploadAuth";
import { classifyLocation, cityState, assessExtraction, openReviewCount } from "../lib/utils";
import StatusTag from "./StatusTag";
import ScoreBadge from "./ScoreBadge";
import { useWatchlist } from "../lib/useWatchlist";
import { computeWatchlistImpact } from "../lib/watchlistImpact";
import { startAiTask, updateAiTask, finishAiTask } from "../lib/aiProgress";
// exportExcel pulls in the heavy SheetJS (xlsx) library — load it on demand at
// click time so it stays out of the initial bundle (DealGrid is on the first
// paint). See onClick below.
import RecencyBadge from "./RecencyBadge";

interface Props {
  deals: Deal[];
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Deal>) => void;
  onCompare: (ids: string[]) => void;
  onDelete?: (id: string) => void;
  onAddFiles?: (files: File[]) => void;
  isAdmin?: boolean;
  onCountsChange?: (shown: number, total: number) => void;
}

// Largest anchor tenant's name — used for the portfolio "Anchor" column and sort.
function leadAnchorName(d: Deal): string {
  const anchors = (d.tenants || []).filter(t => t.isAnchor);
  if (anchors.length === 0) return "";
  const best = anchors.reduce((a, b) => (Number(b.sf) || 0) > (Number(a.sf) || 0) ? b : a);
  return (best.canonicalName || best.name || "").trim();
}

// Compact price for a narrow column, e.g. "$28.0M", "$930K".
function fmtPriceShort(v: number | null | undefined): string {
  const n = Number(v);
  if (v == null || !isFinite(n) || n <= 0) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

// City display that won't repeat the separate State column: strips a trailing
// state (matching d.state, or any trailing 2-letter code) from the city string.
function cityOnly(city: string | null | undefined, state: string | null | undefined): string {
  const c = (city || "").trim();
  if (!c) return "—";
  const st = (state || "").trim();
  if (st) {
    const stripped = c.replace(new RegExp(`,\\s*${st.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\.?$`, "i"), "").trim();
    return stripped || c;
  }
  return c.replace(/,\s*[A-Za-z]{2}\.?$/, "").trim() || c;
}

function RowThumb({ deal }: { deal: Deal }) {
  // Load the cover as a native lazy <img> from a cacheable binary endpoint — the
  // browser only fetches covers for visible rows and caches them, so a 1,000-deal
  // list doesn't fire 1,000 requests and sorting/filtering doesn't re-fetch.
  const [failed, setFailed] = useState(false);
  const initial = (deal.propertyName || deal.fileName || "?").charAt(0).toUpperCase();
  const v = encodeURIComponent(deal.updatedAt || deal.uploadedAt || "");
  return (
    <div style={{ width: 64, height: 48, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: "#eef3e6", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {deal.imageMeta?.cover && !failed
        ? <img src={`/api/deals/${deal.id}/cover-thumb?v=${v}`} alt="" loading="lazy" decoding="async" onError={() => setFailed(true)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        : <span style={{ fontSize: 17, fontWeight: 700, color: "#3f7a1f", fontFamily: "'Inter', sans-serif" }}>{initial}</span>}
    </div>
  );
}

type GroupAction = "link" | "merge";

interface LinkMergeModal {
  action: GroupAction;
  deals: Deal[];
  keeperId?: string;
}

interface ConfirmGate {
  body: string;
}

// Web-search system prompts (mirrors the original JSX)
const SALE_SYSTEM = `You are a commercial real estate research assistant. Using web search, determine whether the specific property described has SOLD in a closed transaction AFTER the date of its offering memorandum (the "omDate" field). We want the eventual sale that resulted from this offering — typically closing in the months after the OM. CRITICAL: ignore any earlier/prior transaction, such as the current seller's own past acquisition of the property. A sale dated before the omDate is NOT relevant — if the only sale you can find predates the omDate, treat it as found=false. Find the confirmed sale price, buyer, seller, sale date, and cap rate where reported by credible sources (brokerage press releases, trade press such as Commercial Observer / Bisnow / REBusinessOnline, local business journals, public records). Be rigorous: report "high" confidence ONLY when an authoritative source, or several credible ones, clearly confirm a post-OM sale of THIS exact property (match address/market). If you cannot confirm it is the same property, the sale predates the OM, or the data is thin or conflicting, use found=false or a lower confidence. Never guess a price or a date. Always include the sale date you found in "soldDate". After researching, output ONLY a single JSON object and nothing else — no markdown, no prose — with exactly this shape: {"found":boolean,"confidence":"high"|"medium"|"low","soldDate":string|null,"price":number|null,"pricePerSF":number|null,"capRate":number|null,"buyer":string|null,"seller":string|null,"summary":string,"sources":[{"title":string,"url":string}]}.`;

const DEMO_SYSTEM = `You are a commercial real estate research assistant. Using web search, find the 1-, 3-, and 5-mile RADIUS demographics centered on the given property address: total POPULATION and AVERAGE household income for each ring. Prefer figures derived from the latest US Census American Community Survey (ACS) 5-year estimates (2020-2024 is the newest). Active listing pages (LoopNet, Crexi, broker sites) and demographic tools often publish these exact ring figures — use them when they clearly match this address/market. If precise ring figures are not available, give your best estimate from the most local ACS data you can find and explain that in "note", but lower the confidence accordingly. Average household income is preferred; if only MEDIAN is available, return it and say so in "note". Always state the data source and as-of vintage. Be reasonable and do not leave everything blank — an approximate, clearly-labeled estimate is useful — but never fabricate a precise-looking number you have no basis for. Output ONLY a single JSON object and nothing else — no markdown, no prose — with exactly this shape: {"found":boolean,"confidence":"high"|"medium"|"low","asOf":string|null,"source":string|null,"pop1mi":number|null,"pop3mi":number|null,"pop5mi":number|null,"avgHHI1mi":number|null,"avgHHI3mi":number|null,"avgHHI5mi":number|null,"note":string,"sources":[{"title":string,"url":string}]}.`;

function robustParseJSON(s: string): Record<string, unknown> | null {
  try {
    const m = s.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch {
    return null;
  }
}

function saleIsAfterOM(soldDate: string | null, omDate: string | null): boolean {
  if (!soldDate) return true;
  if (!omDate) return true;
  return soldDate >= omDate;
}

const darkBtn: React.CSSProperties = {
  background: "#52554e",
  border: "none",
  color: "#ffffff",
  padding: "7px 13px",
  borderRadius: 8,
  cursor: "pointer",
  fontSize: 11.5,
  fontWeight: 600,
  fontFamily: "'Inter', sans-serif",
  whiteSpace: "nowrap",
};

const darkBtnDanger: React.CSSProperties = {
  ...darkBtn,
  background: "#7a2020",
};

function MultiSelectDropdown({ label, options, selected, onChange }: {
  label: string;
  options: string[];
  selected: string[];
  onChange: (v: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const btnLabel = selected.length === 0
    ? `All ${label}`
    : selected.length === 1
    ? selected[0]
    : `${selected.length} ${label}`;

  const toggle = (opt: string) =>
    onChange(selected.includes(opt) ? selected.filter(s => s !== opt) : [...selected, opt]);

  return (
    <div ref={containerRef} style={{ position: "relative", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          fontSize: 12, padding: "6px 10px",
          border: `1px solid ${selected.length > 0 ? "#6dba43" : "#e3dccd"}`,
          borderRadius: 8, cursor: "pointer", fontFamily: "'Inter',sans-serif",
          background: selected.length > 0 ? "#f0fae8" : "#fff",
          color: selected.length > 0 ? "#3f7a1f" : "#383a37",
          fontWeight: selected.length > 0 ? 600 : 400,
          display: "flex", alignItems: "center", gap: 4, whiteSpace: "nowrap",
        }}
      >
        {btnLabel}
        <span style={{ fontSize: 8, opacity: 0.5, marginTop: 1 }}>▾</span>
      </button>
      {open && options.length > 0 && (
        <div style={{
          position: "absolute", top: "calc(100% + 4px)", left: 0, zIndex: 200,
          background: "#fff", border: "1px solid #e3dccd", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(0,0,0,0.12)", padding: "6px 0",
          minWidth: 165, maxWidth: "calc(100vw - 24px)", maxHeight: 300, overflowY: "auto",
        }}>
          {options.map(opt => (
            <label
              key={opt}
              style={{
                display: "flex", alignItems: "center", gap: 10,
                padding: "10px 14px", cursor: "pointer", userSelect: "none",
                fontSize: 12.5, color: "#383a37",
                background: selected.includes(opt) ? "#f0fae8" : "transparent",
              }}
            >
              <input
                type="checkbox"
                checked={selected.includes(opt)}
                onChange={() => toggle(opt)}
                style={{ width: 15, height: 15, accentColor: "#6dba43", cursor: "pointer", flexShrink: 0 }}
              />
              {opt}
            </label>
          ))}
          {selected.length > 0 && (
            <div style={{ padding: "7px 14px", borderTop: "1px solid #f1eadc", marginTop: 2 }}>
              <button
                onClick={() => { onChange([]); setOpen(false); }}
                style={{ fontSize: 11, color: "#a89f8f", background: "transparent", border: "none", cursor: "pointer", padding: 0, fontFamily: "'Inter',sans-serif" }}
              >
                Clear
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Section-aware merge helpers ──────────────────────────────────────────────
const _ts = (s?: string | null) => { const t = s ? Date.parse(s) : NaN; return isNaN(t) ? 0 : t; };
const dealFreshness = (d: Deal) => Math.max(_ts(d.refreshedAt), _ts(d.uploadedAt));
const demoDate = (d: Deal) => Math.max(_ts(d.demoChecked), _ts((d.marketDemographics as { lookedUpAt?: string } | null)?.lookedUpAt)) || dealFreshness(d);

// Merge sales-history snapshots across deals: newest-uploaded snapshot per year.
function mergeSalesHistories(deals: Deal[]): Deal["tenantSalesHistory"] | undefined {
  type Snap = NonNullable<Deal["tenantSalesHistory"]>[number];
  const byYear = new Map<number, Snap>();
  for (const d of deals) for (const snap of d.tenantSalesHistory || []) {
    const cur = byYear.get(snap.year);
    if (!cur || _ts(snap.uploadedAt) >= _ts(cur.uploadedAt)) byYear.set(snap.year, snap);
  }
  const out = [...byYear.values()].sort((a, b) => a.year - b.year);
  return out.length ? out : undefined;
}

// Fields the user enters by hand — never overwritten with a blank on merge.
const USER_EXTRA = new Set(["status", "statusSince", "autoPassed", "dealThesis", "ownershipStructure", "marketSale", "marketSaleChecked", "propertyGroupId", "broker", "seller"]);
const isUserField = (k: string) => /^(acq|debt|pref|txn|disp)/.test(k) || USER_EXTRA.has(k);

// Fields that can be bulk-set across selected properties. `also` keeps linked
// fields in sync (seller↔txnSeller, broker↔acqBroker), mirroring the deal page.
const BULK_FIELDS: { key: keyof Deal; label: string; also?: (keyof Deal)[]; hint?: string; options?: readonly string[] }[] = [
  { key: "status", label: "Status", options: STATUS_OPTS },
  { key: "seller", label: "Seller", also: ["txnSeller"], hint: "Also updates Transaction Details → Seller." },
  { key: "broker", label: "Broker", also: ["acqBroker"], hint: "Also updates Acquisition → Broker." },
  { key: "market", label: "Market (MSA)" },
  { key: "submarket", label: "Submarket" },
  { key: "state", label: "State" },
  { key: "assetType", label: "Asset Type" },
  { key: "centerType", label: "Center Type" },
];

export default function DealGrid({ deals, onOpen, onUpdate, onCompare, onDelete, onAddFiles, isAdmin, onCountsChange }: Props) {
  const watchMap = useWatchlist();
  const [filterStatuses, setFilterStatuses] = useState<string[]>([]);
  const [filterStates, setFilterStates] = useState<string[]>([]);
  const [filterTypes, setFilterTypes] = useState<string[]>([]);
  const [sortKey, setSortKey] = useState("status");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("asc");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"table"|"grid">("table");
  const [modal, setModal] = useState<LinkMergeModal | null>(null);
  const [merging, setMerging] = useState(false);

  // Bulk action state
  const [bulkEditOpen, setBulkEditOpen] = useState(false);
  const [bulkEditField, setBulkEditField] = useState<keyof Deal>("status");
  const [bulkEditValue, setBulkEditValue] = useState<string>(STATUS_OPTS[0] ?? "");
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);
  const [delConfirmText, setDelConfirmText] = useState("");
  const [confirmGate, setConfirmGate] = useState<ConfirmGate | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [lookingUp, setLookingUp] = useState<Set<string>>(new Set());
  const [gettingDemo, setGettingDemo] = useState<Set<string>>(new Set());
  const [reanalyzeBusy, setReanalyzeBusy] = useState<Set<string>>(new Set());

  const [combineModal, setCombineModal] = useState<{ ids: string[]; primaryId: string } | null>(null);
  const [combining, setCombining] = useState(false);
  const [combineUndo, setCombineUndo] = useState<{ primarySnapshot: Deal; extraIds: string[] } | null>(null);

  const confirmResolverRef = useRef<((v: boolean) => void) | null>(null);
  const rerunInputRef = useRef<HTMLInputElement>(null);
  const rerunTargetsRef = useRef<Deal[]>([]);
  const combineUndoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-dismiss notice
  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(t);
  }, [notice]);

  // ── Token-spend confirmation ─────────────────────────────────────────────
  const confirmTokens = useCallback((actionDesc: string, count: number, web: boolean): Promise<boolean> => {
    return new Promise(resolve => {
      confirmResolverRef.current = resolve;
      setConfirmGate({
        body: `You're about to ${actionDesc}. That sends ${count} ${web ? "web search + AI request" : "AI request"}${count === 1 ? "" : "s"} to the Claude API and will draw down your usage. Continue?`,
      });
    });
  }, []);

  const resolveConfirm = (v: boolean) => {
    setConfirmGate(null);
    confirmResolverRef.current?.(v);
    confirmResolverRef.current = null;
  };

  const types = Array.from(new Set(deals.map(d => d.assetType).filter(Boolean))) as string[];
  const states = Array.from(new Set(deals.map(d => d.state as unknown as string | null | undefined).filter((s): s is string => Boolean(s)))).sort();
  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);

  let rows = deals.slice();
  if (filterStatuses.length > 0) rows = rows.filter(d => d.status != null && filterStatuses.includes(d.status));
  if (filterStates.length > 0) rows = rows.filter(d => { const s = d.state as unknown as string | null; return s != null && filterStates.includes(s); });
  if (filterTypes.length > 0) rows = rows.filter(d => d.assetType != null && filterTypes.includes(d.assetType));
  if (q.trim()) {
    const s = q.toLowerCase();
    // Match ONLY the columns visible in the Deal Library row — property name,
    // status, city, state, MSA, lead anchor, seller. We deliberately do NOT search
    // hidden/deep data (street address, notes, thesis, the full tenant roster,
    // lenders, red flags), which made the box feel over-sensitive (e.g. "floriss"
    // matching a street address). Results now always map to something on screen.
    const hay = (d: Deal): string => {
      const parts: (string | null | undefined)[] = [
        d.propertyName, d.status, d.city, d.state, d.market, d.seller, leadAnchorName(d),
      ];
      return parts.filter(Boolean).join(" ").toLowerCase();
    };
    rows = rows.filter(d => hay(d).includes(s));
  }
  const STATUS_ORDER: Record<string, number> = {
    "Under Contract": 0, "Prospect": 1, "Owned": 2, "Sold": 3, "Passed": 4,
  };
  rows.sort((a, b) => {
    if (sortKey === "status") {
      const ao = STATUS_ORDER[a.status || ""] ?? 99;
      const bo = STATUS_ORDER[b.status || ""] ?? 99;
      if (ao !== bo) return sortDir === "asc" ? ao - bo : bo - ao;
      // Within same status group: alphabetical by property name
      const an = (a.propertyName || a.fileName || "").toLowerCase();
      const bn = (b.propertyName || b.fileName || "").toLowerCase();
      return an.localeCompare(bn);
    }
    if (sortKey === "anchor") {
      const av = leadAnchorName(a).toLowerCase();
      const bv = leadAnchorName(b).toLowerCase();
      return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    }
    if (sortKey === "lastUploadAt") {
      const av = _ts(a.lastUploadAt) || _ts(a.uploadedAt);
      const bv = _ts(b.lastUploadAt) || _ts(b.uploadedAt);
      return sortDir === "asc" ? av - bv : bv - av;
    }
    const numKeys = ["capRate","noi","askingPrice","totalSF","occupancy","walt"];
    if (numKeys.includes(sortKey)) {
      const av = n(a[sortKey as keyof Deal]) ?? -Infinity;
      const bv = n(b[sortKey as keyof Deal]) ?? -Infinity;
      return sortDir === "asc" ? av - bv : bv - av;
    }
    const av = String(a[sortKey as keyof Deal] || "");
    const bv = String(b[sortKey as keyof Deal] || "");
    return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  // Report how many deals are showing vs the total, so the header can read
  // "39 of 94 …" while a search/filter is active.
  const shownCount = rows.length;
  useEffect(() => { onCountsChange?.(shownCount, deals.length); }, [shownCount, deals.length, onCountsChange]);

  // One-time, throttled backfill: a deal with a cover but no thumbnail serves the
  // full-size image (heavy). Generate a small tile-sized thumb for those in the
  // background so the whole library stays lean; deals that already have a thumb
  // are skipped.
  const thumbBackfillRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    const todo = deals
      .filter(d => d.imageMeta?.cover && !d.imageMeta?.thumb && !d.trashedAt && !thumbBackfillRef.current.has(d.id))
      .map(d => d.id);
    if (todo.length === 0) return;
    (async () => {
      const { dataUrlToThumb } = await import("../lib/pdfExtract");
      for (const id of todo) {
        if (cancelled) return;
        thumbBackfillRef.current.add(id);
        try {
          const imgs = await apiLoadImages(id) as { cover?: string | null; coverThumb?: string | null } | null;
          if (imgs?.cover && !imgs.coverThumb) {
            const thumb = await dataUrlToThumb(imgs.cover);
            await apiSaveImages(id, { ...(imgs as object), coverThumb: thumb } as Parameters<typeof apiSaveImages>[1]);
          }
        } catch { /* skip this one */ }
        await new Promise(r => setTimeout(r, 500)); // throttle so the UI stays smooth
      }
    })();
    return () => { cancelled = true; };
  }, [deals]);

  const toggleSort = (k: string) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const arrow = (k: string) => sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  const toggleSel = (id: string) => setSelected(s => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const clearSelection = () => { setSelected(new Set()); setConfirmBulkDel(false); setDelConfirmText(""); setBulkEditOpen(false); };

  // ── Combine phases ───────────────────────────────────────────────────────
  const openCombine = () => {
    const ids = Array.from(selected);
    if (ids.length >= 2) setCombineModal({ ids, primaryId: ids[0] });
  };

  const doCombine = async (primaryId: string, ids: string[]) => {
    const others = ids.filter(id => id !== primaryId);
    if (!others.length) return;
    setCombining(true);
    const P = deals.find(d => d.id === primaryId);
    if (!P) { setCombining(false); return; }
    const os = deals.filter(d => others.includes(d.id));
    const all = [P, ...os];
    const ts = new Date().toISOString();

    // Images: keep primary's cover; fill from extras if missing; concat site plans.
    try {
      const pImgs = (await apiLoadImages(primaryId).catch(() => null)) || {};
      let cover = (pImgs as Record<string, unknown>).cover as string | null || null;
      let coverThumb = (pImgs as Record<string, unknown>).coverThumb as string | null || null;
      let sitePlan: unknown[] = Array.isArray((pImgs as Record<string, unknown>).sitePlan) ? [...(pImgs as Record<string, unknown>).sitePlan as unknown[]] : [];
      for (const oid of others) {
        const oi = (await apiLoadImages(oid).catch(() => null)) as Record<string, unknown> | null;
        if (!oi) continue;
        if (!cover && oi.cover) { cover = oi.cover as string; coverThumb = oi.coverThumb as string | null || null; }
        if (Array.isArray(oi.sitePlan)) sitePlan = sitePlan.concat(oi.sitePlan as unknown[]);
      }
      await apiSaveImages(primaryId, { cover, coverThumb, sitePlan, pagePicks: (pImgs as Record<string, unknown>).pagePicks || [], needsSitePlanPick: false } as Parameters<typeof apiSaveImages>[1]);
    } catch {}

    const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
    const asRec = (d: unknown) => d as Record<string, unknown>;
    const combined: Record<string, unknown> = { ...(asRec(P)) };

    // 1. Sum additive size / income fields.
    const SUM = ["totalSF","noi","grossPotentialRent","effectiveGrossIncome","operatingExpenses","nnnRecoveries","numberOfUnits","numberOfBuildings","lotSizeAcres","parkingSpaces","askingPrice","txnPurchasePrice","txnSalePrice","acqNOIAtClose","debtLoanAmount"];
    for (const f of SUM) {
      let s = 0, any = false;
      for (const d of all) { const v = num(asRec(d)[f]); if (v != null) { s += v; any = true; } }
      if (any) combined[f] = s;
    }

    // 2. Concatenate tenant rosters and list fields.
    const concatArr = (f: string) => all.flatMap(d => { const v = asRec(d)[f]; return Array.isArray(v) ? v : []; });
    combined.tenants = concatArr("tenants");
    combined.redFlags = concatArr("redFlags");
    combined.keyAssumptions = concatArr("keyAssumptions");

    // 3. Recompute per-area / derived metrics.
    const totSF = num(combined.totalSF), totNOI = num(combined.noi);
    const totPrice = num(combined.askingPrice) || num(combined.txnPurchasePrice);
    const totEGI = num(combined.effectiveGrossIncome), totOpex = num(combined.operatingExpenses), totGPR = num(combined.grossPotentialRent);
    if (totNOI && totPrice) combined.capRate = +(totNOI / totPrice * 100).toFixed(2);
    if (totPrice && totSF) combined.pricePerSF = Math.round(totPrice / totSF);
    if (totEGI && totOpex) combined.expenseRatio = +(totOpex / totEGI * 100).toFixed(1);
    let occW = 0, occSF = 0, waltW = 0, waltSF = 0;
    for (const d of all) {
      const r = asRec(d);
      const sf = num(r.totalSF), oc = num(r.occupancy), w = num(r.walt);
      if (sf && oc != null) { occW += oc * sf; occSF += sf; }
      if (sf && w != null) { waltW += w * sf; waltSF += sf; }
    }
    if (occSF) combined.occupancy = +(occW / occSF).toFixed(1);
    if (waltSF) combined.walt = +(waltW / waltSF).toFixed(1);
    const baseRent = (combined.tenants as Array<Record<string, unknown>>).reduce((s, t) => s + (num(t.annualRent) || 0), 0) || totGPR || 0;
    if (baseRent && totSF) combined.weightedAvgRentPSF = +(baseRent / totSF).toFixed(2);

    // 4. Combine narrative text (dedupe identical blocks).
    const join = (f: string) => { const parts = all.map(d => asRec(d)[f]).filter(Boolean) as string[]; return parts.length ? Array.from(new Set(parts)).join("\n\n") : asRec(P)[f] as string; };
    if (all.some(d => asRec(d).notes)) combined.notes = join("notes");
    if (all.some(d => asRec(d).userNotes)) combined.userNotes = join("userNotes");

    // 5. Preserve verified flags from every OM.
    const ver: Record<string, unknown> = { ...(P.verified || {}) };
    for (const o of os) for (const [k, v] of Object.entries(o.verified || {})) if (!ver[k]) ver[k] = v;
    combined.verified = ver;

    const pRec = asRec(P);
    const otherNames = os.map(o => o.propertyName || o.fileName || "deal").join(", ");
    combined.editHistory = [...((pRec.editHistory as unknown[]) || []), { ts, by: "User", changes: [{ field: "record", from: `${all.length} OMs`, to: `combined into one — summed SF/NOI/income and merged tenant rosters from: ${otherNames}` }] }];

    onUpdate(primaryId, combined as Partial<Deal>);
    for (const oid of others) onUpdate(oid, { trashedAt: ts });

    // Undo buffer: restore primary snapshot + un-trash extras (15 s window).
    if (combineUndoTimerRef.current) clearTimeout(combineUndoTimerRef.current);
    setCombineUndo({ primarySnapshot: P, extraIds: others });
    combineUndoTimerRef.current = setTimeout(() => setCombineUndo(null), 15000);

    setCombining(false);
    setCombineModal(null);
    clearSelection();
    setNotice(`Combined ${ids.length} OMs into one deal — sizes, income, and tenants added together.`);
  };

  const undoCombine = () => {
    if (!combineUndo) return;
    onUpdate(combineUndo.primarySnapshot.id, combineUndo.primarySnapshot as Partial<Deal>);
    for (const eid of combineUndo.extraIds) onUpdate(eid, { trashedAt: null });
    if (combineUndoTimerRef.current) clearTimeout(combineUndoTimerRef.current);
    setCombineUndo(null);
    setNotice("Combine undone — all OMs restored.");
  };

  // ── Link / Merge modal ───────────────────────────────────────────────────
  const openModal = (action: GroupAction) => {
    const sel = deals.filter(d => selected.has(d.id));
    setModal({ action, deals: sel, keeperId: sel[0]?.id });
  };

  const commitLink = async () => {
    if (!modal) return;
    const groupId = modal.deals.find(d => d.propertyGroupId)?.propertyGroupId || `grp_${Date.now()}`;
    for (const d of modal.deals) onUpdate(d.id, { propertyGroupId: groupId });
    setModal(null);
    clearSelection();
    setNotice(`Linked ${modal.deals.length} deals as one property's version history.`);
  };

  const commitMerge = async () => {
    if (!modal || !modal.keeperId) return;
    setMerging(true);
    const keeper = modal.deals.find(d => d.id === modal.keeperId)!;
    const others = modal.deals.filter(d => d.id !== modal.keeperId);
    const all = modal.deals;
    const nonEmpty = (v: unknown) => v != null && v !== "";

    // Base = the freshest deal's record (newest OM financials + narrative + score).
    const freshest = all.slice().sort((a, b) => dealFreshness(b) - dealFreshness(a))[0];
    const merged: Deal = { ...freshest };

    // Roster (+ derived occupancy/WALT/avg rent) from the most up-to-date source.
    // Judge by ACTUAL data date, not upload order: a real lease as-of date wins
    // (newest first), then a rent-roll/manual roster beats an OM-extracted one,
    // and only then fall back to overall freshness. This stops a later-uploaded
    // but OLDER OM from overwriting a newer rent roll's roster.
    const rosterSrc = all.filter(d => (d.tenants || []).length).sort((a, b) => {
      const aAsOf = _ts(a.tenantsAsOf), bAsOf = _ts(b.tenantsAsOf);
      if (aAsOf !== bAsOf) return bAsOf - aAsOf;            // newest real as-of first (none = 0 → last)
      const aRR = (a.tenantsManual || a.tenantsSource === "rent-roll") ? 1 : 0;
      const bRR = (b.tenantsManual || b.tenantsSource === "rent-roll") ? 1 : 0;
      if (aRR !== bRR) return bRR - aRR;                    // rent-roll / manual roster wins
      return dealFreshness(b) - dealFreshness(a);
    })[0];
    if (rosterSrc) {
      merged.tenants = rosterSrc.tenants;
      merged.tenantsAsOf = rosterSrc.tenantsAsOf;
      merged.tenantsManual = rosterSrc.tenantsManual;
      merged.tenantsSource = rosterSrc.tenantsSource;
      merged.occupancy = rosterSrc.occupancy;
      merged.walt = rosterSrc.walt;
      merged.weightedAvgRentPSF = rosterSrc.weightedAvgRentPSF;
    }

    // Sales history merged across all deals, newest upload per year.
    const sales = mergeSalesHistories(all);
    if (sales) merged.tenantSalesHistory = sales;

    // Demographics from the deal with the newest lookup.
    const demoSrc = all.filter(d => d.marketDemographics || d.demoChecked).sort((a, b) => demoDate(b) - demoDate(a))[0];
    if (demoSrc) {
      merged.marketDemographics = demoSrc.marketDemographics;
      merged.demoChecked = demoSrc.demoChecked;
    }

    // User-entered fields: keeper wins, gap-filled from others, never blanked.
    const userKeys = new Set<string>();
    for (const d of all) for (const k of Object.keys(d)) if (isUserField(k)) userKeys.add(k);
    for (const k of userKeys) {
      const kk = k as keyof Deal;
      let val: unknown = nonEmpty(keeper[kk]) ? keeper[kk] : undefined;
      if (val === undefined) for (const d of all) { if (nonEmpty(d[kk])) { val = d[kk]; break; } }
      if (val !== undefined) (merged as unknown as Record<string, unknown>)[k] = val;
    }

    // Verified flags: union across all. Notes: combine (de-duplicated).
    const mergedVerified: Record<string, unknown> = {};
    for (const d of all) for (const [k, v] of Object.entries(d.verified || {})) if (!mergedVerified[k]) mergedVerified[k] = v;
    merged.verified = mergedVerified as Deal["verified"];
    const allNotes = [...new Set(all.map(d => d.userNotes).filter((n): n is string => !!n))];
    merged.userNotes = allNotes.length ? allNotes.join("\n---\n") : undefined;

    // Cover image: keeper's, else first available.
    if (!merged.imageMeta?.cover) {
      const withCover = all.find(d => d.imageMeta?.cover);
      if (withCover) merged.imageMeta = withCover.imageMeta;
    }

    // Older-fills-blanks: for any factual field still empty on the survivor,
    // borrow it from the other deals (newest first). The newer source already
    // won every field it has; this pulls in the basics an older OM carries that a
    // rent roll never would (NOI, cap rate, address, narrative). Roster, sales,
    // demographics, verified flags and user-entered fields were resolved above
    // and are left untouched.
    const SKIP_GAPFILL = new Set<string>([
      "id", "uploadedAt", "refreshedAt", "trashedAt", "reviewQuestions",
      "tenants", "tenantsAsOf", "tenantsManual", "tenantsSource",
      "occupancy", "walt", "weightedAvgRentPSF",
      "tenantSalesHistory", "marketDemographics", "demoChecked",
      "verified", "userNotes",
    ]);
    const byFresh = all.slice().sort((a, b) => dealFreshness(b) - dealFreshness(a));
    const factKeys = new Set<string>();
    for (const d of all) for (const k of Object.keys(d)) if (!SKIP_GAPFILL.has(k) && !isUserField(k)) factKeys.add(k);
    for (const k of factKeys) {
      const mm = merged as unknown as Record<string, unknown>;
      if (nonEmpty(mm[k])) continue;
      for (const d of byFresh) { const v = (d as unknown as Record<string, unknown>)[k]; if (nonEmpty(v)) { mm[k] = v; break; } }
    }

    // Flag conflicts for review — where the merged deals disagreed on a key
    // factual field, keep the chosen (recency-based) value but surface the
    // alternative so it can be reviewed/overridden, like the upload path does.
    const CONFLICT_FIELDS: { key: keyof Deal; label: string; num: boolean; sev: "high" | "medium" | "low" }[] = [
      { key: "capRate", label: "Cap Rate", num: true, sev: "high" },
      { key: "noi", label: "NOI", num: true, sev: "high" },
      { key: "askingPrice", label: "Asking Price", num: true, sev: "high" },
      { key: "totalSF", label: "Total SF", num: true, sev: "high" },
      { key: "occupancy", label: "Occupancy %", num: true, sev: "medium" },
      { key: "grossPotentialRent", label: "Gross Potential Rent", num: true, sev: "medium" },
      { key: "walt", label: "WALT", num: true, sev: "low" },
      { key: "address", label: "Address", num: false, sev: "medium" },
      { key: "city", label: "City", num: false, sev: "low" },
      { key: "state", label: "State", num: false, sev: "low" },
    ];
    const numClose2 = (a: number, b: number) => { const m = Math.max(Math.abs(a), Math.abs(b), 1); return Math.abs(a - b) / m < 0.02; };
    const mmF = merged as unknown as Record<string, unknown>;
    const stamp = Date.now().toString(36);
    const conflictFlags: NonNullable<Deal["reviewQuestions"]> = [];
    for (const f of CONFLICT_FIELDS) {
      const win = mmF[f.key as string];
      if (!nonEmpty(win)) continue;
      const alt = all.find(d => {
        const v = (d as unknown as Record<string, unknown>)[f.key as string];
        if (!nonEmpty(v)) return false;
        return f.num
          ? !isNaN(Number(win)) && !isNaN(Number(v)) && !numClose2(Number(win), Number(v))
          : String(win).trim().toLowerCase() !== String(v).trim().toLowerCase();
      });
      if (!alt) continue;
      const altV = (alt as unknown as Record<string, unknown>)[f.key as string];
      const fmt = (v: unknown) => f.num ? Number(v).toLocaleString() : String(v);
      conflictFlags.push({
        id: `merge-${f.key as string}-${stamp}`, source: "check", severity: f.sev, field: f.label,
        question: `The merged deals had different ${f.label} values — keep the one shown or use the other?`,
        detail: `Kept: ${fmt(win)} · the other deal had: ${fmt(altV)}. The more recent value was kept; apply to switch.`,
        suggestedValue: String(altV),
        target: { kind: "deal", fieldKey: f.key as string, tenantName: null, valueType: f.num ? "number" : "text" },
      });
    }
    if (conflictFlags.length) {
      const prior = (merged.reviewQuestions || []).filter(q => !(q.id || "").startsWith("merge-"));
      merged.reviewQuestions = [...prior, ...conflictFlags];
    }

    // Keep the keeper's identity.
    merged.id = keeper.id;
    merged.uploadedAt = keeper.uploadedAt;
    merged.refreshedAt = new Date().toISOString();

    await apiSaveDeal(merged).catch(() => {});
    onUpdate(keeper.id, merged as Partial<Deal>);
    for (const o of others) onUpdate(o.id, { trashedAt: new Date().toISOString() });

    setMerging(false);
    setModal(null);
    clearSelection();
    setNotice(`Merged ${modal.deals.length} deals into one — newest data kept per section, your underwriting preserved. Extras are in Trash.`);
  };

  // ── Bulk: set a field across the selected properties ─────────────────────
  const applyBulkEdit = () => {
    const cfg = BULK_FIELDS.find(f => f.key === bulkEditField);
    if (!cfg) return;
    let v = bulkEditValue.trim();
    if (cfg.key === "state") v = v.toUpperCase();
    const finalVal = v === "" ? null : v;
    const patch: Record<string, unknown> = { [cfg.key]: finalVal };
    for (const k of cfg.also || []) patch[k] = finalVal;
    const n = selected.size;
    for (const id of selected) onUpdate(id, patch as Partial<Deal>);
    // Keep the selection (and the bulk-edit panel open) so several fields can be
    // applied to the same set in a row — just reset the value input.
    setBulkEditValue("");
    setNotice(`${cfg.label} ${finalVal === null ? "cleared" : `set to "${finalVal}"`} for ${n} propert${n === 1 ? "y" : "ies"}.`);
  };

  // ── Bulk: permanently delete ─────────────────────────────────────────────
  const bulkDelete = () => {
    // Gate: admins only, and the typed confirmation must read DELETE — so a
    // "select all → delete" can't happen by a careless click or a non-admin.
    if (!isAdmin || delConfirmText.trim().toUpperCase() !== "DELETE") return;
    const ids = Array.from(selected);
    if (onDelete) { for (const id of ids) onDelete(id); }
    else { const ts = new Date().toISOString(); for (const id of ids) onUpdate(id, { trashedAt: ts }); }
    clearSelection();
    setNotice(`Deleted ${ids.length} deal${ids.length === 1 ? "" : "s"}.`);
  };

  // ── Bulk: re-analyze from stored source text ─────────────────────────────
  const reanalyzeSelected = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (ids.length >= 2 && !(await confirmTokens(`re-analyze ${ids.length} deals`, ids.length, false))) return;
    clearSelection();
    setReanalyzeBusy(new Set(ids));

    const taskId = startAiTask(`Re-analyzing ${ids.length} deal${ids.length === 1 ? "" : "s"}`, `0 of ${ids.length}`);
    let done = 0, failed = 0;
    const tick = () => updateAiTask(taskId, { detail: `${done + failed} of ${ids.length}` });
    await Promise.all(ids.map(async id => {
      try {
        await apiReanalyzeDeal(id);
        // Poll until complete (max 10 min)
        const start = Date.now();
        while (Date.now() - start < 10 * 60 * 1000) {
          await new Promise(r => setTimeout(r, 4000));
          const status = await apiPollDealStatus(id);
          if (!status.processing) {
            if (status.deal) onUpdate(id, status.deal as Partial<Deal>);
            done++;
            break;
          }
        }
      } catch {
        failed++;
      } finally {
        tick();
        setReanalyzeBusy(prev => { const next = new Set(prev); next.delete(id); return next; });
      }
    }));

    finishAiTask(taskId, failed && !done ? "error" : "done", `Re-analysis done — ${done} updated${failed ? `, ${failed} failed` : ""}`);
    setNotice(`Re-analysis done — ${done} updated${failed ? `, ${failed} failed` : ""}.`);
  };

  // ── Bulk: re-run from PDF ────────────────────────────────────────────────
  const bulkRerun = () => {
    rerunTargetsRef.current = deals.filter(d => selected.has(d.id));
    rerunInputRef.current?.click();
  };

  const handleRerunFiles = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    e.target.value = "";
    if (!files.length) return;
    if (!ensureUploadAllowed()) return;
    clearSelection();
    if (onAddFiles) onAddFiles(files);
  };

  // ── Sale lookup ──────────────────────────────────────────────────────────
  const lookupSale = async (deal: Deal) => {
    const idInfo = {
      property: deal.propertyName, address: deal.address, market: deal.market,
      assetType: deal.assetType, centerType: deal.centerType,
      sellerInOM: deal.seller, brokerInOM: deal.broker, omDate: deal.omDate,
      approxSF: deal.totalSF, askingPriceInOM: deal.askingPrice,
    };
    const resp = await apiAiMessages({
      system: SALE_SYSTEM,
      messages: [{ role: "user", content: `Find the eventual sale of this property:\n${JSON.stringify(idInfo, null, 2)}\n\nReturn ONLY the JSON object.` }],
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });
    const textOut = (resp.content || []).filter(b => b.type === "text").map(b => b.text || "").join("\n").trim();
    return robustParseJSON(textOut);
  };

  const applySaleResult = (id: string, res: Record<string, unknown> | null) => {
    const ts = new Date().toISOString();
    const deal = deals.find(d => d.id === id);
    const relevant = !(res?.soldDate) || saleIsAfterOM(res.soldDate as string, deal?.omDate || null);
    const confirmed = !!(res?.found && res.confidence === "high" && relevant);
    if (confirmed) {
      const ms = {
        soldDate: res!.soldDate || null, price: res!.price ?? null, pricePerSF: res!.pricePerSF ?? null,
        capRate: res!.capRate ?? null, buyer: res!.buyer || null, seller: res!.seller || null,
        summary: res!.summary || "", sources: ((res!.sources as unknown[]) || []).slice(0, 6),
        confidence: res!.confidence, lookedUpAt: ts,
      };
      onUpdate(id, { marketSale: ms as any, marketSaleChecked: ts });
    } else {
      onUpdate(id, { marketSaleChecked: ts });
    }
    return confirmed;
  };

  const runSaleLookup = async (idsIterable: Iterable<string>) => {
    const ids = Array.from(idsIterable);
    if (!ids.length) return;
    if (!ensureUploadAllowed()) return;
    if (ids.length >= 2 && !(await confirmTokens(`search the web for sales on ${ids.length} deals`, ids.length, true))) return;
    clearSelection();
    setLookingUp(prev => new Set([...prev, ...ids]));
    let found = 0, none = 0, failed = 0;
    for (const id of ids) {
      const deal = deals.find(d => d.id === id);
      if (!deal) { setLookingUp(p => { const next = new Set(p); next.delete(id); return next; }); continue; }
      try {
        if (applySaleResult(id, await lookupSale(deal))) found++; else none++;
      } catch { failed++; }
      setLookingUp(p => { const next = new Set(p); next.delete(id); return next; });
    }
    setNotice(`Sale lookup done — ${found} confirmed sale${found === 1 ? "" : "s"} added${none ? `, ${none} with no confident match` : ""}${failed ? `, ${failed} failed` : ""}.`);
  };

  // ── Demographics lookup ──────────────────────────────────────────────────
  const lookupDemographics = async (deal: Deal) => {
    const idInfo = { property: deal.propertyName, address: deal.address, market: deal.market, submarket: deal.submarket };
    const resp = await apiAiMessages({
      system: DEMO_SYSTEM,
      messages: [{ role: "user", content: `Find 1/3/5-mile demographics for this property:\n${JSON.stringify(idInfo, null, 2)}\n\nReturn ONLY the JSON object.` }],
      max_tokens: 1500,
      tools: [{ type: "web_search_20250305", name: "web_search" }],
    });
    const textOut = (resp.content || []).filter(b => b.type === "text").map(b => b.text || "").join("\n").trim();
    return robustParseJSON(textOut);
  };

  const applyDemoResult = (id: string, res: Record<string, unknown> | null) => {
    const ts = new Date().toISOString();
    const num2 = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
    const md = res ? {
      pop1mi: num2(res.pop1mi), pop3mi: num2(res.pop3mi), pop5mi: num2(res.pop5mi),
      avgHHI1mi: num2(res.avgHHI1mi), avgHHI3mi: num2(res.avgHHI3mi), avgHHI5mi: num2(res.avgHHI5mi),
      source: res.source || null, asOf: res.asOf || null, note: res.note || "",
      confidence: res.confidence || "low", sources: ((res.sources as unknown[]) || []).slice(0, 6), lookedUpAt: ts,
    } : null;
    const has = md && [md.pop1mi, md.pop3mi, md.pop5mi, md.avgHHI1mi, md.avgHHI3mi, md.avgHHI5mi].some(v => v != null);
    if (has) onUpdate(id, { marketDemographics: md as any, demoChecked: ts });
    else onUpdate(id, { demoChecked: ts });
    return !!has;
  };

  const runDemographicsLookup = async (idsIterable: Iterable<string>) => {
    const ids = Array.from(idsIterable);
    if (!ids.length) return;
    if (!ensureUploadAllowed()) return;
    if (ids.length >= 2 && !(await confirmTokens(`pull web demographics for ${ids.length} deals`, ids.length, true))) return;
    clearSelection();
    setGettingDemo(prev => new Set([...prev, ...ids]));
    let got = 0, none = 0, failed = 0;
    for (const id of ids) {
      const deal = deals.find(d => d.id === id);
      if (!deal) { setGettingDemo(p => { const next = new Set(p); next.delete(id); return next; }); continue; }
      try {
        if (applyDemoResult(id, await lookupDemographics(deal))) got++; else none++;
      } catch { failed++; }
      setGettingDemo(p => { const next = new Set(p); next.delete(id); return next; });
    }
    setNotice(`Demographics done — ${got} properties updated${none ? `, ${none} with no confident data` : ""}${failed ? `, ${failed} failed` : ""}.`);
  };


  const isBusy = reanalyzeBusy.size > 0 || lookingUp.size > 0 || gettingDemo.size > 0;

  return (
    <div style={{ padding: "0 28px 28px" }}>
      {/* ── Token-spend confirmation modal ─────────────────────────────── */}
      {confirmGate && (
        <div onClick={() => resolveConfirm(false)} style={{ position: "fixed", inset: 0, background: "rgba(38,40,31,0.45)", zIndex: 600, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 16, maxWidth: 430, width: "100%", padding: "26px 26px 22px", boxShadow: "0 24px 60px rgba(38,40,31,0.28)", border: "1px solid #ece5d7" }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 19, color: "#26281f", fontWeight: 600, marginBottom: 10 }}>This will use API tokens</div>
            <div style={{ fontSize: 13.5, color: "#6f6a5f", lineHeight: 1.55, marginBottom: 22 }}>{confirmGate.body}</div>
            <div style={{ display: "flex", justifyContent: "flex-end", gap: 10 }}>
              <button onClick={() => resolveConfirm(false)} style={{ background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", padding: "9px 18px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Inter', sans-serif" }}>Cancel</button>
              <button onClick={() => resolveConfirm(true)} style={{ background: "#2a2c27", border: "none", color: "#f6f2ea", padding: "9px 18px", borderRadius: 9, cursor: "pointer", fontSize: 13, fontWeight: 700, fontFamily: "'Inter', sans-serif" }}>Continue</button>
            </div>
          </div>
        </div>
      )}

      {/* Link/Merge Modal */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "32px 36px", maxWidth: 480, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.15)", fontFamily: "'Inter', sans-serif" }}>
            {modal.action === "link" ? (
              <>
                <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 500, color: "#26281f", marginBottom: 6 }}>Link as same property</div>
                <div style={{ fontSize: 12, color: "#7d766a", marginBottom: 16, lineHeight: 1.6 }}>
                  Links these {modal.deals.length} deals as different years of the same property. <strong>Every OM is kept intact</strong> — nothing is deleted or merged. They'll appear together in Version History.
                </div>
                <div style={{ background: "#f1ece1", borderRadius: 10, padding: "12px 16px", marginBottom: 20 }}>
                  {modal.deals.map(d => (
                    <div key={d.id} style={{ fontSize: 12, color: "#383a37", padding: "3px 0" }}>
                      {d.propertyName || d.fileName || "Untitled"} {d.omDate ? `(${d.omDate.slice(0,4)})` : d.uploadedAt ? `(${new Date(d.uploadedAt).getFullYear()})` : ""}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={() => setModal(null)} style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Cancel</button>
                  <button onClick={commitLink} style={{ background: "#26281f", color: "#f1ece1", border: "none", padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Link deals</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 500, color: "#26281f", marginBottom: 6 }}>Merge duplicates</div>
                <div style={{ fontSize: 12, color: "#7d766a", marginBottom: 4, lineHeight: 1.6 }}>
                  <strong>Warning:</strong> Merge is for the <em>same OM uploaded more than once</em>. The non-keeper copies will be moved to Trash (reversible). Pick which deal is the "keeper":
                </div>
                <div style={{ background: "#fff8e6", border: "1px solid #d9890c40", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 11, color: "#a06208" }}>
                  Use "Link" instead if these are different years of the same property — Merge is only for true duplicates of the same OM.
                </div>
                <div style={{ marginBottom: 18 }}>
                  {modal.deals.map(d => (
                    <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: modal.keeperId === d.id ? "#6dba4312" : "transparent", border: modal.keeperId === d.id ? "1.5px solid #6dba43" : "1.5px solid transparent", marginBottom: 4, cursor: "pointer" }}>
                      <input type="radio" name="keeper" checked={modal.keeperId === d.id} onChange={() => setModal(m => m ? { ...m, keeperId: d.id } : m)} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#26281f" }}>{d.propertyName || d.fileName || "Untitled"}</div>
                        <div style={{ fontSize: 10, color: "#a89f8f" }}>{d.status} · uploaded {d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : "unknown"}</div>
                      </div>
                      {modal.keeperId === d.id && <span style={{ marginLeft: "auto", fontSize: 10, color: "#6dba43", fontWeight: 700 }}>KEEPER</span>}
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#a89f8f", marginBottom: 16 }}>
                  Human-entered data from the other copies will be absorbed into the keeper (notes, status, transaction details, images). The copies move to Trash.
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={() => setModal(null)} style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Cancel</button>
                  <button onClick={commitMerge} disabled={merging} style={{ background: "#dc2626", color: "#fff", border: "none", padding: "8px 20px", borderRadius: 8, cursor: merging ? "wait" : "pointer", fontSize: 12, fontWeight: 600, opacity: merging ? 0.7 : 1 }}>
                    {merging ? "Merging…" : `Merge (trash ${modal.deals.length - 1} cop${modal.deals.length - 1 === 1 ? "y" : "ies"})`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Combine phases modal */}
      {combineModal && (() => {
        const sel = deals.filter(d => combineModal.ids.includes(d.id));
        const numV = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? 0 : Number(v);
        const sum = (f: string) => sel.reduce((s, d) => s + numV((d as unknown as Record<string, unknown>)[f]), 0);
        const totSF = sum("totalSF"), totNOI = sum("noi");
        const totTenants = sel.reduce((s, d) => s + (Array.isArray(d.tenants) ? d.tenants.length : 0), 0);
        const fmt$ = (v: number) => v > 0 ? "$" + Math.round(v).toLocaleString() : "—";
        return (
          <div style={{ position: "fixed", inset: 0, background: "rgba(10,14,23,0.88)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
            <div style={{ background: "#faf7f0", border: "1px solid #383a37", borderRadius: 14, padding: 28, maxWidth: 520, width: "100%", maxHeight: "85vh", overflowY: "auto", fontFamily: "'Inter',sans-serif" }}>
              <div style={{ fontFamily: "'Fraunces',serif", fontWeight: 700, fontSize: 18, color: "#26281f", marginBottom: 6 }}>Combine {sel.length} OMs into one deal</div>
              <p style={{ fontSize: 12, color: "#3f7a1f", lineHeight: 1.6, margin: "0 0 16px", background: "#f0fae8", border: "1px solid #c6e6a0", borderRadius: 8, padding: "10px 14px" }}>
                For <strong>phases or parcels of one property you own</strong>. SF, NOI, income, and tenant rosters are <strong>added together</strong>; occupancy, WALT, cap rate, and rent/SF are recalculated. The extra OMs move to Trash (undoable for 15 s).
              </p>
              <div style={{ display: "flex", gap: 10, marginBottom: 18, flexWrap: "wrap" }}>
                {([["Combined SF", totSF > 0 ? totSF.toLocaleString() : "—"], ["Combined NOI", fmt$(totNOI)], ["Total tenants", String(totTenants)]] as [string, string][]).map(([l, v]) => (
                  <div key={l} style={{ flex: "1 1 120px", background: "#fff", border: "1px solid #e7e0d2", borderRadius: 9, padding: "10px 14px" }}>
                    <div style={{ fontSize: 9, letterSpacing: "0.07em", color: "#a69e91", textTransform: "uppercase", marginBottom: 4 }}>{l}</div>
                    <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#383a37" }}>{v}</div>
                  </div>
                ))}
              </div>
              <div style={{ fontSize: 11.5, color: "#7d766a", marginBottom: 10 }}>Keep this OM's name, address &amp; status for the combined deal:</div>
              {sel.map(d => (
                <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1.5px solid " + (combineModal.primaryId === d.id ? "#6dba43" : "#e7e0d2"), borderRadius: 9, padding: "10px 14px", marginBottom: 8, cursor: "pointer" }}>
                  <input type="radio" name="combinePrimary" checked={combineModal.primaryId === d.id} onChange={() => setCombineModal(m => m ? { ...m, primaryId: d.id } : m)} />
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 13, color: "#2a2c27", fontWeight: 600 }}>
                      {d.propertyName || d.fileName || "Untitled"}
                      {combineModal.primaryId === d.id && <span style={{ color: "#0f9d63", fontSize: 10, marginLeft: 8, fontWeight: 700 }}>PRIMARY</span>}
                    </div>
                    <div style={{ fontSize: 10.5, color: "#a69e91" }}>
                      {[d.address, d.totalSF ? Number(d.totalSF).toLocaleString() + " SF" : null, d.tenants?.length ? `${d.tenants.length} tenants` : null].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                </label>
              ))}
              <div style={{ display: "flex", gap: 8, marginTop: 12, justifyContent: "flex-end" }}>
                <button onClick={() => setCombineModal(null)} style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Cancel</button>
                <button onClick={() => doCombine(combineModal.primaryId, combineModal.ids)} disabled={combining} style={{ background: "#6dba43", border: "none", color: "#1f2b16", padding: "8px 18px", borderRadius: 8, cursor: combining ? "wait" : "pointer", fontSize: 12, fontWeight: 700, opacity: combining ? 0.7 : 1 }}>
                  {combining ? "Combining…" : "Combine into one deal"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Hidden file input for Re-run from PDF */}
      <input ref={rerunInputRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={handleRerunFiles} />

      {/* Notice toast */}
      {notice && (
        <div style={{ background: "#26281f", color: "#e8e0cf", borderRadius: 10, padding: "10px 16px", fontSize: 12, marginBottom: 8, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          {notice}
          <button onClick={() => setNotice(null)} style={{ background: "none", border: "none", color: "#a89f8f", cursor: "pointer", fontSize: 14, marginLeft: 12, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Combine undo banner */}
      {combineUndo && (
        <div style={{ background: "#2d4a1e", color: "#d4f0b8", borderRadius: 10, padding: "9px 16px", fontSize: 12, marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12 }}>
          <span>Extra OMs moved to Trash.</span>
          <button onClick={undoCombine} style={{ background: "#6dba43", border: "none", color: "#1f2b16", padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap" }}>Undo combine</button>
          <button onClick={() => { setCombineUndo(null); if (combineUndoTimerRef.current) clearTimeout(combineUndoTimerRef.current); }} style={{ background: "none", border: "none", color: "#8aad6a", cursor: "pointer", fontSize: 14, lineHeight: 1 }}>×</button>
        </div>
      )}

      {/* Busy indicator */}
      {isBusy && (
        <div style={{ background: "#f0fae8", border: "1px solid #c6e6a0", color: "#3d7a1c", borderRadius: 10, padding: "8px 14px", fontSize: 11.5, marginBottom: 10 }}>
          {reanalyzeBusy.size > 0 && `Re-analyzing ${reanalyzeBusy.size} deal${reanalyzeBusy.size === 1 ? "" : "s"}…`}
          {lookingUp.size > 0 && ` Looking up ${lookingUp.size} sale${lookingUp.size === 1 ? "" : "s"}…`}
          {gettingDemo.size > 0 && ` Pulling demographics for ${gettingDemo.size}…`}
        </div>
      )}

      {/* ── Bulk action bar (dark, fixed above list) ─────────────────────── */}
      {selected.size > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", background: "#383a37", borderRadius: 12, padding: "11px 16px", marginBottom: 12, boxShadow: "0 4px 16px rgba(56,58,55,0.18)" }}>
          <span style={{ color: "#ffffff", fontSize: 13, fontWeight: 600, flexShrink: 0 }}>{selected.size} selected</span>
          <div style={{ width: 1, height: 20, background: "#55574f", flexShrink: 0 }} />

          {/* Bulk edit fields (status, seller, broker, market, …) */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setBulkEditOpen(o => !o)} style={darkBtn}>
              Bulk edit ▾
            </button>
            {bulkEditOpen && (
              <div style={{ position: "absolute", top: "110%", left: 0, background: "#ffffff", border: "1px solid #e3dccd", borderRadius: 10, padding: 12, zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", width: 270 }}>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.06em", color: "#a69e91", textTransform: "uppercase", marginBottom: 6 }}>Set field for {selected.size} selected</div>
                <select value={String(bulkEditField)}
                  onChange={e => { const k = e.target.value as keyof Deal; setBulkEditField(k); const c = BULK_FIELDS.find(f => f.key === k); setBulkEditValue(c?.options ? c.options[0] : ""); }}
                  style={{ width: "100%", boxSizing: "border-box", padding: "7px 9px", border: "1px solid #d9d2c4", borderRadius: 7, fontSize: 12.5, fontFamily: "'Inter',sans-serif", background: "#fff", color: "#26281f" }}>
                  {BULK_FIELDS.map(f => <option key={String(f.key)} value={String(f.key)}>{f.label}</option>)}
                </select>
                {(() => {
                  const cfg = BULK_FIELDS.find(f => f.key === bulkEditField);
                  const ctrl: React.CSSProperties = { width: "100%", boxSizing: "border-box", padding: "7px 9px", border: "1px solid #d9d2c4", borderRadius: 7, fontSize: 12.5, fontFamily: "'Inter',sans-serif", background: "#fff", color: "#26281f", marginTop: 8 };
                  if (cfg?.options) {
                    return (
                      <select value={bulkEditValue} onChange={e => setBulkEditValue(e.target.value)} style={ctrl}>
                        {cfg.options.map(o => <option key={o} value={o}>{o}</option>)}
                      </select>
                    );
                  }
                  return <input value={bulkEditValue} onChange={e => setBulkEditValue(e.target.value)} placeholder="New value (blank = clear)" onKeyDown={e => { if (e.key === "Enter") applyBulkEdit(); }} style={ctrl} />;
                })()}
                <div style={{ fontSize: 10, color: "#a69e91", marginTop: 6, lineHeight: 1.4 }}>
                  {BULK_FIELDS.find(f => f.key === bulkEditField)?.hint || "Applies to all selected properties."}
                </div>
                <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
                  <button onClick={applyBulkEdit} style={{ background: "#26281f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Apply to {selected.size}</button>
                  <button onClick={() => setBulkEditOpen(false)} style={{ background: "transparent", color: "#837c6e", border: "1px solid #ddd4c2", borderRadius: 7, padding: "7px 12px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                </div>
              </div>
            )}
          </div>

          <div style={{ width: 1, height: 20, background: "#55574f", flexShrink: 0 }} />

          {/* Re-analyze */}
          <button onClick={reanalyzeSelected} style={{ ...darkBtn, opacity: reanalyzeBusy.size > 0 ? 0.6 : 1 }} disabled={reanalyzeBusy.size > 0}>
            Re-analyze
          </button>

          {/* Re-run from PDF */}
          <button onClick={bulkRerun} style={darkBtn}>
            Re-run from PDF
          </button>

          <div style={{ width: 1, height: 20, background: "#55574f", flexShrink: 0 }} />

          {/* Compare */}
          <button onClick={() => onCompare(Array.from(selected))} disabled={selected.size < 2} style={{ ...darkBtn, opacity: selected.size < 2 ? 0.4 : 1 }}>
            Compare
          </button>

          {/* Link as property */}
          <button onClick={() => openModal("link")} disabled={selected.size < 2} style={{ ...darkBtn, opacity: selected.size < 2 ? 0.4 : 1 }}>
            Link as property
          </button>

          {/* Merge */}
          <button onClick={() => openModal("merge")} disabled={selected.size < 2} style={{ ...darkBtn, opacity: selected.size < 2 ? 0.4 : 1 }}>
            Merge…
          </button>

          {/* Combine phases */}
          <button onClick={openCombine} disabled={selected.size < 2} style={{ ...darkBtn, opacity: selected.size < 2 ? 0.4 : 1, background: selected.size >= 2 ? "#4a7a2e" : "#52554e" }}>
            Combine phases…
          </button>

          <div style={{ width: 1, height: 20, background: "#55574f", flexShrink: 0 }} />

          {/* Find sale */}
          <button onClick={() => runSaleLookup(selected)} style={{ ...darkBtn, opacity: lookingUp.size > 0 ? 0.6 : 1 }} disabled={lookingUp.size > 0}>
            {lookingUp.size > 0 ? "Looking up…" : "Find sale"}
          </button>

          {/* Pull demographics */}
          <button onClick={() => runDemographicsLookup(selected)} style={{ ...darkBtn, opacity: gettingDemo.size > 0 ? 0.6 : 1 }} disabled={gettingDemo.size > 0}>
            {gettingDemo.size > 0 ? "Pulling…" : "Pull demographics"}
          </button>

          <div style={{ width: 1, height: 20, background: "#55574f", flexShrink: 0 }} />

          {/* Delete — admins only, and requires typing DELETE to run */}
          {isAdmin ? (
            confirmBulkDel ? (
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span style={{ color: "#ffb3b3", fontSize: 11.5 }}>Type <b>DELETE</b> to remove {selected.size}:</span>
                <input
                  autoFocus
                  value={delConfirmText}
                  onChange={e => setDelConfirmText(e.target.value)}
                  onKeyDown={e => { if (e.key === "Enter") bulkDelete(); }}
                  placeholder="DELETE"
                  style={{ width: 78, fontSize: 11.5, padding: "4px 8px", border: "1px solid #8a4b46", borderRadius: 6, background: "#2c2320", color: "#fff", fontFamily: "'Inter',sans-serif", outline: "none" }}
                />
                {(() => {
                  const ok = delConfirmText.trim().toUpperCase() === "DELETE";
                  return (
                    <button onClick={bulkDelete} disabled={!ok}
                      style={{ ...darkBtnDanger, padding: "5px 10px", opacity: ok ? 1 : 0.45, cursor: ok ? "pointer" : "not-allowed" }}>
                      Yes, delete
                    </button>
                  );
                })()}
                <button onClick={() => { setConfirmBulkDel(false); setDelConfirmText(""); }} style={{ ...darkBtn, padding: "5px 10px" }}>Cancel</button>
              </span>
            ) : (
              <button onClick={() => setConfirmBulkDel(true)} style={{ ...darkBtnDanger }}>Delete</button>
            )
          ) : (
            <span title="Bulk delete is restricted to admins" style={{ color: "#8a8c84", fontSize: 11, fontStyle: "italic" }}>Delete — admins only</span>
          )}

          {/* Clear selection */}
          <button onClick={clearSelection} style={{ background: "transparent", border: "none", color: "#b5b8b0", fontSize: 11, cursor: "pointer", fontFamily: "'Inter',sans-serif", marginLeft: "auto", flexShrink: 0 }}>
            ✕ Clear
          </button>
        </div>
      )}

      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search deals…"
          style={{ fontSize: 12, padding: "6px 12px", border: "1px solid #e3dccd", borderRadius: 8, color: "#383a37", background: "#fff", width: 180, minWidth: 0, fontFamily: "'Inter',sans-serif" }} />
        <MultiSelectDropdown
          label="statuses"
          options={STATUS_OPTS}
          selected={filterStatuses}
          onChange={setFilterStatuses}
        />
        {states.length > 0 && (
          <MultiSelectDropdown
            label="states"
            options={states}
            selected={filterStates}
            onChange={setFilterStates}
          />
        )}
        {types.length > 1 && (
          <MultiSelectDropdown
            label="types"
            options={types}
            selected={filterTypes}
            onChange={setFilterTypes}
          />
        )}
        <span style={{ fontSize: 11, color: "#a89f8f", marginLeft: "auto" }}>{rows.length} deal{rows.length !== 1 ? "s" : ""}</span>
        <button onClick={async () => { const { exportPortfolioToExcel } = await import("../lib/exportExcel"); exportPortfolioToExcel(rows, filterStatuses.length === 1 ? filterStatuses[0].replace(/\s+/g, "") : "All"); }} disabled={rows.length === 0}
          title="Export the current (filtered) deal list to Excel"
          style={{ background: "transparent", border: "1px solid #c8b89a", color: rows.length === 0 ? "#c9c2b8" : "#5c5047", padding: "5px 11px", borderRadius: 7, cursor: rows.length === 0 ? "default" : "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Inter',sans-serif", display: "flex", alignItems: "center", gap: 4 }}>
          ⬇ Excel
        </button>
        <button onClick={() => setViewMode(v => v === "table" ? "grid" : "table")}
          style={{ background: "transparent", border: "1px solid #e3dccd", color: "#a89f8f", padding: "5px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>
          {viewMode === "table" ? "⊞" : "☰"}
        </button>
      </div>

      {rows.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#a89f8f", fontSize: 14 }}>No deals match your filters.</div>
      )}

      {viewMode === "table" && rows.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 600 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #f1eadc", background: "#faf7f0" }}>
                  <th style={{ width: 28, padding: "10px 8px 10px 14px" }}>
                    <input type="checkbox" checked={selected.size === rows.length && rows.length > 0}
                      onChange={e => setSelected(e.target.checked ? new Set(rows.map(d => d.id)) : new Set())} />
                  </th>
                  <th style={{ width: 80, padding: "10px 8px" }} />
                  <th onClick={() => toggleSort("propertyName")}
                    style={{ padding: "10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "propertyName" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    Property{arrow("propertyName")}
                  </th>
                  <th onClick={() => toggleSort("status")}
                    style={{ padding: "10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "status" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    Status{arrow("status")}
                  </th>
                  <th onClick={() => toggleSort("city")}
                    style={{ padding: "10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "city" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    City{arrow("city")}
                  </th>
                  <th onClick={() => toggleSort("state")}
                    style={{ width: 70, padding: "10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "state" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    State{arrow("state")}
                  </th>
                  <th onClick={() => toggleSort("market")} className="hidden lg:table-cell"
                    style={{ padding: "10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "market" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    MSA{arrow("market")}
                  </th>
                  <th onClick={() => toggleSort("anchor")} className="hidden lg:table-cell"
                    style={{ padding: "10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "anchor" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    Anchor{arrow("anchor")}
                  </th>
                  <th onClick={() => toggleSort("totalSF")}
                    style={{ padding: "10px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "totalSF" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    SF{arrow("totalSF")}
                  </th>
                  <th onClick={() => toggleSort("occupancy")} className="hidden lg:table-cell"
                    style={{ padding: "10px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "occupancy" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    Occ{arrow("occupancy")}
                  </th>
                  <th onClick={() => toggleSort("capRate")}
                    style={{ padding: "10px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "capRate" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    Cap{arrow("capRate")}
                  </th>
                  <th onClick={() => toggleSort("askingPrice")}
                    style={{ padding: "10px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "askingPrice" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    Price{arrow("askingPrice")}
                  </th>
                  <th onClick={() => toggleSort("seller")}
                    style={{ padding: "10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "seller" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    Seller{arrow("seller")}
                  </th>
                  <th onClick={() => toggleSort("uploadedAt")}
                    style={{ padding: "10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "uploadedAt" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    Uploaded{arrow("uploadedAt")}
                  </th>
                  <th onClick={() => toggleSort("lastUploadAt")}
                    style={{ padding: "10px 14px 10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "lastUploadAt" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    Last Upload{arrow("lastUploadAt")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d, i) => {
                  const { quality } = assessExtraction(d);
                  const reviewCount = openReviewCount(d);
                  const busyRow = reanalyzeBusy.has(d.id) || lookingUp.has(d.id) || gettingDemo.has(d.id);
                  const anchor = leadAnchorName(d);
                  return (
                    <tr key={d.id}
                      style={{ borderBottom: "1px solid #f4f0e8", background: selected.has(d.id) ? "#6dba4309" : busyRow ? "#fffbf0" : i % 2 === 1 ? "#fdf9f3" : "#fff", cursor: "pointer" }}
                      onClick={() => onOpen(d.id)}>
                      <td style={{ padding: "8px 8px 8px 14px" }} onClick={e => { e.stopPropagation(); toggleSel(d.id); }}>
                        <input type="checkbox" checked={selected.has(d.id)} onChange={() => {}} />
                      </td>
                      <td style={{ padding: "8px 8px" }}>
                        <RowThumb deal={d} />
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <div
                          style={{ fontSize: 13, color: "#383a37", whiteSpace: "nowrap", maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis" }}
                          onMouseEnter={e => (e.currentTarget.style.color = "#3f7a1f")}
                          onMouseLeave={e => (e.currentTarget.style.color = "#383a37")}>
                          {d.propertyName || d.fileName || "Untitled"}
                          {busyRow && <span style={{ marginLeft: 6, fontSize: 9, color: "#d9890c" }}>● processing</span>}
                          {!busyRow && reviewCount > 0 && <span title={`${reviewCount} import detail${reviewCount === 1 ? "" : "s"} to confirm`} style={{ marginLeft: 6, fontSize: 9, color: "#9a6a1e", background: "#fff3df", border: "1px solid #e7c48f", borderRadius: 4, padding: "0 5px", fontWeight: 600 }}>📝 {reviewCount}</span>}
                        </div>
                        {quality !== "good" && !busyRow && <div style={{ fontSize: 9, color: quality === "thin" ? "#dc2626" : "#d9890c" }}>{quality === "thin" ? "thin extraction" : "partial"}</div>}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <StatusTag status={d.status} size="sm" />
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 11, color: d.city ? "#383a37" : "#6f6a5f", whiteSpace: "nowrap" }}>{cityOnly(d.city, d.state)}</td>
                      <td style={{ width: 70, padding: "8px 10px", fontSize: 11, color: d.state ? "#383a37" : "#6f6a5f", whiteSpace: "nowrap" }}>{d.state || "—"}</td>
                      <td className="hidden lg:table-cell" style={{ padding: "8px 10px", fontSize: 11, color: d.market ? "#383a37" : "#6f6a5f", whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{d.market || "—"}</td>
                      <td className="hidden lg:table-cell" style={{ padding: "8px 10px", fontSize: 11, color: anchor ? "#383a37" : "#6f6a5f", whiteSpace: "nowrap", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis" }}>{anchor || "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontSize: 11, color: "#5c5f57", whiteSpace: "nowrap" }}>{d.totalSF ? Number(d.totalSF).toLocaleString() : "—"}</td>
                      <td className="hidden lg:table-cell" style={{ padding: "8px 10px", textAlign: "right", fontSize: 11, color: "#5c5f57", whiteSpace: "nowrap" }}>{d.occupancy != null ? `${d.occupancy}%` : "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontSize: 11, color: "#0f9d63", whiteSpace: "nowrap" }}>{d.capRate != null ? `${d.capRate}%` : "—"}</td>
                      <td style={{ padding: "8px 10px", textAlign: "right", fontSize: 11, color: "#383a37", whiteSpace: "nowrap" }}>{fmtPriceShort(d.askingPrice)}</td>
                      <td style={{ padding: "8px 10px", fontSize: 11, color: d.seller ? "#383a37" : "#6f6a5f", whiteSpace: "nowrap", maxWidth: 160, overflow: "hidden", textOverflow: "ellipsis" }}>{d.seller || "—"}</td>
                      <td style={{ padding: "8px 10px", fontSize: 11, color: d.uploadedAt ? "#5c5f57" : "#6f6a5f", whiteSpace: "nowrap" }}>{d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "—"}</td>
                      {(() => { const lu = d.lastUploadAt || d.uploadedAt; return (
                        <td style={{ padding: "8px 14px 8px 10px", fontSize: 11, color: lu ? "#5c5f57" : "#6f6a5f", whiteSpace: "nowrap" }}>{lu ? new Date(lu).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" }) : "—"}</td>
                      ); })()}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewMode === "grid" && rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {rows.map(d => {
            const sc = STATUS_COLORS[d.status || ""] || "#a69e91";
            const loc = cityState(d);
            const adjScore = computeWatchlistImpact(d, watchMap).adjustScore(d.dealScore);
            return (
              <button key={d.id} onClick={() => onOpen(d.id)}
                style={{ position: "relative", height: 172, borderRadius: 14, overflow: "hidden", cursor: "pointer", border: "1px solid #ece5d7", textAlign: "left", padding: 0,
                  boxShadow: "0 1px 2px rgba(56,58,55,0.05), 0 14px 30px -24px rgba(56,58,55,0.6)",
                  background: d.imageMeta?.cover ? "#26281f" : "linear-gradient(135deg,#43463b,#26281f)", transition: "transform .2s ease" }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; const img = e.currentTarget.querySelector("img"); if (img) (img as HTMLImageElement).style.transform = "scale(1.06)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "none"; const img = e.currentTarget.querySelector("img"); if (img) (img as HTMLImageElement).style.transform = "none"; }}>
                {d.imageMeta?.cover && (
                  <img src={`/api/deals/${d.id}/cover-thumb?v=${encodeURIComponent(d.updatedAt || d.uploadedAt || "")}`} alt="" loading="lazy" decoding="async"
                    onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }}
                    style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transition: "transform .45s ease" }} />
                )}
                <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(38,40,31,0.10) 0%, rgba(38,40,31,0.34) 42%, rgba(38,40,31,0.86) 100%)" }} />
                <div style={{ position: "absolute", top: 11, left: 12, right: 12, display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
                  <span style={{ display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.93)", padding: "3px 9px", borderRadius: 20 }}>
                    <span style={{ width: 6, height: 6, borderRadius: "50%", background: sc }} />
                    <span style={{ fontSize: 9, color: sc, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{d.status || "—"}</span>
                  </span>
                  <ScoreBadge score={adjScore} size={11} />
                  <RecencyBadge deal={d} />
                </div>
                <div style={{ position: "absolute", left: 13, right: 13, bottom: 11, color: "#fff" }}>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, lineHeight: 1.18, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>{d.propertyName || d.fileName || "Untitled"}</div>
                  {loc && <div style={{ fontSize: 11, opacity: 0.86, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{loc}</div>}
                  <div style={{ display: "flex", gap: 12, marginTop: 5 }}>
                    {d.noi != null && <span style={{ fontSize: 11, color: "#9fe08a", fontWeight: 600 }}>${(Number(d.noi)/1e6).toFixed(1)}M NOI</span>}
                    {d.capRate != null && <span style={{ fontSize: 11, color: "#fff", opacity: 0.92, fontWeight: 600 }}>{d.capRate}% cap</span>}
                    {d.walt != null && <span style={{ fontSize: 11, color: Number(d.walt) < 3 ? "#ffb3b3" : "#fff", opacity: 0.92, fontWeight: 600 }}>{d.walt}y WALT</span>}
                  </div>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
