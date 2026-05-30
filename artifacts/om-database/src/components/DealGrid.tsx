import { useState, useEffect, useRef, useCallback } from "react";
import type { Deal } from "../lib/idb";
import { apiLoadImages, apiSaveImages, apiSaveDeal, apiReanalyzeDeal, apiPollDealStatus, apiAiMessages } from "../lib/api";
import { STATUS_COLORS, STATUS_OPTS } from "../lib/constants";
import { ensureUploadAllowed } from "../lib/uploadAuth";
import { classifyLocation, cityState, assessExtraction } from "../lib/utils";
import StatusTag from "./StatusTag";
import ScoreBadge from "./ScoreBadge";
import RecencyBadge from "./RecencyBadge";

interface Props {
  deals: Deal[];
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Deal>) => void;
  onCompare: (ids: string[]) => void;
  onAddFiles?: (files: File[]) => void;
}

function RowThumb({ deal }: { deal: Deal }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (deal.imageMeta?.cover) {
      apiLoadImages(deal.id).then(r => { if (alive) setSrc(r?.coverThumb || r?.cover || null); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [deal.id]);
  const initial = (deal.propertyName || deal.fileName || "?").charAt(0).toUpperCase();
  return (
    <div style={{ width: 64, height: 48, borderRadius: 4, overflow: "hidden", flexShrink: 0, background: "#eef3e6", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {src
        ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} />
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

export default function DealGrid({ deals, onOpen, onUpdate, onCompare, onAddFiles }: Props) {
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
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [confirmBulkDel, setConfirmBulkDel] = useState(false);
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
    rows = rows.filter(d => [d.propertyName, d.fileName, d.market, d.address, d.assetType].some(v => v?.toLowerCase().includes(s)));
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

  const toggleSort = (k: string) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const arrow = (k: string) => sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  const toggleSel = (id: string) => setSelected(s => { const next = new Set(s); next.has(id) ? next.delete(id) : next.add(id); return next; });
  const clearSelection = () => { setSelected(new Set()); setConfirmBulkDel(false); setBulkStatusOpen(false); };

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

    const absorbableFields: (keyof Deal)[] = [
      "userNotes","status","txnPurchasePrice","txnSeller","txnLoiDate","txnCloseDate",
      "txnSalePrice","txnBuyer","txnSaleDate","txnBroker",
      "acqCapRate","acqNOIAtClose","acqEntity","acqBroker","acqContractDate","acqDDExpiration",
      "acqDeposit","acqClosingCosts","acqFee","acqTitleCo","acqCounsel","acqPropManager",
      "acqStrategy","acqHoldPeriod","acqTargetIRR","acqNotes",
      "debtLender","debtType","debtLoanAmount","debtRate","debtMaturityDate","debtNotes",
      "marketSale","marketDemographics",
    ];

    const merged: Partial<Deal> = {};
    for (const f of absorbableFields) {
      const keeperVal = keeper[f];
      if (keeperVal == null || keeperVal === "") {
        for (const o of others) {
          const v = o[f];
          if (v != null && v !== "") { (merged as Record<string, unknown>)[f] = v; break; }
        }
      }
    }

    const mergedVerified = { ...(keeper.verified || {}) };
    for (const o of others) {
      for (const [k, v] of Object.entries(o.verified || {})) {
        if (!mergedVerified[k]) mergedVerified[k] = v;
      }
    }
    merged.verified = mergedVerified;

    if (!keeper.imageMeta?.cover) {
      for (const o of others) {
        if (o.imageMeta?.cover) { merged.imageMeta = o.imageMeta; break; }
      }
    }

    const otherNotes = others.map(o => o.userNotes).filter(Boolean).join("\n---\n");
    if (otherNotes && !keeper.userNotes) merged.userNotes = otherNotes;
    else if (otherNotes && keeper.userNotes) merged.userNotes = keeper.userNotes + "\n---\n" + otherNotes;

    const updatedKeeper: Deal = { ...keeper, ...merged };
    await apiSaveDeal(updatedKeeper).catch(() => {});
    onUpdate(keeper.id, merged);

    for (const o of others) onUpdate(o.id, { trashedAt: new Date().toISOString() });

    setMerging(false);
    setModal(null);
    clearSelection();
    setNotice(`Merged ${modal.deals.length} deals into one. The extras are in Trash if you need them back.`);
  };

  // ── Bulk: change status ──────────────────────────────────────────────────
  const bulkChangeStatus = (status: string) => {
    for (const id of selected) onUpdate(id, { status });
    setBulkStatusOpen(false);
    clearSelection();
    setNotice(`Status set to "${status}" for ${selected.size} deal${selected.size === 1 ? "" : "s"}.`);
  };

  // ── Bulk: delete (trash) ─────────────────────────────────────────────────
  const bulkDelete = () => {
    const ids = Array.from(selected);
    const ts = new Date().toISOString();
    for (const id of ids) onUpdate(id, { trashedAt: ts });
    clearSelection();
    setNotice(`Moved ${ids.length} deal${ids.length === 1 ? "" : "s"} to Trash.`);
  };

  // ── Bulk: re-analyze from stored source text ─────────────────────────────
  const reanalyzeSelected = async () => {
    const ids = Array.from(selected);
    if (!ids.length) return;
    if (ids.length >= 2 && !(await confirmTokens(`re-analyze ${ids.length} deals`, ids.length, false))) return;
    clearSelection();
    setReanalyzeBusy(new Set(ids));

    let done = 0, failed = 0;
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
        setReanalyzeBusy(prev => { const next = new Set(prev); next.delete(id); return next; });
      }
    }));

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

          {/* Change status */}
          <div style={{ position: "relative" }}>
            <button onClick={() => setBulkStatusOpen(o => !o)} style={darkBtn}>
              Change status ▾
            </button>
            {bulkStatusOpen && (
              <div style={{ position: "absolute", top: "110%", left: 0, background: "#ffffff", border: "1px solid #e3dccd", borderRadius: 10, padding: 6, zIndex: 50, boxShadow: "0 8px 24px rgba(0,0,0,0.15)", minWidth: 160 }}>
                {STATUS_OPTS.map(s => (
                  <button key={s} onClick={() => bulkChangeStatus(s)} style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "8px 10px", borderRadius: 7, cursor: "pointer", fontSize: 12, color: "#383a37", fontFamily: "'Inter',sans-serif", fontWeight: 500 }}
                    onMouseEnter={e => e.currentTarget.style.background = "#f6f2ea"}
                    onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
                    <span style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: STATUS_COLORS[s] || "#a69e91", marginRight: 8 }} />
                    {s}
                  </button>
                ))}
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

          {/* Delete */}
          {confirmBulkDel ? (
            <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "#ffb3b3", fontSize: 11.5 }}>Move {selected.size} to trash?</span>
              <button onClick={bulkDelete} style={{ ...darkBtnDanger, padding: "5px 10px" }}>Yes, trash</button>
              <button onClick={() => setConfirmBulkDel(false)} style={{ ...darkBtn, padding: "5px 10px" }}>Cancel</button>
            </span>
          ) : (
            <button onClick={() => setConfirmBulkDel(true)} style={{ ...darkBtnDanger }}>Delete</button>
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
                  <th onClick={() => toggleSort("state")} className="hidden lg:table-cell"
                    style={{ width: 70, padding: "10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "state" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    State{arrow("state")}
                  </th>
                  <th onClick={() => toggleSort("market")} className="hidden lg:table-cell"
                    style={{ padding: "10px 10px", textAlign: "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "market" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    MSA{arrow("market")}
                  </th>
                  <th onClick={() => toggleSort("totalSF")}
                    style={{ padding: "10px 14px 10px 10px", textAlign: "right", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === "totalSF" ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                    SF{arrow("totalSF")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {rows.map((d, i) => {
                  const { quality } = assessExtraction(d);
                  const busyRow = reanalyzeBusy.has(d.id) || lookingUp.has(d.id) || gettingDemo.has(d.id);
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
                        </div>
                        {quality !== "good" && !busyRow && <div style={{ fontSize: 9, color: quality === "thin" ? "#dc2626" : "#d9890c" }}>{quality === "thin" ? "thin extraction" : "partial"}</div>}
                      </td>
                      <td style={{ padding: "8px 10px" }}>
                        <StatusTag status={d.status} size="sm" />
                      </td>
                      <td style={{ padding: "8px 10px", fontSize: 11, color: d.city ? "#383a37" : "#6f6a5f", whiteSpace: "nowrap" }}>{d.city || "—"}</td>
                      <td className="hidden lg:table-cell" style={{ width: 70, padding: "8px 10px", fontSize: 11, color: d.state ? "#383a37" : "#6f6a5f", whiteSpace: "nowrap" }}>{d.state || "—"}</td>
                      <td className="hidden lg:table-cell" style={{ padding: "8px 10px", fontSize: 11, color: d.market ? "#383a37" : "#6f6a5f", whiteSpace: "nowrap", maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis" }}>{d.market || "—"}</td>
                      <td style={{ padding: "8px 14px 8px 10px", textAlign: "right", fontSize: 11, color: "#5c5f57", whiteSpace: "nowrap" }}>{d.totalSF ? Number(d.totalSF).toLocaleString() : "—"}</td>
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
            return (
              <button key={d.id} onClick={() => onOpen(d.id)}
                style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 14, padding: "16px 18px", textAlign: "left", cursor: "pointer", boxShadow: "0 1px 2px rgba(56,58,55,0.04)", transition: "transform .2s ease" }}
                onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-2px)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "none")}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: sc, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: sc, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{d.status}</span>
                  <ScoreBadge score={d.dealScore} size={11} />
                  <RecencyBadge deal={d} />
                </div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 500, color: "#26281f", marginBottom: 2, lineHeight: 1.2 }}>{d.propertyName || d.fileName || "Untitled"}</div>
                {loc && <div style={{ fontSize: 11, color: "#a89f8f", marginBottom: 10 }}>{loc}</div>}
                <div style={{ display: "flex", gap: 14 }}>
                  {d.noi && <div><div style={{ fontSize: 8, color: "#a89f8f", letterSpacing: "0.05em" }}>NOI</div><div style={{ fontSize: 13, color: "#0f9d63", fontWeight: 600 }}>${(Number(d.noi)/1e6).toFixed(1)}M</div></div>}
                  {d.capRate && <div><div style={{ fontSize: 8, color: "#a89f8f", letterSpacing: "0.05em" }}>CAP</div><div style={{ fontSize: 13, color: "#0f9d63", fontWeight: 600 }}>{d.capRate}%</div></div>}
                  {d.walt && <div><div style={{ fontSize: 8, color: "#a89f8f", letterSpacing: "0.05em" }}>WALT</div><div style={{ fontSize: 13, color: Number(d.walt) < 3 ? "#dc2626" : "#383a37", fontWeight: 600 }}>{d.walt}y</div></div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
