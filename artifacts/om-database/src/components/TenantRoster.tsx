import { useState, useRef, useEffect, useMemo } from "react";
import RecoveryWorking, { recoveryLabel } from "./RecoveryWorking";
import { createPortal } from "react-dom";
import { Info, Moon } from "lucide-react";
import type { Tenant, OccBreakdown, LeaseAbstract } from "../lib/idb";
import type { SizeFlag } from "../lib/tenantSizeBenchmark";
import type { SalesFlag } from "../lib/tenantSalesBenchmark";
import type { RentFlag } from "../lib/tenantRentBenchmark";
import { cinemaSalesRead, fmtPerScreen } from "../lib/theaterMetrics";
import { tjxComboRead } from "../lib/tjxCombo";
import { FLAG_META, FLAG_ORDER, isProposedTenant, nextRentStep, type ScrubRow, type FlagKey } from "../lib/rosterScrub";
import { fmtLeaseDate, fmtTenantSales, isVacant, isNAPTenant, isATM, isNonGLA, isHoldover, reimbursementChips, passedOptionNotices, tenantKey, toStepString, reimbursementFromAbstract, reimbursementFlag, statedReimbursementFlag, computeOccupancyCost, type RecoveryEntry } from "../lib/utils";
import { isInvestmentGrade } from "../lib/tenantCredit";
import { gradeOccupancyCost, type OccGrade } from "../lib/retailCategory";
import { useWatchlist, lookupWatch, WATCH_STATUS_META } from "../lib/useWatchlist";
import type { DatexLiveBlock } from "../lib/idb";
import { stickyFirstCol } from "../lib/stickyCol";
import { useTopScrollbar } from "../lib/useTopScrollbar";
import { useIsMobile } from "../hooks/use-mobile";
import { useMultiSort, chainComparator, isBlank, type SortLevel } from "../lib/multiSort";
import SortBar from "./SortBar";
import { rosterTotals } from "../lib/rosterTotals";

// Roster columns offered in the "Sorted by" bar. "isAnchor" is a sort-only key:
// ascending puts anchors first, so "Anchors first, then SF" is two clicks.
const ROSTER_SORT_LABELS: Record<string, string> = {
  isAnchor: "Anchors first", name: "Tenant", suite: "Suite", sf: "SF", rentPerSF: "Rent/SF",
  annualRent: "Annual rent", leaseStart: "Start", leaseExpiry: "Expiry", reimbursementMethod: "Reimbursement",
  salesPSF: "Sales", occupancyCost: "Occupancy cost", creditRating: "Credit",
};
const ROSTER_SORT_DEFAULT: SortLevel[] = [{ key: "sf", dir: "desc" }];

interface Props {
  tenants: Tenant[];
  onTenantClick?: (name: string) => void;
  onUpdateTenant?: (index: number, patch: Partial<Tenant>) => void;
  tenantsAsOf?: string | null;
  tenantsSource?: string | null;
  omDate?: string | null;
  // Live occupancy pulled from Datex (KPR-owned assets only). The roster itself is the
  // frozen acquisition-era record and is deliberately never overwritten by the import —
  // so without this the header shows only the capture date and reads as stale. Showing
  // both side by side is the point: the gap between them IS the finding.
  datexLive?: DatexLiveBlock | null;
  // Estimated per-tenant recoveries (by tenantKey) — used as a fallback for the
  // occupancy-cost calc when the OM didn't disclose a tenant's recoveries.
  estimatedRecoveries?: Map<string, RecoveryEntry>;
  /** Center-level note when calculated recoveries were withheld or look off. */
  recoveryNote?: string | null;
  // Latest sales (by tenantKey) from the Tenant Sales panel — when present, the
  // roster shows these (uploaded report figures) instead of the OM-stated sales.
  latestSales?: Map<string, { salesPSF: number | null; occupancyCost: number | null; occSource?: "stated" | "computed"; occBreakdown?: OccBreakdown | null; anecdotal?: boolean | null; provenance?: string | null }>;
  // Lease abstracts on file for this deal, keyed by lowercased tenant name. When a
  // tenant has one, an "Abstract" pill shows next to its name (opens the viewer);
  // otherwise a faint "+ Abstract" lets you add one. Both are optional — the roster
  // renders unchanged when these aren't supplied.
  abstractsByTenant?: Map<string, LeaseAbstract>;
  // Lowercased tenant name -> list of roster-vs-lease discrepancies (broker/rent-roll
  // disagreeing with the abstract). When present, the Abstract pill shows a ⚠.
  abstractDiscrepancies?: Map<string, string[]>;
  onOpenAbstract?: (tenantName: string) => void;
  onAddAbstract?: (tenantName: string) => void;
  // tenantKey -> SF outlier flag (this store's SF is way off the brand's prototype
  // footprint across the database). Shown next to the SF cell. Optional.
  sizeFlags?: Map<string, SizeFlag>;
  // tenantKey -> SALES outlier flag (this store's sales PSF is way off the brand's
  // typical productivity across the database; below = underperformer). Next to Sales. Optional.
  salesFlags?: Map<string, SalesFlag>;
  // tenantKey -> RENT outlier flag (this store's in-place rent PSF is way above/below
  // the chain's median across the database). Colors the Rent/SF cell. Optional.
  rentFlags?: Map<string, RentFlag>;
  // tenantKey -> kickout / early-termination summary (sales kickout, co-tenancy out,
  // early-termination option). Shown in the Kickout column. Optional.
  kickoutByTenant?: Map<string, { label: string; tip: string }>;
  // Owned deals: the recorded status of option notices whose date has passed (key =
  // "tenant|noticeDate"), and — for admins — a setter. Optional.
  optionStatus?: Map<string, string>;
  onSetOptionStatus?: (tenant: string, option: string, noticeDate: string, status: string) => void;
  // OM roster scrub (rosterScrub.ts): per-tenant flags + market benchmark, keyed by tenantKey.
  // When present the roster shows the Flags / Market-rent columns and the flag filters.
  scrubRows?: Map<string, ScrubRow>;
  /** Proposed / unsigned tenants are hidden (and out of the totals) unless this is on. */
  includeProposed?: boolean;
  onToggleProposed?: () => void;
}

function OccTip({ val, source, breakdown, grade }: { val: number; source: "stated" | "computed"; breakdown?: OccBreakdown | null; grade?: OccGrade | null }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number; flip: boolean } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const isMobile = useIsMobile();

  // Position the tooltip with FIXED coords from the trigger's rect (via a portal),
  // so it can't be clipped by the scrolling table and always tracks the cursor's row.
  // Opens above by default, but flips BELOW when too close to the viewport top.
  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const w = 290;
    const flip = r.top < 320; // not enough room above → open downward instead
    setPos({ top: flip ? r.bottom + 8 : r.top - 8, left: Math.max(12, Math.min(r.right, window.innerWidth - 12) - w), flip });
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

  // A non-finite occ-cost (e.g. a NaN slipping through from sales data) would
  // render as "NaN%" — show a dash instead. (After hooks, so order is stable.)
  if (!isFinite(val)) return <span style={{ color: "#a69e91" }}>—</span>;

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", gap: 3 }}>
      <span
        onMouseEnter={isMobile ? undefined : show}
        onMouseLeave={isMobile ? undefined : () => setOpen(false)}
        onClick={e => { e.stopPropagation(); if (open) setOpen(false); else show(); }}
        style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}
      >
        <span style={{ color: grade ? grade.color : undefined, fontWeight: grade && grade.tier !== "healthy" ? 700 : undefined }}>{val.toFixed(1)}%</span>
        <span style={{ fontSize: 8, letterSpacing: "0.04em", color: isStated ? "#0f9d63" : "#7d766a", background: isStated ? "#e7f8f0" : "#f3f4f6", border: `1px solid ${isStated ? "#a7f3d0" : "#d1d5db"}`, borderRadius: 3, padding: "0px 3px", fontWeight: 700, fontFamily: "'Inter',sans-serif" }}>
          {source}
        </span>
      </span>
      {open && pos && createPortal(
        <div style={{
          position: "fixed", top: pos.top, left: pos.left, transform: pos.flip ? "none" : "translateY(-100%)",
          background: "#fff", border: "1px solid #e6dfd0", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(56,58,55,0.18)", padding: "10px 14px",
          zIndex: 10000, width: 290, maxWidth: "calc(100vw - 24px)",
          fontSize: 11, fontFamily: "'Inter',sans-serif",
        }}>
          {breakdown ? (
            <>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 3 }}>
                <span style={{ color: "#a89f8f" }}>Base rent</span><span style={{ fontWeight: 600 }}>{fmt$(breakdown.base)}</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 3 }}>
                <span style={{ color: "#a89f8f" }}>{recoveryLabel(breakdown)}</span><span style={{ fontWeight: 600 }}>{fmt$(breakdown.reimbursements)}</span>
              </div>
              <RecoveryWorking b={breakdown} />
              {breakdown.percentRent > 0 && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 20, marginBottom: 3 }}>
                  <span style={{ color: "#a89f8f" }}>+ % Rent{breakdown.percentRentFormula ? " (lease formula)" : ""}</span><span style={{ fontWeight: 600 }}>{fmt$(breakdown.percentRent)}</span>
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
          {grade && (
            <div style={{ marginTop: 7, paddingTop: 6, borderTop: "1px solid #f1eadc", display: "flex", alignItems: "flex-start", gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: "50%", background: grade.color, flexShrink: 0, marginTop: 3 }} />
              <span style={{ color: "#5c5f57", lineHeight: 1.4 }}><b style={{ color: grade.color }}>{grade.short}.</b> {grade.detail}</span>
            </div>
          )}
        </div>,
        document.body
      )}
    </span>
  );
}

function fmtAsOf(raw: string): string {
  const d = new Date(raw.includes("T") ? raw : raw + "T00:00:00");
  if (isNaN(d.getTime())) return raw;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function FlagTip({ content, children, color = "#6b9fd4" }: { content: string; children: React.ReactNode; color?: string }) {
  const [open, setOpen] = useState(false);
  // Desktop popover position, computed from the trigger's on-screen rect so it can
  // be rendered in a portal (fixed) — escapes the scrolling table's clipping and
  // flips ABOVE the icon when there isn't room below (e.g. the bottom-most row).
  const [pos, setPos] = useState<{ top: number; left: number; flip: boolean } | null>(null);
  const showTimer = useRef<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  // Treat touch devices as "mobile" for this tooltip even when the viewport is wide
  // (e.g. Safari "Request Desktop Website" on a phone) — so a tap opens the readable
  // centered modal instead of the hover popover, which gets clipped on a phone.
  const isMobile = useIsMobile() || (typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(pointer: coarse)").matches);

  const place = () => {
    const r = ref.current?.getBoundingClientRect();
    if (!r) return;
    const W = 320;
    const flip = window.innerHeight - r.bottom < 180; // not enough room below → open upward
    const left = Math.max(12, Math.min(r.left, window.innerWidth - W - 12));
    setPos({ top: flip ? r.top - 6 : r.bottom + 6, left, flip });
  };

  const showSoon = () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => { place(); setOpen(true); }, 150);
  };
  const cancelHover = () => {
    if (showTimer.current) {
      window.clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    setOpen(false);
  };

  useEffect(() => {
    if (!open || isMobile) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open, isMobile]);

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: 5, verticalAlign: "middle" }}>
      <span
        onMouseEnter={isMobile ? undefined : showSoon}
        onMouseLeave={isMobile ? undefined : cancelHover}
        onClick={(e) => { e.stopPropagation(); if (!isMobile && !open) place(); setOpen(o => !o); }}
        style={{ color, cursor: "pointer", userSelect: "none" }}
        aria-label={content}
        role="button"
        tabIndex={0}
      >
        {children}
      </span>

      {/* Desktop: portal popover (fixed) that flips above the icon near the
          viewport bottom, so it's never clipped by the scrolling table. */}
      {open && !isMobile && pos && createPortal(
        <span
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "fixed",
            top: pos.top,
            left: pos.left,
            transform: pos.flip ? "translateY(-100%)" : "none",
            background: "#26281f",
            color: "#f6f2ea",
            padding: "9px 13px",
            borderRadius: 7,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "normal",
            maxWidth: 320,
            zIndex: 10000,
            boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
          }}
        >
          {content}
        </span>,
        document.body
      )}

      {/* Mobile: centered fixed modal */}
      {open && isMobile && (
        <>
          <span
            onClick={(e) => { e.stopPropagation(); setOpen(false); }}
            style={{
              position: "fixed",
              inset: 0,
              background: "rgba(0,0,0,0.38)",
              zIndex: 9998,
            }}
          />
          <span
            onClick={(e) => e.stopPropagation()}
            style={{
              position: "fixed",
              top: "50%",
              left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 9999,
              background: "#26281f",
              color: "#f6f2ea",
              padding: "20px 20px 16px",
              borderRadius: 12,
              fontSize: 13,
              lineHeight: 1.65,
              whiteSpace: "normal",
              width: "min(360px, 90vw)",
              boxShadow: "0 24px 60px rgba(0,0,0,0.45)",
              display: "flex",
              flexDirection: "column",
              gap: 14,
            }}
          >
            <span style={{ display: "block" }}>{content}</span>
            <button
              onClick={(e) => { e.stopPropagation(); setOpen(false); }}
              style={{
                background: "#3c3f35",
                border: "none",
                color: "#f6f2ea",
                padding: "10px 16px",
                borderRadius: 8,
                cursor: "pointer",
                fontSize: 13,
                fontFamily: "'Inter',sans-serif",
                fontWeight: 500,
                width: "100%",
              }}
            >
              Close
            </button>
          </span>
        </>
      )}
    </span>
  );
}

const TONE: Record<"good" | "bad" | "warn" | "info", { fg: string; bg: string }> = {
  good: { fg: "#2f7a22", bg: "#eaf6e5" }, bad: { fg: "#b3403f", bg: "#fdecec" }, warn: { fg: "#a8640f", bg: "#fff2e0" }, info: { fg: "#4b5563", bg: "#eef0f2" },
};

export default function TenantRoster({ tenants, onTenantClick, onUpdateTenant, tenantsAsOf, tenantsSource, omDate, datexLive, estimatedRecoveries, recoveryNote, latestSales, abstractsByTenant, abstractDiscrepancies, onOpenAbstract, onAddAbstract, sizeFlags, salesFlags, rentFlags, kickoutByTenant, optionStatus, onSetOptionStatus, scrubRows, includeProposed = false, onToggleProposed }: Props) {
  const [flagFilter, setFlagFilter] = useState<FlagKey | null>(null);
  const scrubOf = (t: Tenant) => scrubRows?.get(tenantKey(t.canonicalName || t.name));
  const proposedCount = useMemo(() => tenants.filter(t => !isVacant(t.name) && isProposedTenant(t)).length, [tenants]);
  const watchMap = useWatchlist();
  const scrollRef = useTopScrollbar<HTMLDivElement>();
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState("all");
  const sort = useMultiSort("roster-sort-v1", ROSTER_SORT_DEFAULT, { defaultDir: "asc", validKeys: Object.keys(ROSTER_SORT_LABELS) });
  const [expandedRentStep, setExpandedRentStep] = useState<number | null>(null);
  const [expandedOption, setExpandedOption] = useState<number | null>(null);
  const [expandedReimb, setExpandedReimb] = useState<number | null>(null);
  const [editingOcc, setEditingOcc] = useState<number | null>(null);
  const [editVals, setEditVals] = useState<{ reimb: string; pctRent: string; other: string }>({ reimb: "", pctRent: "", other: "" });
  // Theater screen/sales editor — a cinema is judged on sales PER SCREEN, so enter
  // the screen count and either sales/screen or total sales; the app derives salesPSF.
  const [editingScreens, setEditingScreens] = useState<number | null>(null);
  const [screensForm, setScreensForm] = useState<{ screens: string; perScreen: string; total: string }>({ screens: "", perScreen: "", total: "" });
  const openScreensEditor = (t: Tenant) => {
    const idx = tenants.indexOf(t);
    if (idx < 0) return;
    const sc = t.screens != null ? String(t.screens) : "";
    const sf = Number(t.sf) || 0;
    const psf = Number(t.salesPSF) || 0;
    const total = psf > 0 && sf > 0 ? Math.round(psf * sf) : 0;
    setScreensForm({ screens: sc, perScreen: "", total: total > 0 ? String(total) : "" });
    setEditingScreens(idx);
  };
  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);

  // Filter + sort the roster. Previously ran in the render body on every render;
  // memoized here so it only recomputes when its real inputs change. The sort
  // helpers (effSalesPSF/effOccCost) live inside so they aren't recreated per
  // render. Logic is unchanged.
  const rows = useMemo(() => {
    let rows = tenants.slice();
    // Proposed / unsigned leases are pipeline, not in-place (Eric, 10/18/26) — hidden unless toggled on.
    if (!includeProposed) rows = rows.filter(t => isVacant(t.name) || !isProposedTenant(t));
    if (flagFilter) rows = rows.filter(t => scrubRows?.get(tenantKey(t.canonicalName || t.name))?.flags.includes(flagFilter));
    if (quick==="anchors") rows = rows.filter(t => t.isAnchor);
    else if (quick==="dark") rows = rows.filter(t => t.isDark);
    else if (quick==="expiring") rows = rows.filter(t => n(t.remainingTermYears) != null && n(t.remainingTermYears)! < 2);
    else if (quick==="footnotes") rows = rows.filter(t => t.assumptionNote);
    if (q.trim()) { const s = q.toLowerCase(); rows = rows.filter(t => (t.name||"").toLowerCase().includes(s)); }

    const numKeys = new Set(["sf","rentPerSF","annualRent","salesPSF","occupancyCost"]);
    // Sales and Occ Cost are DISPLAYED from the resolved latest-sales figure (or the
    // computed rent-stack value), not the raw tenant field — so sort by that SAME
    // value, else the two columns appear unsorted. Mirrors the cell render exactly.
    const tk = (t: Tenant) => tenantKey(t.canonicalName || t.name);
    const effSalesPSF = (t: Tenant): number | null => (latestSales?.get(tk(t))?.salesPSF ?? null) ?? n(t.salesPSF);
    const effOccCost = (t: Tenant): number | null => {
      const ls = latestSales?.get(tk(t));
      if (ls && ls.occupancyCost != null && ls.occSource) return ls.occupancyCost;
      const stated = n(t.occupancyCost);
      if (stated != null) return stated;
      const sp = n(t.salesPSF), sfn = n(t.sf);
      const sales = (sp != null && sfn != null && sp > 0 && sfn > 0) ? sp * sfn : null;
      return computeOccupancyCost(t, estimatedRecoveries?.get(tk(t)), sales)?.occ ?? null;
    };
    const sortVal = (t: Tenant, key: string): number => {
      const v = key === "salesPSF" ? effSalesPSF(t) : key === "occupancyCost" ? effOccCost(t) : n((t as any)[key]);
      return v == null ? -Infinity : v;
    };
    const ascending = (key: string): ((a: Tenant, b: Tenant) => number) | null => {
      if (key === "abstract" || key === "kickout" || key === "flags" || key === "bench") return null;
      if (key === "isAnchor") return (a, b) => (a.isAnchor ? 0 : 1) - (b.isAnchor ? 0 : 1);
      if (numKeys.has(key)) return (a, b) => sortVal(a, key) - sortVal(b, key);
      return (a, b) => String((a as any)[key] ?? "").toLowerCase().localeCompare(String((b as any)[key] ?? "").toLowerCase());
    };
    rows = rows.slice().sort(chainComparator<Tenant>(sort.levels, ascending,
      (a, b) => String(a.name ?? "").toLowerCase().localeCompare(String(b.name ?? "").toLowerCase()),
      (key, t) => key === "isAnchor" ? false : numKeys.has(key) ? sortVal(t, key) === -Infinity : isBlank((t as any)[key])));
    return rows;
  }, [tenants, quick, q, sort.levels, latestSales, estimatedRecoveries, includeProposed, flagFilter, scrubRows]);

  const setSort = (k: string, e?: React.MouseEvent) => sort.onHeaderClick(k, e);
  const arrow = (k: string) => sort.marker(k);
  const chip = (key: string, label: string) => (
    <button key={key} onClick={() => setQuick(key)} style={{ background:quick===key?"#2a2c27":"transparent", color:quick===key?"#f6f2ea":"#7d766a", border:`1px solid ${quick===key?"#2a2c27":"#e3dccd"}`, padding:"4px 11px", borderRadius:20, fontSize:11, cursor:"pointer", fontWeight:500, fontFamily:"'Inter',sans-serif" }}>{label}</button>
  );

  const cols: [string, string, boolean][] = [
    ["name","Tenant",false],...(scrubRows ? [["flags","Flags",false] as [string, string, boolean]] : []),["abstract","",false],["suite","Suite",false],["sf","SF",true],["rentPerSF","Rent/SF",true],...(scrubRows ? [["bench","Mkt rent",true] as [string, string, boolean]] : []),["annualRent","Ann. Rent",true],
    ["leaseStart","Start",false],["leaseExpiry","Expiry",false],["reimbursementMethod","Reimb.",false],
    ["salesPSF","Sales",true],["occupancyCost","Occ Cost",true],
    ["rentSchedule","Next step",false],["renewalOptions","Options",false],["kickout","Kickout",false],
    ["recentlyExercisedRenewal","Recent Renewal",false],["creditRating","Credit",false],
  ];

  const isVacantRow = (t: Tenant) => isVacant(t.name);
  const NOSORT = new Set(["abstract", "kickout", "flags", "bench"]);
  // Rent-schedule segments inside the current term (option-period steps excluded).
  const MONTHS: Record<string, number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
  const afterExpiry = (seg: string, expiry: Date | null) => {
    if (!expiry) return false;
    const ey = expiry.getFullYear(), em = expiry.getMonth() + 1;
    const m1 = seg.match(/^(\d{4})-(\d{2})/);
    if (m1) { const sy = parseInt(m1[1], 10), sm = parseInt(m1[2], 10); return sy > ey || (sy === ey && sm >= em); }
    const m2 = seg.match(/^([A-Za-z]{3})[- ](\d{4})/);
    if (m2) { const sm = MONTHS[m2[1].toLowerCase()] ?? 0, sy = parseInt(m2[2], 10); return sy > ey || (sy === ey && sm >= em); }
    return false;
  };
  const rentStepList = (t: Tenant): string[] => {
    const sched = toStepString(t.rentSchedule) || toStepString(t.rentBumps);
    if (!sched) return [];
    const exp = t.leaseExpiry ? new Date(t.leaseExpiry) : null;
    return sched.split(";").map(x => x.trim()).filter(Boolean).filter(seg => !/option/i.test(seg) && !afterExpiry(seg, exp));
  };
  const optionsAndSteps = (t: Tenant): { opts: string[]; optionSteps: string[] } => {
    const o = toStepString(t.renewalOptions), rs = toStepString(t.rentSchedule) || toStepString(t.rentBumps);
    const exp = t.leaseExpiry ? new Date(t.leaseExpiry) : null;
    return { opts: o ? o.split(";").map(x => x.trim()).filter(Boolean) : [], optionSteps: rs ? rs.split(";").map(x => x.trim()).filter(Boolean).filter(seg => afterExpiry(seg, exp)) : [] };
  };

  // The reimbursement / lease structure for one row: badge (NNN / Fixed CAM / Gross), the
  // compact chips (cap 5% · admin 15% · audit), and the full text + CAM/Tax/Insurance
  // breakdown the drawer shows. The executed abstract outranks a stated method.
  const reimbInfo = (t: Tenant) => {
    const lt = t.leaseType || "";
    const isStruct = /\b(nnn|nn|net|gross|modified gross|mg|base\s*year|stop|triple net|double net|single net|cam)\b/i.test(lt);
    const stated = t.reimbursementMethod || (isStruct ? lt : "");
    const absObj = abstractsByTenant?.get((t.name || "").trim().toLowerCase());
    const absText = reimbursementFromAbstract(absObj);
    const m = absText || stated || "";
    if (!m) return null;
    const fromAbstract = !!absText;
    const flag = fromAbstract ? reimbursementFlag(m) : statedReimbursementFlag(t.reimbursementMethod || "", lt);
    const norm = (x: string) => x.replace(/[^a-z]/gi, "").toLowerCase();
    const body = (fromAbstract ? m.replace(/^\s*(fixed cam \(net\)|fixed cam|modified gross|nnn|gross)\s*[—\-:]\s*/i, "").trim() : m).trim();
    const noteOf = (code: string) => (absObj?.leaseNotes || []).find(nn => (nn.code || "").toUpperCase() === code)?.value?.trim() || "";
    const breakdown = ([["CAM", noteOf("CAM")], ["Taxes", noteOf("RETX")], ["Insurance", noteOf("INS")]] as [string, string][]).filter(([, v]) => v && !/^none\b/i.test(v));
    const showBody = !!body && !(flag && norm(body) === norm(flag.label));
    const chips = reimbursementChips([m, ...breakdown.map(([, v]) => v)].join(" "));
    return { flag, fromAbstract, body: showBody ? body : "", breakdown, chips, textColor: flag && flag.warn ? flag.color : "#5c5f57", hasDetail: showBody || breakdown.length > 0 };
  };

  // Roster occupancy aggregates by SQUARE FOOTAGE (the CRE standard), over the FULL
  // roster: NAP parcels are excluded (owner-occupied, not leasable GLA) and dark
  // stores count as occupied (still leased/paying). Null when there's no SF to
  // compute from. Memoized so the several passes over the roster only run when the
  // tenant list changes (not on every keystroke / sort toggle). Logic unchanged.
  const { vacantCount, occupiedCount, totalRosterSF, vacantSF, darkSF, pctOccupied, pctVacant, pctVacantInclDark } = useMemo(() => {
    // A non-GLA sliver (a 90 SF utility closet) is not vacancy; its SF isn't GLA either.
    const vacant = (t: Tenant) => (isVacant(t.name) && !isNonGLA(t)) || (!includeProposed && isProposedTenant(t));
    const sfOf = (t: Tenant) => { if (isNonGLA(t)) return 0; const v = n(t.sf); return v != null && v > 0 ? v : 0; };
    const counted = tenants.filter(t => !(isNonGLA(t) && isVacant(t.name)));
    const vacantCount = counted.filter(vacant).length;
    const occupiedCount = counted.length - vacantCount;
    const leasableRows = counted.filter(t => !isNAPTenant(t));
    const totalRosterSF = leasableRows.reduce((s, t) => s + sfOf(t), 0);
    const vacantSF = leasableRows.filter(vacant).reduce((s, t) => s + sfOf(t), 0);
    // Dark stores still pay rent (so they count as OCCUPIED in the headline figure),
    // but they're vacancy-like risk — surfaced separately as "% vacant including dark."
    const darkSF = leasableRows.filter(t => t.isDark && !vacant(t)).reduce((s, t) => s + sfOf(t), 0);
    const pctOccupied = totalRosterSF > 0 ? ((totalRosterSF - vacantSF) / totalRosterSF) * 100 : null;
    const pctVacant = totalRosterSF > 0 ? (vacantSF / totalRosterSF) * 100 : null;
    const pctVacantInclDark = totalRosterSF > 0 ? ((vacantSF + darkSF) / totalRosterSF) * 100 : null;
    return { vacantCount, occupiedCount, totalRosterSF, vacantSF, darkSF, pctOccupied, pctVacant, pctVacantInclDark };
  }, [tenants, includeProposed]);
  const fmtPct = (v: number) => `${(Math.round(v * 10) / 10).toFixed(1).replace(/\.0$/, "")}%`;

  // Totals / weighted averages for the rows currently shown (respects filters).
  const totals = useMemo(() => rosterTotals(rows,
    t => (latestSales?.get(tenantKey(t.canonicalName || t.name))?.salesPSF ?? null) ?? n(t.salesPSF)),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [rows, latestSales]);
  const totalsFiltered = quick !== "all" || q.trim() !== "";
  const isMobileRoster = useIsMobile();

  const asOfDate = tenantsAsOf || omDate;
  const asOfLabel = tenantsSource === "rent-roll" ? "RENT ROLL" : "OM";

  return (
    <div style={{ background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:8, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>Tenant Roster — {rows.length===tenants.length ? `${occupiedCount} tenant${occupiedCount!==1?"s":""}${vacantCount>0?` · ${vacantCount} vacant`:""}` : `${rows.length} of ${tenants.length}`}</div>
          {asOfDate && (
            <span style={{ fontSize:9, letterSpacing:"0.07em", fontWeight:600, color: tenantsSource==="rent-roll" ? "#0d9488" : "#a89f8f", background: tenantsSource==="rent-roll" ? "#f0fdfa" : "#f6f2ea", border:`1px solid ${tenantsSource==="rent-roll" ? "#99f6e4" : "#e3dccd"}`, borderRadius:8, padding:"2px 8px", textTransform:"uppercase", whiteSpace:"nowrap" }}>
              AS OF {fmtAsOf(asOfDate)} · {asOfLabel}
            </span>
          )}
          {datexLive?.asOf && (
            <span title={`Live from Datex — KPR's property-management system of record — for period ${datexLive.period ?? "?"}. The roster above is the acquisition-era rent roll and is deliberately left untouched by the Datex import; this chip is the CURRENT occupancy. Where the two disagree, Datex governs on an owned asset.`}
              style={{ fontSize:9, letterSpacing:"0.07em", fontWeight:600, color:"#1d4ed8", background:"#eff6ff", border:"1px solid #bfdbfe", borderRadius:8, padding:"2px 8px", textTransform:"uppercase", whiteSpace:"nowrap" }}>
              📡 DATEX {fmtAsOf(datexLive.asOf)}
              {datexLive.occupancyPct != null && ` · ${fmtPct(datexLive.occupancyPct)} OCC`}
              {datexLive.totalUnits != null && ` · ${datexLive.totalUnits} UNITS`}
            </span>
          )}
        </div>
        <div style={{ display:"flex", gap:7, alignItems:"center", flexWrap:"wrap" }}>
          {chip("all","All")}{chip("anchors","Anchors")}{chip("expiring","Expiring ≤2yr")}
          {tenants.some(t => t.isDark) && chip("dark","Dark")}
          {tenants.some(t => t.assumptionNote) && chip("footnotes","Has footnote")}
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Filter tenants…"
            style={{ fontSize:12, padding:"5px 10px", border:"1px solid #e3dccd", borderRadius:7, color:"#383a37", background:"#fff", width:150, fontFamily:"'Inter',sans-serif" }}/>
        </div>
      </div>
      {(scrubRows || proposedCount > 0) && (() => {
        const counts = new Map<FlagKey, number>();
        for (const sr of scrubRows?.values() ?? []) for (const f of sr.flags) counts.set(f, (counts.get(f) ?? 0) + 1);
        return (
          <div style={{ display:"flex", gap:6, flexWrap:"wrap", alignItems:"center", marginBottom:10 }}>
            <span style={{ fontFamily:"'Montserrat',sans-serif", fontSize:9.5, fontWeight:800, letterSpacing:"0.1em", color:"#676767", textTransform:"uppercase", marginRight:2 }}>Flags</span>
            {FLAG_ORDER.filter(f => f !== "proposed" && counts.get(f)).map(f => {
              const m = FLAG_META[f], on = flagFilter === f, c = TONE[m.tone];
              return <button key={f} onClick={() => setFlagFilter(on ? null : f)} title={m.tip} aria-pressed={on}
                style={{ display:"inline-flex", alignItems:"center", gap:4, background: on ? c.fg : c.bg, color: on ? "#fff" : c.fg, border:"none", borderRadius:14, padding:"3px 9px", fontSize:11, fontWeight:700, cursor:"pointer" }}>{m.icon} {m.label} <span style={{ opacity:0.8, fontWeight:600 }}>{counts.get(f)}</span></button>;
            })}
            {proposedCount > 0 && onToggleProposed && (
              <button onClick={onToggleProposed} aria-pressed={includeProposed} title={FLAG_META.proposed.tip}
                style={{ display:"inline-flex", alignItems:"center", gap:4, background: includeProposed ? "#a8640f" : "#fff2e0", color: includeProposed ? "#fff" : "#a8640f", border:"1px dashed #e8c48d", borderRadius:14, padding:"3px 9px", fontSize:11, fontWeight:700, cursor:"pointer" }}>
                ✎ {includeProposed ? "Hide" : "Show"} proposed / unsigned ({proposedCount})
              </button>
            )}
            {flagFilter && <button onClick={() => setFlagFilter(null)} style={{ background:"none", border:"none", color:"#676767", fontSize:11, textDecoration:"underline", cursor:"pointer" }}>clear</button>}
          </div>
        );
      })()}
      {recoveryNote && (
        <div style={{ fontSize:11.5, lineHeight:1.5, color:"#7a4a10", background:"#fdf4e7", border:"1px solid #f0d9b5", borderRadius:8, padding:"7px 10px", marginBottom:8 }}>
          ⚠ Occupancy cost: {recoveryNote}
        </div>
      )}
      {pctOccupied != null && (
        <div style={{ marginBottom:13 }}>
          <span title="Occupied vs vacant by square footage (NAP / owner-occupied parcels excluded; dark stores count as occupied since they still pay rent). The parenthetical adds dark — closed but still-paying — stores to vacancy."
            style={{ display:"inline-block", fontSize:9, letterSpacing:"0.07em", fontWeight:600, color:"#3f7a1f", background:"#eef3e6", border:"1px solid #b8d49a", borderRadius:8, padding:"3px 9px", textTransform:"uppercase", lineHeight:1.6 }}>
            {fmtPct(pctOccupied)} OCCUPIED · <span style={{ color: (pctVacant ?? 0) > 0 ? "#c97a18" : "#3f7a1f" }}>{fmtPct(pctVacant ?? 0)} VACANT</span>
            {darkSF > 0 && pctVacantInclDark != null && (
              <span style={{ color:"#9a5b12", fontWeight:700 }}> ({fmtPct(pctVacantInclDark)} INC. DARK TENANTS)</span>
            )}
          </span>
        </div>
      )}
      <SortBar levels={sort.levels} setLevels={sort.setLevels} labels={ROSTER_SORT_LABELS}
        isDefault={sort.isDefault} onReset={sort.reset} defaultDir="asc" />
      <div ref={scrollRef} style={{ overflowX:"auto" }}>
        <style>{`.kpr-roster td{white-space:nowrap;height:38px;vertical-align:middle}.kpr-roster tbody tr.kpr-roster-row:hover td{background:#faf8f2}.kpr-roster thead th{position:sticky;top:0;background:#fff;z-index:2}`}</style>
        <table className="kpr-roster" style={{ borderCollapse:"collapse", fontSize:12, minWidth:1180, width:"100%", fontVariantNumeric:"tabular-nums" }}>
          <thead>
            <tr style={{ fontSize:10, letterSpacing:"0.03em" }}>
              {cols.map(([k,label,right]) => (
                <th key={k} title={k === "salesPSF" ? "Sales / SF (latest). Two markers may appear: ↗ / ↘ = year-over-year sales trend; ▲ / ▼ = this store vs the brand's median across your library (green = strong, red = weak)." : NOSORT.has(k) ? undefined : "Click to sort by this column · Shift-click to add it as a tiebreaker"} onClick={NOSORT.has(k) ? undefined : (e) => setSort(k, e)} className={k === "name" ? "freeze-col" : undefined} style={{ padding:"6px 10px", textAlign:right?"right":"left", cursor: NOSORT.has(k) ? "default" : "pointer", whiteSpace:"nowrap", userSelect:"none", color:sort.isSorted(k)?"#383a37":"#a69e91", fontWeight:600, ...(k === "name" ? stickyFirstCol("#fff", true) : null) }}>{label}{NOSORT.has(k) ? null : arrow(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t,i) => (
              <tr key={i} className="kpr-roster-row" onClick={e => { if ((e.target as HTMLElement).closest("button,input,select,a,[data-noprop]")) return; setExpandedReimb(i); }} style={{ cursor:"pointer", borderTop:"1px solid #f1eadc", opacity: isNAPTenant(t) ? 0.7 : isVacantRow(t) ? 0.65 : 1, background: t.isDark && !isVacantRow(t) ? "#fbf1e4" : undefined }}>
                <td className="freeze-col" style={{ padding:"8px 10px", whiteSpace:"nowrap", ...stickyFirstCol(t.isDark && !isVacantRow(t) ? "#fbf1e4" : "#fff") }}>
                  {isVacantRow(t) ? (
                    isNonGLA(t)
                      ? <span title="Not leasable GLA (a utility / meter closet or similar) — excluded from GLA and vacancy" style={{ color:"#a69e91", fontStyle:"italic", fontWeight:400, fontSize:11 }}>{t.name && !/^vacant$/i.test(t.name.trim()) ? t.name : "Utility / non-GLA space"} <span style={{ fontStyle:"normal", fontSize:8.5, fontWeight:700, color:"#6f6a5f", background:"#f1f0ec", padding:"1px 6px", borderRadius:9 }}>NON-GLA</span></span>
                      : <span style={{ color:"#a69e91", fontStyle:"italic", fontWeight:400, fontSize:11 }}>Vacant</span>
                  ) : (
                    <div style={{ display:"flex", alignItems:"center", flexWrap:"nowrap", gap:4, minWidth:0 }}>
                      <span data-noprop=""
                        onClick={onTenantClick && t.name ? () => onTenantClick(t.name!) : undefined}
                        title={onTenantClick && t.name ? `View ${t.name} across your portfolio` : undefined}
                        style={{ color: t.isDark ? "#9a5b12" : "#383a37", fontWeight:600, cursor:onTenantClick?"pointer":"default", textDecoration:onTenantClick?"underline":"none", textDecorationColor:"#d8cfbd", textUnderlineOffset:"2px", whiteSpace:"nowrap" }}>
                        {t.name}
                      </span>
                      {t.isAnchor && <span style={{ fontSize:9, color:"#1f2b16", background:"#6dba4322", padding:"1px 6px", borderRadius:10, fontWeight:600 }}>ANCHOR</span>}
                      {isNonGLA(t) && <span title="Not leasable GLA (ATM, antenna, license, utility space) — its rent counts, its SF doesn't count toward GLA or vacancy" style={{ fontSize:9, color:"#6f6a5f", background:"#f1f0ec", padding:"1px 6px", borderRadius:10, fontWeight:700 }}>NON-GLA</span>}
                      {isHoldover(t) && <span title={`Lease expired ${fmtLeaseDate(t.leaseExpiry)} but the tenant is still on the roll — a holdover (month-to-month) tenancy, not a firm lease. Confirm a renewal or extension.`} style={{ fontSize:9, color:"#b3403f", background:"#fdecec", padding:"1px 6px", borderRadius:10, fontWeight:700 }}>HOLDOVER</span>}
                      {(() => {
                        // TJX combo box — two banners (e.g. Marshalls + HomeGoods) on one
                        // lease. Explicit two-banner names show "COMBO"; a single-banner
                        // name on a combo-sized box shows "COMBO?" (verify the 2nd banner).
                        const c = tjxComboRead(t.canonicalName || t.name, t.sf);
                        if (!c.isCombo && !c.likely) return null;
                        return (
                          <span title={c.note} style={{ fontSize:9, color:"#7a3ea8", background:"#f2e9fb", border:"1px solid #ddc7f0", padding:"1px 6px", borderRadius:10, fontWeight:700, letterSpacing:"0.03em", whiteSpace:"nowrap" }}>
                            {c.isCombo ? "COMBO" : "COMBO?"}
                          </span>
                        );
                      })()}
                      {isATM(t.name, t.sf) && (
                        <span style={{ fontSize:9, color:"#5a6b8c", background:"#eef1f7", border:"1px solid #cdd6e6", padding:"1px 6px", borderRadius:10, fontWeight:600 }} title="ATM — a cash machine, not a full bank branch (tracked separately, same parent company)">ATM</span>
                      )}
                      {isNAPTenant(t) && (
                        <span style={{ fontSize:9, color:"#7c6340", background:"#f5ede0", border:"1px solid #e0c9a8", padding:"1px 6px", borderRadius:10, fontWeight:600 }} title="Not A Part — this tenant owns their parcel and pays no rent to the landlord">NAP</span>
                      )}
                      {t.isDark && (
                        <span
                          title="Dark store — closed/not operating but still paying rent. Set from the OM/rent-roll data; not manually editable."
                          style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:9, color:"#fff", background:"#3a342b", padding:"1px 6px", borderRadius:10, fontWeight:700, letterSpacing:"0.04em" }}>
                          <Moon size={9} strokeWidth={2.25} /> DARK
                        </span>
                      )}
                      {(t.leaseStatus === "loi" || t.leaseStatus === "proposed") && (
                        <span title="Lease NOT executed — only at Letter-of-Intent / proposed stage but modeled in place. In-place NOI is overstated until it's signed." style={{ fontSize:9, color:"#9a3412", background:"#fdecdc", border:"1px solid #f0c08a", padding:"1px 6px", borderRadius:10, fontWeight:700, letterSpacing:"0.03em", whiteSpace:"nowrap" }}>{t.leaseStatus === "loi" ? "LOI" : "PROPOSED"}</span>
                      )}
                      {t.leaseStatus === "signed-not-open" && (
                        <span title="Lease executed but the store has not opened / rent has not commenced — confirm rent-commencement date." style={{ fontSize:9, color:"#1f4d8f", background:"#eaf1fb", border:"1px solid #c2d6f0", padding:"1px 6px", borderRadius:10, fontWeight:700, letterSpacing:"0.03em", whiteSpace:"nowrap" }}>SIGNED · NOT OPEN</span>
                      )}
                      {t.name && isInvestmentGrade(t.name, t.creditRating) && <span title="Investment-grade credit" style={{ fontSize:9, color:"#3f7a1f", background:"#eef3e6", border:"1px solid #b8d49a", padding:"1px 5px", borderRadius:4, fontWeight:700 }}>IG</span>}
                      {(() => {
                        // "OVERAGE" pill: tenant's sales exceed its percentage-rent
                        // breakpoint, so it is paying (or near) overage rent — a sign
                        // of a strong performer and mark-to-market evidence.
                        const bp = n(t.percentageRentBreakpoint), sp = n(t.salesPSF), sfn = n(t.sf), rate = n(t.percentageRentRate);
                        if (bp == null || bp <= 0 || sp == null || sfn == null) return null;
                        const sales = sp * sfn;
                        if (sales <= bp) return null;
                        const overage = rate != null ? ((sales - bp) * rate) / 100 : null;
                        return (
                          <span title={`Sales ($${Math.round(sales).toLocaleString()}) exceed the percentage-rent breakpoint ($${Math.round(bp).toLocaleString()})${rate != null ? ` — paying ~$${Math.round(overage!).toLocaleString()}/yr overage at ${rate}%` : ""}. A strong-performer / mark-to-market signal.`}
                            style={{ fontSize:9, color:"#0f6b46", background:"#e7f8f0", border:"1px solid #a7f3d0", padding:"1px 6px", borderRadius:4, fontWeight:700, letterSpacing:"0.03em", whiteSpace:"nowrap" }}>OVERAGE</span>
                        );
                      })()}
                      {(() => {
                        const w = lookupWatch(watchMap, t.name);
                        if (!w) return null;
                        const m = WATCH_STATUS_META[w.status] || WATCH_STATUS_META.watch;
                        return (
                          <span
                            title={`Retailer watchlist — ${m.label}: ${w.note || w.brand}`}
                            style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:9, color:m.color, background:m.bg, border:`1px solid ${m.border}`, padding:"1px 6px", borderRadius:4, fontWeight:700, letterSpacing:"0.03em", textTransform:"uppercase", whiteSpace:"nowrap" }}>
                            ⚠ {m.label}
                          </span>
                        );
                      })()}
                      {t.assumptionNote && <FlagTip content={t.assumptionNote}><Info size={12} strokeWidth={1.75} /></FlagTip>}
                    </div>
                  )}
                </td>
                {scrubRows && (
                  <td style={{ padding:"0 8px", whiteSpace:"nowrap" }}>
                    {(() => {
                      const sr = scrubOf(t);
                      if (!sr || !sr.flags.length) return <span style={{ color:"#d6d0c4" }}>·</span>;
                      return <span style={{ display:"inline-flex", gap:3 }}>{FLAG_ORDER.filter(f => sr.flags.includes(f)).map(f => {
                        const m = FLAG_META[f], c = TONE[m.tone];
                        return <span key={f} title={`${m.label} — ${m.tip}`} style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", minWidth:18, height:18, padding:"0 3px", borderRadius:5, fontSize:10, fontWeight:800, color:c.fg, background:c.bg, lineHeight:1 }}>{m.icon}</span>;
                      })}</span>;
                    })()}
                  </td>
                )}
                <td style={{ padding:"8px 10px", whiteSpace:"nowrap" }}>
                  {(() => {
                    if (isVacantRow(t) || !t.name || (!onOpenAbstract && !onAddAbstract)) return null;
                    const key = t.name.trim().toLowerCase();
                    const hasAbstract = abstractsByTenant?.has(key);
                    const disc = abstractDiscrepancies?.get(key);
                    if (hasAbstract && onOpenAbstract) {
                      const flagged = !!disc?.length;
                      return (
                        <span
                          onClick={(e) => { e.stopPropagation(); onOpenAbstract(t.name!); }}
                          title={flagged ? `Roster disagrees with the lease — review:\n• ${disc!.join("\n• ")}` : "View the lease abstract on file"}
                          aria-label="Open the lease abstract"
                          style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:22, height:20, fontSize:11, color: flagged ? "#9a3412" : "#1f4d8f", background: flagged ? "#fdecdc" : "#eaf1fb", border:`1px solid ${flagged ? "#f0c08a" : "#c2d6f0"}`, borderRadius:5, cursor:"pointer" }}>
                          {flagged ? "⚠" : "📄"}
                        </span>
                      );
                    }
                    if (onAddAbstract) {
                      return (
                        <span
                          onClick={(e) => { e.stopPropagation(); onAddAbstract(t.name!); }}
                          title="Add a lease abstract for this tenant"
                          aria-label="Add a lease abstract"
                          style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:22, height:20, fontSize:12, color:"#a69e91", border:"1px dashed #d8cfbd", borderRadius:5, cursor:"pointer" }}>
                          +
                        </span>
                      );
                    }
                    // No abstract yet — the roster pill is view-only (uploading is now the
                    // single deal-level "⬆ Upload abstracts" button that auto-routes by name).
                    return (
                      <span title="No lease abstract on file yet" style={{ color:"#d6d0c4", fontSize:11 }}>—</span>
                    );
                  })()}
                </td>
                <td style={{ padding:"8px 10px", whiteSpace:"nowrap", color:"#837c6e", fontFamily:"'SF Mono',ui-monospace,monospace", fontSize:11 }}>{t.suite || "—"}</td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>
                  <span style={{ display:"inline-flex", alignItems:"center", gap:3, justifyContent:"flex-end" }}>
                    {n(t.sf)!=null?n(t.sf)!.toLocaleString():"—"}
                    {(() => {
                      const f = sizeFlags?.get(tenantKey(t.canonicalName || t.name));
                      if (!f) return null;
                      // A likely-combo read is informational (amber), not a red anomaly.
                      const col = f.combo ? "#7a3ea8" : "#dc2626";
                      return <FlagTip content={f.tip} color={col}><span style={{ fontSize:10, fontWeight:800, color:col, lineHeight:1 }}>⚑</span></FlagTip>;
                    })()}
                  </span>
                </td>
                {(() => {
                  // Rent/SF vs the chain's median across the database. Below-chain =
                  // favorable basis (green); above-chain = premium / rollover risk (red).
                  // Neutral gray when in-line or no benchmark (was always-green before).
                  const rf = rentFlags?.get(tenantKey(t.canonicalName || t.name));
                  const color = !isVacantRow(t) && rf ? (rf.direction === "below" ? "#0f9d63" : "#dc2626") : "#5c5f57";
                  return (
                    <td style={{ padding:"8px 10px", textAlign:"right", color, fontWeight:rf?700:500, whiteSpace:"nowrap" }}>
                      <span style={{ display:"inline-flex", alignItems:"center", gap:3, justifyContent:"flex-end" }}>
                        {n(t.rentPerSF)!=null?`$${n(t.rentPerSF)!.toFixed(2)}`:"—"}
                        {rf && <FlagTip content={rf.tip} color={color}><span style={{ fontSize:10, fontWeight:800, color, lineHeight:1 }}>{rf.direction === "below" ? "▼" : "▲"}</span></FlagTip>}
                      </span>
                    </td>
                  );
                })()}
                {scrubRows && (() => {
                  const sr = scrubOf(t), b = sr?.bench;
                  if (!b?.rentMedian) return <td style={{ padding:"0 10px", textAlign:"right", color:"#d6d0c4" }}>—</td>;
                  return <td title={`Market: $${b.rentMedian.toFixed(2)}/SF median rent — ${b.basisLabel} (n=${b.rentN}).${b.salesMedian ? ` Chain median sales $${b.salesMedian}/SF (n=${b.salesN}).` : ""}`} style={{ padding:"0 10px", textAlign:"right", color:"#676767", whiteSpace:"nowrap", fontVariantNumeric:"tabular-nums" }}>${b.rentMedian.toFixed(2)}<span style={{ fontSize:9.5, color:"#a69e91", marginLeft:3 }}>{b.basis === "brand" ? "" : b.basis === "category" ? "cat" : "mkt"} n={b.rentN}</span></td>;
                })()}
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#383a37", whiteSpace:"nowrap" }}>{n(t.annualRent)!=null?`$${Math.round(n(t.annualRent)!).toLocaleString()}`:"—"}</td>
                <td style={{ padding:"8px 10px", color:"#8b9097", whiteSpace:"nowrap" }}>{fmtLeaseDate(t.leaseStart)}</td>
                <td style={{ padding:"8px 10px", whiteSpace:"nowrap", color:n(t.remainingTermYears)!=null&&n(t.remainingTermYears)!<2?"#dc2626":n(t.remainingTermYears)!=null&&n(t.remainingTermYears)!<4?"#c97a18":"#5c5f57" }}>{fmtLeaseDate(t.leaseExpiry)}</td>
                <td
                  style={{ padding:"0 10px", fontSize:11, cursor:"pointer", whiteSpace:"nowrap" }}
                >
                  {(() => {
                    // Compact chips in the row (Eric, 10/18/26: the abstract's CAM prose made
                    // the roster unreadable); the full text opens in a side drawer.
                    // ONE chip per row (Eric, 10/18/26 — rows were wrapping 3–4 lines); cap, admin,
                    // audit etc. are in the tooltip and the tenant drawer.
                    const r = reimbInfo(t);
                    if (!r) return <span style={{ color:"#c4bbaa" }}>—</span>;
                    const tip = [r.flag?.label, ...r.chips].filter(Boolean).join(" · ") + (r.fromAbstract ? " · from the lease abstract" : "") + (r.hasDetail ? " — click for the full terms" : "");
                    return (
                      <span title={tip} style={{ display:"inline-flex", alignItems:"center", gap:3, whiteSpace:"nowrap" }}>
                        {r.flag ? <span style={{ fontSize:9, fontWeight:700, letterSpacing:"0.04em", color:r.flag.color, background:r.flag.bg, padding:"1px 6px", borderRadius:9 }}>{r.flag.label}</span>
                          : <span style={{ color:r.textColor, overflow:"hidden", textOverflow:"ellipsis", maxWidth:110, display:"inline-block", verticalAlign:"bottom" }}>{r.body}</span>}
                        {(r.chips.length > 0 || r.fromAbstract) && <span style={{ fontSize:9, color:"#a69e91" }}>{r.fromAbstract ? "◆" : ""}{r.chips.length ? `+${r.chips.length}` : ""}</span>}
                      </span>
                    );
                  })()}
                </td>
                {(() => {
                  // Prefer the latest uploaded sales-report figures over OM-stated.
                  const ls = latestSales?.get(tenantKey(t.canonicalName || t.name));
                  const salesPSF = ls?.salesPSF ?? n(t.salesPSF);
                  // Year-over-year trend arrow when the OM disclosed a prior year too.
                  const prior = n(t.priorSalesPSF), latest = n(t.salesPSF);
                  let trend: { arrow: string; color: string; tip: string } | null = null;
                  if (prior != null && latest != null && prior > 0) {
                    const chg = ((latest - prior) / prior) * 100;
                    if (Math.abs(chg) >= 1) {
                      const up = chg > 0;
                      trend = {
                        // Diagonal arrow = sales TREND over time (this year vs last),
                        // deliberately distinct from the ▲/▼ brand-median flag below.
                        arrow: up ? "↗" : "↘",
                        color: up ? "#0f9d63" : (chg <= -5 ? "#dc2626" : "#c97a18"),
                        tip: `Sales trend — ${up ? "up" : "down"} ${Math.abs(Math.round(chg))}% vs ${t.priorSalesYear || "prior year"} ($${Math.round(prior)} → $${Math.round(latest)}/SF)`,
                      };
                    }
                  }
                  const sFlag = salesFlags?.get(tenantKey(t.canonicalName || t.name));
                  // Sales vs the chain median: above = strong performer (green), below =
                  // weak / at-risk store (red). Intuitive polarity (opposite of rent —
                  // you want LOW rent and HIGH sales). Neutral gray when in-line/no bench.
                  const sColor = sFlag ? (sFlag.direction === "below" ? "#dc2626" : "#0f9d63") : "#5c5f57";
                  // Movie theaters: sales PER SCREEN is the real productivity metric
                  // (sales/SF is meaningless for a big box). Show it alongside.
                  const cin = cinemaSalesRead(t, salesPSF);
                  const perScreenTip = cin.perScreen != null
                    ? `${cin.screens} screens${cin.screenSource === "name" ? " (read from the name — confirm)" : ""} · ${fmtPerScreen(cin.perScreen)}. Theaters are underwritten on sales PER SCREEN, not PSF.`
                    : cin.suspect
                      ? `Screen count reads ${cin.screens}, which is implausibly high — a real theater rarely exceeds 30 screens. This is likely a misread (a store/seat number). Confirm the screen count before trusting a per-screen figure.`
                      : cin.needsScreens
                        ? "Theater — add the screen count to see sales per screen (the metric that matters for a cinema, not PSF)."
                        : "";
                  const canEditCinema = cin.isCinema && !!onUpdateTenant && !isVacantRow(t) && !isNAPTenant(t);
                  // Soft, tenant-reported ("anecdotal") figure — only when the DISPLAYED
                  // sales is the anecdotal snapshot value (not an OM/report fallback).
                  const anecdotal = !!ls?.anecdotal && ls?.salesPSF != null;
                  return <td title={perScreenTip || trend?.tip || t.salesNotes || ""} style={{ padding:"8px 10px", textAlign:"right", color:sColor, fontWeight:sFlag?700:400, whiteSpace:"nowrap", cursor:(perScreenTip||trend||t.salesNotes)?"help":"default" }}>
                    {fmtTenantSales(salesPSF, t.sf)}
                    {anecdotal && (
                      <span title={ls?.provenance || "Anecdotal / unverified — a tenant-reported figure, not from an OM or sales report"}
                        style={{ marginLeft:4, fontSize:8, fontWeight:700, letterSpacing:"0.03em", color:"#9a6a12", background:"#fdf3e3", border:"1px solid #eccf9a", borderRadius:3, padding:"0 3px", cursor:"help", verticalAlign:"middle" }}>ANEC</span>
                    )}
                    {cin.perScreen != null && (
                      <span style={{ marginLeft:6, fontSize:9.5, fontWeight:700, color:"#6b4fa0" }} title={perScreenTip}>· {fmtPerScreen(cin.perScreen)}</span>
                    )}
                    {cin.suspect && (
                      <FlagTip content={perScreenTip} color="#c97a18"><span style={{ marginLeft:5, fontSize:9.5, fontWeight:800, color:"#c97a18", lineHeight:1 }}>⚠ {cin.screens} scr?</span></FlagTip>
                    )}
                    {trend && <FlagTip content={trend.tip} color={trend.color}><span style={{ marginLeft:4, color:trend.color, fontSize:11, fontWeight:800, lineHeight:1 }}>{trend.arrow}</span></FlagTip>}
                    {sFlag && <FlagTip content={`Vs ${(t.canonicalName||t.name||"brand")} median — ${sFlag.tip}`} color={sColor}><span style={{ marginLeft:4, fontSize:10, fontWeight:800, color:sColor, lineHeight:1 }}>{sFlag.direction==="below"?"▼":"▲"}</span></FlagTip>}
                    {canEditCinema && (
                      <button onClick={e => { e.stopPropagation(); openScreensEditor(t); }} title="Set screens & sales for this theater (sales per screen is the metric that matters)"
                        style={{ marginLeft:6, background:"transparent", border:"none", cursor:"pointer", color:"#6b4fa0", fontSize:11, padding:"1px 2px", lineHeight:1, flexShrink:0 }}>🎬</button>
                    )}
                  </td>;
                })()}
                {(() => {
                  const ls = latestSales?.get(tenantKey(t.canonicalName || t.name));
                  // If the sales panel already resolved occ cost (computed or stated)
                  // for this tenant, mirror it so roster + sales table always agree.
                  if (ls && ls.occupancyCost != null && ls.occSource) {
                    const occ = ls.occupancyCost;
                    const grade = gradeOccupancyCost(t.canonicalName || t.name || "", occ);
                    const color = grade ? grade.color : (occ > 15 ? "#dc2626" : "#0f9d63");
                    return (
                      <td style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", color }}>
                        <OccTip val={occ} source={ls.occSource} breakdown={ls.occBreakdown ?? null} grade={grade} />
                      </td>
                    );
                  }
                  // A stored occupancy cost of 0 (or negative) is "no data," NOT a
                  // real 0% health ratio — treat it as missing so it computes from
                  // rent ÷ sales (which also keeps the roster in sync with the sales table).
                  const statedRaw = n(t.occupancyCost);
                  // 0/negative = "no data" (compute from rent ÷ sales). A value in
                  // (0,1) is a fraction that lost its ×100 on import (0.225 = 22.5%) —
                  // normalize it; retail occupancy cost under 1% is effectively impossible.
                  const stated = statedRaw == null || statedRaw <= 0 ? null : (statedRaw < 1 ? statedRaw * 100 : statedRaw);
                  // Recoveries: OM-disclosed first; else calculated from the lease's
                  // recovery terms × the OM's expense budget (see recoveryCalc.ts).
                  const sp = n(t.salesPSF);
                  const sfn = n(t.sf);
                  const sales = (sp != null && sfn != null && sp > 0 && sfn > 0) ? sp * sfn : null;

                  let occ: number | null = null;
                  let occSource: "stated" | "computed" | null = null;
                  let occBreakdown: OccBreakdown | null = null;

                  if (stated != null) {
                    occ = stated; occSource = "stated";
                  } else {
                    const oc = computeOccupancyCost(t, estimatedRecoveries?.get(tenantKey(t.canonicalName || t.name)), sales);
                    if (oc) { occ = oc.occ; occSource = "computed"; occBreakdown = oc.breakdown; }
                  }

                  const occGrade = occ != null ? gradeOccupancyCost(t.canonicalName || t.name || "", occ) : null;
                  const color = occ != null ? (occGrade ? occGrade.color : (occ > 15 ? "#dc2626" : "#0f9d63")) : "#a69e91";
                  const canEdit = !!onUpdateTenant && !isVacant(t) && !isNAPTenant(t);
                  return (
                    <td style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", color }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {occ != null && occSource
                          ? <OccTip val={occ} source={occSource} breakdown={occBreakdown} grade={occGrade} />
                          : <span>{occ != null ? `${occ.toFixed(1)}%` : "—"}</span>}
                        {canEdit && (
                          <button
                            onClick={e => {
                              e.stopPropagation();
                              const idx = tenants.indexOf(t);
                              setEditVals({
                                reimb: t.expenseReimbursements != null ? String(t.expenseReimbursements) : "",
                                pctRent: (t.percentageRent != null && typeof t.percentageRent === "number") ? String(t.percentageRent) : "",
                                other: t.otherRent != null ? String(t.otherRent) : "",
                              });
                              setEditingOcc(editingOcc === idx ? null : idx);
                            }}
                            style={{ background: "transparent", border: "none", cursor: "pointer", color: "#c4bbaa", fontSize: 10, padding: "1px 2px", lineHeight: 1, flexShrink: 0 }}
                            title="Edit occupancy cost components"
                          >✏</button>
                        )}
                      </span>
                    </td>
                  );
                })()}
                <td style={{ padding:"0 10px", color:"#5c5f57", fontSize:11, whiteSpace:"nowrap", fontVariantNumeric:"tabular-nums" }}>
                  {(() => {
                    // Only the NEXT future step, compactly ("→ $27.00 Jan-27"); the full schedule is in the drawer.
                    const steps = rentStepList(t);
                    if (!steps.length) return <span style={{ color:"#c4bbaa" }}>{toStepString(t.rentSchedule) || toStepString(t.rentBumps) ? "Flat" : "—"}</span>;
                    const nx = nextRentStep(t);
                    if (!nx && steps.every(x => /^flat\b/i.test(x) || !/\d{4}/.test(x))) return <span style={{ color:"#a69e91" }} title={steps.join("\n")}>Flat</span>;
                    return <span title={steps.join("\n")}>{nx ? nx.label : <span style={{ color:"#a69e91" }}>no future step</span>}{steps.length > 1 && <span style={{ color:"#a69e91", marginLeft:4 }}>+{steps.length - 1}</span>}</span>;
                  })()}
                </td>
                <td style={{ padding:"0 10px", color:"#5c5f57", fontSize:11, whiteSpace:"nowrap" }}>
                  {(() => {
                    const notices = isVacantRow(t) ? [] : passedOptionNotices(t, abstractsByTenant?.get((t.name || "").trim().toLowerCase()));
                    const pending = notices.filter(pn => optionStatus?.get(`${(t.name || "").trim().toLowerCase()}|${pn.noticeDate}`) == null);
                    const { opts, optionSteps } = optionsAndSteps(t);
                    const summary = opts.join("; ") || (optionSteps.length ? `${optionSteps.length} option rent step${optionSteps.length !== 1 ? "s" : ""}` : "");
                    return (
                      <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                        {notices.length > 0 && <span title={`Option notice date passed (${notices.map(pn => fmtLeaseDate(pn.noticeDate)).join(", ")}) — ${pending.length ? "status not recorded; open the tenant to record it" : "status recorded"}`} style={{ fontSize:9, fontWeight:700, color: pending.length ? "#a8640f" : "#3e8a2f", background: pending.length ? "#fff2e0" : "#eef7eb", padding:"1px 5px", borderRadius:5 }}>{pending.length ? "⚠ notice" : "✓ notice"}</span>}
                        {summary ? <span title={summary} style={{ overflow:"hidden", textOverflow:"ellipsis", maxWidth:150, display:"inline-block", verticalAlign:"bottom" }}>{summary}</span> : !notices.length && <span style={{ color:"#c4bbaa" }}>—</span>}
                      </span>
                    );
                  })()}
                </td>
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap", verticalAlign:"top", maxWidth:200, minWidth:90 }}>
                  {(() => {
                    const k = kickoutByTenant?.get(tenantKey(t.canonicalName || t.name));
                    if (!k) return <span style={{ color:"#c4bbaa" }}>—</span>;
                    return <FlagTip content={k.tip} color="#b45309"><span style={{ fontSize:9.5, fontWeight:700, color:"#9a3412", background:"#fdecdc", border:"1px solid #f0c08a", borderRadius:4, padding:"1px 6px", whiteSpace:"nowrap" }}>{k.label}</span></FlagTip>;
                  })()}
                </td>
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap", color:t.recentlyExercisedRenewal?"#0f9d63":"#a69e91" }}>
                  {(() => {
                    const spread = n(t.recentRenewalSpreadPct);
                    return (
                      <span style={{ display:"inline-flex", alignItems:"center", gap:4 }}>
                        <span>{t.recentlyExercisedRenewal || (spread != null ? "Recent renewal" : "—")}</span>
                        {spread != null && spread !== 0 && (
                          <span title="Rent spread achieved on the most recent renewal — evidence of pricing power / below-market prior rent."
                            style={{ fontSize:9, fontWeight:700, color: spread > 0 ? "#0f6b46" : "#b45309", background: spread > 0 ? "#e7f8f0" : "#fbe6cf", border:`1px solid ${spread > 0 ? "#a7f3d0" : "#e0c9a8"}`, borderRadius:4, padding:"1px 5px", whiteSpace:"nowrap" }}>
                            {spread > 0 ? "+" : ""}{Math.round(spread)}%
                          </span>
                        )}
                      </span>
                    );
                  })()}
                </td>
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap", color:t.creditRating==="Investment Grade"?"#0f9d63":"#837c6e" }}>{t.creditRating||"—"}</td>
              </tr>
            ))}
          </tbody>
          {rows.length > 0 && (
            <tfoot>
              <tr style={{ borderTop:"2px solid #d9d2c4", background:"#faf7f0", fontWeight:700, color:"#26281f" }}>
                {cols.map(([k, , right], idx) => {
                  const sub = (v: string) => <div style={{ fontSize:9.5, fontWeight:500, color:"#8b8578", marginTop:2, whiteSpace:"nowrap" }}>{v}</div>;
                  let cell: React.ReactNode = null;
                  if (k === "name") cell = (<>
                    {totalsFiltered ? "Totals (filtered)" : "Totals"}
                    {sub(`${totals.tenantCount} tenant${totals.tenantCount === 1 ? "" : "s"}${totals.vacantCount ? ` · ${totals.vacantCount} vacant` : ""}`)}
                    {/* Phones: the figure columns are off-screen to the right, so repeat the
                        headline numbers here in the pinned column. */}
                    {isMobileRoster && (
                      <div style={{ fontSize:11, fontWeight:600, color:"#383a37", marginTop:5, lineHeight:1.5, whiteSpace:"nowrap" }}>
                        <div>{totals.totalSF.toLocaleString()} SF{totals.pctLeased != null && totals.vacantCount > 0 ? ` · ${fmtPct(totals.pctLeased)} leased` : ""}</div>
                        <div>${Math.round(totals.annualRent).toLocaleString()} base{totals.rentPSF != null ? ` · $${totals.rentPSF.toFixed(2)}/SF` : ""}</div>
                        {totals.walt != null && <div>WALT {totals.walt.toFixed(1)} yrs</div>}
                      </div>
                    )}
                  </>);
                  else if (k === "sf") cell = (<>
                    {totals.totalSF.toLocaleString()}
                    {totals.pctLeased != null && totals.vacantCount > 0 && sub(`${totals.occupiedSF.toLocaleString()} leased · ${fmtPct(totals.pctLeased)}`)}
                  </>);
                  else if (k === "rentPerSF") cell = totals.rentPSF != null ? (<>${totals.rentPSF.toFixed(2)}{sub("wtd avg")}</>) : "—";
                  else if (k === "annualRent") cell = (<>${Math.round(totals.annualRent).toLocaleString()}{sub("base rent")}</>);
                  else if (k === "leaseExpiry") cell = totals.walt != null ? (<>{totals.walt.toFixed(1)} yrs{sub("WALT (by SF)")}</>) : null;
                  else if (k === "salesPSF") cell = totals.salesPSF != null ? (<>${Math.round(totals.salesPSF).toLocaleString()}{sub(`wtd avg · ${totals.salesReporting} reporting`)}</>) : null;
                  return (
                    <td key={k} className={idx === 0 ? "freeze-col" : undefined}
                      style={{ padding:"9px 10px", textAlign: right ? "right" : "left", whiteSpace:"nowrap", verticalAlign:"top", ...(idx === 0 ? stickyFirstCol("#faf7f0", false) : null) }}>
                      {cell}
                    </td>
                  );
                })}
              </tr>
            </tfoot>
          )}
        </table>
        {expandedReimb != null && rows[expandedReimb] && (() => {
          // TENANT DRAWER — everything the one-line row leaves out: recovery terms, the full
          // rent schedule, options + option rent, passed notices (status), flags, benchmark, notes.
          const t = rows[expandedReimb], r = reimbInfo(t), sr = scrubOf(t);
          const { opts, optionSteps } = optionsAndSteps(t), steps = rentStepList(t);
          const notices = isVacantRow(t) ? [] : passedOptionNotices(t, abstractsByTenant?.get((t.name || "").trim().toLowerCase()));
          const kick = kickoutByTenant?.get(tenantKey(t.canonicalName || t.name));
          const H = ({ children }: { children: React.ReactNode }) => <div style={{ fontFamily:"'Montserrat',sans-serif", fontSize:10.5, fontWeight:800, letterSpacing:"0.1em", textTransform:"uppercase", color:"#383A37", marginTop:16, marginBottom:5 }}>{children}</div>;
          const fact = (l: string, v: React.ReactNode) => <div><div style={{ fontSize:10, color:"#8b8578", textTransform:"uppercase", letterSpacing:"0.06em" }}>{l}</div><div style={{ fontSize:13.5, color:"#232422", fontVariantNumeric:"tabular-nums" }}>{v ?? "—"}</div></div>;
          return (
            <>
              <div onClick={() => setExpandedReimb(null)} style={{ position:"fixed", inset:0, zIndex:1300, background:"rgba(35,36,34,0.32)" }} />
              <aside role="dialog" aria-label={`Tenant detail — ${t.name}`} style={{ position:"fixed", top:0, right:0, bottom:0, width:"min(480px, 100vw)", zIndex:1301, background:"#fff", boxShadow:"-12px 0 40px rgba(35,36,34,0.22)", padding:"18px 18px 32px", overflowY:"auto", boxSizing:"border-box", fontFamily:"'Roboto',sans-serif" }}>
                <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", gap:10 }}>
                  <div style={{ minWidth:0 }}>
                    <div style={{ fontFamily:"'Montserrat',sans-serif", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase", color:"#a69e91", fontWeight:700 }}>Tenant{t.suite ? ` · suite ${t.suite}` : ""}</div>
                    <div style={{ fontFamily:"'Lora',serif", fontSize:21, color:"#232422", marginTop:2 }}>{t.name}</div>
                  </div>
                  <button onClick={() => setExpandedReimb(null)} aria-label="Close" style={{ background:"#fff", border:"1px solid #e0d8c8", borderRadius:8, padding:"4px 10px", cursor:"pointer", fontSize:14 }}>✕</button>
                </div>
                {sr && sr.flags.length > 0 && (
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap", marginTop:10 }}>
                    {FLAG_ORDER.filter(f => sr.flags.includes(f)).map(f => { const m = FLAG_META[f], c = TONE[m.tone]; return <span key={f} title={m.tip} style={{ fontSize:10.5, fontWeight:700, color:c.fg, background:c.bg, padding:"2px 8px", borderRadius:9 }}>{m.icon} {m.label}</span>; })}
                  </div>
                )}
                <div style={{ display:"grid", gridTemplateColumns:"repeat(3, minmax(0,1fr))", gap:"10px 12px", marginTop:14 }}>
                  {fact("SF", n(t.sf) != null ? n(t.sf)!.toLocaleString() : null)}
                  {fact("Rent / SF", n(t.rentPerSF) != null ? `$${n(t.rentPerSF)!.toFixed(2)}` : null)}
                  {fact("Base rent", n(t.annualRent) != null ? `$${Math.round(n(t.annualRent)!).toLocaleString()}` : null)}
                  {fact("Start", fmtLeaseDate(t.leaseStart))}
                  {fact("Expiry", fmtLeaseDate(t.leaseExpiry))}
                  {fact("Credit", t.creditRating || (isInvestmentGrade(t.name || "", t.creditRating) ? "Investment grade" : null))}
                  {fact("Sales", n(t.salesPSF) != null ? fmtTenantSales(n(t.salesPSF), t.sf) : null)}
                  {fact("Occ. cost", n(t.occupancyCost) != null ? `${n(t.occupancyCost)!.toFixed(1)}%` : null)}
                  {fact("Lease type", t.leaseType)}
                </div>
                {sr?.bench.rentMedian != null && (<>
                  <H>Market benchmark</H>
                  <div style={{ fontSize:13, color:"#383A37", lineHeight:1.55 }}>
                    ${sr.bench.rentMedian.toFixed(2)}/SF median rent — {sr.bench.basisLabel} (n={sr.bench.rentN}).
                    {sr.mtm != null && n(t.sf) ? ` In-place is ${sr.mtm >= 0 ? `$${Math.round(sr.mtm).toLocaleString()}/yr below` : `$${Math.round(-sr.mtm).toLocaleString()}/yr above`} that.` : ""}
                    {sr.bench.salesMedian != null ? ` Chain median sales $${sr.bench.salesMedian}/SF (n=${sr.bench.salesN}).` : ""}
                  </div>
                </>)}
                {r && (<>
                  <H>Recovery terms</H>
                  <div style={{ display:"flex", gap:5, flexWrap:"wrap" }}>
                    {r.flag && <span style={{ fontSize:10, fontWeight:700, color:r.flag.color, background:r.flag.bg, padding:"2px 8px", borderRadius:9 }}>{r.flag.label}</span>}
                    {r.chips.map(c => <span key={c} style={{ fontSize:10.5, color:"#5c5f57", background:"#f3f1ea", border:"1px solid #e7e0d2", padding:"1px 8px", borderRadius:9 }}>{c}</span>)}
                    {r.fromAbstract && <span style={{ fontSize:10, color:"#1f4d8f" }}>from the lease abstract</span>}
                  </div>
                  {r.body && <div style={{ fontSize:13, color:"#383a37", marginTop:8, lineHeight:1.6, whiteSpace:"pre-wrap" }}>{r.body}</div>}
                  {r.breakdown.map(([k, v]) => <div key={k} style={{ marginTop:8, fontSize:13, lineHeight:1.55 }}><b>{k}:</b> {v}</div>)}
                </>)}
                {steps.length > 0 && (<>
                  <H>Rent schedule</H>
                  {steps.map((x, k) => <div key={k} style={{ fontSize:13, padding:"3px 0", borderBottom:"1px solid #f3f2ee", fontVariantNumeric:"tabular-nums" }}>{x}</div>)}
                </>)}
                {(opts.length > 0 || optionSteps.length > 0 || notices.length > 0) && (<>
                  <H>Renewal options</H>
                  {opts.map((x, k) => <div key={k} style={{ fontSize:13, padding:"3px 0" }}>{x}</div>)}
                  {optionSteps.length > 0 && <div style={{ fontSize:12, color:"#676767", marginTop:4 }}>Option rent: {optionSteps.join("; ")}</div>}
                  {notices.map(pn => {
                    const key = `${(t.name || "").trim().toLowerCase()}|${pn.noticeDate}`, st = optionStatus?.get(key);
                    return (
                      <div key={key} style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap", marginTop:8, background:"#fff8ec", borderRadius:8, padding:"6px 8px" }}>
                        <span style={{ fontSize:12.5 }}>{pn.option} notice was due <b>{fmtLeaseDate(pn.noticeDate)}</b></span>
                        {onSetOptionStatus ? (
                          <select aria-label="Option status" value={st ?? ""} onChange={e => e.target.value && onSetOptionStatus(t.name || "", pn.option, pn.noticeDate, e.target.value)} style={{ fontSize:12, border:"1px solid #e0d8c8", borderRadius:6, padding:"3px 6px", background:"#fff" }}>
                            <option value="">status?</option><option>Exercised</option><option>Pending</option><option>Lapsed</option>
                          </select>
                        ) : <span style={{ fontSize:12, color:"#6f6a5f" }}>{st ?? "status not recorded"}</span>}
                      </div>
                    );
                  })}
                </>)}
                {kick && (<><H>Kickout / co-tenancy</H><div style={{ fontSize:13, lineHeight:1.55 }}>{kick.tip}</div></>)}
                {(t.assumptionNote || t.salesNotes) && (<><H>Notes</H>{t.assumptionNote && <div style={{ fontSize:13, lineHeight:1.55 }}>{t.assumptionNote}</div>}{t.salesNotes && <div style={{ fontSize:13, lineHeight:1.55, marginTop:6 }}>{t.salesNotes}</div>}</>)}
                {onTenantClick && t.name && !isVacantRow(t) && <button onClick={() => { setExpandedReimb(null); onTenantClick(t.name!); }} style={{ marginTop:18, background:"#383A37", color:"#fff", border:"none", borderRadius:8, padding:"8px 14px", fontSize:12.5, fontWeight:700, cursor:"pointer" }}>{t.name} across the library →</button>}
              </aside>
            </>
          );
        })()}
      </div>
      <div style={{ fontSize:10, color:"#a69e91", marginTop:9 }}>Click a column to sort · scroll sideways for more · tap or hover the ⓘ icon for tenant notes.</div>
      {editingOcc != null && onUpdateTenant && createPortal(
        <>
          <div
            onClick={() => setEditingOcc(null)}
            style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.32)", zIndex: 9998 }}
          />
          <div
            onClick={e => e.stopPropagation()}
            style={{
              position: "fixed", top: "50%", left: "50%",
              transform: "translate(-50%, -50%)",
              zIndex: 9999, background: "#fff", borderRadius: 14,
              boxShadow: "0 24px 60px rgba(0,0,0,0.22)",
              padding: "20px 22px 18px",
              width: "min(340px, 92vw)",
              fontFamily: "'Inter',sans-serif",
            }}
          >
            <div style={{ fontWeight: 700, fontSize: 13, color: "#383a37", marginBottom: 4 }}>
              Edit Occupancy Cost Components
            </div>
            <div style={{ fontSize: 11, color: "#a89f8f", marginBottom: 14, lineHeight: 1.5 }}>
              {tenants[editingOcc]?.canonicalName || tenants[editingOcc]?.name || "Tenant"}<br />
              Enter OM-disclosed annual dollar amounts. Base rent is already captured above.
              Occ cost = (Base + Recoveries + % Rent + Other) ÷ Sales.
            </div>
            {[
              { label: "Recoveries (CAM + taxes + insurance)", key: "reimb" as const, placeholder: "e.g. 125000" },
              { label: "% Rent / Overage rent (annual $)", key: "pctRent" as const, placeholder: "e.g. 48000" },
              { label: "Other rent (marketing, storage, etc.)", key: "other" as const, placeholder: "e.g. 12000" },
            ].map(({ label, key, placeholder }) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{label}</div>
                <input
                  type="number"
                  min="0"
                  step="1000"
                  placeholder={placeholder}
                  value={editVals[key]}
                  onChange={e => setEditVals(prev => ({ ...prev, [key]: e.target.value }))}
                  style={{
                    width: "100%", boxSizing: "border-box",
                    border: "1px solid #e6dfd0", borderRadius: 8,
                    padding: "8px 10px", fontSize: 13, color: "#383a37",
                    fontFamily: "'Inter',sans-serif", outline: "none",
                    background: "#faf8f4",
                  }}
                />
              </div>
            ))}
            <div style={{ fontSize: 10, color: "#c4bbaa", marginBottom: 14 }}>
              Leave a field blank to clear it. Occupancy cost will show "—" unless both Base rent and Recoveries are present.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  const parseOrNull = (s: string) => s.trim() === "" ? null : (isNaN(Number(s)) ? null : Number(s));
                  onUpdateTenant!(editingOcc!, {
                    expenseReimbursements: parseOrNull(editVals.reimb),
                    percentageRent: parseOrNull(editVals.pctRent),
                    otherRent: parseOrNull(editVals.other),
                  });
                  setEditingOcc(null);
                }}
                style={{
                  flex: 1, background: "#3f7a1f", color: "#fff",
                  border: "none", borderRadius: 8, padding: "10px 0",
                  fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 13, cursor: "pointer",
                }}
              >
                Save
              </button>
              <button
                onClick={() => setEditingOcc(null)}
                style={{
                  flex: 1, background: "#f3f4f6", color: "#383a37",
                  border: "none", borderRadius: 8, padding: "10px 0",
                  fontFamily: "'Inter',sans-serif", fontWeight: 500, fontSize: 13, cursor: "pointer",
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        </>,
        document.body
      )}
      {editingScreens != null && onUpdateTenant && createPortal(
        <>
          <div onClick={() => setEditingScreens(null)} style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.32)", zIndex: 9998 }} />
          <div onClick={e => e.stopPropagation()} style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%, -50%)", zIndex: 9999, background: "#fff", borderRadius: 14, boxShadow: "0 24px 60px rgba(0,0,0,0.22)", padding: "20px 22px 18px", width: "min(360px, 92vw)", fontFamily: "'Inter',sans-serif" }}>
            <div style={{ fontWeight: 700, fontSize: 13, color: "#383a37", marginBottom: 4 }}>Theater sales &amp; screens</div>
            <div style={{ fontSize: 11, color: "#a89f8f", marginBottom: 14, lineHeight: 1.5 }}>
              {tenants[editingScreens]?.canonicalName || tenants[editingScreens]?.name || "Theater"}<br />
              A cinema is judged on sales <b>per screen</b>, not per SF. Enter the screen count and EITHER the sales per screen OR the total annual sales — the app computes the rest.
            </div>
            {[
              { label: "Screens (auditoriums)", key: "screens" as const, placeholder: "e.g. 16", step: "1" },
              { label: "Sales per screen (annual $)", key: "perScreen" as const, placeholder: "e.g. 165836", step: "1000" },
              { label: "— or — Total annual sales ($)", key: "total" as const, placeholder: "e.g. 2653381", step: "10000" },
            ].map(({ label, key, placeholder, step }) => (
              <div key={key} style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, color: "#6b7280", marginBottom: 4 }}>{label}</div>
                <input type="number" min="0" step={step} placeholder={placeholder} value={screensForm[key]}
                  onChange={e => setScreensForm(prev => ({ ...prev, [key]: e.target.value }))}
                  style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e6dfd0", borderRadius: 8, padding: "8px 10px", fontSize: 13, color: "#383a37", fontFamily: "'Inter',sans-serif", outline: "none", background: "#faf8f4" }} />
              </div>
            ))}
            <div style={{ fontSize: 10, color: "#c4bbaa", marginBottom: 14, lineHeight: 1.5 }}>
              Leave sales blank to set only the screen count. Total sales wins if you enter both. Sales/SF is derived so the roster and benchmarks stay correct.
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => {
                  const idx = editingScreens!;
                  const t = tenants[idx];
                  const parseNum = (s: string) => { const v = s.trim(); return v === "" || isNaN(Number(v)) ? null : Number(v); };
                  const screens = parseNum(screensForm.screens);
                  const sf = Number(t?.sf) || 0;
                  const total = parseNum(screensForm.total);
                  const perScreen = parseNum(screensForm.perScreen);
                  // Total sales: explicit, else per-screen × screens. salesPSF = total ÷ SF.
                  const totalSales = total != null ? total : (perScreen != null && screens != null ? perScreen * screens : null);
                  const patch: Partial<Tenant> = { screens: screens != null ? Math.round(screens) : null };
                  if (totalSales != null && sf > 0) patch.salesPSF = Math.round((totalSales / sf) * 100) / 100;
                  onUpdateTenant!(idx, patch);
                  setEditingScreens(null);
                }}
                style={{ flex: 1, background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 8, padding: "10px 0", fontFamily: "'Inter',sans-serif", fontWeight: 600, fontSize: 13, cursor: "pointer" }}
              >Save</button>
              <button onClick={() => setEditingScreens(null)} style={{ flex: 1, background: "#f3f4f6", color: "#383a37", border: "none", borderRadius: 8, padding: "10px 0", fontFamily: "'Inter',sans-serif", fontWeight: 500, fontSize: 13, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}
