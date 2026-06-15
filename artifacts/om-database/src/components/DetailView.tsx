import { useState, useEffect, useRef, useCallback, useMemo, Fragment } from "react";
import { createPortal } from "react-dom";
import type { Deal, ImageBundle, TenantSalesYear, InterestRateSwap, LeaseAbstract } from "../lib/idb";
import { apiLoadImages, apiSaveImages, apiReanalyzeDeal, apiRefreshAnalysis, apiPollDealStatus, apiIngestDeal, apiAiMessages, apiRefreshDemographics, apiRefreshMarket, apiRescore, apiGetRates,
  apiGetExtractionLessons, apiAddExtractionLesson, apiDeleteExtractionLesson, type ExtractionLesson, type LessonScope,
  apiListLeaseAbstracts } from "../lib/api";
import { reconcileDeal, assessExtraction, classifyLocation, getRecency, buildCorrectionsNote, robustParseJSON, lenderLabel, openReviewCount, tenantKey, stripSuiteCode, estimateRecoveries, buildLatestSales, recomputeRosterMetrics, formatFullAddress, fmtUSD, withAbstractRecoveries } from "../lib/utils";
import { calcPrepay, prepayInputsFromDeal, calcSwapBreakage } from "../lib/prepay";
import { extractSwap, buildSwapPatch, recognizeRateIndex } from "../lib/swapExtract";
import { extractRentRoll, buildRosterPatch } from "../lib/rentRollExtract";
import { extractLoan, buildLoanPatch } from "../lib/loanExtract";
import { amortForDeal, currentBalanceFromRows } from "../lib/amortize";
import { extractAmortSchedule } from "../lib/amortExtract";
import { extractPref, buildPrefPatch } from "../lib/prefExtract";
import ImportReview from "./ImportReview";
import { ensureUploadAllowed } from "../lib/uploadAuth";
import { STATUS_COLORS, GRADE_COLORS, ANALYSIS_VERSION, DETAIL_MAX_WIDTH } from "../lib/constants";
import StatusTag from "./StatusTag";
import ScoreBadge from "./ScoreBadge";
import RecencyBadge from "./RecencyBadge";
import TenantRoster from "./TenantRoster";
import LeaseAbstractModal from "./LeaseAbstractModal";
import AbstractUploadModal from "./AbstractUploadModal";
import SiteAgreementsCard from "./SiteAgreementsCard";
import { computeAbstractChecks } from "../lib/abstractChecks";
import { loadPdfJs, _capturePagePhoto, extractPdfText, dataUrlToThumb } from "../lib/pdfExtract";
import { useCreateAiMessage } from "@workspace/api-client-react";
import { exportDealToExcel, exportRosterToExcel } from "../lib/exportExcel";
import { exportLeaseAbstractsWorkbook } from "../lib/abstractExcel";
import { extractAnyFile } from "../lib/fileExtract";
import { extractSalesReport, buildSalesHistoryPatch } from "../lib/salesExtract";
import MyUnderwritingPanel from "./MyUnderwritingPanel";
import LeaseRollover from "./LeaseRollover";
import LeaseRiskPanel from "./LeaseRiskPanel";
import ErrorBoundary from "./ErrorBoundary";
import HouseViewModal from "./HouseViewModal";
// @react-pdf/renderer (~2 MB) and the PDF document components are loaded ON
// CLICK via PdfDownloadButton, so opening a deal page no longer pulls the whole
// PDF engine into its chunk.
import { isInvestmentGrade } from "../lib/tenantCredit";
import { useWatchlist } from "../lib/useWatchlist";
import { computeWatchlistImpact } from "../lib/watchlistImpact";
import { runWithProgress, startAiTask, finishAiTask } from "../lib/aiProgress";
import ClosingCostsCard from "./ClosingCostsCard";
import TenantSalesPanel from "./TenantSalesPanel";
import OwnershipStructure from "./OwnershipStructure";
import { deriveExpenseRiskFlag } from "../lib/expenseRisk";
import { deriveUnsignedLeaseFlag } from "../lib/unsignedLeaseRisk";
import { deriveSalesTrendFlag } from "../lib/salesTrendRisk";
import { useIsMobile } from "../hooks/use-mobile";

// DETAIL_MAX_WIDTH (from lib/constants) caps the deal page's readable width. The
// body and floating title bar both use it, and every sub-tab renders inside that
// one centered column — so the detail page and ALL its subpages match. The same
// constant drives the tenant/parent/lender/compare pages for one consistent width.

// Sub-page tabs and the jump-list shown when a tab is clicked.
const PAGE_TABS = [
  ["overview","Overview"],["ai","AI Analysis"],["tenants","Tenants & Sales"],
  ["transaction","Transaction Details"],["financing","Financing"],
  ["market","Market & Comps"],["underwriting","Underwriting"],
] as const;
const PAGE_TAB_LABEL: Record<string,string> = Object.fromEntries(PAGE_TABS.map(([k,l]) => [k,l]));
const TAB_SECTIONS: Record<string, Array<{ label: string; id: string }>> = {
  overview: [{label:"Cover photo",id:"section-cover"},{label:"Site plan",id:"section-site"},{label:"Also known as",id:"section-aliases"},{label:"Edit metrics",id:"section-metriceditor"},{label:"Key financials",id:"section-financials"},{label:"Your notes",id:"section-notes"}],
  ai: [{label:"Highlights",id:"section-highlights"},{label:"Our take",id:"section-review"},{label:"Deal score",id:"section-dealscore"},{label:"Upside",id:"section-upside"},{label:"Red flags",id:"section-redflags"},{label:"Key assumptions",id:"section-assumptions"}],
  tenants: [{label:"Site plan",id:"section-site"},{label:"Tenant roster",id:"section-tenants"},{label:"Site agreements / REAs",id:"section-site-agreements"},{label:"Tenant sales",id:"section-tenant-sales"},{label:"Lease risk",id:"section-lease-risk"},{label:"Lease rollover & WALT",id:"section-rollover"}],
  transaction: [{label:"Transaction record",id:"section-acquisition"},{label:"Closing costs",id:"section-closing-costs"},{label:"Ownership structure",id:"section-ownership"}],
  financing: [{label:"Senior loan",id:"section-senior-loan"},{label:"Amortization",id:"section-amortization"},{label:"Prepay & swap",id:"section-prepay"},{label:"Preferred equity",id:"section-pref-equity"}],
  market: [{label:"Market sale",id:"section-market-sale"},{label:"Comp benchmark",id:"section-comp-benchmark"},{label:"Property info",id:"section-property-info"},{label:"Demographics",id:"section-demographics"},{label:"Trade-area demographics",id:"section-trade-area"}],
  underwriting: [{label:"My underwriting",id:"section-underwriting"},{label:"Cash-flow projection",id:"section-cashflow"}],
};

// Renders **bold** segments in AI text (highlights, deal-score rationale) so key
// figures/terms stand out. Plain text otherwise.
function BoldText({ text }: { text: string }) {
  if (!text) return null;
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return <>{parts.map((p, i) =>
    p.startsWith("**") && p.endsWith("**")
      ? <strong key={i} style={{ fontWeight: 700, color: "#383a37" }}>{p.slice(2, -2)}</strong>
      : <span key={i}>{p}</span>
  )}</>;
}

interface Props {
  deal: Deal;
  allDeals: Deal[];
  onBack: () => void;
  onDelete: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Deal>) => void;
  onQuery: (q: string) => void;
  onCompare: (ids: string[]) => void;
  onTenantClick?: (name: string) => void;
  isAdmin?: boolean;
}

// Downscale/recompress an uploaded image before we store it as a data URL.
// Cover photos straight off a phone can be 10MB+ and slow to load; this caps the
// longest edge and re-encodes to JPEG, falling back to the original on anything
// it can't safely shrink (small images keep their original bytes/format).
// Downscale an image File to a JPEG data URL. `maxBytes` (when set) HARD-CAPS the
// output by stepping quality, then dimensions, down until the data URL fits — so a
// cover/site-plan upload can't exceed the platform proxy's request-body limit (the
// real reason a 450KB cover's PUT never reached the server). For tiles/headers a
// ~1000px JPEG is plenty.
async function downscaleImageFile(file: File, maxDim = 1600, quality = 0.82, maxBytes = 0): Promise<string> {
  const readAsDataUrl = (f: File) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(new Error("read failed"));
    r.readAsDataURL(f);
  });
  const dataUrl = await readAsDataUrl(file);
  if (!file.type.startsWith("image/")) return dataUrl;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("decode failed"));
      im.src = dataUrl;
    });
    const longest = Math.max(img.width, img.height);
    const tooBig = longest > maxDim;
    const heavy = dataUrl.length > 600_000;
    const overCap = !!maxBytes && dataUrl.length > maxBytes;
    if (!tooBig && !heavy && !overCap) return dataUrl;
    const render = (dim: number, q: number): string => {
      const scale = Math.min(1, dim / longest);
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return dataUrl;
      ctx.drawImage(img, 0, 0, w, h);
      const url = canvas.toDataURL("image/jpeg", q);
      canvas.width = canvas.height = 0;
      return url;
    };
    let dim = Math.min(longest, maxDim);
    let q = quality;
    let out = render(dim, q);
    // Step quality down (to 0.4), then dimensions down, until under the byte cap.
    if (maxBytes) {
      let guard = 0;
      while (out.length > maxBytes && guard++ < 10) {
        if (q > 0.42) q = Math.max(0.4, q - 0.1);
        else { dim = Math.round(dim * 0.82); q = 0.6; }
        out = render(dim, q);
      }
    }
    return out.length > 0 && out.length < dataUrl.length ? out : dataUrl;
  } catch {
    return dataUrl;
  }
}

function ReconBadge({ msg }: { msg: string }) {
  return (
    <span title={msg} style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:15, height:15, borderRadius:3, background:"#fef3c7", border:"1px solid #f59e0b", color:"#92400e", fontSize:9, cursor:"help", flexShrink:0, lineHeight:1 }}>!</span>
  );
}

// Box that starts collapsed to about a normal card's height with a "click to
// enlarge" hover hint; on click it expands to show everything, and the child
// renders at a larger text size (it receives `expanded`).
function CollapsibleBox({ collapsedHeight = 300, fadeColor = "#faf7f0", children }: {
  collapsedHeight?: number;
  fadeColor?: string;
  children: (expanded: boolean) => React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  const [hover, setHover] = useState(false);
  const collapseBtn: React.CSSProperties = { background:"#fff", border:"1px solid #e7e0d2", borderRadius:6, fontSize:10, fontWeight:600, color:"#7d766a", cursor:"pointer", padding:"3px 9px", fontFamily:"'Inter',sans-serif" };
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      onClick={() => { if (!expanded) setExpanded(true); }}
      style={{ position:"relative", marginBottom:12, cursor: expanded ? "default" : "zoom-in" }}
    >
      <div style={{ maxHeight: expanded ? undefined : collapsedHeight, overflow:"hidden", borderRadius:8 }}>
        {children(expanded)}
      </div>
      {!expanded && (
        <div style={{ position:"absolute", inset:0, borderRadius:8, display:"flex", alignItems:"flex-end", justifyContent:"center", paddingBottom:8, background:`linear-gradient(to bottom, rgba(0,0,0,0) 48%, ${fadeColor})` }}>
          <span style={{ fontSize:10, fontWeight:700, letterSpacing:"0.06em", color:"#7d766a", background:"#fff", border:"1px solid #e7e0d2", borderRadius:20, padding:"3px 11px", boxShadow:"0 1px 3px rgba(0,0,0,0.08)", opacity: hover ? 1 : 0.8 }}>
            ⤢ Click to enlarge
          </span>
        </div>
      )}
      {expanded && (
        <>
          <button onClick={(e) => { e.stopPropagation(); setExpanded(false); }} style={{ ...collapseBtn, position:"absolute", top:10, right:12 }}>
            Collapse ⤡
          </button>
          <div style={{ display:"flex", justifyContent:"center", marginTop:8 }}>
            <button onClick={(e) => { e.stopPropagation(); setExpanded(false); }} style={collapseBtn}>
              ⤡ Collapse
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// Compact inline-editable text row (label left, value right) for free-text deal
// fields like Seller. Module-level so its edit state survives parent re-renders.
function EditableTextRow({ label, value, placeholder, onSave }: {
  label: string;
  value?: string | null;
  placeholder?: string;
  onSave: (v: string | null) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const commit = () => { const t = draft.trim(); onSave(t === "" ? null : t); setEditing(false); };
  return (
    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid #e7e0d2", gap:10 }}>
      <span style={{ fontSize:10, color:"#6f6a5f", letterSpacing:"0.05em", flexShrink:0 }}>{label}</span>
      {editing ? (
        <input
          autoFocus
          value={draft}
          onChange={e => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={e => { if (e.key === "Enter") commit(); else if (e.key === "Escape") setEditing(false); }}
          placeholder={placeholder}
          style={{ fontSize:11, padding:"3px 7px", border:"1px solid #6dba43", borderRadius:5, color:"#383a37", background:"#fafaf8", maxWidth:200, width:"100%", fontFamily:"'Inter',sans-serif", textAlign:"right", boxSizing:"border-box" }}
        />
      ) : (
        <button
          onClick={() => { setDraft(value ?? ""); setEditing(true); }}
          title="Click to edit"
          style={{ display:"flex", alignItems:"center", gap:6, background:"transparent", border:"none", cursor:"pointer", padding:0, minWidth:0 }}>
          <span style={{ fontSize:11, color: value ? "#383a37" : "#958d80", fontWeight:500, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{value || "—"}</span>
          <span style={{ fontSize:10, color:"#c4bba7", flexShrink:0 }}>✎</span>
        </button>
      )}
    </div>
  );
}

function StaleBadge() {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:"#fffbeb", border:"1px solid #f59e0b", borderRadius:5, padding:"2px 8px", fontSize:10, color:"#92400e", fontWeight:500, fontFamily:"'Inter',sans-serif", lineHeight:1.4 }}>
      ⚠ Roster updated — AI grade, summary &amp; red flags may be out of date.
    </span>
  );
}

function ExtractionQuality({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  const [open, setOpen] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const { quality, missing } = assessExtraction(deal);
  if (quality === "good") return null;
  const color = quality === "thin" ? "#dc2626" : "#d9890c";
  const bg = quality === "thin" ? "#dc262610" : "#d9890c10";

  // The exact core fields assessExtraction grades on — let the user type in whichever
  // are blank so a thin/partial deal can be completed by hand (not just re-uploaded).
  const CORE: Array<{ field: keyof Deal; label: string; type: "text" | "number"; prefix?: string; suffix?: string; placeholder?: string }> = [
    { field: "propertyName", label: "Property Name", type: "text", placeholder: "e.g. Pointe Plaza" },
    { field: "totalSF", label: "Total SF", type: "number", placeholder: "e.g. 125000" },
    { field: "noi", label: "NOI", type: "number", prefix: "$", placeholder: "e.g. 1850000" },
    { field: "occupancy", label: "Occupancy", type: "number", suffix: "%", placeholder: "e.g. 94.5" },
    { field: "walt", label: "WALT", type: "number", suffix: "yrs", placeholder: "e.g. 6.2" },
  ];
  const blanks = CORE.filter(c => deal[c.field] == null || deal[c.field] === "");

  const save = () => {
    const patch: Record<string, unknown> = {};
    for (const c of blanks) {
      const raw = (vals[c.field as string] ?? "").trim();
      if (!raw) continue;
      if (c.type === "number") {
        const num = Number(raw.replace(/[$,%\s]/g, ""));
        if (!isNaN(num)) patch[c.field as string] = num;
      } else {
        patch[c.field as string] = raw;
      }
    }
    if (Object.keys(patch).length) onUpdate(deal.id, patch as Partial<Deal>);
    setOpen(false);
  };

  return (
    <div style={{ background:bg, border:`1px solid ${color}40`, borderRadius:8, padding:"10px 14px", marginBottom:12 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <div style={{ flex:1, minWidth:180 }}>
          <div style={{ fontSize:10, fontWeight:700, color, letterSpacing:"0.06em", marginBottom:3 }}>
            {quality === "thin" ? "⚠ THIN EXTRACTION" : "PARTIAL EXTRACTION"}
          </div>
          <div style={{ fontSize:11, color:"#6f6a5f" }}>
            {missing.length > 0
              ? <>Missing: {missing.join(", ")}. Fill them in below, or re-upload a higher-quality PDF.</>
              : <>No tenant roster captured — paste a rent roll or re-upload a higher-quality PDF.</>}
          </div>
        </div>
        {blanks.length > 0 && (
          <button onClick={() => { setVals({}); setOpen(true); }}
            style={{ flexShrink:0, background:"#fff", border:`1px solid ${color}`, color, padding:"6px 12px", borderRadius:8, cursor:"pointer", fontSize:11.5, fontWeight:700, fontFamily:"'Inter',sans-serif", whiteSpace:"nowrap" }}>
            ✎ Fill in the blanks
          </button>
        )}
      </div>
      {open && createPortal(
        <>
          <div onClick={() => setOpen(false)} style={{ position:"fixed", inset:0, background:"rgba(0,0,0,0.32)", zIndex:9998 }} />
          <div onClick={e => e.stopPropagation()} style={{ position:"fixed", top:"50%", left:"50%", transform:"translate(-50%,-50%)", zIndex:9999, background:"#fff", borderRadius:14, boxShadow:"0 24px 60px rgba(0,0,0,0.22)", padding:"20px 22px 18px", width:"min(360px,92vw)", maxHeight:"88vh", overflowY:"auto", fontFamily:"'Inter',sans-serif" }}>
            <div style={{ fontWeight:700, fontSize:13, color:"#383a37", marginBottom:4 }}>Fill in the missing fields</div>
            <div style={{ fontSize:11, color:"#a89f8f", marginBottom:14, lineHeight:1.5 }}>
              Enter the values from the OM. Filling these clears the {quality === "thin" ? "thin" : "partial"}-extraction flag. Leave any you don't have blank.
            </div>
            {blanks.map(c => (
              <div key={c.field as string} style={{ marginBottom:12 }}>
                <div style={{ fontSize:11, color:"#6b7280", marginBottom:4 }}>{c.label}</div>
                <div style={{ display:"flex", alignItems:"center", gap:6 }}>
                  {c.prefix && <span style={{ fontSize:13, color:"#a89f8f" }}>{c.prefix}</span>}
                  <input
                    inputMode={c.type === "number" ? "decimal" : undefined}
                    placeholder={c.placeholder}
                    value={vals[c.field as string] ?? ""}
                    onChange={e => setVals(prev => ({ ...prev, [c.field as string]: e.target.value }))}
                    onKeyDown={e => { if (e.key === "Enter") save(); }}
                    style={{ flex:1, boxSizing:"border-box", border:"1px solid #e6dfd0", borderRadius:8, padding:"8px 10px", fontSize:13, color:"#383a37", fontFamily:"'Inter',sans-serif", outline:"none", background:"#faf8f4" }}
                  />
                  {c.suffix && <span style={{ fontSize:13, color:"#a89f8f" }}>{c.suffix}</span>}
                </div>
              </div>
            ))}
            <div style={{ display:"flex", gap:8, marginTop:4 }}>
              <button onClick={save} style={{ flex:1, background:"#3f7a1f", color:"#fff", border:"none", borderRadius:8, padding:"10px 0", fontFamily:"'Inter',sans-serif", fontWeight:600, fontSize:13, cursor:"pointer" }}>Save</button>
              <button onClick={() => setOpen(false)} style={{ flex:1, background:"#f3f4f6", color:"#383a37", border:"none", borderRadius:8, padding:"10px 0", fontFamily:"'Inter',sans-serif", fontWeight:500, fontSize:13, cursor:"pointer" }}>Cancel</button>
            </div>
          </div>
        </>,
        document.body
      )}
    </div>
  );
}

function KeyAssumptions({ deal }: { deal: Deal }) {
  const [expanded, setExpanded] = useState(false);
  const tenantNotes = (deal.tenants||[]).filter(t=>t.assumptionNote).map(t=>({ name:t.name, text:t.assumptionNote! }));
  const dealNotes = Array.isArray(deal.keyAssumptions) ? deal.keyAssumptions.filter(Boolean).map(n=>({ text:n })) : (deal.keyAssumptions ? [{ text:deal.keyAssumptions }] : []);
  const all = [...dealNotes, ...tenantNotes];
  if (all.length === 0) return null;
  const LIMIT = 5;
  const shown = expanded ? all : all.slice(0, LIMIT);
  const hidden = all.length - LIMIT;
  return (
    <div style={{ background:"#fff8ec", border:"1px solid #e7c48f", borderLeft:"3px solid #d9890c", borderRadius:12, padding:"14px 18px", marginBottom:12 }}>
      <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#b45309", marginBottom:9 }}>⚑ Key Assumptions &amp; Footnotes</div>
      {shown.map((n,i) => (
        <div key={i} style={{ fontSize:12.5, color:"#6b4a16", lineHeight:1.6, marginBottom:4 }}>
          •&nbsp; {(n as {name?:string; text:string}).name && <span style={{ fontWeight:600 }}>{(n as {name?:string; text:string}).name}: </span>}{(n as {name?:string; text:string}).text}
        </div>
      ))}
      {hidden > 0 && (
        <button onClick={() => setExpanded(e => !e)} style={{ marginTop:7, background:"transparent", border:"none", color:"#b45309", fontWeight:600, fontSize:12, cursor:"pointer", padding:0, fontFamily:"'Inter',sans-serif" }}>
          {expanded ? "Show less" : `Show ${hidden} more`}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Comp Benchmark card
// ---------------------------------------------------------------------------
interface BmStats { median: number; p25: number; p75: number }
interface BmMatch {
  id: number; name: string | null; sourceDealName: string | null; market: string | null; saleDate: string | null;
  salePrice: number | null; capRate: number | null; pricePerSf: number | null;
  sf: number | null; anchor?: string | null; source: "owned" | "broker" | "om"; excluded: boolean;
  starred?: boolean; matchScore?: number; matchReasons?: string[];
  address?: string | null; state?: string | null; occupancy?: number | null;
  propertyType?: string | null; buyer?: string | null; seller?: string | null;
  sourceNotes?: string | null; sourceDealId?: string | null;
}
interface BmResult {
  insufficient: boolean; tierLabel: string; relaxed: string[]; excludedInvalid: number;
  n: number; dateRange: { from: string; to: string } | null;
  sourceMix: { owned: number; broker: number; om: number };
  capRate: BmStats | null; pricePerSf: BmStats | null;
  last12: { n: number; capRate: BmStats | null; pricePerSf: BmStats | null } | null;
  capDeltaBps: number | null; psfDeltaPct: number | null;
  comps: BmMatch[]; smartMatched: number; suggestions: BmMatch[];
  subject: { capRate: number | null; pricePerSf: number | null };
}

// Expandable "about the center" panel shown when a comp row is clicked.
function CompDetail({ c }: { c: BmMatch }) {
  const rows: Array<[string, string]> = [];
  const push = (l: string, v: string | number | null | undefined, suffix = "") => { if (v != null && v !== "") rows.push([l, `${v}${suffix}`]); };
  push("Address", c.address);
  push("Market", c.market);
  push("State", c.state);
  push("Property type", c.propertyType);
  push("Anchor", c.anchor);
  if (c.occupancy != null) push("Occupancy", c.occupancy, "%");
  push("Buyer", c.buyer);
  push("Seller", c.seller);
  if (c.sourceDealName && c.sourceDealName !== c.name) push("From deal", c.sourceDealName);
  push("Source", c.source === "owned" ? "KPR owned transaction (verified)" : c.source === "broker" ? "Broker / manually entered" : "OM-sourced (seller-provided)");
  return (
    <div style={{ fontFamily: "'Inter',sans-serif" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "5px 22px", marginTop: 6 }}>
        {rows.map(([l, v]) => (
          <div key={l} style={{ fontSize: 11.5 }}>
            <span style={{ color: "#a89f8f", marginRight: 5 }}>{l}:</span>
            <span style={{ color: "#383a37", fontWeight: 500 }}>{v}</span>
          </div>
        ))}
      </div>
      {c.matchReasons && c.matchReasons.length > 0 && (
        <div style={{ fontSize: 11, color: "#3f7a1f", marginTop: 7 }}>Why it matched: {c.matchReasons.join(" · ")}</div>
      )}
      {c.sourceNotes && <div style={{ fontSize: 11, color: "#7d766a", marginTop: 6, lineHeight: 1.5 }}>{c.sourceNotes}</div>}
      {rows.length === 0 && !c.sourceNotes && <div style={{ fontSize: 11.5, color: "#a89f8f", fontStyle: "italic", marginTop: 6 }}>No additional center detail on file for this comp.</div>}
    </div>
  );
}

function CompBenchmarkCard({ deal }: { deal: Deal }) {
  const lsKey = `bm-overrides-${deal.id}`;
  const readLs = (): { excludeIds?: number[]; includeIds?: number[]; dismissedSugIds?: number[]; starredIds?: number[] } => {
    try { return JSON.parse(localStorage.getItem(lsKey) ?? "{}"); } catch { return {}; }
  };

  const [bm, setBm] = useState<BmResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [excludeOm, setExcludeOm] = useState(false);
  const [excludeIds, setExcludeIds] = useState<number[]>(() => readLs().excludeIds ?? []);
  const [includeIds, setIncludeIds] = useState<number[]>(() => readLs().includeIds ?? []);
  const [dismissedSugIds, setDismissedSugIds] = useState<number[]>(() => readLs().dismissedSugIds ?? []);
  const [starredIds, setStarredIds] = useState<number[]>(() => readLs().starredIds ?? []);
  const [expandedComp, setExpandedComp] = useState<number | null>(null);
  const [showAllComps, setShowAllComps] = useState(false);
  const [showAllSugs, setShowAllSugs] = useState(false);
  const [addQ, setAddQ] = useState("");
  const [tableQ, setTableQ] = useState("");
  const [sortKey, setSortKey] = useState<"name" | "market" | "anchor" | "date" | "price" | "cap" | "psf" | "sf" | "source">("date");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [suggestions, setSuggestions] = useState<Array<{ id: number; name: string | null; sourceDealName: string | null; salePrice: number | null; market: string | null; saleDate: string | null }>>([]);
  const [sugsLoading, setSugsLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);
  // Manual comp filters. null = automatic (smart relaxation). When set, exactly
  // these filters apply (no auto-relax) and whatever count results is shown.
  type CompFilters = { months: number | null; geography: "national" | "state" | "metro"; sameType: boolean; sizeBand: boolean };
  const [compFilters, setCompFilters] = useState<CompFilters | null>(null);
  const DEFAULT_FILTERS: CompFilters = { months: 36, geography: "national", sameType: false, sizeBand: false };
  // Seed "Customize" from what AUTO just used, so it opens showing the SAME comps
  // (then the user tightens/loosens) — instead of a fixed default that can match
  // nothing (e.g. requiring same-type when the comps carry no property type).
  const filtersFromAuto = (): CompFilters => {
    const label = bm?.tierLabel || "";
    const relaxed = bm?.relaxed ?? [];
    // No real tier matched (comps came from smart-match) → start inclusive.
    if (!bm || label.includes("no matching")) return { months: 36, geography: "national", sameType: false, sizeBand: false };
    return {
      months: /24 month/i.test(label) ? 24 : 36,
      geography: relaxed.includes("geography") ? "national" : "state",
      sameType: !relaxed.includes("property type"),
      sizeBand: !relaxed.includes("size"),
    };
  };

  useEffect(() => {
    try { localStorage.setItem(lsKey, JSON.stringify({ excludeIds, includeIds, dismissedSugIds, starredIds })); } catch { /* ignore */ }
  }, [lsKey, excludeIds, includeIds, dismissedSugIds, starredIds]);

  const toggleStar = (id: number) =>
    setStarredIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const toggleExclude = (id: number) =>
    setExcludeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const addInclude = (id: number) => {
    setIncludeIds(prev => prev.includes(id) ? prev : [...prev, id]);
    setAddQ(""); setSuggestions([]);
  };
  const removeInclude = (id: number) =>
    setIncludeIds(prev => prev.filter(x => x !== id));

  // Click a column header to sort; clicking the active column flips direction.
  const toggleSort = (key: typeof sortKey) => {
    if (key === sortKey) setSortDir(d => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir(key === "name" || key === "market" || key === "anchor" || key === "source" ? "asc" : "desc"); }
  };

  useEffect(() => {
    if (!addQ.trim()) { setSuggestions([]); return; }
    setSugsLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/comps?q=${encodeURIComponent(addQ.trim())}`, { credentials: "include" })
        .then(r => r.json())
        .then((rows: Array<{ id: number; name: string | null; sourceDealName: string | null; salePrice: number | null; market: string | null; saleDate: string | null }>) => {
          const inBm = new Set((bm?.comps ?? []).map(c => c.id));
          setSuggestions(
            rows
              .filter(r => !inBm.has(r.id) && r.salePrice != null && r.salePrice > 0)
              .slice(0, 8)
              .map(r => ({ id: r.id, name: r.name, sourceDealName: r.sourceDealName, salePrice: r.salePrice, market: r.market, saleDate: r.saleDate }))
          );
          setSugsLoading(false);
        })
        .catch(() => setSugsLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [addQ, bm?.comps]);

  const subjectPsf = deal.pricePerSF != null ? deal.pricePerSF
    : (deal.askingPrice && deal.totalSF ? Math.round((deal.askingPrice as number) / (deal.totalSF as number)) : null);

  // Subject anchor signals for smart matching: lead anchor name(s) + IG flag.
  const anchorTenants = (deal.tenants || []).filter(t => t.isAnchor && t.name);
  const subjAnchorNames = anchorTenants.map(t => t.canonicalName || t.name).filter(Boolean).slice(0, 3).join(", ");
  const subjAnchorIG = anchorTenants.some(t => isInvestmentGrade(t.name || "", t.creditRating));

  useEffect(() => {
    let cancelled = false;
    const payload = JSON.stringify({
      dealId: deal.id, market: deal.market ?? null,
      state: (deal as unknown as Record<string, unknown>).state ?? null,
      propertyType: deal.centerType ?? (deal as unknown as Record<string, unknown>).propertyType ?? null,
      sf: deal.totalSF ?? null,
      capRate: deal.capRate ?? null, pricePerSf: subjectPsf ?? null,
      occupancy: deal.occupancy ?? null,
      anchor: subjAnchorNames || null,
      anchorIG: subjAnchorIG,
      excludeOmComps: excludeOm,
      excludeCompIds: excludeIds,
      includeCompIds: includeIds,
      starCompIds: starredIds,
      manual: compFilters,
    });
    setLoading(true); setErr(null); setBm(null);

    async function run(attempt: number): Promise<void> {
      try {
        const r = await fetch("/api/comps/benchmark", {
          method: "POST", credentials: "include",
          headers: { "Content-Type": "application/json" },
          body: payload,
        });
        if (cancelled) return;
        const transient = r.status === 502 || r.status === 503 || r.status === 504;
        if (transient && attempt === 0) {
          await new Promise(res => setTimeout(res, 1200));
          return run(1);
        }
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const d = await r.json() as BmResult;
        if (cancelled) return;
        setBm(d); setLoading(false);
      } catch (e) {
        if (cancelled) return;
        if (attempt === 0) {
          await new Promise(res => setTimeout(res, 1200));
          return run(1);
        }
        setErr((e instanceof Error ? e.message : String(e)) || "Failed");
        setLoading(false);
      }
    }

    run(0);
    return () => { cancelled = true; };
  }, [deal.id, excludeOm, excludeIds, includeIds, starredIds, retryKey, compFilters]);

  const fmtD = (s: string | null) => {
    if (!s) return "—";
    const d = new Date(s);
    return isNaN(d.getTime()) ? s : d.toLocaleDateString("en-US", { month: "short", year: "numeric" });
  };
  const fmtPct2 = (v: number | null | undefined) => v != null ? `${(+v).toFixed(1)}%` : "—";
  const fmtPsf  = (v: number | null | undefined) => v != null ? `$${Math.round(+v)}` : "—";
  const fmtM    = (v: number | null | undefined) => v != null ? `$${(+v / 1e6).toFixed(1)}M` : "—";
  const fmtSf   = (v: number | null | undefined) => v != null ? `${Number(v).toLocaleString()} SF` : "—";

  const capVerdict = (bps: number | null) => {
    if (bps == null) return null;
    if (bps <= -25) return { text: `~${Math.abs(bps)}bps inside the comp median — priced richer than comps`, color: "#b45309" };
    if (bps >= 25)  return { text: `~${Math.abs(bps)}bps above the comp median — priced cheaper than comps`, color: "#0f6b46" };
    return { text: "in line with comps", color: "#6dba43" };
  };
  const psfVerdict = (pct: number | null) => {
    if (pct == null) return null;
    if (pct >= 5)  return { text: `${Math.abs(pct)}% above the comp median — priced higher`, color: "#b45309" };
    if (pct <= -5) return { text: `${Math.abs(pct)}% below the comp median — priced lower`, color: "#0f6b46" };
    return { text: "in line with comps", color: "#6dba43" };
  };

  const sourceBadge = (s: "owned" | "broker" | "om") =>
    s === "owned" ? <span style={{ fontSize: 8, fontWeight: 700, color: "#3a7d44", background: "#d6f0da", border: "1px solid #a8d9b0", borderRadius: 3, padding: "1px 4px" }}>OWNED</span>
    : s === "broker" ? <span style={{ fontSize: 8, fontWeight: 700, color: "#5a7c9e", background: "#e8f1f8", border: "1px solid #c3d9ec", borderRadius: 3, padding: "1px 4px" }}>MANUAL</span>
    : <span style={{ fontSize: 8, fontWeight: 700, color: "#8c7a62", background: "#f3ede2", border: "1px solid #e0d4c0", borderRadius: 3, padding: "1px 4px" }}>OM</span>;

  const ROW_STYLE: React.CSSProperties = { display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap", padding: "7px 0", borderBottom: "1px solid #f5f1ea" };
  const LABEL: React.CSSProperties = { fontSize: 9, fontWeight: 700, letterSpacing: "0.12em", textTransform: "uppercase", color: "#a89f8f", minWidth: 72, flexShrink: 0 };
  const VAL: React.CSSProperties = { fontSize: 13, fontWeight: 600, color: "#26281f" };
  const MUTED: React.CSSProperties = { fontSize: 11, color: "#a89f8f" };

  const EyeBtn = ({ id, isExcluded }: { id: number; isExcluded: boolean }) => (
    <button onClick={() => toggleExclude(id)}
      title={isExcluded ? "Re-include in benchmark" : "Exclude from benchmark"}
      style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 4px", color: isExcluded ? "#c0b8ab" : "#6dba43", display: "inline-flex", alignItems: "center", flexShrink: 0 }}>
      {isExcluded ? (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/>
          <line x1="1" y1="1" x2="23" y2="23"/>
        </svg>
      ) : (
        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
          <circle cx="12" cy="12" r="3"/>
        </svg>
      )}
    </button>
  );

  const AddCompSection = () => (
    <div style={{ marginTop: 10, position: "relative" }}>
      <div style={{ fontSize: 10, color: "#a89f8f", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 5 }}>Add a comp</div>
      <input value={addQ} onChange={e => setAddQ(e.target.value)}
        placeholder="Search by property name, market…"
        style={{ width: "100%", boxSizing: "border-box", border: "1px solid #e7e0d2", borderRadius: 6, padding: "6px 10px", fontSize: 12, fontFamily: "'Inter',sans-serif", outline: "none", background: "#fdfaf6" }} />
      {sugsLoading && <div style={{ fontSize: 11, color: "#a89f8f", padding: "4px 0" }}>Searching…</div>}
      {suggestions.length > 0 && (
        <div style={{ position: "absolute", zIndex: 20, top: "100%", left: 0, right: 0, background: "#fff", border: "1px solid #e7e0d2", borderRadius: 7, boxShadow: "0 8px 24px rgba(0,0,0,0.12)", maxHeight: 260, overflowY: "auto" }}>
          {suggestions.map(s => {
            const label = s.name || s.sourceDealName || s.market || "Unnamed comp";
            return (
              <button key={s.id} onClick={() => addInclude(s.id)}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid #f5f1ea", padding: "10px 12px", cursor: "pointer", fontFamily: "'Inter',sans-serif", touchAction: "manipulation" }}>
                <span style={{ fontSize: 12, fontWeight: 500, color: "#26281f" }}>{label}</span>
                {s.market && s.name && <span style={{ fontSize: 11, color: "#a89f8f", marginLeft: 6 }}>{s.market}</span>}
                {s.saleDate && <span style={{ fontSize: 11, color: "#a89f8f", marginLeft: 6 }}>{fmtD(s.saleDate)}</span>}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );

  return (
    <div id="section-comp-benchmark" style={{ background: "#fff", border: "1px solid #efe8da", borderRadius: 12, padding: "18px 20px", marginBottom: 14, boxShadow: "0 1px 2px rgba(56,58,55,0.04)" }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", marginBottom: 12, gap: 12, flexWrap: "wrap" }}>
        <div style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 700, color: "#a89f8f" }}>Comp Benchmark</div>
        <label style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer", fontSize: 11, color: "#7d766a", fontFamily: "'Inter',sans-serif" }}>
          <input type="checkbox" checked={excludeOm} onChange={e => setExcludeOm(e.target.checked)} style={{ accentColor: "#6dba43", width: 12, height: 12 }} />
          Exclude OM-sourced comps
        </label>
      </div>

      {/* Comp filters — Auto (smart relaxation) or Custom (locked exactly as set) */}
      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 12, fontSize: 11.5 }}>
        {compFilters === null ? (
          <>
            <span style={{ color: "#7d766a" }}>Comps: <b style={{ color: "#3f7a1f" }}>Auto</b></span>
            <button onClick={() => setCompFilters(filtersFromAuto())}
              style={{ background: "transparent", border: "1px solid #d8cfbd", color: "#5c5047", borderRadius: 6, padding: "3px 9px", fontSize: 11, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
              Customize
            </button>
          </>
        ) : (
          <>
            <span style={{ color: "#7d766a", fontWeight: 600 }}>Filters:</span>
            <select value={String(compFilters.months ?? 0)} aria-label="Timing window"
              onChange={e => setCompFilters(f => ({ ...(f ?? DEFAULT_FILTERS), months: Number(e.target.value) || null }))}
              style={{ fontSize: 11, padding: "3px 6px", border: "1px solid #d8cfbd", borderRadius: 6, background: "#fff", color: "#383a37", fontFamily: "'Inter',sans-serif" }}>
              <option value="12">Last 12 mo</option>
              <option value="24">Last 24 mo</option>
              <option value="36">Last 36 mo</option>
              <option value="60">Last 60 mo</option>
              <option value="0">All dates</option>
            </select>
            <select value={compFilters.geography} aria-label="Geography"
              onChange={e => setCompFilters(f => ({ ...(f ?? DEFAULT_FILTERS), geography: e.target.value as CompFilters["geography"] }))}
              style={{ fontSize: 11, padding: "3px 6px", border: "1px solid #d8cfbd", borderRadius: 6, background: "#fff", color: "#383a37", fontFamily: "'Inter',sans-serif" }}>
              <option value="national">National</option>
              <option value="state">Same state</option>
              <option value="metro">Same metro</option>
            </select>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "#5c5047" }}>
              <input type="checkbox" checked={compFilters.sameType} onChange={e => setCompFilters(f => ({ ...(f ?? DEFAULT_FILTERS), sameType: e.target.checked }))} style={{ accentColor: "#6dba43", width: 12, height: 12 }} />
              Same type
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer", color: "#5c5047" }}>
              <input type="checkbox" checked={compFilters.sizeBand} onChange={e => setCompFilters(f => ({ ...(f ?? DEFAULT_FILTERS), sizeBand: e.target.checked }))} style={{ accentColor: "#6dba43", width: 12, height: 12 }} />
              Similar size
            </label>
            <button onClick={() => setCompFilters(null)}
              style={{ background: "transparent", border: "none", color: "#3f7a1f", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
              Reset to auto
            </button>
          </>
        )}
      </div>

      {loading && <div style={{ fontSize: 12, color: "#a89f8f", padding: "12px 0" }}>Computing benchmark…</div>}
      {err && (
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", fontSize: 12, color: "#dc2626" }}>
          <span>Could not load benchmark: {err}</span>
          <button onClick={() => setRetryKey(k => k + 1)}
            style={{ background: "transparent", border: "1px solid #dc2626", color: "#dc2626", padding: "3px 10px", borderRadius: 5, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", flexShrink: 0 }}>
            Retry
          </button>
        </div>
      )}

      {bm && (() => {
        const cv = capVerdict(bm.capDeltaBps);
        const pv = psfVerdict(bm.psfDeltaPct);
        const activeComps = bm.comps.filter(c => !c.excluded);
        const excludedCount = bm.comps.filter(c => c.excluded).length;

        if (bm.n === 0 && bm.comps.length === 0) {
          return (
            <>
              <div style={{ fontSize: 13, fontWeight: 600, color: "#26281f", marginBottom: 8 }}>Based on 0 comps · no matching comps</div>
              <div style={{ background: "#f9f6f0", border: "1px solid #ece5d7", borderRadius: 8, padding: "14px 16px", marginBottom: 10, fontSize: 12, color: "#a89f8f", fontStyle: "italic" }}>
                No comparable trades on file yet.
              </div>
              {AddCompSection()}
            </>
          );
        }

        return (
          <>
            <div style={{ marginBottom: 6 }}>
              <span style={{ fontSize: 13, fontWeight: 600, color: "#26281f" }}>
                {bm.n} comp{bm.n !== 1 ? "s" : ""} · {(bm.tierLabel === "no matching comps" && bm.n > 0) ? "closest matches" : bm.tierLabel}
                {bm.dateRange ? ` · ${fmtD(bm.dateRange.from)}–${fmtD(bm.dateRange.to)}` : ""}
              </span>
              {(() => {
                const mix = [
                  bm.sourceMix.owned ? `${bm.sourceMix.owned} owned` : "",
                  bm.sourceMix.broker ? `${bm.sourceMix.broker} broker` : "",
                  bm.sourceMix.om ? `${bm.sourceMix.om} OM` : "",
                ].filter(Boolean);
                if (bm.excludedInvalid > 0) mix.push(`${bm.excludedInvalid} excluded`);
                if (bm.relaxed.length > 0) mix.push(`relaxed ${bm.relaxed.join("/")}`);
                return mix.length ? <span style={{ fontSize: 11, color: "#a89f8f", marginLeft: 6 }}>· {mix.join(" · ")}</span> : null;
              })()}
              {bm.smartMatched > 0 && (
                <span style={{ fontSize: 11, color: "#3f7a1f", marginLeft: 6, fontWeight: 600 }}>· {bm.smartMatched} auto-matched</span>
              )}
            </div>

            {bm.insufficient && (
              <div style={{ background: "#fef9ed", border: "1px solid #f5c842", borderRadius: 8, padding: "8px 12px", marginBottom: 12, fontSize: 12, color: "#92400e" }}>
                Only {bm.n} comparable trade{bm.n !== 1 ? "s" : ""} on file — too few to benchmark reliably. Showing what's available; treat as directional only.
              </div>
            )}

            {(bm.subject.capRate != null || bm.capRate != null) && (
              <div style={ROW_STYLE}>
                <span style={LABEL}>Cap Rate</span>
                {bm.subject.capRate != null && <span style={VAL}>{fmtPct2(bm.subject.capRate)}</span>}
                {bm.subject.capRate != null && bm.capRate != null && <span style={MUTED}>subject vs</span>}
                {bm.capRate != null && (
                  <span style={{ fontSize: 12, color: "#383a37" }}>
                    median {fmtPct2(bm.capRate.median)}
                    <span style={{ color: "#a89f8f" }}> ({fmtPct2(bm.capRate.p25)}–{fmtPct2(bm.capRate.p75)} range)</span>
                  </span>
                )}
                {!bm.insufficient && cv && <span style={{ fontSize: 11, color: cv.color, fontWeight: 500 }}>{cv.text}</span>}
              </div>
            )}

            {(bm.subject.pricePerSf != null || bm.pricePerSf != null) && (
              <div style={ROW_STYLE}>
                <span style={LABEL}>Price / SF</span>
                {bm.subject.pricePerSf != null && <span style={VAL}>{fmtPsf(bm.subject.pricePerSf)}</span>}
                {bm.subject.pricePerSf != null && bm.pricePerSf != null && <span style={MUTED}>subject vs</span>}
                {bm.pricePerSf != null && (
                  <span style={{ fontSize: 12, color: "#383a37" }}>
                    median {fmtPsf(bm.pricePerSf.median)}
                    <span style={{ color: "#a89f8f" }}> ({fmtPsf(bm.pricePerSf.p25)}–{fmtPsf(bm.pricePerSf.p75)} range)</span>
                  </span>
                )}
                {!bm.insufficient && pv && <span style={{ fontSize: 11, color: pv.color, fontWeight: 500 }}>{pv.text}</span>}
              </div>
            )}

            {bm.last12 && (
              <div style={{ fontSize: 11, color: "#7d766a", padding: "6px 0", borderBottom: "1px solid #f5f1ea" }}>
                Last 12 months (n={bm.last12.n}):
                {bm.last12.capRate && <span> median cap {fmtPct2(bm.last12.capRate.median)}</span>}
                {bm.last12.capRate && bm.last12.pricePerSf && <span>,</span>}
                {bm.last12.pricePerSf && <span> median PSF {fmtPsf(bm.last12.pricePerSf.median)}</span>}
              </div>
            )}

            {/* Comps list — always shown, no toggle */}
            <div style={{ marginTop: 10 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", marginBottom: 6 }}>
                <div style={{ fontSize: 11, color: "#7d766a" }} title="★ weights a comp heavier · × drops it · tap a column header to sort">
                  <span style={{ fontWeight: 600, color: "#6dba43" }}>{activeComps.length}</span> in benchmark
                  {excludedCount > 0 && <span style={{ color: "#a89f8f", marginLeft: 5 }}>· {excludedCount} excluded</span>}
                  {starredIds.length > 0 && <span style={{ color: "#c98f1e", marginLeft: 5, fontWeight: 600 }}>· {starredIds.length} starred</span>}
                  <span style={{ fontSize: 10, color: "#c0b8ab", marginLeft: 6 }}>· ★ weight · × drop</span>
                </div>
                <input value={tableQ} onChange={e => setTableQ(e.target.value)}
                  placeholder="Filter comps…"
                  style={{ flex: "0 1 200px", minWidth: 130, boxSizing: "border-box", border: "1px solid #e7e0d2", borderRadius: 6, padding: "5px 9px", fontSize: 11.5, fontFamily: "'Inter',sans-serif", outline: "none", background: "#fdfaf6" }} />
              </div>
              {(() => {
                const q = tableQ.trim().toLowerCase();
                const dispName = (c: BmMatch) => c.name || c.sourceDealName || c.market || "Unnamed comp";
                let rows = bm.comps;
                if (q) rows = rows.filter(c =>
                  dispName(c).toLowerCase().includes(q) ||
                  (c.market || "").toLowerCase().includes(q) ||
                  (c.anchor || "").toLowerCase().includes(q));
                const sv = (c: BmMatch): string | number => {
                  switch (sortKey) {
                    case "name": return dispName(c).toLowerCase();
                    case "market": return (c.market || "").toLowerCase();
                    case "anchor": return (c.anchor || "").toLowerCase();
                    case "date": return c.saleDate || "";
                    case "price": return c.salePrice ?? -Infinity;
                    case "cap": return c.capRate ?? -Infinity;
                    case "psf": return c.pricePerSf ?? -Infinity;
                    case "sf": return c.sf ?? -Infinity;
                    case "source": return ({ owned: 0, broker: 1, om: 2 } as const)[c.source];
                  }
                };
                const sorted = [...rows].sort((a, b) => {
                  const av = sv(a), bv = sv(b);
                  const cmp = typeof av === "number" && typeof bv === "number"
                    ? av - bv : String(av).localeCompare(String(bv));
                  return sortDir === "asc" ? cmp : -cmp;
                });
                const COLS: Array<{ key: typeof sortKey; label: string }> = [
                  { key: "name", label: "Name" }, { key: "market", label: "Market" },
                  { key: "anchor", label: "Anchor" }, { key: "date", label: "Date" },
                  { key: "price", label: "Sale Price" }, { key: "cap", label: "Cap %" },
                  { key: "psf", label: "$/SF" }, { key: "sf", label: "SF" },
                  { key: "source", label: "Source" },
                ];
                // Keep the page short: show the first 5 unless expanded or actively
                // filtering (a filter should reveal all of its matches).
                const COMP_PREVIEW = 5;
                const collapsed = !showAllComps && !q && sorted.length > COMP_PREVIEW;
                const visible = collapsed ? sorted.slice(0, COMP_PREVIEW) : sorted;
                return (
                <>
                <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "'Inter',sans-serif" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #ece5d7" }}>
                      <th style={{ width: 48 }} />
                      {COLS.map(col => (
                        <th key={col.key} onClick={() => toggleSort(col.key)}
                          title="Sort by this column"
                          style={{ textAlign: "left", padding: "4px 8px", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: sortKey === col.key ? "#6dba43" : "#a89f8f", fontWeight: 700, whiteSpace: "nowrap", cursor: "pointer", userSelect: "none" }}>
                          {col.label}{sortKey === col.key ? (sortDir === "asc" ? " ▲" : " ▼") : ""}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {visible.map(c => {
                      const isStar = starredIds.includes(c.id) || !!c.starred;
                      const open = expandedComp === c.id;
                      return (
                      <Fragment key={c.id}>
                      <tr style={{ borderBottom: open ? "none" : "1px solid #f5f1ea", opacity: c.excluded ? 0.38 : 1, background: open ? "#faf7f0" : (isStar && !c.excluded ? "#fffaf0" : undefined) }}>
                        <td style={{ padding: "5px 2px 5px 6px", verticalAlign: "middle", whiteSpace: "nowrap" }}>
                          <button onClick={() => toggleStar(c.id)}
                            title={isStar ? "Unstar — remove extra weight" : "Star — weight this comp more heavily"}
                            style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 2px", color: isStar ? "#e8a92e" : "#cfc7b8", fontSize: 14, lineHeight: 1, display: "inline-flex", alignItems: "center", flexShrink: 0, fontFamily: "sans-serif" }}>{isStar ? "★" : "☆"}</button>
                          {c.excluded && !includeIds.includes(c.id)
                            ? <EyeBtn id={c.id} isExcluded={true} />
                            : <button onClick={() => includeIds.includes(c.id) ? removeInclude(c.id) : toggleExclude(c.id)}
                                title="Remove from benchmark"
                                style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 4px", color: "#dc2626", fontSize: 16, lineHeight: 1, display: "inline-flex", alignItems: "center", flexShrink: 0, fontFamily: "sans-serif" }}>×</button>}
                        </td>
                        <td onClick={() => setExpandedComp(open ? null : c.id)} title="Click for center details"
                          style={{ padding: "6px 8px", color: c.excluded ? "#a89f8f" : "#383a37", fontWeight: 500, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", cursor: "pointer" }}>
                          <span style={{ color: "#b3a994", fontSize: 9, marginRight: 4 }}>{open ? "▾" : "▸"}</span>{dispName(c)}
                        </td>
                        <td style={{ padding: "6px 8px", color: "#5c5850", whiteSpace: "nowrap" }}>{c.market || "—"}</td>
                        <td style={{ padding: "6px 8px", color: c.anchor ? "#5c5850" : "#c9c2b8", maxWidth: 150, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.anchor || "—"}</td>
                        <td style={{ padding: "6px 8px", color: "#5c5850", whiteSpace: "nowrap" }}>{fmtD(c.saleDate)}</td>
                        <td style={{ padding: "6px 8px", color: "#383a37", whiteSpace: "nowrap" }}>{fmtM(c.salePrice)}</td>
                        <td style={{ padding: "6px 8px", color: c.capRate != null ? "#26281f" : "#c9c2b8", fontWeight: c.capRate != null ? 600 : 400, whiteSpace: "nowrap" }}>{fmtPct2(c.capRate)}</td>
                        <td style={{ padding: "6px 8px", color: "#383a37", whiteSpace: "nowrap" }}>{fmtPsf(c.pricePerSf)}</td>
                        <td style={{ padding: "6px 8px", color: "#5c5850", whiteSpace: "nowrap" }}>{fmtSf(c.sf)}</td>
                        <td style={{ padding: "6px 8px" }}>{sourceBadge(c.source)}</td>
                      </tr>
                      {open && (
                        <tr style={{ background: "#faf7f0", borderBottom: "1px solid #f5f1ea" }}>
                          <td colSpan={10} style={{ padding: "2px 14px 12px 30px" }}>
                            <CompDetail c={c} />
                          </td>
                        </tr>
                      )}
                      </Fragment>
                      );
                    })}
                    {sorted.length === 0 && (
                      <tr><td colSpan={11} style={{ padding: "10px 8px", color: "#a89f8f", fontStyle: "italic" }}>No comps match "{tableQ}".</td></tr>
                    )}
                  </tbody>
                </table>
                </div>
                {sorted.length > COMP_PREVIEW && !q && (
                  <button onClick={() => setShowAllComps(s => !s)}
                    style={{ marginTop: 8, background: "transparent", border: "none", color: "#6dba43", cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "'Inter',sans-serif", padding: "2px 0" }}>
                    {collapsed ? `▸ Show all ${sorted.length} comps` : "▾ Show fewer"}
                  </button>
                )}
                </>
                );
              })()}
              {(() => {
                const sugs = bm.suggestions
                  .filter(s => !dismissedSugIds.includes(s.id) && !includeIds.includes(s.id))
                  // Rank most-similar first: matchScore, then number of match reasons, then recency.
                  .sort((a, b) => {
                    const sa = a.matchScore ?? (a.matchReasons?.length ?? 0);
                    const sb = b.matchScore ?? (b.matchReasons?.length ?? 0);
                    if (sb !== sa) return sb - sa;
                    return (b.saleDate || "").localeCompare(a.saleDate || "");
                  });
                if (sugs.length === 0) return null;
                const SUG_PREVIEW = 5;
                const visibleSugs = showAllSugs ? sugs : sugs.slice(0, SUG_PREVIEW);
                return (
                  <div style={{ marginTop: 14, borderTop: "1px solid #f1eadc", paddingTop: 12 }}>
                    <div style={{ fontSize: 10, color: "#a89f8f", fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 8 }}>Suggested comps — most similar first</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {visibleSugs.map(s => (
                        <div key={s.id} style={{ display: "flex", alignItems: "center", gap: 10, border: "1px solid #ece5d7", borderRadius: 9, padding: "8px 10px", background: "#faf7f0", flexWrap: "wrap" }}>
                          <div style={{ minWidth: 0, flex: "1 1 220px" }}>
                            <div style={{ fontSize: 12.5, fontWeight: 600, color: "#26281f", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{s.name || s.sourceDealName || s.market || "Comp"}</div>
                            <div style={{ fontSize: 10.5, color: "#8b8578", marginTop: 1 }}>
                              {(s.matchReasons ?? []).join(" · ") || "similar"}{s.capRate != null ? ` · ${fmtPct2(s.capRate)} cap` : ""}{s.saleDate ? ` · ${fmtD(s.saleDate)}` : ""}
                            </div>
                          </div>
                          <button onClick={() => addInclude(s.id)} style={{ background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 6, padding: "5px 11px", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap" }}>+ Add</button>
                          <button onClick={() => setDismissedSugIds(prev => prev.includes(s.id) ? prev : [...prev, s.id])} title="Dismiss this suggestion" style={{ background: "transparent", border: "1px solid #ddd4c2", color: "#a69e91", borderRadius: 6, padding: "5px 9px", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>Dismiss</button>
                        </div>
                      ))}
                    </div>
                    {sugs.length > SUG_PREVIEW && (
                      <button onClick={() => setShowAllSugs(s => !s)}
                        style={{ marginTop: 8, background: "transparent", border: "none", color: "#6dba43", cursor: "pointer", fontSize: 11.5, fontWeight: 600, padding: 0 }}>
                        {showAllSugs ? "▾ Show fewer" : `▸ Show all ${sugs.length} suggestions`}
                      </button>
                    )}
                  </div>
                );
              })()}
              {AddCompSection()}
            </div>
          </>
        );
      })()}
    </div>
  );
}

// Default human labels for known section ids. A section is included in the
// Jump-to menu if it is actually rendered in the DOM AND either carries a
// data-jump="Label" attribute or its id appears here. Deriving the menu from the
// live DOM (rather than a hand-kept list) means it stays correct automatically
// whenever sections are added, removed, reordered, or conditionally hidden.
const SECTION_LABELS: Record<string, string> = {
  "section-cover": "Overview",
  "section-highlights": "Investment Highlights",
  "section-tenants": "Tenant Roster",
  "section-site-agreements": "Site Agreements / REAs",
  "section-tenant-sales": "Tenant Sales",
  "section-lease-risk": "Lease Risk",
  "section-rollover": "Lease Rollover & WALT",
  "section-dealscore": "AI Deal Score",
  "section-upside": "Upside Items",
  "section-redflags": "Red Flags",
  "section-financials": "Key Financials",
  "section-assumptions": "Key Assumptions",
  "section-thesis": "Our Thesis",
  "section-review": "Our Review",
  "section-comp-benchmark": "Comp Benchmark",
  "section-closing-costs": "Estimated Closing Costs",
  "section-cashflow": "Cash Flow",
  "section-demographics": "Demographics & Site",
  "section-trade-area": "Trade Area (Census)",
  "section-notes": "Your Notes",
};

// All / Asset Management view toggle — AM mode hides the acquisition-underwriting
// sections (thesis, AI score, upside, red flags, key assumptions, closing costs,
// cash flow), leaving the operational data an asset manager cares about.
function ViewToggle({ mode, onChange }: { mode: "all" | "am"; onChange: (m: "all" | "am") => void }) {
  return (
    <div style={{ display:"flex", border:"1px solid #ddd4c2", borderRadius:6, overflow:"hidden", flexShrink:0, fontFamily:"'Inter',sans-serif" }}>
      {([["all","All"],["am","Asset Mgmt"]] as const).map(([v,label]) => (
        <button key={v} onClick={() => onChange(v)}
          style={{ background: mode===v ? "#383a37" : "#fff", color: mode===v ? "#f6f2ea" : "#52554e", border:"none", padding:"5px 11px", fontSize:11, fontWeight:600, cursor:"pointer", whiteSpace:"nowrap" }}>
          {label}
        </button>
      ))}
    </div>
  );
}

function SectionJump({ deal, scrollRef, viewMode }: { deal: Deal; scrollRef: React.RefObject<HTMLDivElement | null>; viewMode?: string }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<{ id: string; label: string }[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  // Build the menu from the sections actually present in the DOM, in document
  // order. A section qualifies if it has id starting with "section-" and either
  // a data-jump label or a known id in SECTION_LABELS. Recomputed each time the
  // menu opens (and when the deal changes), so it can never drift from the layout.
  const rebuildItems = useCallback(() => {
    const container = scrollRef.current;
    if (!container) return;
    const seen = new Set<string>();
    const next: { id: string; label: string }[] = [];
    container.querySelectorAll<HTMLElement>('[id^="section-"]').forEach(el => {
      const id = el.id;
      if (seen.has(id)) return;
      const label = el.dataset.jump || SECTION_LABELS[id];
      if (!label) return;
      seen.add(id);
      next.push({ id, label });
    });
    setItems(next);
  }, [scrollRef]);

  // Rebuild when the menu opens, the deal changes, or the view mode toggles
  // (which adds/removes sections from the DOM). A microtask delay lets the
  // conditional sections mount/unmount before we scan.
  useEffect(() => { const t = setTimeout(rebuildItems, 0); return () => clearTimeout(t); }, [rebuildItems, deal.id, open, viewMode]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    document.addEventListener("touchstart", handler);
    return () => {
      document.removeEventListener("mousedown", handler);
      document.removeEventListener("touchstart", handler);
    };
  }, [open]);

  const scrollTo = (id: string) => {
    setOpen(false);
    const el = document.getElementById(id);
    const container = scrollRef.current;
    if (el && container) {
      const y = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 72;
      container.scrollTo({ top: y, behavior: "smooth" });
    }
  };

  return (
    <div ref={ref} style={{ position: "relative", display: "inline-block", flexShrink: 0 }}>
      <button
        onClick={() => setOpen(o => !o)}
        style={{
          background: "#fff",
          border: "1px solid #ddd4c2",
          color: "#52554e",
          padding: "5px 11px",
          borderRadius: 6,
          cursor: "pointer",
          fontSize: 11,
          fontWeight: 600,
          fontFamily: "'Inter', sans-serif",
          display: "flex",
          alignItems: "center",
          gap: 5,
          whiteSpace: "nowrap",
        }}
      >
        Jump to ▾
      </button>
      {open && (
        <div style={{
          position: "absolute",
          top: "calc(100% + 5px)",
          right: 0,
          background: "#fff",
          border: "1px solid #e6dfd0",
          borderRadius: 8,
          boxShadow: "0 8px 24px rgba(56,58,55,0.16)",
          minWidth: 200,
          zIndex: 95,
          overflow: "hidden",
        }}>
          {items.map(it => (
            <button
              key={it.id}
              onClick={() => scrollTo(it.id)}
              style={{
                display: "block",
                width: "100%",
                textAlign: "left",
                background: "transparent",
                border: "none",
                padding: "9px 14px",
                cursor: "pointer",
                fontSize: 12,
                color: "#383a37",
                fontFamily: "'Inter', sans-serif",
                borderBottom: "1px solid #f5efe2",
              }}
              onMouseEnter={e => (e.currentTarget.style.background = "#f9f6f0")}
              onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
            >
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// Our REVIEW / overall take on the deal. Like the thesis box, but it's our verdict
// (what we like / don't like, our read on pricing). It folds into THIS deal's grade
// on re-grade, AND feeds the portfolio "House View" (Phase 2) that teaches the
// analyst how we think across all future deals.
function DealReviewBox({ deal, onUpdate, onRegrade, regrading, onOpenHouseView }: {
  deal: Deal;
  onUpdate: (id: string, patch: Partial<Deal>) => void;
  onRegrade: () => void | Promise<void>;
  regrading: boolean;
  onOpenHouseView?: () => void;
}) {
  // Single "Our Take" box. If a deal still has a legacy dealThesis but no review,
  // seed from it so old thesis text isn't lost — it migrates into dealReview (and
  // the old thesis is cleared) on the next save.
  const legacy = deal.dealReview ?? deal.dealThesis ?? "";
  const [text, setText] = useState(legacy);
  const saved = legacy;
  const dirty = text.trim() !== saved.trim();

  const lastSavedRef = useRef(saved);
  useEffect(() => {
    const prevSaved = lastSavedRef.current;
    if (saved !== prevSaved) {
      lastSavedRef.current = saved;
      setText(prev => (prev.trim() === "" || prev === prevSaved ? saved : prev));
    }
  }, [saved]);

  const persist = () => onUpdate(deal.id, { dealReview: text.trim() || null, ...(deal.dealThesis ? { dealThesis: null } : {}) });
  const save = () => { if (dirty) persist(); };
  const saveAndRegrade = async () => {
    if (dirty) persist();
    await Promise.resolve();
    await onRegrade();
  };

  return (
    <div style={{ background:"#f1f8f2", border:"1px solid #c2e0c9", borderRadius:12, padding:"16px 18px", marginBottom:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:8, marginBottom:6, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:8 }}>
          <span style={{ fontSize:13 }}>🧭</span>
          <span style={{ fontSize:12, fontWeight:700, letterSpacing:"0.04em", color:"#1f7a43", textTransform:"uppercase" }}>Our Take on This Deal</span>
        </div>
        {onOpenHouseView && (
          <button onClick={onOpenHouseView}
            style={{ background:"#fff", border:"1px solid #c2e0c9", color:"#1f7a43", padding:"5px 11px", borderRadius:7, cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
            🧠 House View
          </button>
        )}
      </div>
      <div style={{ fontSize:11, color:"#5e7165", marginBottom:10, lineHeight:1.5 }}>
        Your overall take — what you like, what concerns you, what you're underwriting to, and your read on the broker's pricing / cap. Folds into this deal's grade when you re-grade, and is distilled across all your takes into the <b>House View</b> that teaches the analyst how you think and shapes every future deal.
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={save}
        placeholder="e.g. We like the grocer's strong sales and below-market rent. Concerned about Best Buy — rent is high and sales are soft. Broker guided to a 6.5% cap, which is too expensive for this product and market…"
        rows={4}
        style={{ width:"100%", boxSizing:"border-box", resize:"vertical", fontFamily:"'Inter',sans-serif", fontSize:13, lineHeight:1.55, padding:"10px 12px", border:"1px solid #c2e0c9", borderRadius:8, color:"#383a37", background:"#fff", outline:"none" }}
      />
      <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:10, flexWrap:"wrap" }}>
        <button onClick={save} disabled={!dirty}
          style={{ background: dirty ? "#fff" : "#eef3ea", border:"1px solid #c2e0c9", color: dirty ? "#1f7a43" : "#a89f8f", padding:"7px 14px", borderRadius:7, cursor: dirty ? "pointer" : "default", fontSize:12, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
          {dirty ? "Save" : "Saved"}
        </button>
        <button onClick={saveAndRegrade} disabled={regrading || (!saved && !text.trim())}
          style={{ background:"#1f7a43", border:"none", color:"#fff", padding:"7px 14px", borderRadius:7, cursor: regrading ? "default" : "pointer", fontSize:12, fontWeight:600, fontFamily:"'Inter',sans-serif", opacity: regrading ? 0.6 : 1 }}>
          {regrading ? "Re-grading…" : "✨ Save & Re-grade with this review"}
        </button>
        <span style={{ fontSize:10.5, color:"#9aa3b2" }}>Re-grade uses a token refresh.</span>
      </div>
    </div>
  );
}

// Disposition subsection — collapsed behind a hide/unhide toggle by default,
// auto-expanded when the deal is Sold (so exit details surface automatically).
function DispositionSection({ sold, children }: { sold: boolean; children: React.ReactNode }) {
  const [open, setOpen] = useState(sold);
  // If the deal becomes Sold after mount, auto-reveal it.
  const prevSold = useRef(sold);
  useEffect(() => {
    if (sold && !prevSold.current) setOpen(true);
    prevSold.current = sold;
  }, [sold]);
  return (
    <div style={{ marginTop: 4 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ display:"flex", alignItems:"center", gap:8, width:"100%", textAlign:"left", background:"transparent", border:"none", cursor:"pointer", padding:"4px 0", marginBottom: open ? 10 : 0, fontFamily:"'Inter',sans-serif" }}>
        <span style={{ width:6, height:6, borderRadius:"50%", background:sold?"#0d9488":"#d0c9bc", flexShrink:0 }}/>
        <span style={{ fontSize:13, fontWeight:600, color:"#383a37" }}>{sold ? "Disposition Record" : "Disposition"}</span>
        <span style={{ marginLeft:"auto", fontSize:10, color:"#a69e91", fontWeight:600 }}>{open ? "HIDE ▴" : "SHOW ▾"}</span>
      </button>
      {open && children}
    </div>
  );
}

// Inline "Teach the extractor" modal (admin). Lets Eric record a plain-English
// rule when he catches an extraction mistake; the rule is stored and fed into
// the AI on every future extraction of that document type, so the system learns.
const SCOPE_OPTS: Array<{ value: LessonScope; label: string }> = [
  { value: "all", label: "All documents" },
  { value: "om", label: "Offering memorandums" },
  { value: "rent-roll", label: "Rent rolls" },
  { value: "lease-options", label: "Lease options" },
  { value: "sales", label: "Sales reports" },
  { value: "flyer", label: "Leasing flyers" },
  { value: "swap", label: "Swap confirmations" },
  { value: "loan", label: "Loan documents" },
];
function TeachExtractorModal({ onClose }: { onClose: () => void }) {
  const [lessons, setLessons] = useState<ExtractionLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [scope, setScope] = useState<LessonScope>("all");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reload = useCallback(() => {
    setLoading(true);
    apiGetExtractionLessons("all").then(rows => { setLessons(rows); setLoading(false); }).catch(() => setLoading(false));
  }, []);
  useEffect(() => { reload(); }, [reload]);

  const save = async () => {
    const t = text.trim();
    if (!t) return;
    setSaving(true); setErr(null);
    const res = await apiAddExtractionLesson(scope, t);
    setSaving(false);
    if (!res.ok) { setErr(res.error || "Could not save."); return; }
    setText(""); reload();
  };
  const remove = async (id: string) => { await apiDeleteExtractionLesson(id); reload(); };
  const scopeLabel = (s: string) => SCOPE_OPTS.find(o => o.value === s)?.label || s;

  const fld: React.CSSProperties = { width: "100%", boxSizing: "border-box", border: "1px solid #ddd4c2", borderRadius: 8, padding: "9px 11px", fontSize: 13, fontFamily: "'Inter',sans-serif", outline: "none", background: "#fdfaf6" };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 800, background: "rgba(38,40,31,0.5)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#fff", borderRadius: 14, padding: "20px 22px", width: "min(560px, 96vw)", maxHeight: "88vh", overflowY: "auto", boxShadow: "0 20px 60px rgba(38,40,31,0.28)", fontFamily: "'Inter',sans-serif" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
          <div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#26281f" }}>🎓 Teach the extractor</div>
            <div style={{ fontSize: 12.5, color: "#7d766a", lineHeight: 1.5, marginTop: 4 }}>
              Caught a mistake? Write a rule in plain English. The AI will follow it on every future extraction, so it gets it right next time.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", color: "#a69e91", cursor: "pointer", fontSize: 18, lineHeight: 1, flexShrink: 0 }}>✕</button>
        </div>

        <div style={{ marginTop: 16 }}>
          <label style={{ display: "block", fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#a89f8f", marginBottom: 5 }}>New rule</label>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={3}
            placeholder="e.g. Always capture every anchor tenant (Burlington, grocers, banks) even if they're on a separate page of the rent roll — never drop large tenants."
            style={{ ...fld, resize: "vertical", lineHeight: 1.5 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", marginTop: 8 }}>
            <span style={{ fontSize: 12, color: "#7d766a" }}>Apply to:</span>
            <select value={scope} onChange={e => setScope(e.target.value as LessonScope)} style={{ ...fld, width: "auto", padding: "7px 9px" }}>
              {SCOPE_OPTS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
            <button onClick={save} disabled={saving || !text.trim()}
              style={{ marginLeft: "auto", background: "#26281f", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: saving || !text.trim() ? "default" : "pointer", opacity: saving || !text.trim() ? 0.5 : 1 }}>
              {saving ? "Saving…" : "Add rule"}
            </button>
          </div>
          {err && <div style={{ fontSize: 12, color: "#dc2626", marginTop: 6 }}>{err}</div>}
        </div>

        <div style={{ borderTop: "1px solid #f1ece1", margin: "18px 0 12px" }} />
        <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", color: "#a89f8f", marginBottom: 8 }}>
          Active rules{lessons.length > 0 ? ` (${lessons.length})` : ""}
        </div>
        {loading ? (
          <div style={{ fontSize: 12.5, color: "#a89f8f" }}>Loading…</div>
        ) : lessons.length === 0 ? (
          <div style={{ fontSize: 12.5, color: "#a89f8f", fontStyle: "italic" }}>No custom rules yet. Add one above — the built-in extraction rules still apply on their own.</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
            {lessons.map(l => (
              <div key={l.id} style={{ display: "flex", alignItems: "flex-start", gap: 9, border: "1px solid #ece5d7", borderRadius: 9, padding: "9px 11px", background: "#faf7f0" }}>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontSize: 12.5, color: "#383a37", lineHeight: 1.5, whiteSpace: "pre-wrap" }}>{l.lesson}</div>
                  <div style={{ fontSize: 10.5, color: "#a69e91", marginTop: 3 }}>{scopeLabel(l.scope)}</div>
                </div>
                <button onClick={() => remove(l.id)} title="Remove this rule"
                  style={{ background: "transparent", border: "none", color: "#c0392b", cursor: "pointer", fontSize: 12, fontWeight: 600, flexShrink: 0, padding: "0 2px" }}>Remove</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Generates a PDF on click by dynamically importing @react-pdf + the document
// component — keeps the heavy PDF engine out of the deal page's initial load.
function PdfDownloadButton({ fileName, makeDoc, render }: {
  fileName: string;
  makeDoc: () => Promise<React.ReactElement>;
  render: (busy: boolean) => React.ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const [{ pdf }, doc] = await Promise.all([import("@react-pdf/renderer"), makeDoc()]);
      const blob = await pdf(doc as Parameters<typeof pdf>[0]).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch { /* ignore — user can retry */ }
    finally { setBusy(false); }
  };
  return <span onClick={onClick} style={{ display: "contents", cursor: "pointer" }}>{render(busy)}</span>;
}

export default function DetailView({ deal: d, allDeals, onBack, onDelete, onUpdate, onQuery, onCompare, onTenantClick, isAdmin }: Props) {
  const watchMap = useWatchlist();
  const watchImpact = computeWatchlistImpact(d, watchMap);
  const adjustedScore = watchImpact.adjustScore(d.dealScore);
  const [confirmDel, setConfirmDel] = useState(false);
  // View mode — "all" shows everything; "am" (Asset Management) hides the
  // acquisition-underwriting sections (thesis, AI score, upside, red flags, key
  // assumptions, closing costs, cash flow).
  const [viewMode, setViewMode] = useState<"all" | "am">("all");
  const showAcq = viewMode === "all"; // acquisition/underwriting sections visible?
  // Which image a delete-confirmation is open for ("cover" | "site" | null).
  const [confirmDelImg, setConfirmDelImg] = useState<null | "cover" | "site">(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [imgs, setImgs] = useState<ImageBundle | null>(null);
  // Lease abstracts on file for this deal (keyed by lowercased tenant name), plus
  // the open viewer/paste modal. Loaded per deal; refreshed after a save/delete.
  const [abstracts, setAbstracts] = useState<LeaseAbstract[]>([]);
  const [abstractModal, setAbstractModal] = useState<{ mode: "view" | "add"; tenantName: string } | null>(null);
  const [houseViewOpen, setHouseViewOpen] = useState(false);
  const [showAbstractUpload, setShowAbstractUpload] = useState(false);
  const [saleBusy, setSaleBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [marketBusy, setMarketBusy] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [tab, setTab] = useState<"overview" | "ai" | "tenants" | "transaction" | "financing" | "market" | "underwriting">("overview");
  const [navMenu, setNavMenu] = useState<string | null>(null);  // open jump-dropdown (a tab key, or "toc" on mobile)
  const isMobileNav = useIsMobile();
  const [actionsHelpOpen, setActionsHelpOpen] = useState(false);
  const [teachOpen, setTeachOpen] = useState(false);
  const [editingAddr, setEditingAddr] = useState(false);
  const [addrDraft, setAddrDraft] = useState({ address: "", city: "", state: "", zip: "" });
  const [reanalyzeBusy, setReanalyzeBusy] = useState(false);
  const rerunPdfRef = useRef<HTMLInputElement>(null);
  const [rrBusy, setRrBusy] = useState(false);
  const [rrError, setRrError] = useState<string | null>(null);
  const rrPdfRef = useRef<HTMLInputElement>(null);
  const [salesBusy, setSalesBusy] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
  const [showPrefManual, setShowPrefManual] = useState(false);
  const [notesVal, setNotesVal] = useState(d.userNotes || "");
  const [fixPage, setFixPage] = useState("");
  const [fixingPlan, setFixingPlan] = useState(false);
  const [sitePlanHalf, setSitePlanHalf] = useState<"full"|"left"|"right">("full");
  const [coverFixPage, setCoverFixPage] = useState("");
  const [fixingCover, setFixingCover] = useState(false);
  const [coverHalf, setCoverHalf] = useState<"full"|"left"|"right">("full");
  const sitePlanPdfRef = useRef<HTMLInputElement>(null);
  const coverPdfRef = useRef<HTMLInputElement>(null);
  const coverPhotoRef = useRef<HTMLInputElement>(null);
  const sitePlanImgRef = useRef<HTMLInputElement>(null);
  const [pastePanelOpen, setPastePanelOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteError, setPasteError] = useState<string | null>(null);
  // Start hidden if the user already confirmed this property's image (persisted
  // on the deal so the box doesn't reappear every time they reopen it).
  const [coverFinalized, setCoverFinalized] = useState(!!d.imageMeta?.coverConfirmed);
  const [sitePlanFinalized, setSitePlanFinalized] = useState(!!d.imageMeta?.sitePlanConfirmed);
  // Cover-save status so the user can SEE whether it's safe to leave the page.
  const [coverSave, setCoverSave] = useState<"idle" | "saving" | "saved" | "error">("idle");

  // Persist the confirmation onto the deal so it survives remounts / reopens.
  const finalizeCover = (v: boolean) => {
    setCoverFinalized(v);
    onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), coverConfirmed: v } });
  };
  const finalizeSitePlan = (v: boolean) => {
    setSitePlanFinalized(v);
    onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), sitePlanConfirmed: v } });
  };
  const { mutateAsync: sendMessage } = useCreateAiMessage();
  const [rescoreBusy, setRescoreBusy] = useState(false);
  const autoRescoreTriggered = useRef(false);
  // Long-running AI actions report to the global pinned progress bar (see lib/aiProgress).

  useEffect(() => {
    let alive = true;
    setImgs({});
    // ALWAYS load — don't gate on imageMeta flags. Those flags can drift out of
    // sync with what's actually stored (a manually-uploaded cover/site plan was
    // disappearing on return because its flag hadn't been set), which made stored
    // images look "gone." apiLoadImages returns empty when nothing's stored, so
    // this is cheap. Then self-heal the flags from what's really there.
    apiLoadImages(d.id).then(res => {
      if (!alive) return;
      setImgs(res || {});
      const hasCover = !!res?.cover;
      const planCount = res?.sitePlan?.length || 0;
      const metaCover = !!d.imageMeta?.cover;
      const metaPlan = Number(d.imageMeta?.sitePlan) || 0;
      if (hasCover !== metaCover || planCount !== metaPlan) {
        onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), cover: hasCover, sitePlan: planCount } });
      }
    }).catch(() => {});
    return () => { alive = false; };
  }, [d.id]);

  // Load lease abstracts for this deal (powers the roster "Abstract" pills and the
  // viewer). Returns [] on any failure, so the roster never breaks.
  const reloadAbstracts = useCallback(() => {
    apiListLeaseAbstracts(d.id).then(setAbstracts).catch(() => setAbstracts([]));
  }, [d.id]);
  useEffect(() => { setAbstracts([]); reloadAbstracts(); }, [reloadAbstracts]);

  const abstractsByTenant = useMemo(() => {
    const m = new Map<string, LeaseAbstract>();
    for (const a of abstracts) {
      if (a.tenantName) m.set(a.tenantName.trim().toLowerCase(), a);
    }
    return m;
  }, [abstracts]);

  // Deal whose tenant reimbursementMethods reflect the executed lease abstracts (when
  // on file) — used for the recovery estimate and expense-risk flag so they classify
  // off the authoritative lease (incl. Fixed CAM vs pro-rata NNN) when the OM was
  // silent. Render-time only; the stored roster is untouched.
  const dWithRecoveries = useMemo(() => withAbstractRecoveries(d, abstractsByTenant), [d, abstractsByTenant]);

  // Auto-apply lease-authoritative data to the roster: for every abstract that
  // matches a roster tenant, fill the fields the roster is MISSING (never
  // overwrites). Idempotent — once filled there are no blanks left, so it stops.
  // Keyed on [abstracts, d.id] so the onUpdate below can't loop.
  useEffect(() => {
    if (!abstracts.length || !(d.tenants?.length)) return;
    let next = d.tenants;
    let changed = false;
    for (const a of abstracts) {
      const chk = computeAbstractChecks(a, next, undefined);
      if (chk.tenantIndex >= 0 && Object.keys(chk.fill).length) {
        next = next.map((t, i) => (i === chk.tenantIndex ? { ...t, ...chk.fill } : t));
        changed = true;
      }
    }
    if (changed) onUpdate(d.id, { tenants: next, ...recomputeRosterMetrics(next as Array<Record<string, unknown>>, d.tenantsAsOf, d) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [abstracts, d.id]);

  // Roster tenants whose broker/rent-roll data disagrees with their lease abstract
  // (lowercased tenant name -> the list of discrepancies). Surfaced on the roster.
  const abstractDiscrepancies = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const a of abstracts) {
      const chk = computeAbstractChecks(a, d.tenants ?? [], undefined);
      if (a.tenantName && chk.discrepancies.length) m.set(a.tenantName.trim().toLowerCase(), chk.discrepancies);
    }
    return m;
  }, [abstracts, d.tenants]);

  // Resync confirmation boxes to the persisted flags when switching properties.
  useEffect(() => {
    setCoverFinalized(!!d.imageMeta?.coverConfirmed);
    setSitePlanFinalized(!!d.imageMeta?.sitePlanConfirmed);
    setCoverSave("idle");
  }, [d.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close Actions dropdown on any outside click
  useEffect(() => {
    if (!actionsOpen) return;
    const handler = () => { setActionsOpen(false); setActionsHelpOpen(false); };
    const t = window.setTimeout(() => {
      document.addEventListener("click", handler);
    }, 0);
    return () => {
      window.clearTimeout(t);
      document.removeEventListener("click", handler);
    };
  }, [actionsOpen]);

  // DetailView stays mounted as you move between deals, so the one-shot guard
  // below must reset per deal — otherwise only the FIRST deal opened in a session
  // could ever auto-rescore.
  useEffect(() => { autoRescoreTriggered.current = false; }, [d.id]);
  // Auto-rescore when ≥10 new deals have been added to the portfolio since this deal was last scored
  useEffect(() => {
    const lastCount = d.lastScoredDealCount ?? 0;
    if (!autoRescoreTriggered.current && allDeals.length - lastCount >= 10) {
      autoRescoreTriggered.current = true;
      setRescoreBusy(true);
      runWithProgress(
        `Re-scoring against portfolio benchmarks — ${d.propertyName || d.fileName || "deal"}`,
        async () => { const patch = await apiRescore(d.id); onUpdate(d.id, patch as Partial<typeof d>); },
        { doneLabel: "Score refreshed against portfolio benchmarks", errorLabel: "Auto re-score failed" },
      ).catch(() => {}).finally(() => setRescoreBusy(false));
    }
  }, [d.id, allDeals.length]);

  useEffect(() => { setNotesVal(d.userNotes || ""); }, [d.id]);

  const LOCKABLE: Record<string, boolean> = { askingPrice:true, capRate:true, noi:true, pricePerSF:true, totalSF:true, occupancy:true, grossPotentialRent:true, effectiveGrossIncome:true, operatingExpenses:true, walt:true };

  const onToggleVerified = (id: string, field: string) => {
    const ver = { ...(d.verified || {}) };
    if (ver[field]) { delete ver[field]; } else { ver[field] = { ts: Date.now() }; }
    onUpdate(id, { verified: ver });
  };

  const handleRentRoll = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ensureUploadAllowed()) return;
    const taskId = startAiTask(`Reading rent roll — ${d.propertyName || d.fileName || "deal"}`, file.name);
    setRrBusy(true);
    setRrError(null);
    try {
      const { text } = await extractAnyFile(file);
      // Use the SHARED rent-roll extractor — the SAME path as the bulk uploader —
      // so this button gets suite capture, the stronger model, vacant suites, the
      // rent-step-vs-option split, the truncation backstop, the suite-aware merge,
      // and review flags. (It previously ran a stale duplicate prompt that had no
      // "suite" field, which is why suites never pulled from this button.)
      const result = await extractRentRoll(text);
      const patch = buildRosterPatch(d, result);
      onUpdate(d.id, patch);
      finishAiTask(taskId, "done", `Roster updated — ${result.tenants.length} tenants from the rent roll`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Rent roll import failed.";
      setRrError(msg);
      finishAiTask(taskId, "error", msg);
    }
    setRrBusy(false);
  };

  const handleSalesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ensureUploadAllowed()) return;
    const taskId = startAiTask(`Reading sales report — ${d.propertyName || d.fileName || "deal"}`, file.name);
    setSalesBusy(true);
    setSalesError(null);
    try {
      const { text } = await extractAnyFile(file);
      const result = await extractSalesReport(text);
      const patch = buildSalesHistoryPatch(d, result);
      onUpdate(d.id, patch);
      finishAiTask(taskId, "done", `Sales loaded — ${result.tenants.length} tenants (${result.year})`);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Sales upload failed.";
      setSalesError(msg);
      finishAiTask(taskId, "error", msg);
    }
    setSalesBusy(false);
  };

  const pollUntilDone = async (id: string) => {
    const start = Date.now();
    while (Date.now() - start < 10 * 60 * 1000) {
      await new Promise(r => setTimeout(r, 3000));
      const status = await apiPollDealStatus(id);
      if (!status.processing) { if (status.deal) onUpdate(id, status.deal); break; }
    }
  };

  // Confirm before any action that spends AI / API tokens, so an accidental
  // button press can't quietly draw down usage. (Returns true to proceed.)
  const confirmAi = (label: string) =>
    window.confirm(`${label} uses AI and will draw down your API token usage.\n\nContinue?`);

  const handleReanalyze = async () => {
    if (!ensureUploadAllowed()) return;
    let overwriteRoster = false;
    if (d.tenantsManual) {
      const confirmed = window.confirm(
        "This deal's roster was manually updated (via rent roll paste).\n\n" +
        "Re-analyzing from the stored OM will REPLACE the current roster with the OM's older tenants.\n\n" +
        "For a safe refresh that keeps the current roster, cancel and use \"✨ Refresh Analysis (current roster)\" from the Actions menu.\n\n" +
        "Press OK only to confirm that you want to overwrite the manual roster with the OM's tenants."
      );
      if (!confirmed) return;
      overwriteRoster = true;
    } else if (!confirmAi("Rebuild from OM")) {
      return;
    }
    setAnalyzeOpen(false);
    setReanalyzeBusy(true);
    const taskId = startAiTask(`Rebuilding from OM — ${d.propertyName || d.fileName || "deal"}`);
    try {
      const result = await apiReanalyzeDeal(d.id, { overwriteRoster });
      if (result.rosterManual) { finishAiTask(taskId, "error", "Re-analyze blocked — manual roster (use Refresh Analysis)"); setReanalyzeBusy(false); return; }
      await pollUntilDone(d.id);
      onUpdate(d.id, { analysisStale: false });
      finishAiTask(taskId, "done", "Rebuilt from OM — analysis updated");
    } catch (err) {
      finishAiTask(taskId, "error", err instanceof Error ? err.message : "Rebuild from OM failed");
    }
    setReanalyzeBusy(false);
  };

  const handleRefreshAnalysis = async () => {
    if (!ensureUploadAllowed()) return;
    if (!confirmAi("Refresh Analysis")) return;
    setActionsOpen(false);
    setReanalyzeBusy(true);
    try {
      await runWithProgress(
        `Refreshing analysis — ${d.propertyName || d.fileName || "deal"}`,
        async () => {
          const result = await apiRefreshAnalysis(d.id);
          onUpdate(d.id, {
            notes: result.notes as string | undefined,
            dealScore: result.dealScore as import("../lib/idb").DealScore | undefined,
            upsideItems: result.upsideItems as import("../lib/idb").Deal["upsideItems"],
            redFlags: result.redFlags,
            analysisStale: false,
          });
        },
        { doneLabel: "Analysis refreshed — grade, narrative & red flags updated", errorLabel: "Refresh analysis failed" },
      );
    } catch { /* surfaced by the progress bar */ }
    setReanalyzeBusy(false);
  };

  const handleRerunPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ensureUploadAllowed()) return;
    setReanalyzeBusy(true);
    const taskId = startAiTask(`Re-running extraction from PDF — ${file.name}`);
    try {
      const { text, pages } = await extractPdfText(await file.arrayBuffer());
      await apiIngestDeal({ id: d.id, text, fileName: file.name, pageCount: pages, correctionsNote: buildCorrectionsNote(allDeals) });
      await pollUntilDone(d.id);
      onUpdate(d.id, { analysisStale: false });
      finishAiTask(taskId, "done", "Extraction complete — deal updated");
    } catch (err) {
      finishAiTask(taskId, "error", err instanceof Error ? err.message : "PDF extraction failed");
    }
    setReanalyzeBusy(false);
  };

  const onLookupSale = async (id: string) => {
    if (!ensureUploadAllowed()) return;
    if (!confirmAi("Find sale record (web search)")) return;
    setSaleBusy(true);
    const taskId = startAiTask(`Finding sale record — ${d.propertyName || d.fileName || "deal"}`);
    try {
      const resp = await sendMessage({ data: {
        system: "You are a CRE data analyst. Search for recent sale records of the property provided. Return JSON with: price (number), soldDate (string YYYY-MM-DD), capRate (number), buyer, seller, pricePerSF (number), summary (string), sources (array of {url, title}). If no sale found, return {notFound: true}.",
        messages: [{ role: "user", content: `Find sale records for: ${d.propertyName || d.fileName}, ${d.address || d.market}. Return JSON only.` }],
        max_tokens: 1024,
      }});
      const text = (resp as any)?.content?.[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]+\}/);
      let found = false;
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        if (!data.notFound) {
          found = true;
          onUpdate(id, { marketSale: { ...data, lookedUpAt: new Date().toISOString() }, marketSaleChecked: new Date().toISOString() });
        } else {
          onUpdate(id, { marketSaleChecked: new Date().toISOString() });
        }
      }
      finishAiTask(taskId, "done", found ? "Sale record found" : "No sale record found");
    } catch (err) {
      finishAiTask(taskId, "error", err instanceof Error ? err.message : "Sale lookup failed");
    }
    finally { setSaleBusy(false); }
  };

  const onGetDemo = async (id: string) => {
    if (!confirmAi("Fetch demographics (web search)")) return;
    setDemoBusy(true);
    const taskId = startAiTask(`Fetching demographics — ${d.propertyName || d.fileName || "deal"}`);
    try {
      const demo = await apiRefreshDemographics(id);
      if (demo) {
        onUpdate(id, { marketDemographics: demo, demoChecked: new Date().toISOString() });
      } else {
        onUpdate(id, { demoChecked: new Date().toISOString() });
      }
      finishAiTask(taskId, "done", demo ? "Demographics updated" : "No demographics found");
    } catch (err) {
      finishAiTask(taskId, "error", err instanceof Error ? err.message : "Demographics lookup failed");
    }
    finally { setDemoBusy(false); }
  };

  // Derive Market / Submarket from the address — free Census geocoder, no AI/tokens,
  // so no confirmation prompt. Fills the PROPERTY INFO rows the OM left blank.
  const onGetMarket = async (id: string) => {
    setMarketBusy(true);
    try {
      const r = await apiRefreshMarket(id);
      onUpdate(id, { market: r.market ?? undefined, submarket: r.submarket ?? undefined, marketGeo: r.marketGeo, marketGeoChecked: new Date().toISOString() });
    } catch {
      /* non-fatal — leave fields as-is */
    } finally {
      setMarketBusy(false);
    }
  };

  const parsePageSpec = (spec: string, max: number): number[] => {
    const pages: number[] = [];
    for (const part of spec.split(",")) {
      const trimmed = part.trim();
      const range = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
      if (range) {
        const lo = Math.max(1, parseInt(range[1], 10));
        const hi = Math.min(max, parseInt(range[2], 10));
        for (let p = lo; p <= hi; p++) pages.push(p);
      } else {
        const n = parseInt(trimmed, 10);
        if (n >= 1 && n <= max) pages.push(n);
      }
    }
    return [...new Set(pages)].sort((a, b) => a - b);
  };

  const handleSitePlanPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file || !fixPage.trim()) return;
    setFixingPlan(true);
    try {
      const lib = await loadPdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await lib.getDocument({ data: buf }).promise;
      if (pdf.numPages > 5 && !window.confirm(
        `This PDF has ${pdf.numPages} pages. Pulling a site plan from a large PDF loads the whole file and uses unnecessary bandwidth (and can be slow on a phone). For best results, extract just the page(s) you need into a smaller PDF first.\n\nUpload this ${pdf.numPages}-page PDF anyway?`
      )) { return; }
      const pages = parsePageSpec(fixPage, pdf.numPages);
      if (pages.length === 0) { alert(`No valid pages found in "${fixPage}" (PDF has ${pdf.numPages} pages).`); return; }
      const imgs_raw: string[] = [];
      for (const pg of pages) {
        const res = await _capturePagePhoto(pdf, pg, lib, sitePlanHalf, true);
        if (res.cover) imgs_raw.push(res.cover);
      }
      const current = (await apiLoadImages(d.id)) || {};
      const next = { ...current, sitePlan: imgs_raw, pagePicks: [], needsSitePlanPick: false };
      await apiSaveImages(d.id, next);
      setImgs(next);
      onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), sitePlan: imgs_raw.length, needsSitePlanPick: false } });
      setFixPage("");
    } catch (err: unknown) { alert("Couldn't read PDF: " + (err instanceof Error ? err.message : "error")); }
    finally { setFixingPlan(false); }
  };

  const handleCoverPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    const page = parseInt(coverFixPage, 10);
    if (!file || !(page >= 1)) return;
    setFixingCover(true);
    try {
      const lib = await loadPdfJs();
      const buf = await file.arrayBuffer();
      const pdf = await lib.getDocument({ data: buf }).promise;
      if (pdf.numPages > 5 && !window.confirm(
        `This PDF has ${pdf.numPages} pages. Pulling a cover image from a large PDF loads the whole file and uses unnecessary bandwidth (and can be slow on a phone). For best results, extract just the page you need into a smaller PDF first.\n\nUpload this ${pdf.numPages}-page PDF anyway?`
      )) { return; }
      if (page > pdf.numPages) { alert(`PDF has only ${pdf.numPages} pages.`); return; }
      const res = await _capturePagePhoto(pdf, page, lib, coverHalf);
      const current = (await apiLoadImages(d.id)) || {};
      const next = { ...current, cover: res.cover || null, coverThumb: res.thumb || null };
      await apiSaveImages(d.id, next);
      setImgs(next);
      onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), cover: !!res.cover } });
      setCoverFixPage("");
    } catch (err: unknown) { alert("Couldn't read PDF: " + (err instanceof Error ? err.message : "error")); }
    finally { setFixingCover(false); }
  };

  const chooseSitePlan = async (page: number) => {
    if (!imgs?.pagePicks) return;
    const pick = imgs.pagePicks.find(pk => pk.page === page);
    if (!pick) return;
    const next = { ...imgs, sitePlan: [pick.img], pagePicks: [], needsSitePlanPick: false };
    setImgs(next);
    await apiSaveImages(d.id, next);
    onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), sitePlan: 1, needsSitePlanPick: false } });
  };

  const handleCoverImageFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    setCoverSave("saving");
    // Keep the cover lean (1280px) so the save is a small, fast request.
    const dataUrl = await downscaleImageFile(file, 1280, 0.72);
    const coverThumb = await dataUrlToThumb(dataUrl).catch(() => null);
    // Read the latest stored bundle first so saving a cover never clobbers an
    // existing site plan (state can be stale across back-to-back uploads).
    const current: ImageBundle = (await apiLoadImages(d.id).catch(() => null)) || imgs || {};
    const next: ImageBundle = { ...current, cover: dataUrl, coverThumb };
    setImgs(next);
    // A failed save used to be swallowed — the cover showed locally but never
    // reached the DB, so it vanished on return. Now the status chip shows Saving →
    // Saved ✓ (so the user knows when it's safe to leave), and a real failure shows
    // its actual reason (HTTP status / timeout) instead of a misleading "too large".
    // Save ONLY the cover fields: the server preserves the rest.
    try {
      await apiSaveImages(d.id, { cover: dataUrl, coverThumb });
      onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), cover: true } });
      setCoverSave("saved");
    } catch (err) {
      setImgs(current);
      setCoverSave("error");
      alert(`Couldn't save the cover photo — ${err instanceof Error ? err.message : "unknown error"}.\n\nPlease try again. If it keeps failing, tell me the message above.`);
    }
  };

  const handleSitePlanImageFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = "";
    if (!files.length) return;
    // Downscale each image like the cover does. Raw phone photos are several MB
    // each; an oversized request body was being rejected, so the save silently
    // failed and the site plan disappeared on return. Keep them readable but lean.
    const urls = await Promise.all(files.map(f => downscaleImageFile(f, 2000, 0.82)));
    // Read the latest stored bundle first so saving a site plan never clobbers an
    // existing cover (state can be stale across back-to-back uploads).
    const current: ImageBundle = (await apiLoadImages(d.id).catch(() => null)) || imgs || {};
    const next: ImageBundle = { ...current, sitePlan: urls, pagePicks: [], needsSitePlanPick: false };
    setImgs(next);
    // Save ONLY the site-plan fields (server preserves the cover) — and clearing
    // pagePicks here shrinks the deal's stored bundle, freeing future saves.
    try {
      await apiSaveImages(d.id, { sitePlan: urls, pagePicks: [], needsSitePlanPick: false });
      onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), sitePlan: urls.length, needsSitePlanPick: false } });
    } catch (err) {
      setImgs(current);
      alert(`Couldn't save the site plan — ${err instanceof Error ? err.message : "unknown error"}.\n\nPlease try again. If it keeps failing, tell me the message above.`);
    }
  };

  // Remove the cover or site plan without uploading a replacement (with a confirm).
  const deleteCover = async () => {
    const current = (await apiLoadImages(d.id)) || {};
    const next: ImageBundle = { ...current, cover: null, coverThumb: null };
    setImgs(next);
    await apiSaveImages(d.id, next);
    setCoverFinalized(false);
    onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), cover: false, coverConfirmed: false } });
  };
  const deleteSitePlan = async () => {
    const current = (await apiLoadImages(d.id)) || {};
    const next: ImageBundle = { ...current, sitePlan: [], pagePicks: [], needsSitePlanPick: false };
    setImgs(next);
    await apiSaveImages(d.id, next);
    setSitePlanFinalized(false);
    onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), sitePlan: 0, needsSitePlanPick: false } });
  };
  // Remove ONE site-plan page (when the OM pulled several) without dropping the rest.
  const deleteSitePlanPage = async (index: number) => {
    const current = (await apiLoadImages(d.id)) || {};
    const arr = (current.sitePlan || []).filter((_, i) => i !== index);
    const next: ImageBundle = { ...current, sitePlan: arr };
    setImgs(next);
    await apiSaveImages(d.id, next);
    if (arr.length === 0) setSitePlanFinalized(false);
    onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), sitePlan: arr.length } });
  };

  const applyParsed = (parsed: { asOf?: string | null; tenants?: unknown[] }) => {
    const newTenants = Array.isArray(parsed.tenants) ? parsed.tenants as Deal["tenants"] : [];
    if (!newTenants || newTenants.length === 0) { setPasteError("No tenants found — check the pasted text."); return; }
    const asOf = parsed.asOf || new Date().toISOString().slice(0, 10);
    // WALT is derived from leaseExpiry vs asOf (the paste JSON keys off expiry
    // dates and rarely carries a fresh remainingTermYears), vacant/NAP excluded,
    // and never overwrites a good WALT with 0. See recomputeRosterMetrics.
    const recomputed = recomputeRosterMetrics(newTenants as Array<Record<string, unknown>>, asOf, d);
    onUpdate(d.id, { tenants: newTenants, tenantsAsOf: asOf, tenantsSource: "rent-roll", tenantsManual: true, analysisStale: true, ...recomputed });
    setPastePanelOpen(false);
    setPasteText("");
    setPasteError(null);
  };

  const applyPaste = () => {
    setPasteError(null);
    try {
      const parsed = robustParseJSON(pasteText) as { asOf?: string | null; tenants?: unknown[] };
      if (!parsed || typeof parsed !== "object") throw new Error("Not valid JSON.");
      applyParsed(parsed);
    } catch (err: unknown) {
      setPasteError(err instanceof Error ? err.message : "Couldn't parse — paste the raw JSON from Claude.");
    }
  };

  const HalfToggle = ({ val, set }: { val: string; set: (v: "full"|"left"|"right") => void }) => (
    <div style={{ display:"flex", gap:4 }}>
      {(["full","left","right"] as const).map(v => (
        <button key={v} onClick={() => set(v)}
          style={{ fontSize:9, padding:"3px 7px", borderRadius:5, border:"1px solid", borderColor:val===v?"#0d9488":"#e3dccd", background:val===v?"#0d948818":"transparent", color:val===v?"#0d9488":"#a69e91", cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
          {v}
        </button>
      ))}
    </div>
  );

  const Row = ({ l, v, c, field, warn }: { l: string; v: unknown; c?: string; field?: string; warn?: string }) => {
    const lockable = !!(field && LOCKABLE[field]);
    const ver = lockable ? (d.verified || {})[field!] : null;
    const hasVal = v != null && v !== "";
    return (
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid #e7e0d2", background:ver?"#0f9d6308":"transparent", margin:ver?"0 -6px":0, paddingLeft:ver?6:0, paddingRight:ver?6:0, borderRadius:ver?4:0 }}>
        <span style={{ fontSize:10, color:"#6f6a5f", letterSpacing:"0.05em" }}>{l}</span>
        <span style={{ display:"flex", alignItems:"center", gap:7 }}>
          <span style={{ fontSize:11, color:c||"#383a37", fontWeight:500 }}>{hasVal ? String(v) : <span style={{color:"#958d80"}}>—</span>}</span>
          {warn && <ReconBadge msg={warn}/>}
          {lockable && hasVal && (
            <button onClick={() => onToggleVerified(d.id, field!)}
              title={ver ? "Verified — click to unlock" : "Mark verified — locks against re-analyze"}
              style={{ background:ver?"#0f9d63":"transparent", border:`1px solid ${ver?"#0f9d63":"#cfd6dd"}`, color:ver?"#fff":"#b6bcc4", width:17, height:17, borderRadius:4, cursor:"pointer", fontSize:10, lineHeight:1, display:"flex", alignItems:"center", justifyContent:"center", padding:0, flexShrink:0 }}>
              {ver ? "✓" : ""}
            </button>
          )}
        </span>
      </div>
    );
  };

  const Card = ({ title, source, children, accent }: { title: string; source?: string; children: React.ReactNode; accent?: string }) => (
    <div style={{ background:"#fff", border:`1px solid ${accent||"#ece5d7"}`, borderRadius:12, padding:"16px 18px", boxShadow:"0 1px 2px rgba(56,58,55,0.04), 0 12px 28px -22px rgba(56,58,55,0.45)" }}>
      <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:accent||"#a89f8f", marginBottom:12 }}>
        {title}
        {source && <span style={{ textTransform:"none", letterSpacing:"normal", fontWeight:500, color:"#bcae97" }}> (Source: {source})</span>}
      </div>
      {children}
    </div>
  );

  const loc = classifyLocation(d);

  // ── Reconciliation warnings (display-only, ~2% tolerance) ─────────────────
  const reconWarns = (() => {
    const TOL = 0.02;
    const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
    const warns: Record<string, string> = {};
    const occupied = (d.tenants || []).filter(t => t.name && !/^vacant/i.test(String(t.name).trim()));

    // 1) Sum of tenant base rents vs Gross Potential Rent
    const gpr = n(d.grossPotentialRent);
    const sumRent = occupied.reduce((s, t) => s + (n(t.annualRent) ?? 0), 0);
    if (gpr && sumRent > 0) {
      const diff = Math.abs(sumRent - gpr) / gpr;
      if (diff > TOL) warns.grossPotentialRent =
        `Tenant base rents sum to $${Math.round(sumRent).toLocaleString()} — expected (GPR) $${Math.round(gpr).toLocaleString()} (${(diff*100).toFixed(1)}% gap)`;
    }

    // 2) Computed weighted-avg rent/SF vs stated WTAVG
    const wtavg = n(d.weightedAvgRentPSF);
    const withBoth = occupied.filter(t => n(t.annualRent) != null && n(t.sf) != null);
    const leasedSFw = withBoth.reduce((s, t) => s + n(t.sf)!, 0);
    const computedWtavg = leasedSFw > 0 ? withBoth.reduce((s, t) => s + n(t.annualRent)!, 0) / leasedSFw : null;
    if (wtavg && computedWtavg != null) {
      const diff = Math.abs(computedWtavg - wtavg) / wtavg;
      if (diff > TOL) warns.weightedAvgRentPSF =
        `Computed from tenants: $${computedWtavg.toFixed(2)}/SF — stated $${Number(wtavg).toFixed(2)}/SF (${(diff*100).toFixed(1)}% gap)`;
    }

    // 3) Leased SF vs occupancy %
    const totalSF = n(d.totalSF), occ = n(d.occupancy);
    const leasedSF = occupied.reduce((s, t) => s + (n(t.sf) ?? 0), 0);
    if (totalSF && occ && leasedSF > 0) {
      const computedOcc = (leasedSF / totalSF) * 100;
      const diff = Math.abs(computedOcc - occ) / occ;
      if (diff > TOL) warns.occupancy =
        `Tenant SF sums to ${leasedSF.toLocaleString()} SF = ${computedOcc.toFixed(1)}% of total — stated ${occ}%`;
    }

    return warns;
  })();

  const fullAddress = formatFullAddress(d);

  const titleRef = useRef<HTMLHeadingElement>(null);
  const [titleScrolled, setTitleScrolled] = useState(false);

  useEffect(() => {
    const el = titleRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => setTitleScrolled(!entries[0].isIntersecting),
      { threshold: 0, rootMargin: "-96px 0px 0px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollToSection = (id: string) => {
    const el = document.getElementById(id);
    const c = scrollContainerRef.current;
    if (el && c) { const y = el.getBoundingClientRect().top - c.getBoundingClientRect().top + c.scrollTop - 56; c.scrollTo({ top: y, behavior: "smooth" }); }
  };
  useEffect(() => {
    if (!navMenu) return;
    const h = () => setNavMenu(null);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [navMenu]);

  // The sub-page nav (tabs + jump-menus). Rendered in two spots: in-flow under the
  // title, and inside the floating compact header so it stays pinned (incl. at the
  // very bottom of the page, where a sticky bar would detach).
  // Both copies share one `navMenu` state, so gate each so only the currently
  // visible nav renders the open dropdown — otherwise the floating header and the
  // in-flow bar both show the same menu, stacked on top of each other.
  const renderSubNav = (floating: boolean) => {
   const showMenu = floating ? titleScrolled : !titleScrolled;
   return (
    isMobileNav ? (
      <div style={{ position:"relative" }}>
        <button onClick={() => setNavMenu(m => m ? null : "toc")}
          style={{ width:"100%", display:"flex", alignItems:"center", justifyContent:"space-between", background:"#fff", border:"1px solid #e3dccd", borderRadius:8, padding:"9px 13px", fontSize:13, fontWeight:700, color:"#26281f", cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>
          <span>{PAGE_TAB_LABEL[tab]}</span><span style={{ fontSize:11, color:"#a69e91", fontWeight:600 }}>☰ sections ▾</span>
        </button>
        {navMenu && showMenu && (
          <div style={{ position:"absolute", left:0, right:0, top:"calc(100% + 4px)", background:"#fff", border:"1px solid #e3dccd", borderRadius:10, boxShadow:"0 14px 34px rgba(0,0,0,0.2)", zIndex:70, maxHeight:"68vh", overflowY:"auto", padding:6 }}>
            {PAGE_TABS.map(([k,label]) => (
              <div key={k} style={{ marginBottom:2 }}>
                <button onClick={() => { setTab(k); setNavMenu(null); }}
                  style={{ width:"100%", textAlign:"left", background: tab===k ? "#eef5e8" : "transparent", border:"none", padding:"8px 10px", fontSize:12.5, fontWeight:700, color: tab===k ? "#2d5a0e" : "#383a37", cursor:"pointer", borderRadius:6 }}>
                  {label}
                </button>
                {(TAB_SECTIONS[k] || []).map(s => (
                  <button key={s.id} onClick={() => { setTab(k); setNavMenu(null); setTimeout(() => scrollToSection(s.id), 60); }}
                    style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"5px 10px 5px 26px", fontSize:11.5, color:"#6f6a5f", cursor:"pointer" }}>
                    {s.label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    ) : (
      <div style={{ display:"flex", gap:2, borderBottom:"1.5px solid #e7e0d2", flexWrap:"wrap" }}>
        {PAGE_TABS.map(([k,label]) => (
          <div key={k} style={{ position:"relative" }}>
            <button onClick={() => { setTab(k); setNavMenu(m => m === k ? null : k); }}
              style={{ background:"transparent", border:"none", borderBottom: tab===k ? "2px solid #3f7a1f" : "2px solid transparent", color: tab===k ? "#26281f" : "#8b8578", padding:"8px 11px", marginBottom:-1.5, cursor:"pointer", fontSize:12.5, fontWeight: tab===k ? 700 : 500, whiteSpace:"nowrap", fontFamily:"'Inter',sans-serif" }}>
              {label} <span style={{ fontSize:8, opacity:0.55 }}>▾</span>
            </button>
            {navMenu === k && showMenu && (TAB_SECTIONS[k] || []).length > 0 && (
              <div style={{ position:"absolute", top:"100%", left:0, marginTop:2, background:"#fff", border:"1px solid #e3dccd", borderRadius:9, boxShadow:"0 10px 26px rgba(0,0,0,0.14)", zIndex:70, minWidth:190, padding:5 }}>
                {(TAB_SECTIONS[k] || []).map(s => (
                  <button key={s.id} onClick={() => { setTab(k); setNavMenu(null); setTimeout(() => scrollToSection(s.id), 60); }}
                    style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"7px 10px", fontSize:12, color:"#383a37", cursor:"pointer", borderRadius:6 }}>
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    )
   );
  };

  return (
    <div ref={scrollContainerRef} style={{ flex:1, minHeight:0, overflowY:"auto", padding:"20px 24px 96px 24px" }}>
      <div style={{
        position: "fixed",
        top: 88,
        // Centered to the same max width as the body so the floating title bar
        // lines up with the content on a wide monitor instead of spanning the
        // whole screen.
        left: "50%",
        right: "auto",
        width: "100%",
        maxWidth: DETAIL_MAX_WIDTH,
        zIndex: 90,
        background: "rgba(252,250,245,0.94)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid #e7e0d2",
        padding: "12px 16px",
        boxShadow: titleScrolled ? "0 6px 18px -10px rgba(56,58,55,0.25)" : "none",
        // Hidden state must clear the top:88 offset too — translateY(-110%) only moved
        // it up by its own height, leaving its bottom edge stuck visible at the top
        // before any scroll. Move up its full height PLUS the offset so it's fully gone.
        transform: titleScrolled ? "translateX(-50%) translateY(0)" : "translateX(-50%) translateY(calc(-100% - 96px))",
        transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 220ms ease",
        pointerEvents: titleScrolled ? "auto" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10 }}>
          <button onClick={onBack} title="Back" aria-label="Back" style={{ flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", width: 30, height: 30, borderRadius: "50%", background: "#fff", border: "1px solid #e0d8c8", color: "#5c5047", fontSize: 15, cursor: "pointer", lineHeight: 1, boxShadow: "0 1px 3px rgba(56,58,55,0.1)" }}>←</button>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div style={{
              fontFamily: "'Fraunces',serif",
              fontSize: 16,
              fontWeight: 600,
              color: "#26281f",
              letterSpacing: "-0.01em",
              lineHeight: 1.3,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
            }}>
              {d.propertyName || d.fileName}
            </div>
            {fullAddress && (
              <div style={{
                fontSize: 11,
                color: "#6f6a5f",
                marginTop: 1,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}>
                {fullAddress}
              </div>
            )}
          </div>
          <div style={{ display:"flex", gap:8, flexShrink: 0 }}>
            <ViewToggle mode={viewMode} onChange={setViewMode} />
          </div>
        </div>
        {/* Tabs live inside the floating header so they stay pinned all the way down */}
        <div onClick={e => e.stopPropagation()} style={{ marginTop:8 }}>
          {renderSubNav(true)}
        </div>
      </div>

      {/* Width-constrained body — like the Comps page, the deal page and all its
          sub-tabs sit in a centered max-width column so they stay readable on a big
          monitor. The scroll stays on the full-width container above; only the
          content is capped. */}
      <div style={{ maxWidth: DETAIL_MAX_WIDTH, margin: "0 auto", width: "100%", boxSizing: "border-box" }}>
      {/* Back — own line above the title so it never crowds the title/actions row */}
      <div style={{ marginBottom:8 }}>
        <button onClick={onBack} title="Back" aria-label="Back" style={{ display:"inline-flex", alignItems:"center", gap:4, background:"#fff", border:"1px solid #e0d8c8", color:"#5c5047", borderRadius:20, padding:"5px 13px 5px 10px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'Inter',sans-serif", boxShadow:"0 1px 3px rgba(56,58,55,0.1)" }}>← Back</button>
      </div>
      {/* Property name + Actions + Jump To */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8, margin:"0 0 4px 0", flexWrap:"wrap" }}>
        <h1 ref={titleRef} style={{ fontFamily:"'Fraunces',serif", fontSize:30, fontWeight:500, color:"#26281f", margin:0, letterSpacing:"-0.02em", lineHeight:1.15, paddingTop:2, flex:"1 1 auto", minWidth:0 }}>{d.propertyName||d.fileName}</h1>
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <div style={{ position:"relative" }}>
            <button onClick={() => setActionsOpen(o => { if (o) setActionsHelpOpen(false); return !o; })}
              style={{ background:"#2a2c27", border:"none", color:"#fff", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:5, fontWeight:500 }}>
              Actions <span style={{ fontSize:9 }}>▾</span>
            </button>
            {actionsOpen && (
              <div onClick={e => e.stopPropagation()} style={{ position:"absolute", top:"110%", left:0, right:"auto", background:"#fff", border:"1px solid #e3dccd", borderRadius:9, padding:4, zIndex:300, boxShadow:"0 8px 24px rgba(0,0,0,0.13)", minWidth:210, maxWidth:"calc(100vw - 24px)", maxHeight:"70vh", overflowY:"auto" }}>
                {actionsHelpOpen ? (
                  <div>
                    <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", padding:"4px 8px 6px 12px" }}>
                      <span style={{ fontSize:9, color:"#a69e91", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>What these do</span>
                      <button onClick={() => setActionsHelpOpen(false)} style={{ background:"transparent", border:"none", color:"#7d766a", cursor:"pointer", fontSize:12, fontWeight:600, padding:"2px 6px" }}>✕ Close</button>
                    </div>
                    <div style={{ maxHeight:380, overflowY:"auto", padding:"0 12px 6px" }}>
                      {([
                        ["✨ Refresh Analysis (current roster)", "Your everyday button. Re-grades the deal and rewrites the summary, strengths, risks and red flags from the CURRENT tenant roster — use it after you paste a new rent roll. It does NOT re-read the OM, so a manually-entered roster stays safe."],
                        ["↺ Rebuild from OM", "Starts over from the OM: re-runs the full AI extraction from the saved OM text, regenerating tenants, financials and narrative (and picking up any newer analysis the app has added). It refuses to wipe a manual roster unless you confirm. Use the small 'Re-run from PDF' link underneath only if the saved OM text came out garbled."],
                        ["↗ Ask the Analyst", "Opens the AI analyst with a full buy / pass / watch question (cap rate, WALT, tenant credit, rollover, comps) pre-filled — then ask it anything else, including for comparable sales."],
                        ["🔍 Find Sale Record", "Looks up the property's actual last/known sale — price, date, buyer and seller — from public sources."],
                        ["🗑 Delete Deal", "Permanently removes this deal from the database."],
                      ] as [string, string][]).map(([title, desc]) => (
                        <div key={title} style={{ padding:"7px 0", borderBottom:"1px solid #f4efe6" }}>
                          <div style={{ fontSize:11.5, fontWeight:700, color:"#383a37", marginBottom:2 }}>{title}</div>
                          <div style={{ fontSize:11, color:"#7d766a", lineHeight:1.5 }}>{desc}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (<>
                <div style={{ display:"flex", alignItems:"center", gap:6, padding:"4px 12px 2px" }}>
                  <span style={{ fontSize:9, color:"#a69e91", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>Analyze</span>
                  <button onClick={() => setActionsHelpOpen(true)} title="What do these actions do?"
                    style={{ width:16, height:16, borderRadius:"50%", border:"1px solid #d8cfbd", background:"#f6f2ea", color:"#7d766a", fontSize:10, fontWeight:700, lineHeight:1, cursor:"pointer", display:"inline-flex", alignItems:"center", justifyContent:"center", padding:0, flexShrink:0 }}>?</button>
                </div>
                <button onClick={() => handleRefreshAnalysis()} disabled={reanalyzeBusy}
                  style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"7px 12px", borderRadius:6, cursor:reanalyzeBusy?"default":"pointer", fontSize:12, color:reanalyzeBusy?"#a69e91":"#3f7a1f", fontFamily:"'Inter',sans-serif", fontWeight:600 }}
                  onMouseEnter={e => { if (!reanalyzeBusy) e.currentTarget.style.background="#f0f7e8"; }} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                  {reanalyzeBusy ? "Refreshing…" : "✨ Refresh Analysis (current roster)"}
                </button>
                <button onClick={() => { setActionsOpen(false); handleReanalyze(); }}
                  style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"7px 12px 2px", borderRadius:6, cursor:"pointer", fontSize:12, color:"#383a37", fontFamily:"'Inter',sans-serif" }}
                  onMouseEnter={e => e.currentTarget.style.background="#f6f2ea"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                  ↺ Rebuild from OM
                </button>
                <button onClick={() => { setActionsOpen(false); rerunPdfRef.current?.click(); }}
                  style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"0 12px 7px 30px", borderRadius:6, cursor:"pointer", fontSize:10.5, color:"#a69e91", fontFamily:"'Inter',sans-serif" }}
                  onMouseEnter={e => e.currentTarget.style.color="#7d766a"} onMouseLeave={e => e.currentTarget.style.color="#a69e91"}>
                  ↑ OM text looks wrong? Re-run from PDF…
                </button>
                <div style={{ borderTop:"1px solid #f1ece1", margin:"4px 0" }}/>
                <div style={{ padding:"4px 12px 2px", fontSize:9, color:"#a69e91", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>Research</div>
                <button onClick={() => { setActionsOpen(false); onQuery(`Full investment analysis on "${d.propertyName}": evaluate cap rate, WALT (${d.walt||"unknown"}yr), tenant credit quality, rent bumps, lease rollover risk, and comparable sales. Give a buy/pass/watch recommendation.`); }}
                  style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"7px 12px", borderRadius:6, cursor:"pointer", fontSize:12, color:"#383a37", fontFamily:"'Inter',sans-serif" }}
                  onMouseEnter={e => e.currentTarget.style.background="#f6f2ea"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                  ↗ Ask the Analyst
                </button>
                <button onClick={() => { setActionsOpen(false); onLookupSale(d.id); }}
                  style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"7px 12px", borderRadius:6, cursor:"pointer", fontSize:12, color:"#383a37", fontFamily:"'Inter',sans-serif" }}
                  onMouseEnter={e => e.currentTarget.style.background="#f6f2ea"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                  🔍 Find Sale Record
                </button>
                {isAdmin && (<>
                  <div style={{ borderTop:"1px solid #f1ece1", margin:"4px 0" }}/>
                  <div style={{ padding:"4px 12px 2px", fontSize:9, color:"#a69e91", fontWeight:600, letterSpacing:"0.06em", textTransform:"uppercase" }}>Admin · Debug</div>
                  <button onClick={() => {
                      setActionsOpen(false);
                      const { id, ...data } = d;
                      const blob = new Blob([JSON.stringify([{ id, data }], null, 2)], { type: "application/json" });
                      const url = URL.createObjectURL(blob);
                      const a = document.createElement("a");
                      a.href = url;
                      a.download = `kpr-rawdata-${(d.propertyName || d.fileName || "deal").replace(/[^a-z0-9]+/gi, "-").slice(0, 40)}-${new Date().toISOString().slice(0, 10)}.json`;
                      a.click();
                      URL.revokeObjectURL(url);
                    }}
                    title="Download this deal's full extracted data to review against the OM"
                    style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"7px 12px", borderRadius:6, cursor:"pointer", fontSize:12, color:"#383a37", fontFamily:"'Inter',sans-serif" }}
                    onMouseEnter={e => e.currentTarget.style.background="#f6f2ea"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                    🧪 Export raw data (.json)
                  </button>
                  <button onClick={() => { setActionsOpen(false); setTeachOpen(true); }}
                    title="Teach the extractor a new rule so it handles files like this correctly next time"
                    style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"7px 12px", borderRadius:6, cursor:"pointer", fontSize:12, color:"#383a37", fontFamily:"'Inter',sans-serif" }}
                    onMouseEnter={e => e.currentTarget.style.background="#f6f2ea"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                    🎓 Teach the extractor
                  </button>
                </>)}
                <div style={{ borderTop:"1px solid #f1ece1", margin:"4px 0" }}/>
                <button onClick={() => { setActionsOpen(false); setConfirmDel(true); }}
                  style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"7px 12px", borderRadius:6, cursor:"pointer", fontSize:12, color:"#dc2626", fontFamily:"'Inter',sans-serif" }}
                  onMouseEnter={e => e.currentTarget.style.background="#fff5f5"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                  🗑 Delete Deal
                </button>
                </>)}
              </div>
            )}
          </div>
          <div style={{ display:"flex", gap:8, alignItems:"center" }}>
            <ViewToggle mode={viewMode} onChange={setViewMode} />
          </div>
        </div>
      </div>
      {editingAddr ? (
        <div style={{ display:"flex", gap:6, alignItems:"center", flexWrap:"wrap", margin:"0 0 12px 0" }}>
          <input autoFocus value={addrDraft.address} onChange={e => setAddrDraft(a => ({ ...a, address: e.target.value }))} placeholder="Street address"
            style={{ flex:"1 1 240px", minWidth:160, border:"1px solid #c8b89a", borderRadius:6, padding:"5px 9px", fontSize:12, fontFamily:"'Inter',sans-serif", background:"#fff" }} />
          <input value={addrDraft.city} onChange={e => setAddrDraft(a => ({ ...a, city: e.target.value }))} placeholder="City"
            style={{ flex:"0 1 140px", minWidth:90, border:"1px solid #c8b89a", borderRadius:6, padding:"5px 9px", fontSize:12, fontFamily:"'Inter',sans-serif", background:"#fff" }} />
          <input value={addrDraft.state} onChange={e => setAddrDraft(a => ({ ...a, state: e.target.value.toUpperCase().slice(0,2) }))} placeholder="ST" maxLength={2}
            style={{ width:46, border:"1px solid #c8b89a", borderRadius:6, padding:"5px 9px", fontSize:12, fontFamily:"'Inter',sans-serif", background:"#fff", textTransform:"uppercase" }} />
          <input value={addrDraft.zip} onChange={e => setAddrDraft(a => ({ ...a, zip: e.target.value.replace(/[^0-9-]/g, "").slice(0,10) }))} placeholder="ZIP" inputMode="numeric"
            style={{ width:72, border:"1px solid #c8b89a", borderRadius:6, padding:"5px 9px", fontSize:12, fontFamily:"'Inter',sans-serif", background:"#fff" }} />
          <button onClick={() => { onUpdate(d.id, { address: addrDraft.address.trim(), city: addrDraft.city.trim(), state: addrDraft.state.trim().toUpperCase(), zip: addrDraft.zip.trim() }); setEditingAddr(false); }}
            style={{ background:"#26281f", color:"#fff", border:"none", borderRadius:6, padding:"6px 12px", fontSize:12, fontWeight:600, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>Save</button>
          <button onClick={() => setEditingAddr(false)}
            style={{ background:"transparent", color:"#a89f8f", border:"none", padding:"6px 8px", fontSize:12, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>Cancel</button>
        </div>
      ) : (
        <p onClick={() => { setAddrDraft({ address: d.address || "", city: d.city || "", state: d.state || "", zip: d.zip || "" }); setEditingAddr(true); }}
          title="Click to edit the address"
          style={{ color: fullAddress ? "#6f6a5f" : "#b08a3c", fontSize:12, margin:"0 0 12px 0", cursor:"pointer", display:"inline-flex", alignItems:"center", gap:6 }}>
          {fullAddress || "+ Add address (needed for closing costs)"}
          <span style={{ fontSize:10, color:"#b3a994" }}>✎</span>
        </p>
      )}

      {/* Export buttons */}
      <div style={{ display:"flex", gap:8, marginBottom:12 }}>
        {((d.tenants||[]).length > 0 || (Array.isArray(d.cashFlowProjection) && d.cashFlowProjection.length > 0)) && (
          <button onClick={() => exportDealToExcel(d)}
            style={{ background:"#f6f2ea", border:"1px solid #c8b89a", color:"#5c5047", padding:"8px 16px", borderRadius:6, cursor:"pointer", fontSize:12, fontFamily:"'Inter',sans-serif", fontWeight:600, display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ fontSize:13 }}>⬇</span> Excel
          </button>
        )}
        <PdfDownloadButton
          fileName={`${(d.propertyName||d.fileName||"deal").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}-summary.pdf`}
          makeDoc={async () => { const { default: DealSummaryPDF } = await import("./DealSummaryPDF"); return <DealSummaryPDF deal={d} imgs={imgs} logoUrl={`${window.location.origin}/apple-touch-icon.png`} />; }}
          render={(busy) => (
            <button style={{ background:"#f6f2ea", border:"1px solid #c8b89a", color: busy ? "#a69e91" : "#4a7fb5", padding:"8px 16px", borderRadius:6, cursor: busy ? "default" : "pointer", fontSize:12, fontFamily:"'Inter',sans-serif", fontWeight:600, display:"flex", alignItems:"center", gap:5, opacity: busy ? 0.7 : 1 }}>
              <span style={{ fontSize:13 }}>⬇</span>{busy ? "PDF…" : "Summary PDF"}
            </button>
          )}
        />
      </div>
      <input ref={rerunPdfRef} type="file" accept=".pdf" style={{ display:"none" }} onChange={handleRerunPdf}/>

      {/* Badges */}
      <div style={{ marginBottom:14 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:6, marginBottom:4 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
            <StatusTag status={d.status} onChange={s => onUpdate(d.id, { status:s })}/>
            <ScoreBadge score={adjustedScore} size={12}/>
            <RecencyBadge deal={d}/>
            {d.autoPassed && <span title="Auto-passed: prospect for 2+ months without a status change" style={{ fontSize:9, color:"#b08968", background:"#b0896815", border:"1px solid #b0896840", padding:"2px 7px", borderRadius:3, fontWeight:600 }}>AUTO-PASSED</span>}
            {d.assumableDebt && <span style={{ fontSize:9, color:"#0f9d63", background:"#0f9d6315", padding:"2px 6px", borderRadius:3 }}>ASSUMABLE DEBT</span>}
          </div>
          {(d.omDate || d.pdfPages) && (
            <span style={{ fontSize:9, color:"#958d80" }}>
              {[d.omDate ? `OM ${d.omDate}` : null, d.pdfPages ? `${d.pdfPages}pp` : null].filter(Boolean).join(" · ")}
            </span>
          )}
        </div>
        {(() => {
          const parts = [
            d.assetType && d.assetType !== "unknown" ? d.assetType : null,
            d.centerType || null,
            loc.urbanicity || null,
            loc.density?.tier || null,
            loc.income?.tier || null,
          ].filter(Boolean) as string[];
          return parts.length > 0 ? (
            <div style={{ fontSize:13, color:"#a69e91" }}>{parts.join(" · ")}</div>
          ) : null;
        })()}
      </div>

      {/* Thin/partial-extraction banner with the "Fill in the blanks" CTA — kept at
          the very top, next to the import-review box, so missing core data is obvious. */}
      <ExtractionQuality deal={d} onUpdate={onUpdate}/>

      {/* Unified import-review / data-integrity banner — top of page. Amber when
          there are open items to confirm (opens the review overlay), green when
          everything checks out. Supersedes the old standalone DataIntegrity box. */}
      {(() => {
        const openCount = openReviewCount(d);
        if (openCount > 0) {
          return (
            <button onClick={() => setReviewOpen(true)}
              style={{ display: "flex", alignItems: "center", gap: 10, width: "100%", textAlign: "left", background: "#fffaf2", border: "1px solid #e7c48f", borderRadius: 10, padding: "11px 15px", marginBottom: 12, cursor: "pointer" }}>
              <span style={{ fontSize: 16 }}>📝</span>
              <span style={{ flex: 1 }}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#9a6a1e" }}>{openCount} import detail{openCount === 1 ? "" : "s"} to confirm</span>
                <span style={{ display: "block", fontSize: 11, color: "#b08a4e", marginTop: 1 }}>A few values I wasn't fully sure I captured right (incl. any failed data checks) — tap to review or fix.</span>
              </span>
              <span style={{ fontSize: 12, color: "#9a6a1e", fontWeight: 600 }}>Review ›</span>
            </button>
          );
        }
        // No open items: reassure that the deterministic checks ran clean.
        const { hadData } = reconcileDeal(d);
        if (!hadData) return null;
        return (
          <div style={{ display:"flex", alignItems:"center", gap:8, background:"#0f9d6310", border:"1px solid #0f9d6333", borderRadius:8, padding:"10px 14px", marginBottom:12 }}>
            <span style={{ color:"#0f9d63", fontSize:13 }}>✓</span>
            <span style={{ fontSize:11, color:"#0f6b46", fontWeight:500 }}>Data checks passed — extracted numbers are internally consistent.</span>
            <span style={{ fontSize:9, color:"#958d80", marginLeft:"auto" }}>Verify against the OM before deciding.</span>
          </div>
        );
      })()}
      {reviewOpen && <ImportReview deal={d} onClose={() => setReviewOpen(false)} onUpdate={onUpdate} />}

      {/* ── Sub-page nav — sticky under the property name. Desktop: a row of tabs,
          each opening a jump-menu of its sections. Mobile: one compact dropdown. ── */}
      <div onClick={e => e.stopPropagation()} style={{ position:"sticky", top:0, zIndex:55, background:"#f6f2ea", margin:"0 -24px 14px", padding:"6px 24px 0" }}>
        {renderSubNav(false)}
      </div>

      {tab === "overview" && (<>
      {/* Cover hero — fit the whole photo to the window (cap to viewport height,
          contain so nothing is cropped or overflows), centered on a soft backdrop. */}
      {imgs?.cover && (
        <div id="section-cover"
          style={{ position:"relative", display:"flex", justifyContent:"center", borderRadius:14, overflow:"hidden", marginBottom:16, boxShadow:"0 1px 2px rgba(56,58,55,0.05), 0 20px 40px -28px rgba(56,58,55,0.6)", border:"1px solid #ece5d7", background:"#faf7f0" }}>
          <img onClick={() => setLightbox(imgs.cover!)} title="Click to enlarge" src={imgs.cover} alt={`${d.propertyName||"Property"} cover`} style={{ maxWidth:"100%", maxHeight:"70vh", width:"auto", height:"auto", objectFit:"contain", display:"block", cursor:"zoom-in" }}/>
          <div style={{ position:"absolute", left:18, bottom:14, color:"#fff", fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", opacity:0.9, fontWeight:600, pointerEvents:"none", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>From the offering memorandum</div>
          <button onClick={() => setConfirmDelImg("cover")} title="Remove cover photo"
            style={{ position:"absolute", top:10, right:10, background:"rgba(38,40,31,0.62)", border:"none", color:"#fff", width:30, height:30, borderRadius:8, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>🗑</button>
          {(coverSave === "saving" || coverSave === "error") && (
            <div style={{ position:"absolute", inset:0, background: coverSave==="saving" ? "rgba(38,40,31,0.55)" : "rgba(120,30,20,0.55)", display:"flex", alignItems:"center", justifyContent:"center", pointerEvents:"none" }}>
              <div style={{ background:"#fff", borderRadius:10, padding:"12px 20px", fontSize:14, fontWeight:700, fontFamily:"'Inter',sans-serif", color: coverSave==="saving" ? "#9a6a1e" : "#c0392b", boxShadow:"0 8px 24px rgba(0,0,0,0.35)", display:"flex", alignItems:"center", gap:8 }}>
                {coverSave === "saving" ? "⏳ Saving — don't leave this page yet…" : "⚠ Not saved — please try again"}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Cover fixer */}
      {imgs != null && (
        coverFinalized ? (
          <div style={{ marginBottom:16, textAlign:"right" }}>
            <button onClick={() => finalizeCover(false)} style={{ background:"transparent", border:"none", color:"#a69e91", fontSize:10.5, cursor:"pointer", fontFamily:"'Inter',sans-serif", padding:0, textDecoration:"underline", textDecorationColor:"#d8cfbd" }}>✎ edit cover photo</button>
          </div>
        ) : (
          <div style={{ background:"#fff", border:"1px solid #ece5d7", borderRadius:12, padding:"12px 16px", marginBottom:16, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            {!imgs.cover && (
              <>
                <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#a89f8f", marginBottom:6 }}>Cover Photo — not set</div>
                <p style={{ fontSize:11.5, color:"#6f6a5f", lineHeight:1.55, margin:"0 0 8px 0" }}>Upload a photo or set from a PDF page:</p>
              </>
            )}
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <button onClick={() => coverPhotoRef.current?.click()}
                style={{ background:"transparent", border:"1px solid #6dba43", color:"#3f7a1f", padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
                Upload a photo
              </button>
              <input ref={coverPhotoRef} type="file" accept="image/*" style={{ display:"none" }} onChange={handleCoverImageFile}/>
              {coverSave !== "idle" && (
                <span style={{
                  fontSize:11, fontWeight:700, padding:"3px 8px", borderRadius:5, fontFamily:"'Inter',sans-serif",
                  color: coverSave==="saved" ? "#0f9d63" : coverSave==="error" ? "#c0392b" : "#9a6a1e",
                  background: coverSave==="saved" ? "#e7f8f0" : coverSave==="error" ? "#fdecea" : "#fff7e8",
                  border: `1px solid ${coverSave==="saved" ? "#a7f3d0" : coverSave==="error" ? "#f3c0b8" : "#f0d9a8"}`,
                }}>
                  {coverSave==="saving" ? "⏳ Saving — don't leave yet…" : coverSave==="saved" ? "✓ Saved" : "⚠ Not saved — try again"}
                </span>
              )}
              <span style={{ fontSize:11, color:"#c4bba7" }}>·</span>
              <span style={{ fontSize:11, color:"#7d766a" }}>{imgs.cover ? "Wrong cover? Set from" : "Set from"}</span>
              <span style={{ fontSize:11, color:"#a69e91" }}>page</span>
              <input value={coverFixPage} onChange={e => setCoverFixPage(e.target.value.replace(/[^0-9]/g,""))} placeholder="#" inputMode="numeric"
                style={{ width:56, fontSize:12, padding:"5px 8px", border:"1px solid #e3dccd", borderRadius:6, color:"#383a37", textAlign:"center", fontFamily:"'Inter',sans-serif" }}/>
              <span style={{ fontSize:11, color:"#a69e91" }}>spread?</span>
              <HalfToggle val={coverHalf} set={setCoverHalf}/>
              <button onClick={() => { if (parseInt(coverFixPage,10) >= 1) coverPdfRef.current?.click(); }} disabled={fixingCover || !(parseInt(coverFixPage,10)>=1)}
                style={{ background:"transparent", border:"1px solid #0d9488", color:(fixingCover||!(parseInt(coverFixPage,10)>=1))?"#a69e91":"#0d9488", padding:"5px 12px", borderRadius:6, cursor:(fixingCover||!(parseInt(coverFixPage,10)>=1))?"default":"pointer", fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
                {fixingCover?"Rendering…":"Choose PDF & set"}
              </button>
              <input ref={coverPdfRef} type="file" accept=".pdf" style={{ display:"none" }} onChange={handleCoverPdf}/>
            </div>
            {imgs.cover && (
              <div style={{ marginTop:10, borderTop:"1px solid #f1eadc", paddingTop:9, display:"flex", alignItems:"center", gap:6 }}>
                <input type="checkbox" id="coverFinalChk" checked={coverFinalized} onChange={e => finalizeCover(e.target.checked)} style={{ accentColor:"#6dba43", width:13, height:13, cursor:"pointer" }}/>
                <label htmlFor="coverFinalChk" style={{ fontSize:11, color:"#7d766a", cursor:"pointer", userSelect:"none" }}>Confirmed / finalize — hides this box</label>
              </div>
            )}
          </div>
        )
      )}

      </>)}

      {/* Lightbox */}
      {lightbox && (
        <div onClick={() => setLightbox(null)} style={{ position:"fixed", inset:0, zIndex:600, background:"rgba(26,28,22,0.88)", display:"flex", alignItems:"center", justifyContent:"center", padding:24, cursor:"zoom-out" }}>
          <img src={lightbox} alt="Enlarged" style={{ maxWidth:"94%", maxHeight:"92%", objectFit:"contain", borderRadius:8, boxShadow:"0 30px 80px rgba(0,0,0,0.5)" }}/>
          <button onClick={() => setLightbox(null)} style={{ position:"fixed", top:20, right:24, background:"rgba(255,255,255,0.12)", border:"1px solid rgba(255,255,255,0.3)", color:"#fff", width:36, height:36, borderRadius:"50%", cursor:"pointer", fontSize:18 }}>✕</button>
        </div>
      )}

      {/* Cover / site-plan delete confirmation */}
      {confirmDelImg && (
        <div onClick={() => setConfirmDelImg(null)} style={{ position:"fixed", inset:0, zIndex:700, background:"rgba(38,40,31,0.5)", backdropFilter:"blur(2px)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#fff", borderRadius:14, padding:"22px 24px", width:"min(380px, 92vw)", boxShadow:"0 20px 60px rgba(38,40,31,0.28)", fontFamily:"'Inter',sans-serif" }}>
            <div style={{ fontFamily:"'Fraunces',serif", fontSize:18, fontWeight:600, color:"#26281f", marginBottom:6 }}>Delete {confirmDelImg === "cover" ? "cover photo" : "site plan"}?</div>
            <div style={{ fontSize:13, color:"#7d766a", lineHeight:1.55, marginBottom:18 }}>
              This removes the {confirmDelImg === "cover" ? "cover photo" : "site plan"} from this deal. You can upload a new one anytime.
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => setConfirmDelImg(null)} style={{ background:"#f6f2ea", border:"1px solid #ddd4c2", color:"#52554e", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>Cancel</button>
              <button onClick={() => { const which = confirmDelImg; setConfirmDelImg(null); if (which === "cover") deleteCover(); else deleteSitePlan(); }}
                style={{ background:"#c0392b", border:"none", color:"#fff", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>Delete</button>
            </div>
          </div>
        </div>
      )}

      {/* Delete-deal confirmation */}
      {confirmDel && (
        <div onClick={() => setConfirmDel(false)} style={{ position:"fixed", inset:0, zIndex:700, background:"rgba(38,40,31,0.5)", backdropFilter:"blur(2px)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
          <div onClick={e => e.stopPropagation()} style={{ background:"#fff", borderRadius:14, padding:"22px 24px", width:"min(400px, 92vw)", boxShadow:"0 20px 60px rgba(38,40,31,0.28)", fontFamily:"'Inter',sans-serif" }}>
            <div style={{ fontFamily:"'Fraunces',serif", fontSize:18, fontWeight:600, color:"#26281f", marginBottom:6 }}>Delete this deal?</div>
            <div style={{ fontSize:13, color:"#7d766a", lineHeight:1.55, marginBottom:18 }}>
              Permanently delete <strong style={{ color:"#383a37" }}>{d.propertyName || d.fileName || "this deal"}</strong> — its tenants, financials, images, and comp entries. This can't be undone.
            </div>
            <div style={{ display:"flex", gap:10, justifyContent:"flex-end" }}>
              <button onClick={() => setConfirmDel(false)} style={{ background:"#f6f2ea", border:"1px solid #ddd4c2", color:"#52554e", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>Cancel</button>
              <button onClick={() => { setConfirmDel(false); onDelete(d.id); }}
                style={{ background:"#c0392b", border:"none", color:"#fff", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>Delete permanently</button>
            </div>
          </div>
        </div>
      )}

      {teachOpen && <TeachExtractorModal onClose={() => setTeachOpen(false)} />}

      {tab === "ai" && (<>
      {/* AI highlights — surfaced near the top, just below the cover photo */}
      {(d.notes || d.analysisStale) && (
        <div id="section-highlights" style={{ background:"linear-gradient(180deg,#fff,#fcfbf6)", border:"1px solid #e3dccd", borderLeft:"3px solid #6dba43", borderRadius:12, padding:"16px 18px", marginBottom:12, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:8, marginBottom:9 }}>
            <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#3f6b24" }}>AI Investment Highlights</div>
            {d.analysisStale && <StaleBadge />}
          </div>
          {d.notes && <p style={{ color:"#5b574d", fontSize:13, lineHeight:1.75, margin:0 }}><BoldText text={d.notes}/></p>}
        </div>
      )}

      </>)}
      {tab === "market" && (<>
      {/* Market sale */}
      {d.marketSale && (
        <div id="section-market-sale" style={{ background:"#0d948810", border:"1px solid #0d948840", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:9, gap:10, flexWrap:"wrap" }}>
            <div style={{ fontSize:9, letterSpacing:"0.1em", color:"#0d9488", fontWeight:700 }}>↗ MARKET SALE — FOUND ONLINE</div>
            <button onClick={() => onLookupSale(d.id)} disabled={saleBusy} style={{ background:"transparent", border:"1px solid #0d9488", color:saleBusy?"#a69e91":"#0d9488", padding:"3px 9px", borderRadius:4, cursor:saleBusy?"default":"pointer", fontSize:9, fontFamily:"'Inter',sans-serif" }}>{saleBusy?"SEARCHING…":"RE-CHECK"}</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:9 }}>
            {([["SALE PRICE", d.marketSale.price!=null?fmtUSD(d.marketSale.price):null],
               ["SALE DATE", d.marketSale.soldDate],["CAP RATE", d.marketSale.capRate!=null?`${d.marketSale.capRate}%`:null],
               ["BUYER", d.marketSale.buyer],["SELLER", d.marketSale.seller],["PRICE/SF", d.marketSale.pricePerSF!=null?`$${d.marketSale.pricePerSF}`:null]
            ] as [string,string|null][]).map(([l,v],i)=>(
              <div key={i}><div style={{ fontSize:8, color:"#5f8a86" }}>{l}</div><div style={{ fontSize:12, color:"#0f5e57", fontWeight:600 }}>{v||"—"}</div></div>
            ))}
          </div>
          {d.marketSale.summary && <div style={{ fontSize:11, color:"#6f6a5f", lineHeight:1.55, marginBottom:9 }}>{d.marketSale.summary}</div>}
          <div style={{ fontSize:9, color:"#a69e91" }}>AI-gathered from public sources{d.marketSale.lookedUpAt?` on ${d.marketSale.lookedUpAt.slice(0,10)}`:""}. Verify before relying on it.</div>
        </div>
      )}
      {!d.marketSale && d.marketSaleChecked && (
        <div style={{ fontSize:11, color:"#a69e91", marginBottom:12 }}>
          No confirmed sale found (checked {d.marketSaleChecked.slice(0,10)}).&nbsp;
          <button onClick={() => onLookupSale(d.id)} disabled={saleBusy} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"2px 8px", borderRadius:4, cursor:"pointer", fontSize:9, fontFamily:"'Inter',sans-serif" }}>{saleBusy?"…":"Re-check"}</button>
        </div>
      )}

      </>)}
      {tab === "ai" && (<>
      {/* KPR thesis / assumptions — folded into the AI grade on re-grade. Placed
          above the site plan. Hidden in Asset Management view. */}
      {showAcq && (
      <div id="section-review" data-jump="Our Take">
        <DealReviewBox deal={d} onUpdate={onUpdate} onRegrade={handleRefreshAnalysis} regrading={reanalyzeBusy} onOpenHouseView={() => setHouseViewOpen(true)}/>
      </div>
      )}

      </>)}
      {(tab === "overview" || tab === "tenants") && (<>
      {/* Site plan (all states wrapped in one jump anchor; rendered only when the
          image bundle has loaded so the menu entry tracks the visible section) */}
      {imgs != null && (
      <div id="section-site" data-jump="Site Plan">
      {imgs.sitePlan && imgs.sitePlan.length > 0 && (
        sitePlanFinalized ? (
          // Finalized: keep showing the site plan images; only the upload/confirm controls collapse.
          <div style={{ background:"#fff", border:"1px solid #ece5d7", borderRadius:12, padding:"16px 18px", marginBottom:12, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#a89f8f" }}>Site Plan</div>
              <div style={{ display:"flex", alignItems:"center", gap:12 }}>
                <button onClick={() => finalizeSitePlan(false)} style={{ background:"transparent", border:"none", color:"#a69e91", fontSize:10.5, cursor:"pointer", fontFamily:"'Inter',sans-serif", padding:0, textDecoration:"underline", textDecorationColor:"#d8cfbd" }}>✎ edit site plan</button>
                <button onClick={() => setConfirmDelImg("site")} title="Remove site plan" style={{ background:"transparent", border:"none", color:"#c0392b", fontSize:13, cursor:"pointer", padding:0 }}>🗑</button>
              </div>
            </div>
            <div style={{ display:"grid", gap:10 }}>
              {imgs.sitePlan.map((src, i) => (
                <div key={i} style={{ position:"relative", borderRadius:9, overflow:"hidden", border:"1px solid #ece5d7", display:"flex", justifyContent:"center", background:"#faf7f0" }}>
                  <img src={src} alt={`Site plan ${i+1}`} onClick={() => setLightbox(src)} style={{ maxWidth:"100%", maxHeight:"75vh", width:"auto", height:"auto", objectFit:"contain", display:"block", cursor:"zoom-in" }}/>
                  <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Remove site-plan page ${i+1}?`)) deleteSitePlanPage(i); }}
                    title="Remove this page"
                    style={{ position:"absolute", top:6, right:6, width:24, height:24, borderRadius:"50%", border:"none", background:"rgba(38,40,31,0.62)", color:"#fff", fontSize:15, lineHeight:1, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div style={{ background:"#fff", border:"1px solid #ece5d7", borderRadius:12, padding:"16px 18px", marginBottom:12, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#a89f8f" }}>Site Plan</div>
              <button onClick={() => setConfirmDelImg("site")} title="Remove site plan" style={{ background:"transparent", border:"none", color:"#c0392b", fontSize:13, cursor:"pointer", padding:0 }}>🗑</button>
            </div>
            <div style={{ display:"grid", gap:10 }}>
              {imgs.sitePlan.map((src, i) => (
                <div key={i} style={{ position:"relative", borderRadius:9, overflow:"hidden", border:"1px solid #ece5d7", display:"flex", justifyContent:"center", background:"#faf7f0" }}>
                  <img src={src} alt={`Site plan ${i+1}`} onClick={() => setLightbox(src)} style={{ maxWidth:"100%", maxHeight:"75vh", width:"auto", height:"auto", objectFit:"contain", display:"block", cursor:"zoom-in" }}/>
                  <button onClick={(e) => { e.stopPropagation(); if (window.confirm(`Remove site-plan page ${i+1}?`)) deleteSitePlanPage(i); }}
                    title="Remove this page"
                    style={{ position:"absolute", top:6, right:6, width:24, height:24, borderRadius:"50%", border:"none", background:"rgba(38,40,31,0.62)", color:"#fff", fontSize:15, lineHeight:1, cursor:"pointer", display:"flex", alignItems:"center", justifyContent:"center" }}>×</button>
                </div>
              ))}
            </div>
            <div style={{ marginTop:10, display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <button onClick={() => sitePlanImgRef.current?.click()}
                style={{ background:"transparent", border:"1px solid #6dba43", color:"#3f7a1f", padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
                Upload image(s)
              </button>
              <input ref={sitePlanImgRef} type="file" accept="image/*" multiple style={{ display:"none" }} onChange={handleSitePlanImageFiles}/>
              <span style={{ fontSize:11, color:"#c4bba7" }}>·</span>
              <span style={{ fontSize:11, color:"#a89f8f" }}>Wrong page? Set from</span>
              <input value={fixPage} onChange={e => setFixPage(e.target.value.replace(/[^0-9,\-\s]/g,""))} placeholder="e.g. 5 or 3-6 or 3,5,7"
                style={{ width:148, fontSize:11.5, padding:"5px 8px", border:"1px solid #e3dccd", borderRadius:6, color:"#383a37", fontFamily:"'Inter',sans-serif" }}/>
              <HalfToggle val={sitePlanHalf} set={setSitePlanHalf}/>
              <button onClick={() => { if (fixPage.trim()) sitePlanPdfRef.current?.click(); }} disabled={fixingPlan||!fixPage.trim()}
                style={{ background:"transparent", border:"1px solid #0d9488", color:(fixingPlan||!fixPage.trim())?"#a69e91":"#0d9488", padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>
                {fixingPlan?"Rendering…":"Choose PDF & set"}
              </button>
              <input ref={sitePlanPdfRef} type="file" accept=".pdf" style={{ display:"none" }} onChange={handleSitePlanPdf}/>
            </div>
            <div style={{ marginTop:10, borderTop:"1px solid #f1eadc", paddingTop:9, display:"flex", alignItems:"center", gap:6 }}>
              <input type="checkbox" id="sitePlanFinalChk" checked={sitePlanFinalized} onChange={e => finalizeSitePlan(e.target.checked)} style={{ accentColor:"#6dba43", width:13, height:13, cursor:"pointer" }}/>
              <label htmlFor="sitePlanFinalChk" style={{ fontSize:11, color:"#7d766a", cursor:"pointer", userSelect:"none" }}>Confirmed / finalize — hides this box</label>
            </div>
          </div>
        )
      )}

      {/* Site plan — empty state (no images, no page picks yet) */}
      {imgs != null && (!imgs.sitePlan || imgs.sitePlan.length === 0) && (!imgs.pagePicks || imgs.pagePicks.length === 0) && (
        sitePlanFinalized ? (
          <div style={{ marginBottom:12, textAlign:"right" }}>
            <button onClick={() => finalizeSitePlan(false)} style={{ background:"transparent", border:"none", color:"#a69e91", fontSize:10.5, cursor:"pointer", fontFamily:"'Inter',sans-serif", padding:0, textDecoration:"underline", textDecorationColor:"#d8cfbd" }}>✎ edit site plan</button>
          </div>
        ) : (
        <div style={{ background:"#fff", border:"1px solid #ece5d7", borderRadius:12, padding:"12px 16px", marginBottom:12, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#a89f8f", marginBottom:6 }}>Site Plan — not set</div>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
            <button onClick={() => sitePlanImgRef.current?.click()}
              style={{ background:"transparent", border:"1px solid #6dba43", color:"#3f7a1f", padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
              Upload image(s)
            </button>
            <input ref={sitePlanImgRef} type="file" accept="image/*" multiple style={{ display:"none" }} onChange={handleSitePlanImageFiles}/>
            <span style={{ fontSize:11, color:"#c4bba7" }}>·</span>
            <span style={{ fontSize:11, color:"#a89f8f" }}>Set from page</span>
            <input value={fixPage} onChange={e => setFixPage(e.target.value.replace(/[^0-9,\-\s]/g,""))} placeholder="e.g. 5 or 3-6 or 3,5,7"
              style={{ width:148, fontSize:11.5, padding:"5px 8px", border:"1px solid #e3dccd", borderRadius:6, color:"#383a37", fontFamily:"'Inter',sans-serif" }}/>
            <HalfToggle val={sitePlanHalf} set={setSitePlanHalf}/>
            <button onClick={() => { if (fixPage.trim()) sitePlanPdfRef.current?.click(); }} disabled={fixingPlan||!fixPage.trim()}
              style={{ background:"transparent", border:"1px solid #0d9488", color:(fixingPlan||!fixPage.trim())?"#a69e91":"#0d9488", padding:"5px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>
              {fixingPlan?"Rendering…":"Choose PDF & set"}
            </button>
            <input ref={sitePlanPdfRef} type="file" accept=".pdf" style={{ display:"none" }} onChange={handleSitePlanPdf}/>
          </div>
        </div>
        )
      )}

      {/* Site plan picker (manual) */}
      {imgs != null && (!imgs.sitePlan || imgs.sitePlan.length===0) && imgs.pagePicks && imgs.pagePicks.length > 0 && (
        <div style={{ background:"#fff", border:"1px solid #e7c48f", borderRadius:12, padding:"16px 18px", marginBottom:12 }}>
          <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#b45309", marginBottom:8 }}>Site Plan — choose the page</div>
          <p style={{ fontSize:11.5, color:"#6f6a5f", lineHeight:1.55, margin:"0 0 12px 0" }}>I couldn't confidently find the site plan. Tap the page that shows it.</p>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fill, minmax(108px, 1fr))", gap:9 }}>
            {imgs.pagePicks.map(pk => (
              <button key={pk.page} onClick={() => chooseSitePlan(pk.page)}
                style={{ padding:0, border:"1px solid #ece5d7", borderRadius:9, overflow:"hidden", cursor:"pointer", background:"#faf7f0", position:"relative", transition:"border-color .15s, transform .15s" }}
                onMouseEnter={e => { e.currentTarget.style.borderColor="#6dba43"; e.currentTarget.style.transform="translateY(-2px)"; }}
                onMouseLeave={e => { e.currentTarget.style.borderColor="#ece5d7"; e.currentTarget.style.transform="none"; }}>
                <img src={pk.img} alt={`Page ${pk.page}`} style={{ width:"100%", display:"block", aspectRatio:"3/4", objectFit:"cover", objectPosition:"top" }}/>
                <span style={{ position:"absolute", bottom:5, right:5, background:"rgba(38,40,31,0.78)", color:"#fff", fontSize:9, fontWeight:600, padding:"1px 6px", borderRadius:10 }}>p.{pk.page}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      </div>
      )}

      </>)}
      {tab === "tenants" && (<>
      {/* Tenant roster */}
      {(d.tenants||[]).length > 0 && (
        <div id="section-tenants">
          <style>{`@keyframes rrIndeterminate{0%{transform:translateX(-110%)}100%{transform:translateX(310%)}}`}</style>
          {/* Roster action bar — refresh/paste on the left, exports on the right */}
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:8, marginBottom:8, flexWrap:"wrap" }}>
            <div style={{ display:"flex", alignItems:"center", gap:8, flexWrap:"wrap" }}>
              <input ref={rrPdfRef} type="file" accept="application/pdf,.pdf,.xlsx,.xls,.xlsm,.xlsb,.csv" style={{ display:"none" }} onChange={handleRentRoll}/>
              <button onClick={() => { setRrError(null); rrPdfRef.current?.click(); }} disabled={rrBusy}
                title="Update the roster from a current rent roll (PDF or Excel)"
                style={{ background: rrBusy ? "#e7ecde" : "#fff", border:"1px solid #8cbf63", color:"#3f7a1f", padding:"6px 13px", borderRadius:7, cursor: rrBusy ? "default" : "pointer", fontSize:11.5, fontWeight:600, fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:5 }}>
                {rrBusy ? "Refreshing…" : "⬆ Refresh from rent roll"}
              </button>
              <button onClick={() => { setPastePanelOpen(o => !o); setPasteError(null); }}
                title="Paste a roster JSON from Claude (no API call)"
                style={{ background:"#f6f2ea", border:"1px solid #c8b89a", color:"#5c5047", padding:"6px 13px", borderRadius:7, cursor:"pointer", fontSize:11.5, fontWeight:600, fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:5 }}>
                {pastePanelOpen ? "Close paste box" : "⌘ Paste roster"}
              </button>
              <button onClick={() => setShowAbstractUpload(true)}
                title="Upload one tenant's abstract or a whole-property file — it auto-routes to the right tenants"
                style={{ background:"#fff", border:"1px solid #c2d6f0", color:"#1f4d8f", padding:"6px 13px", borderRadius:7, cursor:"pointer", fontSize:11.5, fontWeight:600, fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:5 }}>
                ⬆ Upload abstracts
              </button>
              <span style={{ fontSize:11.5, color: rrError ? "#dc2626" : "#3f7a1f" }}>
                {rrError || (d.tenantsSource === "rent-roll" && d.tenantsAsOf ? `✓ Refreshed ${d.tenantsAsOf}` : "")}
              </span>
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <button onClick={() => exportRosterToExcel(d)}
                title="Export this rent roll to a clean Excel file"
                style={{ background:"#f6f2ea", border:"1px solid #c8b89a", color:"#5c5047", padding:"6px 13px", borderRadius:7, cursor:"pointer", fontSize:11.5, fontWeight:600, fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:5 }}>
                ⬇ Rent roll — Excel
              </button>
              {abstracts.length > 0 && (
                <button onClick={() => { void exportLeaseAbstractsWorkbook(d.propertyName || d.fileName || "deal", abstracts).catch(() => {}); }}
                  title="Export all lease abstracts on this deal to Excel — an Issues Summary plus one detailed tab per tenant"
                  style={{ background:"#eafaf0", border:"1px solid #b7e4c7", color:"#1f6f43", padding:"6px 13px", borderRadius:7, cursor:"pointer", fontSize:11.5, fontWeight:600, fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:5 }}>
                  ⬇ Lease abstracts — Excel
                </button>
              )}
              <PdfDownloadButton
                fileName={`KPR_RentRoll_${(d.propertyName||d.fileName||"deal").replace(/[/\\?%*:|"<>]/g,"-").slice(0,80)}.pdf`}
                makeDoc={async () => { const { default: RentRollPDF } = await import("./RentRollPDF"); return <RentRollPDF deal={d} />; }}
                render={(busy) => (
                  <span style={{ background:"#2a2c27", border:"1px solid #2a2c27", color:"#fff", padding:"6px 13px", borderRadius:7, cursor:"pointer", fontSize:11.5, fontWeight:600, fontFamily:"'Inter',sans-serif", display:"inline-flex", alignItems:"center", gap:5 }}>
                    {busy ? "Preparing…" : "⬇ Rent roll — PDF"}
                  </span>
                )}
              />
            </div>
          </div>
          {rrBusy && (
            <div style={{ marginBottom:9, height:5, borderRadius:3, background:"#dfe7d2", overflow:"hidden" }}>
              <div style={{ height:"100%", width:"40%", borderRadius:3, background:"#6dba43", animation:"rrIndeterminate 1.1s ease-in-out infinite" }}/>
            </div>
          )}
          {pastePanelOpen && (
            <div style={{ marginBottom:10, background:"#f3f7ee", border:"1px dashed #b8d49a", borderRadius:10, padding:"10px 14px", display:"flex", flexDirection:"column", gap:7 }}>
              <textarea
                value={pasteText} onChange={e => setPasteText(e.target.value)}
                placeholder='Paste the JSON Claude returned — {"asOf":"…","tenants":[…]}'
                style={{ width:"100%", minHeight:90, fontSize:11, padding:"8px 10px", border:"1px solid #b8d49a", borderRadius:7, fontFamily:"monospace", resize:"vertical", color:"#383a37", boxSizing:"border-box" }}
              />
              {pasteError && <div style={{ fontSize:11, color:"#dc2626" }}>{pasteError}</div>}
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={applyPaste} disabled={!pasteText.trim()}
                  style={{ background: pasteText.trim() ? "#6dba43" : "#ccc", border:"none", color:"#fff", padding:"7px 16px", borderRadius:7, cursor: pasteText.trim() ? "pointer" : "default", fontSize:12, fontWeight:700, fontFamily:"'Inter',sans-serif" }}>
                  Apply
                </button>
                <button onClick={() => { setPastePanelOpen(false); setPasteText(""); setPasteError(null); }}
                  style={{ background:"transparent", border:"1px solid #b8d49a", color:"#6f6a5f", padding:"7px 12px", borderRadius:7, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>
                  Cancel
                </button>
              </div>
            </div>
          )}
          <TenantRoster
          tenants={d.tenants!}
          onTenantClick={onTenantClick}
          onUpdateTenant={(idx, patch) => {
            const newTenants = (d.tenants || []).map((t, i) => i === idx ? { ...t, ...patch } : t);
            onUpdate(d.id, { tenants: newTenants });
          }}
          tenantsAsOf={d.tenantsAsOf}
          tenantsSource={d.tenantsSource}
          omDate={d.omDate}
          estimatedRecoveries={estimateRecoveries(dWithRecoveries).byName}
          latestSales={buildLatestSales(d)}
          abstractsByTenant={abstractsByTenant}
          abstractDiscrepancies={abstractDiscrepancies}
          onOpenAbstract={(name) => setAbstractModal({ mode: "view", tenantName: name })}
        /></div>
      )}

      {/* Center-level recorded documents (REAs / OEAs / operating agreements / easements). */}
      <SiteAgreementsCard dealId={d.id} dealName={d.propertyName || d.fileName || "deal"} isAdmin={isAdmin} />

      <HouseViewModal open={houseViewOpen} onClose={() => setHouseViewOpen(false)} isAdmin={isAdmin} />

      {abstractModal && (
        <LeaseAbstractModal
          open={true}
          onClose={() => setAbstractModal(null)}
          mode={abstractModal.mode}
          abstract={abstractModal.mode === "view" ? (abstractsByTenant.get(abstractModal.tenantName.trim().toLowerCase()) ?? null) : null}
          dealId={d.id}
          tenantName={abstractModal.tenantName}
          tenants={d.tenants}
          isAdmin={isAdmin}
          onSaved={() => reloadAbstracts()}
          onDeleted={() => reloadAbstracts()}
          onFillRoster={(idx, patch) => {
            const newTenants = (d.tenants || []).map((t, i) => i === idx ? { ...t, ...patch } : t);
            onUpdate(d.id, { tenants: newTenants, ...recomputeRosterMetrics(newTenants as Array<Record<string, unknown>>, d.tenantsAsOf, d) });
          }}
        />
      )}

      {showAbstractUpload && (
        <AbstractUploadModal
          dealId={d.id}
          tenantNames={(d.tenants ?? []).map((t) => t.name).filter((n): n is string => !!n && !!n.trim())}
          onClose={() => setShowAbstractUpload(false)}
          onSaved={() => reloadAbstracts()}
        />
      )}

      {/* Tenant Sales Panel */}
      {(d.tenants||[]).length > 0 && (
        <div id="section-tenant-sales">
          <TenantSalesPanel
            salesHistory={d.tenantSalesHistory || []}
            omTenants={d.tenants}
            omDate={d.omDate}
            recoveries={estimateRecoveries(dWithRecoveries).byName}
            onUpload={handleSalesUpload}
            uploadBusy={salesBusy}
            uploadError={salesError}
            onChangeSalesHistory={next => onUpdate(d.id, { tenantSalesHistory: next })}
            onEraseAllSales={() => onUpdate(d.id, {
              // Wipe uploaded snapshots AND the OM-derived sales that live on the
              // roster (salesPSF drives the OM snapshot; clear the related fields too),
              // and drop the sales review flags so no stale banner lingers.
              tenantSalesHistory: [],
              tenants: (d.tenants || []).map(t => ({ ...t, salesPSF: null, salesYear: null, occupancyCost: null, salesNotes: null })),
              reviewQuestions: (d.reviewQuestions ?? []).filter(q => !(q.id ?? "").startsWith("ai-sales-")),
            })}
            onLinkRoster={(rosterName, salesPSF, salesYear) => {
              const rk = tenantKey(rosterName);
              const tenants = (d.tenants || []).map(t => tenantKey(t.canonicalName || t.name) === rk ? { ...t, salesPSF: salesPSF ?? t.salesPSF, salesYear: salesYear ?? t.salesYear } : t);
              onUpdate(d.id, { tenants });
            }}
          />
        </div>
      )}

      {/* Lease Risk — anchor-dependency / co-tenancy exposure (live, token-free).
          Wrapped so a panel error can never take down the Tenants tab (it logs +
          renders nothing instead). */}
      <ErrorBoundary fallback={null}><LeaseRiskPanel deal={d} abstracts={abstracts} /></ErrorBoundary>

      {/* Lease Rollover & WALT */}
      {(d.tenants||[]).length > 0 && (
        <div id="section-rollover"><LeaseRollover tenants={d.tenants!} tenantsAsOf={d.tenantsAsOf} /></div>
      )}

      </>)}
      {tab === "ai" && (<>
      {/* Deal score */}
      {showAcq && (d.dealScore || d.analysisStale) && (
        <CollapsibleBox collapsedHeight={300} fadeColor="#faf7f0">
          {(expanded) => { const fs = 1; void expanded; return (
          <div id="section-dealscore" data-jump="AI Deal Score" style={{ background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:8, padding:"14px 16px" }}>
            <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:8, marginBottom:10 }}>
              <div style={{ fontSize:8*fs, letterSpacing:"0.1em", color:"#958d80" }}>AI DEAL SCORE</div>
              {d.dealScore && <ScoreBadge score={adjustedScore}/>}
              {watchImpact.notches > 0 && d.dealScore && (
                <span title={`Lowered from ${d.dealScore.grade} for at-risk tenant exposure, weighted by share of income.`}
                  style={{ display:"inline-flex", alignItems:"center", gap:4, fontSize:9*fs, color:"#b3261e", background:"#fbe6e4", border:"1px solid #f0c5c1", padding:"2px 7px", borderRadius:10, fontWeight:700 }}>
                  ⚠ Adjusted from {d.dealScore.grade} · watchlist
                </span>
              )}
              {d.analysisStale && <StaleBadge />}
              {!d.analysisStale && d.dealScore && (d.analysisVersion ?? 0) < ANALYSIS_VERSION && (
                <button onClick={() => handleRefreshAnalysis()} disabled={reanalyzeBusy}
                  title="This deal's written analysis predates the latest scoring logic. Click to refresh it (uses the cheap roster-analysis pass). Your badges and score adjustments are already up to date."
                  style={{ display:"inline-flex", alignItems:"center", gap:4, background:"#fffbeb", border:"1px solid #f59e0b", borderRadius:5, padding:"2px 8px", fontSize:9*fs, color:"#92400e", fontWeight:600, fontFamily:"'Inter',sans-serif", lineHeight:1.4, cursor:reanalyzeBusy?"default":"pointer" }}>
                  {reanalyzeBusy ? "Refreshing…" : "⚠ Analysis may be outdated — refresh"}
                </button>
              )}
            </div>
            {d.dealScore && <>
              <p style={{ fontSize:12*fs, color:"#5c5f57", lineHeight:1.7, margin:"0 0 12px 0" }}><BoldText text={(adjustedScore || d.dealScore).rationale || ""}/></p>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div>
                  <div style={{ fontSize:8*fs, color:"#0f9d63", letterSpacing:"0.08em", marginBottom:5 }}>STRENGTHS</div>
                  {(d.dealScore.strengths||[]).map((s,i) => <div key={i} style={{ fontSize:11*fs, color:"#7d766a", marginBottom:2 }}>› {s}</div>)}
                </div>
                <div>
                  <div style={{ fontSize:8*fs, color:"#dc2626", letterSpacing:"0.08em", marginBottom:5 }}>RISKS</div>
                  {(d.dealScore.risks||[]).map((r,i) => <div key={i} style={{ fontSize:11*fs, color:"#7d766a", marginBottom:2 }}>› {r}</div>)}
                </div>
              </div>
            </>}
          </div>
          ); }}
        </CollapsibleBox>
      )}


      {/* Upside items */}
      {showAcq && Array.isArray(d.upsideItems) && d.upsideItems.length > 0 && (() => {
        const priOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const sorted = [...d.upsideItems!].sort((a, b) => (priOrder[a.priority ?? "low"] ?? 2) - (priOrder[b.priority ?? "low"] ?? 2));
        return (
          <CollapsibleBox collapsedHeight={300} fadeColor="#f2faf0">
            {(expanded) => { const fs = 1; void expanded; return (
            <div id="section-upside" style={{ background:"#f2faf0", border:"1px solid #3f7a1f40", borderRadius:8, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:10 }}>
                <div style={{ fontSize:8*fs, letterSpacing:"0.1em", color:"#2d7a0e", fontWeight:700 }}>&#10024; UPSIDE ITEMS</div>
                {d.analysisStale && <StaleBadge />}
              </div>
              {sorted.map((u,i) => (
                <div key={i} style={{ display:"flex", gap:10, padding:"6px 0", borderBottom:i<sorted.length-1?"1px solid #d4edca":"none", alignItems:"flex-start" }}>
                  <span style={{ fontSize:9*fs, padding:"2px 6px", borderRadius:3, background:u.priority==="high"?"#22c55e20":u.priority==="medium"?"#86efac20":"#bbf7d020", color:u.priority==="high"?"#166534":u.priority==="medium"?"#15803d":"#166534", fontWeight:600, flexShrink:0 }}>{u.priority?.toUpperCase()}</span>
                  <div>
                    <div style={{ fontSize:11*fs, fontWeight:700, color:"#1a3d12", marginBottom:2 }}>{u.item}</div>
                    <div style={{ fontSize:11*fs, color:"#3d5c35", lineHeight:1.55 }}>{u.detail}</div>
                  </div>
                </div>
              ))}
            </div>
            ); }}
          </CollapsibleBox>
        );
      })()}

      {/* Red flags */}
      {(() => {
        const expenseFlag = deriveExpenseRiskFlag(dWithRecoveries);
        const unsignedFlag = deriveUnsignedLeaseFlag(d);
        const salesTrendFlag = deriveSalesTrendFlag(d);
        const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const allRedFlags = [...(expenseFlag ? [expenseFlag] : []), ...(unsignedFlag ? [unsignedFlag] : []), ...(salesTrendFlag ? [salesTrendFlag] : []), ...watchImpact.flags, ...(d.redFlags || [])]
          .sort((a, b) => (sevOrder[a.severity ?? "low"] ?? 2) - (sevOrder[b.severity ?? "low"] ?? 2));
        return showAcq && (allRedFlags.length > 0 || d.analysisStale) && (
          <CollapsibleBox collapsedHeight={300} fadeColor="#faf7f0">
            {(expanded) => { const fs = 1; void expanded; return (
            <div id="section-redflags" style={{ background:"#faf7f0", border:"1px solid #dc262630", borderRadius:8, padding:"14px 16px" }}>
              <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:8, marginBottom:10 }}>
                <div style={{ fontSize:8*fs, letterSpacing:"0.1em", color:"#dc2626" }}>⚠ RED FLAGS</div>
                {d.analysisStale && <StaleBadge />}
              </div>
              {allRedFlags.map((f,i) => (
                <div key={i} style={{ display:"flex", gap:10, padding:"6px 0", borderBottom:i<allRedFlags.length-1?"1px solid #e7e0d2":"none", alignItems:"flex-start" }}>
                  <span style={{ fontSize:9*fs, padding:"2px 6px", borderRadius:3, background:f.severity==="high"?"#dc262615":f.severity==="medium"?"#f9731615":"#eab30815", color:f.severity==="high"?"#dc2626":f.severity==="medium"?"#ea6000":"#b08000", fontWeight:600, flexShrink:0 }}>{f.severity?.toUpperCase()}</span>
                  <span style={{ fontSize:11*fs, color:"#5c5f57" }}>{f.description}</span>
                </div>
              ))}
            </div>
            ); }}
          </CollapsibleBox>
        );
      })()}

      </>)}
      {tab === "overview" && (<>
      {/* Edit metrics — below red flags */}
      <div id="section-aliases"><AkaEditor deal={d} onUpdate={onUpdate}/></div>

      {/* AI Investment Highlights — mirrored from the AI Analysis tab so the narrative
          is visible on the main page too (no id: section-highlights stays unique). */}
      {d.notes && (
        <div style={{ background:"linear-gradient(180deg,#fff,#fcfbf6)", border:"1px solid #e3dccd", borderLeft:"3px solid #6dba43", borderRadius:12, padding:"16px 18px", marginBottom:12, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:8, marginBottom:9 }}>
            <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#3f6b24" }}>AI Investment Highlights</div>
            {d.analysisStale && <StaleBadge />}
          </div>
          <p style={{ color:"#5b574d", fontSize:13, lineHeight:1.75, margin:0 }}><BoldText text={d.notes}/></p>
        </div>
      )}

      <div id="section-metriceditor"><MetricsEditor deal={d} onUpdate={onUpdate}/></div>

      {/* Financial grid */}
      <div id="section-financials" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:12, marginBottom:12 }}>
        <Card title="KEY FINANCIALS">
          <Row l="ASKING PRICE" v={d.askingPrice?fmtUSD(d.askingPrice):null} c="#6dba43" field="askingPrice"/>
          <Row l="CAP RATE" v={d.capRate?`${d.capRate}%`:null} c="#0f9d63" field="capRate"/>
          <Row l="NOI" v={d.noi?fmtUSD(d.noi):null} c="#0f9d63" field="noi"/>
          <Row l="PRICE / SF" v={d.pricePerSF?`$${d.pricePerSF}`:null} field="pricePerSF"/>
          <Row l="TOTAL SF" v={d.totalSF?`${Number(d.totalSF).toLocaleString()} SF`:null} field="totalSF"/>
          <Row l="OCCUPANCY" v={d.occupancy?`${d.occupancy}%`:null} c="#383a37" field="occupancy" warn={reconWarns.occupancy}/>
          <PriceCapEditor deal={d} onUpdate={onUpdate}/>
        </Card>
        <Card title="INCOME & EXPENSES">
          <Row l="GROSS POTENTIAL RENT" v={d.grossPotentialRent?fmtUSD(d.grossPotentialRent):null} field="grossPotentialRent" warn={reconWarns.grossPotentialRent}/>
          <Row l="EFF. GROSS INCOME" v={d.effectiveGrossIncome?fmtUSD(d.effectiveGrossIncome):null} field="effectiveGrossIncome"/>
          <Row l="OPERATING EXPENSES" v={d.operatingExpenses?fmtUSD(d.operatingExpenses):null} field="operatingExpenses"/>
          <Row l="NNN RECOVERIES" v={d.nnnRecoveries?fmtUSD(d.nnnRecoveries):null}/>
          {(() => {
            // Expense-recovery ratio = recoveries ÷ operating expenses — how
            // genuinely NNN the center is. Near 100% = fully passed through; a low
            // ratio means the landlord eats the gap (recovery leakage). Recoveries:
            // prefer the stated NNN recoveries, else the income-breakdown recovery
            // lines, else the sum of per-tenant disclosed recoveries.
            const ib = d.incomeBreakdown || {};
            const ibRecov = ["camReimbursements","realEstateTaxReimbursements","insuranceReimbursements"]
              .reduce((s, k) => s + (Number(ib[k]) || 0), 0);
            const tenantRecov = (d.tenants||[]).reduce((s, t) => s + (Number(t.expenseReimbursements) || 0), 0);
            const recov = Number(d.nnnRecoveries) || ibRecov || tenantRecov || 0;
            const opex = Number(d.operatingExpenses) || 0;
            if (recov <= 0 || opex <= 0) return null;
            const ratio = Math.round((recov / opex) * 100);
            const c = ratio >= 75 ? "#0f9d63" : ratio >= 50 ? "#c97a18" : "#dc2626";
            return <Row l="EXPENSE RECOVERY" v={`${ratio}% of opex`} c={c} />;
          })()}
          <Row l="WTAVG RENT/SF" v={d.weightedAvgRentPSF?`$${Number(d.weightedAvgRentPSF).toFixed(2)}/SF`:null} warn={reconWarns.weightedAvgRentPSF}/>
        </Card>
        <Card title="LEASE METRICS">
          <Row l="WALT" v={d.walt?`${d.walt} yrs`:null} c={d.walt && Number(d.walt)<3?"#dc2626":Number(d.walt)<6?"#383a37":"#0f9d63"} field="walt"/>
          {(d.tenants||[]).length > 0 && (() => {
            const toN = (v: unknown) => { const n = Number(v); return isNaN(n) ? 0 : n; };
            const occ = (d.tenants||[]).filter(t => t.name && !/^vacant$/i.test(String(t.name).trim()));
            const ig = occ.filter(t => t.name && isInvestmentGrade(t.name, t.creditRating));
            const totalR = occ.reduce((s, t) => s + toN(t.annualRent), 0);
            const igR = ig.reduce((s, t) => s + toN(t.annualRent), 0);
            const totalS = occ.reduce((s, t) => s + toN(t.sf), 0);
            const igS = ig.reduce((s, t) => s + toN(t.sf), 0);
            const pR = totalR > 0 ? Math.round(igR / totalR * 100) : null;
            const pS = totalS > 0 ? Math.round(igS / totalS * 100) : null;
            const v = [pR != null ? `${pR}% rent` : null, pS != null ? `${pS}% GLA` : null].filter(Boolean).join(" · ");
            return v ? <Row l="INVESTMENT GRADE EXPOSURE" v={v} /> : null;
          })()}
          {(d.tenants||[]).length > 0 && (() => {
            // Recent-renewal momentum: average rent spread achieved on tenants that
            // recently renewed (when the OM disclosed the increase) — evidence of
            // pricing power / below-market in-place rents.
            const spreads = (d.tenants||[])
              .map(t => { const n = Number(t.recentRenewalSpreadPct); return isNaN(n) ? null : n; })
              .filter((n): n is number => n != null && n !== 0);
            if (spreads.length < 2) return null;
            const avg = Math.round(spreads.reduce((s, n) => s + n, 0) / spreads.length);
            return <Row l="RECENT RENEWAL SPREAD" v={`${avg > 0 ? "+" : ""}${avg}% avg · ${spreads.length} renewals`} c={avg > 0 ? "#0f9d63" : undefined} />;
          })()}
          <Row l="YEAR BUILT" v={d.yearBuilt}/>
          <Row l="RENOVATION YEAR" v={d.renovationYear}/>
          <Row l="LOT SIZE" v={d.lotSizeAcres?`${d.lotSizeAcres} ac`:null}/>
          <Row l="PARKING RATIO" v={d.parkingRatio?`${d.parkingRatio}/1k SF`:null}/>
          <Row l="# BUILDINGS" v={d.numberOfBuildings}/>
        </Card>
        {Array.isArray(d.otherIncome) && d.otherIncome.length > 0 && (
          <Card title="OTHER INCOME">
            {d.otherIncome.map((oi, i) => (
              <Row
                key={i}
                l={(oi.source || oi.type || "Other").toUpperCase()}
                v={oi.annualAmount != null ? fmtUSD(oi.annualAmount) : (oi.note || "—")}
                c={oi.isMargin ? "#b45309" : undefined}
              />
            ))}
            {d.otherIncome.some(oi => oi.isMargin) && (
              <div style={{ fontSize:10, color:"#b45309", marginTop:6, lineHeight:1.5 }}>
                ⚠ Margin income (e.g. utility resale) is a spread, not durable rent — underwrite cautiously / haircut.
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Verified hint — under lease/financial metrics */}
      {(() => {
        const vcount = Object.keys(d.verified || {}).length;
        return (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, fontSize:11, color:vcount?"#0f6b46":"#a69e91" }}>
            <span style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:15, height:15, borderRadius:4, border:`1px solid ${vcount?"#0f9d63":"#cfd6dd"}`, background:vcount?"#0f9d63":"transparent", color:"#fff", fontSize:9, flexShrink:0 }}>{vcount?"✓":""}</span>
            {vcount ? `${vcount} figure${vcount>1?"s":""} verified — locked against re-analyze.` : "Tip: click ☐ beside a figure to verify/lock it."}
          </div>
        );
      })()}

      </>)}
      {tab === "ai" && (<>
      {/* Key assumptions — above My Underwriting. Hidden in Asset Management view. */}
      {showAcq && <div id="section-assumptions"><KeyAssumptions deal={d} /></div>}

      </>)}
      {tab === "underwriting" && (<>
      {/* My Underwriting */}
      <div id="section-underwriting" data-jump="My Underwriting"><MyUnderwritingPanel deal={d} onUpdate={onUpdate}/></div>

      </>)}
      {tab === "market" && (<>
      {/* Comp Benchmark — below My Underwriting */}
      <CompBenchmarkCard deal={d} />

      </>)}
      {tab === "underwriting" && (<>
      {/* Cash flow */}
      {showAcq && Array.isArray(d.cashFlowProjection) && d.cashFlowProjection.length > 0 && (
        <div id="section-cashflow" style={{ background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", marginBottom:12, fontWeight:600, textTransform:"uppercase" }}>Cash Flow Projection — {d.cashFlowProjection!.length} periods</div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ borderCollapse:"collapse", fontSize:12, minWidth:150+d.cashFlowProjection!.length*108 }}>
              <thead>
                <tr style={{ fontSize:10, color:"#a69e91", fontWeight:600 }}>
                  <th className="freeze-col" style={{ textAlign:"left", padding:"6px 10px", position:"sticky", left:0, background:"#fff", zIndex:1 }}></th>
                  {d.cashFlowProjection!.map((r,i) => <th key={i} style={{ textAlign:"right", padding:"6px 10px", whiteSpace:"nowrap", fontWeight:i===0?700:600, color:i===0?"#383a37":"#a69e91" }}>{r.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {([["Base Rent","totalBaseRent","#5c5f57"],["Reimbursements","reimbursements","#5c5f57"],["Eff. Gross Rev.","egr","#383a37"],["Operating Expenses","operatingExpenses","#837c6e"],["NOI","noi","#0f9d63"]] as [string,string,string][]).map(([label,key,color]) => (
                  <tr key={key} style={{ borderTop:"1px solid #f1eadc", background:key==="noi"?"#0f9d6308":"transparent" }}>
                    <td className="freeze-col" style={{ textAlign:"left", padding:"8px 10px", color:key==="noi"?"#0f7a4e":"#a69e91", fontWeight:key==="noi"?700:500, whiteSpace:"nowrap", position:"sticky", left:0, background:key==="noi"?"#f2faef":"#fff", zIndex:1 }}>{label}</td>
                    {d.cashFlowProjection!.map((r,ci) => (
                      <td key={ci} style={{ textAlign:"right", padding:"8px 10px", color, fontWeight:key==="noi"?700:400, whiteSpace:"nowrap" }}>{fmtUSD((r as any)[key])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      </>)}
      {tab === "transaction" && (<>
      {/* TRANSACTION DETAILS — acquisition record (LOI → close) and disposition */}
      {(() => {
        const owned = d.status === "Owned" || d.status === "Sold";
        const sold  = d.status === "Sold";
        // Seller & Broker are linked to the Property Info rows of the same name —
        // editing the Transaction field mirrors into the OM field (and vice versa)
        // so the value only has to be entered once.
        const LINKED: Partial<Record<keyof Deal, keyof Deal>> = { txnSeller: "seller", acqBroker: "broker" };
        const tf = (p: Omit<TxnFieldProps,"dealId"|"onUpdate">) => {
          const mirror = LINKED[p.field];
          const upd = mirror
            ? (id: string, patch: Partial<Deal>) => onUpdate(id, (p.field in patch) ? { ...patch, [mirror]: patch[p.field] } : patch)
            : onUpdate;
          return <TxnField key={p.field as string} {...p} initial={d[p.field] ?? (mirror ? d[mirror] : undefined)} dealId={d.id} onUpdate={upd} />;
        };
        const Grp = ({ title }: { title: string }) => (
          <div style={{ gridColumn:"1 / -1", fontSize:13, fontWeight:600, color:"#383a37", marginTop:8, marginBottom:-2, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:6, height:6, borderRadius:"50%", background:"#6dba43" }}/>{title}
          </div>
        );
        const pp = Number(d.txnPurchasePrice)||0, sp = Number(d.txnSalePrice)||0;
        const gain = pp && sp ? sp - pp : null;
        const closingCosts = Number(d.acqClosingCosts)||0, acqFee = Number(d.acqFee)||0;
        const allInBasis   = pp ? pp + closingCosts + acqFee : null;
        const noiClose     = Number(d.acqNOIAtClose) || Number(d.noi) || 0;
        const goingInCap   = pp && noiClose ? (noiClose/pp*100) : null;
        const pricePerSFCalc = pp && d.totalSF ? (pp/Number(d.totalSF)) : null;
        return (
          <div id="section-acquisition" data-jump={owned ? "Purchase Metrics" : "Transaction Details"} style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
              <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>
                {owned ? "Purchase Metrics" : "Transaction Details"}
              </div>
              <div style={{ fontSize:12, color:"#a69e91" }}>
                {owned ? "Complete the closing details below" : "Set status to Owned when acquired to record full closing details"}
              </div>
            </div>

            {owned && (() => {
              const req: [string, unknown][] = [
                ["Purchase price", d.txnPurchasePrice],["Seller", d.txnSeller],["Close date", d.txnCloseDate],
                ["Going-in cap", d.acqCapRate],["Acquiring entity", d.acqEntity],["Strategy", d.acqStrategy],
                ["Lender", d.debtLender],["Loan amount", d.debtLoanAmount],["Interest rate", d.debtRate],["Loan maturity", d.debtMaturityDate],
              ];
              const missing = req.filter(([,v]) => v == null || v === "");
              const filled  = req.length - missing.length;
              const pct     = Math.round((filled/req.length)*100);
              const done    = missing.length === 0;
              return (
                <div style={{ background:done?"#f0faf0":"#fffaf2", border:`1px solid ${done?"#cfe9c4":"#f0d9b5"}`, borderRadius:10, padding:"12px 16px", marginBottom:18 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:done?0:8 }}>
                    <span style={{ fontSize:13, fontWeight:600, color:done?"#0f7a3d":"#9a6a1e" }}>
                      {done ? "✓ Purchase metrics complete" : `Purchase metrics ${pct}% complete — ${missing.length} key detail${missing.length===1?"":"s"} still needed`}
                    </span>
                    <div style={{ width:90, height:6, background:"#efe8da", borderRadius:4, overflow:"hidden", flexShrink:0 }}>
                      <div style={{ width:`${pct}%`, height:"100%", background:done?"#0f9d63":"#d9a441", borderRadius:4, transition:"width 0.3s" }}/>
                    </div>
                  </div>
                  {!done && (
                    <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:4 }}>
                      {missing.map(([label]) => (
                        <span key={label as string} style={{ fontSize:11, color:"#9a6a1e", background:"#fbeed5", padding:"2px 8px", borderRadius:10 }}>{label as string}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Acquisition */}
            <div style={{ fontSize:13, fontWeight:600, color:"#383a37", marginBottom:10, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:"#6dba43" }}/>{owned ? "Deal Terms" : "Acquisition"}
            </div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14, marginBottom:18 }}>
              {tf({ label:"Purchase Price", field:"txnPurchasePrice", placeholder:"e.g. 42,500,000", prefix:"$" })}
              {tf({ label:"Acquired From (Seller)", field:"txnSeller", placeholder:"Seller entity / name" })}
              {tf({ label:"Close Date", field:"txnCloseDate", placeholder:"YYYY-MM-DD" })}
              {owned && <>
                {tf({ label:"Going-In Cap Rate", field:"acqCapRate", placeholder:"e.g. 6.50", suffix:"%" })}
                {tf({ label:"NOI at Close", field:"acqNOIAtClose", placeholder:"actual in-place NOI", prefix:"$" })}
                {tf({ label:"Acquiring Entity", field:"acqEntity", placeholder:"title-holding LLC / SPV" })}
                {tf({ label:"Acquisition Broker", field:"acqBroker", placeholder:"firm representing buyer/seller" })}
                <Grp title="Closing Economics"/>
                {tf({ label:"Earnest Money / Deposit", field:"acqDeposit", placeholder:"e.g. 1,000,000", prefix:"$" })}
                {tf({ label:"Closing Costs", field:"acqClosingCosts", placeholder:"e.g. 850,000", prefix:"$" })}
                {tf({ label:"Acquisition Fee", field:"acqFee", placeholder:"e.g. 425,000", prefix:"$" })}
                <Grp title="Parties & Advisors"/>
                {tf({ label:"Legal Counsel", field:"acqCounsel", placeholder:"acquisition counsel" })}
                <Grp title="Business Plan"/>
                {tf({ label:"Strategy", field:"acqStrategy", options:["Core","Core-Plus","Value-Add","Opportunistic"] })}
                {tf({ label:"Target Hold", field:"acqHoldPeriod", placeholder:"e.g. 7", suffix:"yrs" })}
                {tf({ label:"Target IRR", field:"acqTargetIRR", placeholder:"e.g. 14", suffix:"%" })}
              </>}
            </div>

            {owned && (allInBasis || goingInCap || pricePerSFCalc) && (
              <div style={{ marginBottom:18, paddingBottom:16, borderBottom:"1px solid #f1eadc", display:"flex", gap:30, flexWrap:"wrap" }}>
                {goingInCap && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Going-In Cap (calc)</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#0f9d63" }}>{goingInCap.toFixed(2)}%</div></div>}
                {pricePerSFCalc && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Price / SF</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#383a37" }}>${pricePerSFCalc.toFixed(0)}</div></div>}
                {allInBasis && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>All-In Basis</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#383a37" }}>{fmtUSD(allInBasis)}</div></div>}
              </div>
            )}

            {/* Disposition — collapsed behind a toggle, auto-expanded when Sold */}
            <DispositionSection sold={sold}>
            {sold && (() => {
              const req: [string, unknown][] = [["Sale price", d.txnSalePrice],["Buyer", d.txnBuyer],["Sale date", d.txnSaleDate],["Exit cap", d.dispExitCap]];
              const missing = req.filter(([,v]) => v == null || v === "");
              const filled  = req.length - missing.length, pct = Math.round((filled/req.length)*100), done = missing.length === 0;
              return (
                <div style={{ background:done?"#eefcfa":"#fffaf2", border:`1px solid ${done?"#bfe9e3":"#f0d9b5"}`, borderRadius:10, padding:"12px 16px", marginBottom:16 }}>
                  <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, marginBottom:done?0:8 }}>
                    <span style={{ fontSize:13, fontWeight:600, color:done?"#0a7d72":"#9a6a1e" }}>
                      {done ? "✓ Disposition record complete" : `Disposition record ${pct}% complete — ${missing.length} detail${missing.length===1?"":"s"} still needed`}
                    </span>
                    <div style={{ width:90, height:6, background:"#efe8da", borderRadius:4, overflow:"hidden", flexShrink:0 }}>
                      <div style={{ width:`${pct}%`, height:"100%", background:done?"#0d9488":"#d9a441", borderRadius:4, transition:"width 0.3s" }}/>
                    </div>
                  </div>
                  {!done && <div style={{ display:"flex", flexWrap:"wrap", gap:6, marginTop:4 }}>{missing.map(([l]) => <span key={l as string} style={{ fontSize:11, color:"#9a6a1e", background:"#fbeed5", padding:"2px 8px", borderRadius:10 }}>{l as string}</span>)}</div>}
                </div>
              );
            })()}

            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14 }}>
              {tf({ label:"Sale Price", field:"txnSalePrice", placeholder:"e.g. 54,000,000", prefix:"$" })}
              {tf({ label:"Sold To (Buyer)", field:"txnBuyer", placeholder:"Buyer entity / name" })}
              {tf({ label:"Sale Date", field:"txnSaleDate", placeholder:"YYYY-MM-DD" })}
              {tf({ label:"Disposition Broker", field:"txnBroker", placeholder:"firm representing the sale" })}
              {sold && <>
                {tf({ label:"Exit Cap Rate", field:"dispExitCap", placeholder:"e.g. 5.75", suffix:"%" })}
                {tf({ label:"Selling Costs", field:"dispCosts", placeholder:"commission, legal, transfer", prefix:"$" })}
                {tf({ label:"Loan Payoff at Sale", field:"dispLoanPayoff", placeholder:"outstanding balance repaid", prefix:"$" })}
                {tf({ label:"Disposition Notes", field:"dispNotes", placeholder:"rationale, terms, buyer profile", wide:true })}
              </>}
            </div>

            {gain != null && (
              <div style={{ marginTop:18, paddingTop:16, borderTop:"1px solid #f1eadc", display:"flex", gap:30, flexWrap:"wrap" }}>
                <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Realized Gain / (Loss)</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:gain>=0?"#0f9d63":"#dc2626" }}>{gain>=0?"":"-"}${Math.abs(gain).toLocaleString()}</div></div>
              </div>
            )}
            </DispositionSection>
          </div>
        );
      })()}

      {showAcq && <ClosingCostsCard deal={d} />}
      {(d.status === "Owned" || d.status === "Sold") && (
        <div id="section-ownership"><OwnershipStructure deal={d} onUpdate={onUpdate} /></div>
      )}
      </>)}
      {tab === "financing" && (<>
      {/* FINANCING & DEBT — loan record / term sheet for deals Under Contract, Owned, or Sold */}
      {(() => {
        const owned = d.status === "Owned" || d.status === "Sold" || d.status === "Under Contract";
        const f = (p: Omit<TxnFieldProps,"dealId"|"onUpdate">) =>
          <TxnField key={p.field as string} {...p} initial={d[p.field]} dealId={d.id} onUpdate={onUpdate} />;
        const Group = ({ title }: { title: string }) => (
          <div style={{ gridColumn:"1 / -1", fontSize:13, fontWeight:600, color:"#383a37", marginTop:6, marginBottom:-2, display:"flex", alignItems:"center", gap:8 }}>
            <span style={{ width:6, height:6, borderRadius:"50%", background:"#6dba43" }}/>{title}
          </div>
        );
        const amt = Number(d.debtLoanAmount)||0, rate = Number(d.debtRate)||0, amortY = Number(d.debtAmortYears)||0;
        let annualDS: number|null = null;
        if (amt && rate) {
          if (amortY > 0) { const r = rate/100/12, n = amortY*12; annualDS = (r>0 ? amt*r/(1-Math.pow(1+r,-n)) : amt/n)*12; }
          else annualDS = amt * rate/100;
        }
        const noi2     = Number(d.noi)||0;
        const dscrCalc = annualDS && noi2 ? noi2/annualDS : null;

        if (!owned) return (
          <div id="section-financing" data-jump="Financing & Debt" style={{ background:"#ffffff", border:"1px dashed #ddd4c2", borderRadius:12, padding:"16px 20px", marginBottom:14, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
            <div style={{ fontSize:13, color:"#837c6e" }}>
              <span style={{ fontWeight:600, color:"#383a37" }}>Financing & Debt</span> — set this deal's status to <span style={{ fontWeight:600 }}>Under Contract</span> or <span style={{ fontWeight:600 }}>Owned</span> to record financing or upload a term sheet.
            </div>
            <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
              <button onClick={() => onUpdate(d.id, { status:"Under Contract" })}
                style={{ background:"#f6efe0", border:"1px solid #e0c98a", color:"#8a5a12", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>
                Mark Under Contract
              </button>
              <button onClick={() => onUpdate(d.id, { status:"Owned" })}
                style={{ background:"#6dba43", border:"none", color:"#1f2b16", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>
                Mark as Owned
              </button>
            </div>
          </div>
        );

        return (
          <div id="section-financing">
            <div id="section-senior-loan" style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:14 }}>Senior Loan</div>
            <TermSheetImport deal={d} onUpdate={onUpdate}/>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14 }}>
              <Group title="Lender & Loan"/>
              {f({ label:"Lender / Servicer", field:"debtLender", placeholder:"e.g. JPMorgan, Fannie Mae" })}
              {d.debtLender && onTenantClick && (
                <div style={{ gridColumn:"1 / -1", marginTop:-8 }}>
                  <button onClick={() => onTenantClick("__lender__" + d.debtLender!)} style={{ background:"transparent", border:"none", padding:0, cursor:"pointer", fontSize:11, color:"#2d4ecf", textDecoration:"underline" }}>
                    View all loans with {lenderLabel(d.debtLender)} ›
                  </button>
                </div>
              )}
              <TxnField key="debtType" label="Loan Type" field="debtType" options={["Senior / Acquisition","Permanent","Bridge","Construction","Mezzanine","CMBS","Agency (Fannie/Freddie)","Life Co","Bank","Other"]} initial={d.debtType ?? "Senior / Acquisition"} dealId={d.id} onUpdate={onUpdate} />
              {f({ label:"Original Loan Amount", field:"debtLoanAmount", placeholder:"e.g. 30,000,000", prefix:"$" })}
              {f({ label:"Lender Contact", field:"debtContact", placeholder:"Name / email / phone", wide:true })}
              <Group title="Rate"/>
              {f({ label:"Interest Rate", field:"debtRate", placeholder:"e.g. 6.25", suffix:"%" })}
              {f({ label:"Rate Type", field:"debtRateType", options:["Fixed","Floating"] })}
              {f({ label:"Index (if floating)", field:"debtIndex", placeholder:"e.g. 1-mo SOFR" })}
              {f({ label:"Spread / Margin", field:"debtSpread", placeholder:"e.g. 250", suffix:"bps" })}
              <Group title="Term & Amortization"/>
              {f({ label:"Origination / Close Date", field:"debtOriginationDate", placeholder:"YYYY-MM-DD" })}
              {f({ label:"Maturity Date", field:"debtMaturityDate", placeholder:"YYYY-MM-DD" })}
              {f({ label:"Term", field:"debtTermYears", placeholder:"e.g. 10", suffix:"yrs" })}
              {f({ label:"Amortization", field:"debtAmortYears", placeholder:"e.g. 30 (0 = IO)", suffix:"yrs" })}
              {f({ label:"Interest-Only Period", field:"debtIOPeriod", placeholder:"e.g. 36", suffix:"mo" })}
              {f({ label:"Extension Options", field:"debtExtensions", placeholder:"e.g. 2 × 1-yr" })}
              <Group title="Covenants & Terms"/>
              {f({ label:"LTV at Close", field:"debtLTV", placeholder:"e.g. 60", suffix:"%" })}
              {f({ label:"Recourse", field:"debtRecourse", options:["Non-Recourse","Full Recourse","Partial / Bad-Boy Carveouts"] })}
              {f({ label:"Assumable", field:"debtAssumable", options:["Yes","No","With Lender Approval"] })}
              {f({ label:"Prepayment", field:"debtPrepay", placeholder:"e.g. Yield maintenance, defeasance, 5-4-3-2-1 step-down" })}
              {f({ label:"Escrows / Reserves", field:"debtEscrows", placeholder:"e.g. Tax, insurance, TI/LC, replacement" })}
              {f({ label:"Notes", field:"debtNotes", placeholder:"Anything else worth recording", wide:true })}
            </div>
            {(annualDS || dscrCalc) && (
              <div style={{ marginTop:18, paddingTop:16, borderTop:"1px solid #f1eadc", display:"flex", gap:30, flexWrap:"wrap" }}>
                {annualDS && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Est. Annual Debt Service</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#383a37" }}>${Math.round(annualDS).toLocaleString()}</div></div>}
                {dscrCalc && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Implied DSCR (NOI)</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:dscrCalc<1.2?"#dc2626":"#0f9d63" }}>{dscrCalc.toFixed(2)}x</div></div>}
              </div>
            )}
            <div style={{ marginTop:12, fontSize:11, color:"#b3aa9b", lineHeight:1.5 }}>Derived figures are estimates (debt service assumes level amortization; DSCR uses the OM NOI). For reference only.</div>
            </div>{/* /Senior Loan box */}

            {/* Amortization schedule — its own box */}
            <div id="section-amortization" style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
              <AmortizationCard deal={d} onUpdate={onUpdate} />
            </div>

            {/* Prepayment & swap breakage — its own box */}
            <div id="section-prepay" style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
              <PrepayCalculator deal={d} onUpdate={onUpdate} />
            </div>

            {/* Preferred Equity — its own box, below the senior mortgage details */}
            {(() => {
              const hasPref = [d.prefLender, d.prefAmount, d.prefRateCurrent, d.prefRateAllIn, d.prefReturnType, d.prefOriginationDate, d.prefMaturityDate, d.prefTermYears, d.prefRecourse, d.prefNotes].some(v => v != null && v !== "");
              const prefOpen = hasPref || showPrefManual;
              return (
                <div id="section-pref-equity" style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
                  <div onClick={() => { if (!hasPref) setShowPrefManual(v => !v); }}
                    style={{ fontSize:13, fontWeight:600, color:"#383a37", marginBottom: prefOpen ? 10 : 0, display:"flex", alignItems:"center", gap:8, cursor: hasPref ? "default" : "pointer", userSelect:"none" }}>
                    <span style={{ width:6, height:6, borderRadius:"50%", background:"#6dba43" }}/>
                    Preferred Equity (if applicable)
                    {!hasPref && <span style={{ fontSize:11, fontWeight:600, color:"#a69e91" }}>{prefOpen ? "▾ hide" : "▸ add"}</span>}
                  </div>
                  {prefOpen && (
                    <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14 }}>
                      <div style={{ gridColumn:"1 / -1" }}><PrefImportButton deal={d} onUpdate={onUpdate} /></div>
                      {f({ label:"Pref Equity Provider", field:"prefLender", placeholder:"e.g. Basis, Cerberus, family office" })}
                      {d.prefLender && onTenantClick && (
                        <div style={{ gridColumn:"1 / -1", marginTop:-8 }}>
                          <button onClick={() => onTenantClick("__lender__" + d.prefLender!)} style={{ background:"transparent", border:"none", padding:0, cursor:"pointer", fontSize:11, color:"#2d4ecf", textDecoration:"underline" }}>
                            View all loans with {lenderLabel(d.prefLender)} ›
                          </button>
                        </div>
                      )}
                      {f({ label:"Pref Amount", field:"prefAmount", placeholder:"e.g. 5,000,000", prefix:"$" })}
                      {f({ label:"Current Pay Rate", field:"prefRateCurrent", placeholder:"e.g. 8.0", suffix:"%" })}
                      {f({ label:"All-In Rate (at sale/refi)", field:"prefRateAllIn", placeholder:"e.g. 9.25", suffix:"%" })}
                      {f({ label:"Return Type", field:"prefReturnType", options:["Current Pay","Accruing","Hybrid"] })}
                      {f({ label:"Origination Date", field:"prefOriginationDate", placeholder:"YYYY-MM-DD" })}
                      {f({ label:"Maturity / Redemption Date", field:"prefMaturityDate", placeholder:"YYYY-MM-DD" })}
                      {f({ label:"Term", field:"prefTermYears", placeholder:"e.g. 3", suffix:"yrs" })}
                      {f({ label:"Recourse", field:"prefRecourse", options:["Non-Recourse","Recourse","Partial"] })}
                      {f({ label:"Notes", field:"prefNotes", placeholder:"Key terms, promote structure, etc.", wide:true })}
                      {d.prefSchedule && d.prefSchedule.length > 0 && (
                        <div style={{ gridColumn:"1 / -1" }}><PrefScheduleCard deal={d} /></div>
                      )}
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
        );
      })()}

      </>)}
      {tab === "market" && (<>
      {/* Property info */}
      <div id="section-property-info" style={{ marginBottom:12 }}>
        <Card title="PROPERTY INFO">
          <div style={{ display:"flex", justifyContent:"flex-end", marginBottom:2 }}>
            <button onClick={() => onGetMarket(d.id)} disabled={marketBusy || !(d.address || d.city || d.state)}
              title="Derive Market & Submarket from the address (free US Census geocoder — no tokens)"
              style={{ background:"transparent", border:"1px solid #0d9488", color:(marketBusy||!(d.address||d.city||d.state))?"#a69e91":"#0d9488", padding:"4px 10px", borderRadius:5, cursor:(marketBusy||!(d.address||d.city||d.state))?"default":"pointer", fontSize:9.5, fontWeight:600, fontFamily:"'Inter',sans-serif", letterSpacing:"0.04em" }}>
              {marketBusy ? "PULLING…" : ((d.market||d.submarket) ? "RE-PULL MARKET" : "PULL MARKET FROM ADDRESS")}
            </button>
          </div>
          {(() => {
            const tag = (
              <span title="Derived from the address via the US Census geocoder — verify before relying on it"
                style={{ fontSize:7.5, fontWeight:700, color:"#0d9488", background:"#0d948815", border:"1px solid #0d948840", borderRadius:4, padding:"1px 4px", letterSpacing:"0.04em", whiteSpace:"nowrap" }}>AUTO · VERIFY</span>
            );
            const derivedMkt = !!(d.marketGeo?.market && d.market && d.market === d.marketGeo.market);
            const derivedSub = !!(d.marketGeo?.submarket && d.submarket && d.submarket === d.marketGeo.submarket);
            const infoRow = (l: string, v: unknown, derived: boolean) => (
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", padding:"7px 0", borderBottom:"1px solid #e7e0d2" }}>
                <span style={{ fontSize:10, color:"#6f6a5f", letterSpacing:"0.05em" }}>{l}</span>
                <span style={{ display:"flex", alignItems:"center", gap:6 }}>
                  {derived && tag}
                  <span style={{ fontSize:11, color:"#383a37", fontWeight:500 }}>{(v != null && v !== "") ? String(v) : <span style={{ color:"#958d80" }}>—</span>}</span>
                </span>
              </div>
            );
            return (<>
              {infoRow("MARKET", d.market, derivedMkt)}
              {infoRow("SUBMARKET", d.submarket, derivedSub)}
            </>);
          })()}
          {/* Broker & Seller are LINKED with the Transaction Details fields —
              editing here writes both so you only enter each once. */}
          <EditableTextRow label="BROKER" value={d.broker ?? d.acqBroker} placeholder="Listing / deal broker" onSave={v => onUpdate(d.id, { broker: v, acqBroker: v })} />
          <EditableTextRow label="SELLER" value={d.seller ?? d.txnSeller} placeholder="Seller / current owner" onSave={v => onUpdate(d.id, { seller: v, txnSeller: v })} />
          <Row l="LAST SALE DATE" v={d.lastSaleDate}/>
          <Row l="LAST SALE PRICE" v={d.lastSalePrice?fmtUSD(d.lastSalePrice):null}/>
        </Card>
      </div>

      {/* Demographics from OM */}
      {(d.trafficCountVPD || d.population3mi || d.medianHHIncome3mi) && (
        <div id="section-demographics"><Card title="DEMOGRAPHICS & SITE" source="OM">
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
            {[["TRAFFIC/DAY", d.trafficCountVPD?`${Number(d.trafficCountVPD).toLocaleString()} VPD`:null],
              ["POP. 3MI", d.population3mi?`${Number(d.population3mi).toLocaleString()}`:null],
              ["MED. HHI 3MI", d.medianHHIncome3mi?fmtUSD(d.medianHHIncome3mi):null],
              ["AVG. HHI 3MI", d.avgHHIncome3mi?fmtUSD(d.avgHHIncome3mi):null],
            ].map(([l,v]) => (
              <div key={l as string} style={{ background:"#fff", padding:"8px 10px", borderRadius:5 }}>
                <div style={{ fontSize:8, color:"#958d80", marginBottom:3 }}>{l as string}</div>
                <div style={{ fontSize:12, color:"#5c5f57", fontWeight:500 }}>{v as string||"—"}</div>
              </div>
            ))}
          </div>
          {d.proximityHighways && <div style={{ marginTop:8, fontSize:11, color:"#7d766a" }}>Highways: {d.proximityHighways}</div>}
          {d.retailCotenants && <div style={{ marginTop:4, fontSize:11, color:"#7d766a" }}>Co-tenants: {d.retailCotenants}</div>}
        </Card></div>
      )}
      {(d.trafficCountVPD || d.population3mi || d.medianHHIncome3mi) && <div style={{ height:12 }}/>}

      {/* Trade area demographics pull */}
      <div id="section-trade-area" style={{ background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"16px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:d.marketDemographics?12:9, flexWrap:"wrap" }}>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>Trade Area — 1 / 3 / 5 Mile<span style={{ textTransform:"none", letterSpacing:"normal", fontWeight:500, color:"#bcae97" }}> (Source: Address-based Census data pull)</span></div>
          <button onClick={() => onGetDemo(d.id)} disabled={demoBusy}
            style={{ background:"transparent", border:"1px solid #0d9488", color:demoBusy?"#a69e91":"#0d9488", padding:"5px 11px", borderRadius:5, cursor:demoBusy?"default":"pointer", fontSize:10, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
            {demoBusy?"PULLING…":(d.marketDemographics?"RE-PULL":"PULL DEMOGRAPHICS")}
          </button>
        </div>
        {d.marketDemographics ? (() => {
          const m = d.marketDemographics!;
          const fmtN = (v: number|null|undefined) => v!=null ? Number(v).toLocaleString() : "—";
          const fmtD = (v: number|null|undefined) => v!=null ? fmtUSD(v) : "—";
          const cc = m.confidence==="high"?"#0f9d63":m.confidence==="medium"?"#d9890c":"#a69e91";
          return (
            <>
              <div style={{ overflowX:"auto" }}>
                <table style={{ borderCollapse:"collapse", fontSize:12, width:"100%", minWidth:360 }}>
                  <thead><tr style={{ fontSize:10, color:"#a69e91", fontWeight:600 }}>
                    <th style={{ textAlign:"left", padding:"5px 8px" }}></th>
                    <th style={{ textAlign:"right", padding:"5px 8px" }}>1 MILE</th>
                    <th style={{ textAlign:"right", padding:"5px 8px" }}>3 MILE</th>
                    <th style={{ textAlign:"right", padding:"5px 8px" }}>5 MILE</th>
                  </tr></thead>
                  <tbody>
                    <tr style={{ borderTop:"1px solid #f1eadc" }}>
                      <td style={{ padding:"7px 8px", color:"#a69e91" }}>Population</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#383a37" }}>{fmtN(m.pop1mi)}</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#383a37" }}>{fmtN(m.pop3mi)}</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#383a37" }}>{fmtN(m.pop5mi)}</td>
                    </tr>
                    <tr style={{ borderTop:"1px solid #f1eadc" }}>
                      <td style={{ padding:"7px 8px", color:"#a69e91" }}>Avg HH Income</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#0f9d63", fontWeight:500 }}>{fmtD(m.avgHHI1mi)}</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#0f9d63", fontWeight:500 }}>{fmtD(m.avgHHI3mi)}</td>
                      <td style={{ padding:"7px 8px", textAlign:"right", color:"#0f9d63", fontWeight:500 }}>{fmtD(m.avgHHI5mi)}</td>
                    </tr>
                  </tbody>
                </table>
              </div>
              <div style={{ display:"flex", alignItems:"center", gap:8, marginTop:10, flexWrap:"wrap" }}>
                <span style={{ fontSize:9, fontWeight:700, color:cc, background:`${cc}1a`, padding:"2px 8px", borderRadius:10, textTransform:"uppercase" }}>{m.confidence} confidence</span>
                {m.source && <span style={{ fontSize:10.5, color:"#837c6e" }}>{m.source}{m.asOf?` · ${m.asOf}`:""}</span>}
              </div>
              {m.note && <div style={{ fontSize:10.5, color:"#7d766a", lineHeight:1.55, marginTop:7 }}>{m.note}</div>}
              <div style={{ fontSize:9, color:"#a69e91", marginTop:9 }}>Sourced from US Census Bureau ACS 5-Year Estimates. Block-group centroids apportioned within radius rings — a close estimate; verify before relying on it.</div>

            </>
          );
        })() : (
          <div style={{ fontSize:11.5, color:"#a69e91", lineHeight:1.55 }}>Auto-pulled on deal creation from US Census ACS 5-Year Estimates. Click "RE-PULL" to refresh.</div>
        )}
      </div>

      </>)}
      {tab === "overview" && (<>
      {/* User notes */}
      <div id="section-notes" style={{ background:"#fff", border:"1px solid #ece5d7", borderRadius:12, padding:"16px 18px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#a89f8f" }}>Your Notes</div>
          {!notesOpen && <button onClick={() => setNotesOpen(true)} style={{ fontSize:10, color:"#7d766a", background:"transparent", border:"1px solid #e7e0d2", padding:"3px 9px", borderRadius:5, cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>Edit</button>}
        </div>
        {notesOpen ? (
          <div>
            <textarea value={notesVal} onChange={e => setNotesVal(e.target.value)} rows={5}
              style={{ width:"100%", fontFamily:"'Inter',sans-serif", fontSize:13, padding:"10px 12px", border:"1px solid #e3dccd", borderRadius:8, color:"#383a37", background:"#faf7f0", resize:"vertical", boxSizing:"border-box" }}/>
            <div style={{ display:"flex", gap:8, marginTop:6 }}>
              <button onClick={() => { onUpdate(d.id, { userNotes:notesVal }); setNotesOpen(false); }}
                style={{ background:"#26281f", border:"none", color:"#e8e0cf", padding:"6px 14px", borderRadius:7, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>Save</button>
              <button onClick={() => { setNotesVal(d.userNotes||""); setNotesOpen(false); }}
                style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"6px 14px", borderRadius:7, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>Cancel</button>
            </div>
          </div>
        ) : (
          <p style={{ fontSize:13, color: d.userNotes?"#383a37":"#c4bba7", lineHeight:1.65, margin:0, whiteSpace:"pre-wrap" }}>{d.userNotes || "No notes yet. Click Edit to add."}</p>
        )}
      </div>

      </>)}

      <PropertyChat deal={d} abstracts={abstracts} />
      </div>
    </div>
  );
}

// ── Fields that hold numeric values in the transaction / debt / acq forms ──
const NUMERIC_TXN_FIELDS = new Set<string>([
  "txnPurchasePrice","txnSalePrice","debtLoanAmount","debtRate","debtSpread",
  "debtTermYears","debtAmortYears","debtIOPeriod","debtLTV","debtDSCR",
  "acqCapRate","acqNOIAtClose","acqDeposit","acqClosingCosts","acqFee",
  "acqHoldPeriod","acqTargetIRR","dispExitCap","dispCosts","dispLoanPayoff",
]);

// Coerce a loosely-typed date the user typed (3/12/26, 3-12-2026, "March 12, 2026")
// into ISO YYYY-MM-DD, which is what every date calc in the app expects. Returns the
// input unchanged if it can't confidently parse it — never mangle what they typed.
function normalizeDateInput(raw: string): string {
  const s = raw.trim();
  if (!s || /^\d{4}-\d{2}-\d{2}$/.test(s)) return s; // blank or already ISO
  const pad = (n: number) => String(n).padStart(2, "0");
  const fixYr = (y: number) => y >= 100 ? y : (y < 70 ? 2000 + y : 1900 + y); // 2-digit → century
  // US order M/D/Y (also - or . separators)
  let m = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{2,4})$/);
  if (m) {
    const mo = +m[1], da = +m[2], yr = fixYr(+m[3]);
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `${yr}-${pad(mo)}-${pad(da)}`;
    return s;
  }
  // ISO-ish with slashes: Y/M/D
  m = s.match(/^(\d{4})[/.\-](\d{1,2})[/.\-](\d{1,2})$/);
  if (m) {
    const yr = +m[1], mo = +m[2], da = +m[3];
    if (mo >= 1 && mo <= 12 && da >= 1 && da <= 31) return `${yr}-${pad(mo)}-${pad(da)}`;
    return s;
  }
  // Month-name formats ("March 12, 2026", "12 Mar 2026") — only when a 4-digit year
  // is present, so we never guess a century from an ambiguous string.
  if (/\d{4}/.test(s)) {
    const d = new Date(s);
    if (!isNaN(d.getTime())) return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }
  return s;
}

interface TxnFieldProps {
  label: string;
  field: keyof Deal;
  initial?: unknown;
  placeholder?: string;
  prefix?: string;
  suffix?: string;
  options?: string[];
  wide?: boolean;
  dealId: string;
  onUpdate: (id: string, patch: Partial<Deal>) => void;
  numeric?: boolean;
}

// Stable input: local state only, never calls onUpdate on keystroke.
// Commits on blur or Enter; formats money as $40,000,000 on blur.
function TxnField({ label, field, initial, placeholder, prefix, suffix, options, wide, dealId, onUpdate, numeric }: TxnFieldProps) {
  const isMoney = prefix === "$";
  const isPct   = suffix === "%";
  const isNum   = !!(numeric || isMoney || isPct || NUMERIC_TXN_FIELDS.has(field as string));
  const isDate  = !isNum && (placeholder === "YYYY-MM-DD" || /date$/i.test(String(field)));
  const fmt = (v: unknown): string => {
    if (v == null || v === "") return "";
    if (isMoney) { const n = Number(String(v).replace(/[^0-9.\-]/g,"")); return isNaN(n) ? String(v) : n.toLocaleString("en-US"); }
    return String(v);
  };
  const [val, setVal] = useState(() => fmt(initial));
  const [saved, setSaved] = useState(false);
  const valRef = useRef(val);
  const dirtyRef = useRef(false);
  const focusedRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync down from the deal — but never yank the field out from under the user
  // while they're actively typing in it.
  useEffect(() => {
    if (focusedRef.current) return;
    const f = fmt(initial); setVal(f); valRef.current = f; dirtyRef.current = false;
  }, [initial, dealId]);

  // Persist the current value WITHOUT touching React state — safe to call on unmount.
  const persistValue = (): unknown => {
    if (!dirtyRef.current) return undefined;
    dirtyRef.current = false;
    const v = valRef.current;
    let patchVal: unknown;
    if (v === "" || v == null) patchVal = null;
    else if (isNum) { const n = Number(String(v).replace(/[^0-9.\-]/g,"")); patchVal = isNaN(n) ? null : n; }
    else if (isDate) patchVal = normalizeDateInput(String(v));
    else patchVal = v;
    onUpdate(dealId, { [field]: patchVal } as Partial<Deal>);
    return patchVal;
  };

  // Interactive save: persist, reflect in the UI, and flash a "saved" tick.
  const commit = () => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
    if (!dirtyRef.current) return;
    const patchVal = persistValue();
    if (!focusedRef.current) {
      const disp = patchVal == null ? "" : isMoney ? (patchVal as number).toLocaleString("en-US") : String(patchVal);
      setVal(disp); valRef.current = disp;
    }
    setSaved(true);
    if (savedTimerRef.current) clearTimeout(savedTimerRef.current);
    savedTimerRef.current = setTimeout(() => setSaved(false), 1500);
  };

  const handleChange = (next: string) => {
    setVal(next); valRef.current = next; dirtyRef.current = true; setSaved(false);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(commit, 600);   // auto-save shortly after you stop typing
  };

  // Flush any pending edit if the editor closes or the page navigates away.
  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current); persistValue(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5, gridColumn: wide?"1 / -1":"auto" }}>
      <label style={{ fontSize:11, color:"#a69e91", fontWeight:600, letterSpacing:"0.03em", textTransform:"uppercase", display:"flex", alignItems:"center", gap:6 }}>
        {label}{saved && <span style={{ color:"#3f7a1f", fontSize:10, fontWeight:700 }}>✓ saved</span>}
      </label>
      {options ? (
        <select value={val} onChange={e => { setVal(e.target.value); valRef.current = e.target.value; dirtyRef.current = true; commit(); }}
          style={{ background:"#f5f1e8", border:"1px solid #e6dfd0", borderRadius:8, padding:"10px", fontSize:14, color:"#383a37", outline:"none" }}>
          <option value="">—</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <div style={{ display:"flex", alignItems:"center", background:"#f5f1e8", border:"1px solid "+(saved?"#8cbf63":"#e6dfd0"), borderRadius:8, padding:"0 10px", transition:"border-color 0.3s" }}>
          {prefix && <span style={{ color:"#a69e91", fontSize:14 }}>{prefix}</span>}
          <input
            value={val}
            onFocus={() => { focusedRef.current = true; }}
            onChange={e => handleChange(e.target.value)}
            onBlur={() => {
              focusedRef.current = false;
              // Convert a loosely-typed date (3/12/26) to ISO and reflect it in the box.
              if (isDate && valRef.current.trim()) {
                const norm = normalizeDateInput(valRef.current);
                if (norm !== valRef.current) { setVal(norm); valRef.current = norm; dirtyRef.current = true; }
              }
              commit();
            }}
            onKeyDown={e => { if (e.key === "Enter") e.currentTarget.blur(); }}
            placeholder={placeholder}
            style={{ flex:1, background:"transparent", border:"none", outline:"none", padding:"10px 6px", fontSize:14, color:"#383a37" }}/>
          {suffix && <span style={{ color:"#a69e91", fontSize:13 }}>{suffix}</span>}
        </div>
      )}
    </div>
  );
}

// ── Core metrics editor ───────────────────────────────────────────────────────
// Toggle panel on the detail page to correct extracted numbers. Saves through the
// normal onUpdate path so every change is logged in the deal's edit history.
// ── "Also known as" aliases ──────────────────────────────────────────────────
// Alternate names/entities (borrowing LLC, broker's phase name) that should route
// documents to THIS deal — so a doc under a different name auto-attaches here
// instead of forking a duplicate.
function AkaEditor({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState("");
  const aka = Array.isArray(deal.aka) ? deal.aka : [];
  const add = () => {
    const v = draft.trim();
    if (!v) return;
    if (aka.some(a => a.toLowerCase() === v.toLowerCase()) || (deal.propertyName || "").toLowerCase() === v.toLowerCase()) { setDraft(""); return; }
    onUpdate(deal.id, { aka: [...aka, v] });
    setDraft("");
  };
  const remove = (name: string) => onUpdate(deal.id, { aka: aka.filter(a => a !== name) });

  if (!open && aka.length === 0) {
    return (
      <div style={{ marginBottom: 12 }}>
        <button onClick={() => setOpen(true)}
          style={{ background: "transparent", border: "1px dashed #d8cfbd", color: "#7d766a", padding: "5px 11px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>
          + Add "also known as" name
        </button>
      </div>
    );
  }
  return (
    <div style={{ marginBottom: 12, background: "#fff", border: "1px solid #efe8da", borderRadius: 10, padding: "12px 14px" }}>
      <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "#a69e91", fontWeight: 600, textTransform: "uppercase", marginBottom: 6 }}>Also Known As</div>
      <div style={{ fontSize: 11, color: "#9a917f", marginBottom: 8, lineHeight: 1.5 }}>
        Other names this property goes by — a borrowing entity (e.g. "Voorhees MZL LLC"), a broker's phase name, or an old name. Any uploaded document under one of these names will route straight to this deal.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 8 }}>
        {aka.map(name => (
          <span key={name} style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "#f4f8ef", border: "1px solid #cfe3b8", borderRadius: 14, padding: "3px 6px 3px 10px", fontSize: 12, color: "#2f5a1f" }}>
            {name}
            <button onClick={() => remove(name)} title="Remove" style={{ background: "transparent", border: "none", color: "#7d9a5c", cursor: "pointer", fontSize: 14, lineHeight: 1, padding: "0 2px" }}>×</button>
          </span>
        ))}
        {aka.length === 0 && <span style={{ fontSize: 11.5, color: "#bcae97" }}>No aliases yet.</span>}
      </div>
      <div style={{ display: "flex", gap: 8 }}>
        <input value={draft} autoFocus={open && aka.length === 0}
          onChange={e => setDraft(e.target.value)}
          onKeyDown={e => { if (e.key === "Enter") add(); }}
          placeholder='e.g. Voorhees MZL LLC'
          style={{ flex: 1, border: "1px solid #c8b89a", borderRadius: 7, padding: "7px 10px", fontSize: 13, color: "#383a37", outline: "none", background: "#fff" }} />
        <button onClick={add} style={{ background: "#3f7a1f", border: "none", color: "#fff", padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Add</button>
      </div>
    </div>
  );
}

function MetricsEditor({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  const [open, setOpen] = useState(false);
  const fields: Array<{ field: keyof Deal; label: string; prefix?: string; suffix?: string; numeric?: boolean }> = [
    { field:"noi", label:"NOI", prefix:"$" },
    { field:"capRate", label:"Cap Rate", suffix:"%" },
    { field:"askingPrice", label:"Asking Price", prefix:"$" },
    { field:"totalSF", label:"Total SF", numeric:true },
    { field:"occupancy", label:"Occupancy", suffix:"%" },
    { field:"weightedAvgRentPSF", label:"Wtd Avg Rent / SF", prefix:"$" },
    { field:"walt", label:"WALT (yrs)", numeric:true },
    { field:"grossPotentialRent", label:"Gross Potential Rent", prefix:"$" },
    { field:"effectiveGrossIncome", label:"Effective Gross Income", prefix:"$" },
    { field:"operatingExpenses", label:"Operating Expenses", prefix:"$" },
    { field:"nnnRecoveries", label:"NNN Recoveries", prefix:"$" },
    { field:"yearBuilt", label:"Year Built", numeric:true },
    { field:"renovationYear", label:"Renovation Year", numeric:true },
    { field:"numberOfBuildings", label:"# Buildings", numeric:true },
    { field:"lotSizeAcres", label:"Lot Size (acres)", numeric:true },
  ];
  return (
    <div style={{ marginBottom:14 }}>
      <button onClick={() => setOpen(o => !o)}
        style={{ background:open?"#383a37":"transparent", color:open?"#f6f2ea":"#5c5f57", border:"1px solid "+(open?"#383a37":"#d8cfbd"), padding:"6px 13px", borderRadius:8, cursor:"pointer", fontSize:11.5, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
        {open ? "✕ Close metric editor" : "✎ Edit metrics"}
      </button>
      {open && (
        <div style={{ marginTop:11, background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"16px 18px", boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ fontSize:11, color:"#9a917f", marginBottom:13, lineHeight:1.5 }}>
            Correct any figure that doesn't match the OM. Changes save automatically as you type — you'll see a green <b style={{ color:"#3f7a1f" }}>✓ saved</b> on each field — and are logged in this deal's edit history. The fields you most often correct get flagged for extra care on future extractions.
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(190px, 1fr))", gap:13 }}>
            {fields.map(f => (
              <TxnField key={f.field as string} label={f.label} field={f.field} initial={deal[f.field]}
                prefix={f.prefix} suffix={f.suffix} numeric={f.numeric}
                dealId={deal.id} onUpdate={onUpdate}/>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── Preferred-equity terms importer ──────────────────────────────────────────
// Drop a JV agreement / pref-equity term sheet / schedule to auto-fill the
// blank pref-equity fields. Never overwrites a value you've already entered.
function PrefImportButton({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [isErr, setIsErr] = useState(false);

  const handle = async (file: File) => {
    setBusy(true); setMsg(null); setIsErr(false);
    try {
      const { text } = await extractAnyFile(file);
      const result = await extractPref(text);
      const patch = buildPrefPatch(deal, result);
      // Also pull the accrual schedule (the running pref balance) when the file
      // includes one — optional, so a missing/odd schedule never blocks the terms.
      let sched = 0;
      try {
        const rows = await extractAmortSchedule(text);
        if (rows.length) { (patch as Partial<Deal>).prefSchedule = rows; sched = rows.length; }
      } catch { /* no schedule in this file — fine */ }
      const n = Object.keys(patch).length;
      if (n) {
        onUpdate(deal.id, patch);
        const bits = [n - (sched ? 1 : 0) > 0 ? `${n - (sched ? 1 : 0)} field${n - (sched ? 1 : 0) === 1 ? "" : "s"}` : "", sched ? `a ${sched}-period balance schedule` : ""].filter(Boolean);
        setMsg(`Filled ${bits.join(" + ")} — review and verify.`);
      } else { setMsg("Read the terms, but every pref-equity field already had a value (nothing overwritten)."); }
    } catch (e) {
      setIsErr(true); setMsg(e instanceof Error ? e.message : "Couldn't read that file.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:10, background:"#f4f8ef", border:"1px dashed #cfe3b8", borderRadius:8, padding:"8px 12px" }}>
      <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv" style={{ display:"none" }}
        onChange={e => { const f = e.target.files?.[0]; if (f) handle(f); }} />
      <button onClick={() => fileRef.current?.click()} disabled={busy}
        style={{ background: busy ? "#dfe9d3" : "#fff", border:"1px solid #8cbf63", color:"#3f7a1f", padding:"6px 12px", borderRadius:7, cursor: busy ? "default" : "pointer", fontSize:12, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
        {busy ? "Reading…" : "⬆ Import pref-equity terms (PDF / Excel)"}
      </button>
      <span style={{ fontSize:11.5, color: isErr ? "#c0392b" : msg ? "#3f7a1f" : "#7d766a", lineHeight:1.4 }}>
        {msg || "Drop a JV agreement or pref term sheet — it fills the blank fields below."}
      </span>
    </div>
  );
}

// ── Preferred-equity accrual schedule / current accrued balance ──────────────
function PrefScheduleCard({ deal }: { deal: Deal }) {
  const [showAll, setShowAll] = useState(false);
  const rows = deal.prefSchedule || [];
  const { balance, row } = useMemo(() => currentBalanceFromRows(rows), [rows]);
  const fmt$ = (v: number | null | undefined) => v == null ? "—" : `$${Math.round(v).toLocaleString()}`;
  // Monthly, windowed on the closest upcoming period; expand for the full schedule.
  const nowMs = Date.now();
  const currentIdx = (() => {
    for (let i = 0; i < rows.length; i++) { const t = new Date(rows[i].date).getTime(); if (!isNaN(t) && t >= nowMs) return i; }
    return rows.length ? rows.length - 1 : 0;
  })();
  const PREVIEW = 6;
  const shown = showAll ? rows : rows.slice(currentIdx, currentIdx + PREVIEW);
  const currentDate = rows[currentIdx]?.date;
  const currentRowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (showAll) currentRowRef.current?.scrollIntoView({ block: "center" }); }, [showAll]);

  return (
    <div style={{ marginTop:8, background:"#faf8f3", border:"1px solid #efe8da", borderRadius:10, padding:"12px 14px" }}>
      <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", gap:12, flexWrap:"wrap", marginBottom:8 }}>
        <div>
          <div style={{ fontSize:10.5, color:"#a69e91", fontWeight:600, textTransform:"uppercase", letterSpacing:"0.04em", marginBottom:3 }}>Current Accrued Pref Balance (today)</div>
          <div style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:600, color:"#383a37" }}>{fmt$(balance)}</div>
          {row?.date && <div style={{ fontSize:10, color:"#a69e91", marginTop:2 }}>as of {row.date}</div>}
        </div>
        <span style={{ fontSize:10, color:"#bcae97", maxWidth:240, lineHeight:1.4, textAlign:"right" }}>From the uploaded pref schedule — the unreturned preferred balance plus accrued return.</span>
      </div>
      {shown.length > 0 && (
        <div style={{ overflowX:"auto", maxHeight: showAll ? 280 : undefined, overflowY: showAll ? "auto" : undefined, border:"1px solid #f0e9da", borderRadius:8 }}>
          <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11.5 }}>
            <thead>
              <tr style={{ fontSize:9, color:"#a69e91", fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", background:"#fff" }}>
                <th style={{ textAlign:"left", padding:"6px 8px" }}>Date</th>
                <th style={{ textAlign:"right", padding:"6px 8px" }}>Payment</th>
                <th style={{ textAlign:"right", padding:"6px 8px" }}>Balance</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r, i) => {
                const isCurrent = currentDate && r.date === currentDate;
                return (
                  <tr key={r.date + i} ref={isCurrent ? currentRowRef : undefined} style={{ borderTop:"1px solid #f5efe2", background: isCurrent ? "#eef5e8" : undefined }}>
                    <td style={{ padding:"6px 8px", color: isCurrent ? "#2d5a0e" : "#52554e", fontWeight: isCurrent ? 700 : 400, whiteSpace:"nowrap" }}>{r.date}{isCurrent ? <span style={{ color:"#3f7a1f", fontWeight:700 }}> · next</span> : null}</td>
                    <td style={{ padding:"6px 8px", textAlign:"right", color:"#7d766a" }}>{fmt$(r.payment)}</td>
                    <td style={{ padding:"6px 8px", textAlign:"right", color:"#383a37", fontWeight:500 }}>{fmt$(r.balance)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {(rows.length > shown.length || showAll) && (
        <button onClick={() => setShowAll(s => !s)}
          style={{ marginTop:8, background:"transparent", border:"none", color:"#6dba43", cursor:"pointer", fontSize:11.5, fontWeight:600, padding:0 }}>
          {showAll ? "▾ Show fewer" : `▸ Show all ${rows.length} periods (past & future)`}
        </button>
      )}
    </div>
  );
}

// ── Amortization schedule / current balance ──────────────────────────────────
// Builds a level-payment schedule from the loan terms to show today's balance,
// or uses a lender-provided schedule when one is uploaded.
function AmortizationCard({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  // Resolve the rate the generated schedule should use: the loan's stated rate,
  // else the hedging swap's fixed rate, else (for a floating loan) current 1-mo
  // SOFR + the loan's spread — so a blank debtRate never yields a $0-interest table.
  const swapRate = deal.interestRateSwap?.fixedRatePct;
  const loanRate = Number(deal.debtRate) > 0 ? Number(deal.debtRate) : null;
  const baseRate = loanRate ?? (swapRate != null && swapRate > 0 ? swapRate : null);
  const spreadPct = deal.debtSpread != null && !isNaN(Number(deal.debtSpread))
    ? (Number(deal.debtSpread) > 25 ? Number(deal.debtSpread) / 100 : Number(deal.debtSpread)) // accept bps or %
    : null;
  const needSofr = baseRate == null && spreadPct != null;
  const [sofr, setSofr] = useState<number | null>(null);
  useEffect(() => {
    if (!needSofr) return;
    let alive = true;
    apiGetRates().then(r => { if (!alive) return; const row = r.sofr?.rows?.[0]; if (row && typeof row.value === "number") setSofr(row.value); }).catch(() => {});
    return () => { alive = false; };
  }, [needSofr]);
  const effRate = baseRate ?? (sofr != null && spreadPct != null ? Math.round((sofr + spreadPct) * 1000) / 1000 : null);
  const rateNote = loanRate != null ? null
    : (swapRate != null && swapRate > 0) ? `Interest computed from the swap's ${swapRate}% fixed rate.`
    : (effRate != null) ? `No fixed rate on file — interest computed from current 1-mo SOFR + ${spreadPct}% spread ≈ ${effRate}% (floating, indicative).`
    : null;

  const result = useMemo(() => amortForDeal(deal, null, effRate), [
    deal.customAmortSchedule, deal.debtLoanAmount, deal.debtRate, deal.debtAmortYears, deal.debtIOPeriod, deal.debtOriginationDate, deal.interestRateSwap, effRate,
  ]);
  const fmt$ = (v: number | null | undefined) => v == null ? "—" : `$${Math.round(v).toLocaleString()}`;

  const upload = async (file: File) => {
    setBusy(true); setErr(null);
    try {
      const { text } = await extractAnyFile(file);
      const rows = await extractAmortSchedule(text);
      onUpdate(deal.id, { customAmortSchedule: rows });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Couldn't read that schedule.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const rows = result.rows;
  // Monthly view, windowed on the closest UPCOMING payment ("today"). Collapsed
  // starts at that payment and shows the next ~12 months; expanding reveals the
  // full schedule (past + future), scrolled to the current payment.
  const nowMs = Date.now();
  // The "current" row = first payment dated today-or-later. If no row carries a
  // real date (e.g. no origination date on file), there's no "next payment" to
  // highlight — start the window at the first payment instead.
  const hasDates = rows.some(r => !isNaN(new Date(r.date).getTime()));
  const currentIdx = (() => {
    if (!hasDates) return 0;
    for (let i = 0; i < rows.length; i++) { const t = new Date(rows[i].date).getTime(); if (!isNaN(t) && t >= nowMs) return i; }
    return rows.length ? rows.length - 1 : 0;
  })();
  const AMORT_PREVIEW = 6;
  // Always show a full window of AMORT_PREVIEW rows around the current payment —
  // clamp the start so we don't end up with a single row near the end.
  const windowStart = Math.min(currentIdx, Math.max(0, rows.length - AMORT_PREVIEW));
  const shown = showAll ? rows : rows.slice(windowStart, windowStart + AMORT_PREVIEW);
  const currentDate = hasDates ? rows[currentIdx]?.date : undefined;
  const currentRowRef = useRef<HTMLTableRowElement>(null);
  useEffect(() => { if (showAll) currentRowRef.current?.scrollIntoView({ block: "center" }); }, [showAll]);

  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap", marginBottom:10 }}>
        <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>Amortization &amp; Current Balance</div>
        <div>
          <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.csv" style={{ display:"none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) upload(f); }} />
          <button onClick={() => fileRef.current?.click()} disabled={busy}
            style={{ background: busy ? "#e9e3d6" : "#fff", border:"1px solid #c8b89a", color:"#5c5047", padding:"5px 11px", borderRadius:7, cursor: busy ? "default" : "pointer", fontSize:11.5, fontWeight:600 }}>
            {busy ? "Reading…" : deal.customAmortSchedule?.length ? "Replace schedule" : "Upload amortization schedule"}
          </button>
        </div>
      </div>
      {err && <div style={{ fontSize:11, color:"#c0392b", marginBottom:6 }}>{err}</div>}

      {result.error ? (
        <div style={{ fontSize:12, color:"#9a917f", lineHeight:1.5 }}>{result.error} (or upload the lender's amortization schedule).</div>
      ) : (
        <>
          <div style={{ display:"flex", gap:24, flexWrap:"wrap", alignItems:"flex-end", marginBottom:12 }}>
            <div>
              <div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:3 }}>Current Balance (today)</div>
              <div style={{ fontFamily:"'Fraunces',serif", fontSize:24, fontWeight:600, color:"#383a37" }}>{fmt$(result.currentBalance)}</div>
            </div>
            {result.payment != null && (
              <div>
                <div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:3 }}>{Number(deal.debtIOPeriod) > 0 ? "Payment (post-IO)" : "Monthly Payment"}</div>
                <div style={{ fontFamily:"'Fraunces',serif", fontSize:18, fontWeight:600, color:"#52554e" }}>{fmt$(result.payment)}</div>
              </div>
            )}
            {result.currentBalance != null && Number(deal.debtLoanAmount) > 0 && (
              <button onClick={() => onUpdate(deal.id, { loanBalance: Math.round(result.currentBalance!) })}
                style={{ background:"#fff", border:"1px solid #8cbf63", color:"#3f7a1f", padding:"6px 12px", borderRadius:7, cursor:"pointer", fontSize:11.5, fontWeight:600, alignSelf:"center" }}>
                Set as loan balance
              </button>
            )}
          </div>

          <div style={{ fontSize:10.5, color:"#a69e91", marginBottom:8 }}>
            {result.basis === "uploaded" ? "From your uploaded schedule." : "Generated from the loan terms."}
            {result.basis !== "uploaded" && rateNote ? ` ${rateNote}` : ""}
            {result.assumptions.length > 0 && ` ${result.assumptions.join(" ")}`}
          </div>

          {shown.length > 0 && (
            <div style={{ overflowX:"auto", maxHeight: showAll ? 320 : undefined, overflowY: showAll ? "auto" : undefined, border:"1px solid #f0e9da", borderRadius:8 }}>
              <table style={{ width:"100%", borderCollapse:"collapse", fontSize:11.5 }}>
                <thead>
                  <tr style={{ fontSize:9, color:"#a69e91", fontWeight:700, letterSpacing:"0.06em", textTransform:"uppercase", background:"#faf7f0" }}>
                    <th style={{ textAlign:"left", padding:"6px 8px" }}>Payment Date</th>
                    <th style={{ textAlign:"right", padding:"6px 8px" }}>Interest</th>
                    <th style={{ textAlign:"right", padding:"6px 8px" }}>Principal</th>
                    <th style={{ textAlign:"right", padding:"6px 8px" }}>Balance</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.map((r, i) => {
                    const isCurrent = currentDate && r.date === currentDate;
                    return (
                      <tr key={r.date + i} ref={isCurrent ? currentRowRef : undefined} style={{ borderTop:"1px solid #f5efe2", background: isCurrent ? "#eef5e8" : undefined }}>
                        <td style={{ padding:"6px 8px", color: isCurrent ? "#2d5a0e" : "#52554e", fontWeight: isCurrent ? 700 : 400, whiteSpace:"nowrap" }}>{r.date}{isCurrent ? <span style={{ color:"#3f7a1f", fontWeight:700 }}> · next payment</span> : null}</td>
                        <td style={{ padding:"6px 8px", textAlign:"right", color:"#7d766a" }}>{fmt$(r.interest)}</td>
                        <td style={{ padding:"6px 8px", textAlign:"right", color:"#7d766a" }}>{fmt$(r.principal)}</td>
                        <td style={{ padding:"6px 8px", textAlign:"right", color:"#383a37", fontWeight:500 }}>{fmt$(r.balance)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > shown.length || showAll ? (
            <button onClick={() => setShowAll(s => !s)}
              style={{ marginTop:8, background:"transparent", border:"none", color:"#6dba43", cursor:"pointer", fontSize:11.5, fontWeight:600, padding:0 }}>
              {showAll ? "▾ Show fewer" : `▸ Show all ${rows.length} payments (past & future)`}
            </button>
          ) : null}
          <div style={{ marginTop:10, fontSize:10, color:"#bcae97", lineHeight:1.5 }}>
            {result.basis === "generated" ? "Estimate — assumes a fixed rate and level amortization. Upload the lender's schedule for the exact balance." : "Read from your uploaded schedule."}
          </div>
        </>
      )}
    </div>
  );
}

// ── Prepayment penalty calculator ────────────────────────────────────────────
// Estimates the prepay penalty as of a payoff date from the deal's structured
// prepayTerms (extracted from a term sheet, or set by hand). Exact for step-down;
// indicative for yield-maintenance/defeasance using a current Treasury rate.
function PrepayCalculator({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  const [payoff, setPayoff] = useState<string>(new Date().toISOString().slice(0, 10));
  const [reinvest, setReinvest] = useState<number | null>(null);
  const terms = deal.prepayTerms || null;
  const needsRate = terms?.type === "yield_maintenance" || terms?.type === "defeasance";

  // Pull a current matching-tenor Treasury for YM/defeasance estimates.
  useEffect(() => {
    if (!needsRate) return;
    let alive = true;
    apiGetRates().then(r => {
      if (!alive) return;
      // Pick the Treasury tenor closest to the loan's remaining term.
      const mat = deal.debtMaturityDate ? new Date(deal.debtMaturityDate) : null;
      const yrsLeft = mat ? Math.max(0, (mat.getTime() - new Date(payoff).getTime()) / (365.25 * 864e5)) : 7;
      const tenors: Array<[string, number]> = [["1-Yr",1],["2-Yr",2],["3-Yr",3],["5-Yr",5],["7-Yr",7],["10-Yr",10],["30-Yr",30]];
      const best = tenors.reduce((a, b) => Math.abs(b[1]-yrsLeft) < Math.abs(a[1]-yrsLeft) ? b : a);
      const row = r.treasuries.rows.find(x => x.label === best[0]);
      setReinvest(row?.value ?? null);
    }).catch(() => {});
    return () => { alive = false; };
  }, [needsRate, payoff, deal.debtMaturityDate]);

  // Penalty is assessed on the OUTSTANDING balance at payoff, not the original
  // loan — for an amortizing loan those differ (IO loans are unchanged).
  const payoffBalance = useMemo(() => amortForDeal(deal, payoff).currentBalance, [deal, payoff]);
  const result = calcPrepay(terms, prepayInputsFromDeal(deal, payoff, reinvest, payoffBalance));
  const setType = (type: NonNullable<Deal["prepayTerms"]>["type"]) =>
    onUpdate(deal.id, { prepayTerms: { ...(terms || {}), type } });

  // ── Interest-rate swap breakage ────────────────────────────────────────────
  const swap = deal.interestRateSwap || null;
  const [swapRate, setSwapRate] = useState<number | null>(null);
  const [swapRateTouched, setSwapRateTouched] = useState(false);
  const swapFileRef = useRef<HTMLInputElement>(null);
  const [swapBusy, setSwapBusy] = useState(false);
  const [swapErr, setSwapErr] = useState<string | null>(null);

  // Seed the market swap rate from the live SOFR SWAP curve in Today's Rates
  // (Iron Hound 3/5/10-yr par swap rates — the actual rates swaps price off of),
  // interpolated to the remaining term, until the user types their bank's quote.
  // Breakage is brutally sensitive to this input: the locked fixed rate is all-in
  // (SOFR swap rate + credit spread), so we compare against the current swap rate
  // PLUS the same spread. Using the Treasury curve here understates the swap by the
  // Treasury-vs-swap basis (~25-35 bps), which flips the breakage sign on near-the-
  // money swaps — so we use the swap curve and fall back to Treasuries only if the
  // swap feed is unavailable.
  useEffect(() => {
    if (!swap?.terminationDate || swapRateTouched) return;
    let alive = true;
    apiGetRates().then(r => {
      if (!alive) return;
      const term = new Date(swap.terminationDate!);
      const yrsLeft = Math.max(0, (term.getTime() - new Date(payoff).getTime()) / (365.25 * 864e5));
      const spread = (swap.floatingSpreadBps ?? 0) / 100;

      // Pull (tenorYears, rate) points from the SOFR swap rows ("SOFR Swap – 3 Year",
      // "… 3 Year (est.)", "… 5 Year", "… 10 Year") and interpolate to yrsLeft.
      const swapPts = (r.swaps?.rows ?? [])
        .map(x => { const m = /(\d+)\s*Year/i.exec(x.label || ""); return m && x.value != null ? [Number(m[1]), x.value] as [number, number] : null; })
        .filter((p): p is [number, number] => !!p)
        .sort((a, b) => a[0] - b[0]);

      const interp = (pts: [number, number][], t: number): number | null => {
        if (!pts.length) return null;
        if (t <= pts[0][0]) return pts[0][1];                       // clamp below shortest tenor (e.g. 2.5y → 3y swap)
        if (t >= pts[pts.length - 1][0]) return pts[pts.length - 1][1];
        for (let i = 1; i < pts.length; i++) {
          const [x0, y0] = pts[i - 1], [x1, y1] = pts[i];
          if (t <= x1) return y0 + (y1 - y0) * ((t - x0) / (x1 - x0));
        }
        return pts[pts.length - 1][1];
      };

      let mkt = interp(swapPts, yrsLeft);
      // Fallback only if the live swap feed is empty: matching-tenor Treasury proxy
      // (rougher — carries the swap-spread basis error, but better than nothing).
      if (mkt == null) {
        const tenors: Array<[string, number]> = [["1-Yr",1],["2-Yr",2],["3-Yr",3],["5-Yr",5],["7-Yr",7],["10-Yr",10],["30-Yr",30]];
        const best = tenors.reduce((a, b) => Math.abs(b[1]-yrsLeft) < Math.abs(a[1]-yrsLeft) ? b : a);
        mkt = r.treasuries.rows.find(x => x.label === best[0])?.value ?? null;
      }
      if (mkt != null) setSwapRate(Math.round((mkt + spread) * 100) / 100);
    }).catch(() => {});
    return () => { alive = false; };
  }, [swap?.terminationDate, swap?.floatingSpreadBps, payoff, swapRateTouched]);

  const importSwap = async (file: File) => {
    setSwapBusy(true); setSwapErr(null);
    try {
      const { text } = await extractAnyFile(file);
      const parsed = await extractSwap(text);
      // Sets the loan's all-in rate to the swap fixed rate (editable in the Debt
      // fields above), defaults the loan to Senior, and gap-fills the rest.
      onUpdate(deal.id, buildSwapPatch(deal, parsed));
    } catch (e) {
      setSwapErr(e instanceof Error ? e.message : "Couldn't read the swap confirmation.");
    } finally {
      setSwapBusy(false);
      if (swapFileRef.current) swapFileRef.current.value = "";
    }
  };
  // Manual swap entry / edit. For a hedged loan with no confirmation PDF, type the
  // terms (pre-filled from the loan's debt fields). The same form also EDITS an
  // already-imported swap, so an extraction error can be corrected by hand.
  const [manualOpen, setManualOpen] = useState(false);
  const [manualDraft, setManualDraft] = useState({ notional: "", fixedRatePct: "", terminationDate: "", floatingSpreadBps: "", floatingIndex: "", counterparty: "" });
  const openManualSwap = () => {
    setSwapErr(null);
    setManualDraft({
      notional: deal.debtLoanAmount != null ? String(deal.debtLoanAmount) : "",
      fixedRatePct: deal.debtRate != null ? String(deal.debtRate) : "",
      terminationDate: deal.debtMaturityDate || "",
      floatingSpreadBps: deal.debtSpread != null ? String(Math.round(Number(deal.debtSpread))) : "", // debtSpread is already in bps
      floatingIndex: deal.debtIndex || "",
      counterparty: deal.debtLender || "",
    });
    setManualOpen(true);
  };
  const openEditSwap = () => {
    if (!swap) return;
    setSwapErr(null);
    setManualDraft({
      notional: swap.notional != null ? String(swap.notional) : "",
      fixedRatePct: swap.fixedRatePct != null ? String(swap.fixedRatePct) : "",
      terminationDate: swap.terminationDate || "",
      floatingSpreadBps: swap.floatingSpreadBps != null ? String(Math.round(Number(swap.floatingSpreadBps))) : "",
      floatingIndex: swap.floatingIndex || "",
      counterparty: swap.counterparty || "",
    });
    setManualOpen(true);
  };
  const saveManualSwap = () => {
    const num = (v: string) => { const n = Number(v.replace(/[,$\s]/g, "")); return v.trim() === "" || isNaN(n) ? null : n; };
    const notional = num(manualDraft.notional);
    const fixedRatePct = num(manualDraft.fixedRatePct);
    const terminationDate = manualDraft.terminationDate || null;
    if (notional == null || fixedRatePct == null || !terminationDate) {
      setSwapErr("Enter notional, fixed rate, and termination date to estimate breakage.");
      return;
    }
    const sw: InterestRateSwap = {
      // When editing, keep the imported swap's other fields (trade date, day-count,
      // confirmation ref, etc.); when new, seed effective date / notes from the loan.
      ...(swap || { effectiveDate: deal.debtOriginationDate || null, notes: "Entered manually — no swap confirmation on file." }),
      notional, fixedRatePct, terminationDate,
      floatingSpreadBps: num(manualDraft.floatingSpreadBps),
      floatingIndex: manualDraft.floatingIndex.trim() || null,
      counterparty: manualDraft.counterparty.trim() || null,
      payFixed: swap?.payFixed ?? true,
    };
    onUpdate(deal.id, buildSwapPatch(deal, sw));
    setManualOpen(false);
  };

  const breakage = calcSwapBreakage(swap, { valuationDate: payoff, marketSwapRatePct: swapRate });
  const fmt$ = (v: number | null) => v == null ? "—" : `$${Math.round(v).toLocaleString()}`;
  const basisColor = result.basis === "exact" ? "#0f9d63" : result.basis === "estimate" ? "#b08a3e" : result.basis === "locked" ? "#dc2626" : "#7d766a";
  const swapColor = breakage.direction === "credit" ? "#0f9d63" : breakage.direction === "cost" ? "#c0392b" : "#7d766a";

  // A swapped loan's early-payoff economics ARE the swap breakage — the underlying
  // floating note is prepayable at par — so we show ONE of the two, never both (and
  // never a combined total that would double-count). Swap present → swap breakage;
  // otherwise → the prepayment penalty from the loan doc's structured terms.
  return (
    <div>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap", marginBottom:10 }}>
        <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>
          {swap ? "Swap Breakage — Early Payoff" : "Prepayment Penalty"}
        </div>
        <div style={{ display:"flex", gap:8, flexWrap:"wrap" }}>
          {!swap && (
            <button onClick={openManualSwap}
              style={{ background:"#fff", border:"1px solid #c8b89a", color:"#5c5047", padding:"5px 11px", borderRadius:7, cursor:"pointer", fontSize:11.5, fontWeight:600 }}>
              Enter swap manually
            </button>
          )}
          {swap && (
            <button onClick={openEditSwap}
              style={{ background:"#fff", border:"1px solid #c8b89a", color:"#5c5047", padding:"5px 11px", borderRadius:7, cursor:"pointer", fontSize:11.5, fontWeight:600 }}>
              Edit terms
            </button>
          )}
          <input ref={swapFileRef} type="file" accept=".pdf" style={{ display:"none" }}
            onChange={e => { const f = e.target.files?.[0]; if (f) importSwap(f); }} />
          <button onClick={() => swapFileRef.current?.click()} disabled={swapBusy}
            style={{ background: swapBusy ? "#e9e3d6" : "#fff", border:"1px solid #c8b89a", color:"#5c5047", padding:"5px 11px", borderRadius:7, cursor: swapBusy ? "default" : "pointer", fontSize:11.5, fontWeight:600 }}>
            {swapBusy ? "Reading…" : swap ? "Replace swap confirmation" : "Import swap confirmation"}
          </button>
        </div>
      </div>
      {swapErr && <div style={{ fontSize:11, color:"#c0392b", marginBottom:6 }}>{swapErr}</div>}

      {/* Shared payoff date; prepay-type selector only when there's no swap. */}
      <div style={{ display:"flex", gap:14, flexWrap:"wrap", alignItems:"flex-end", marginBottom:12 }}>
        <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"#7d766a" }}>
          Payoff date
          <input type="date" value={payoff} onChange={e => setPayoff(e.target.value)}
            style={{ background:"#f5f1e8", border:"1px solid #e6dfd0", borderRadius:8, padding:"8px 10px", fontSize:13, color:"#383a37" }}/>
        </label>
        {!swap && (
          <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"#7d766a" }}>
            Prepay type (from loan docs)
            <select value={terms?.type || "none"} onChange={e => setType(e.target.value as NonNullable<Deal["prepayTerms"]>["type"])}
              style={{ background:"#f5f1e8", border:"1px solid #e6dfd0", borderRadius:8, padding:"8px 10px", fontSize:13, color:"#383a37" }}>
              <option value="none">None / open</option>
              <option value="stepdown">Step-down %</option>
              <option value="yield_maintenance">Yield maintenance</option>
              <option value="defeasance">Defeasance</option>
              <option value="lockout_open">Lockout then open</option>
              <option value="other">Other</option>
            </select>
          </label>
        )}
        {!swap && needsRate && (
          <div style={{ fontSize:11, color:"#7d766a" }}>
            Reinvestment (Treasury): <span style={{ fontWeight:600, color:"#383a37" }}>{reinvest != null ? `${reinvest.toFixed(2)}%` : "loading…"}</span>
          </div>
        )}
      </div>

      {manualOpen && (
        <div style={{ background:"#fbf8f1", border:"1px solid #e0d2b4", borderRadius:10, padding:"12px 14px", marginBottom:12 }}>
          <div style={{ fontSize:11.5, fontWeight:600, color:"#5c5047", marginBottom:8 }}>{swap ? "Edit swap terms" : "Enter swap terms (no confirmation needed)"}</div>
          <div style={{ display:"flex", gap:12, flexWrap:"wrap", alignItems:"flex-end" }}>
            <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"#7d766a" }}>
              Notional ($)
              <input value={manualDraft.notional} onChange={e => setManualDraft(d => ({ ...d, notional: e.target.value }))} placeholder="e.g. 25,000,000"
                style={{ background:"#fff", border:"1px solid #e6dfd0", borderRadius:8, padding:"8px 10px", fontSize:13, color:"#383a37", width:150 }}/>
            </label>
            <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"#7d766a" }}>
              Swap fixed rate (%)
              <input value={manualDraft.fixedRatePct} onChange={e => setManualDraft(d => ({ ...d, fixedRatePct: e.target.value }))} placeholder="e.g. 5.10"
                style={{ background:"#fff", border:"1px solid #e6dfd0", borderRadius:8, padding:"8px 10px", fontSize:13, color:"#383a37", width:120 }}/>
            </label>
            <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"#7d766a" }}>
              Termination date
              <input type="date" value={manualDraft.terminationDate} onChange={e => setManualDraft(d => ({ ...d, terminationDate: e.target.value }))}
                style={{ background:"#fff", border:"1px solid #e6dfd0", borderRadius:8, padding:"8px 10px", fontSize:13, color:"#383a37" }}/>
            </label>
            <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"#7d766a" }}>
              Floating index (optional)
              <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                <input value={manualDraft.floatingIndex} onChange={e => setManualDraft(d => ({ ...d, floatingIndex: e.target.value }))} placeholder="e.g. USD-SOFR CME Term 1M"
                  style={{ background:"#fff", border:"1px solid #e6dfd0", borderRadius:8, padding:"8px 10px", fontSize:13, color:"#383a37", width:200 }}/>
                {(() => {
                  const v = manualDraft.floatingIndex.trim();
                  if (!v) return null;
                  const rec = recognizeRateIndex(v);
                  if (!rec) return (
                    <span title="Not a recognized rate index — double-check the name/tenor (e.g. 'USD-SOFR CME Term 1M', 'WSJ Prime', 'Fed Funds')"
                      style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, fontWeight:700, whiteSpace:"nowrap", color:"#b3403f" }}>
                      ⚠ unrecognized
                    </span>
                  );
                  return (
                    <span title={rec.note ? `${rec.label} — ${rec.note}` : `Recognized rate index: ${rec.label}`}
                      style={{ display:"inline-flex", alignItems:"center", gap:3, fontSize:11, fontWeight:700, whiteSpace:"nowrap", color: rec.warn ? "#9a6a12" : "#3f7a1f" }}>
                      {rec.warn ? "⚠" : "✓"} {rec.label}
                    </span>
                  );
                })()}
              </div>
            </label>
            <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"#7d766a" }}>
              Floating spread (bps, optional)
              <input value={manualDraft.floatingSpreadBps} onChange={e => setManualDraft(d => ({ ...d, floatingSpreadBps: e.target.value }))} placeholder="e.g. 200"
                style={{ background:"#fff", border:"1px solid #e6dfd0", borderRadius:8, padding:"8px 10px", fontSize:13, color:"#383a37", width:140 }}/>
            </label>
            <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"#7d766a" }}>
              Dealer / counterparty (optional)
              <input value={manualDraft.counterparty} onChange={e => setManualDraft(d => ({ ...d, counterparty: e.target.value }))} placeholder="e.g. Webster Bank, N.A."
                style={{ background:"#fff", border:"1px solid #e6dfd0", borderRadius:8, padding:"8px 10px", fontSize:13, color:"#383a37", width:200 }}/>
            </label>
            <div style={{ display:"flex", gap:8 }}>
              <button onClick={saveManualSwap}
                style={{ background:"#3f7a1f", border:"none", color:"#fff", padding:"8px 14px", borderRadius:7, cursor:"pointer", fontSize:12, fontWeight:600 }}>
                {swap ? "Save terms" : "Calculate breakage"}
              </button>
              <button onClick={() => { setManualOpen(false); setSwapErr(null); }}
                style={{ background:"#fff", border:"1px solid #ddd4c2", color:"#7d766a", padding:"8px 14px", borderRadius:7, cursor:"pointer", fontSize:12 }}>
                Cancel
              </button>
            </div>
          </div>
          <div style={{ marginTop:8, fontSize:10, color:"#bcae97", lineHeight:1.5 }}>
            Notional usually equals the loan amount, the fixed rate is your locked swap rate, and termination is the swap/loan maturity. The current market swap rate is filled in automatically from Today's Rates once you save — replace it with your bank's quote for a tighter estimate.
          </div>
        </div>
      )}

      {!swap ? (
        <>
          <div style={{ background:"#faf7f0", border:`1px solid ${basisColor}33`, borderRadius:10, padding:"12px 14px" }}>
            <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
              <span style={{ fontSize:12.5, fontWeight:600, color:"#383a37" }}>{result.label}</span>
              <span style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:600, color:basisColor }}>
                {fmt$(result.penalty)}{result.pct != null ? <span style={{ fontSize:13, color:"#a69e91", marginLeft:6 }}>({result.pct}%)</span> : null}
              </span>
            </div>
            {result.detail && <div style={{ fontSize:11.5, color:"#6f6a5f", marginTop:5, lineHeight:1.5 }}>{result.detail}</div>}
            {result.warnings.map((w, i) => <div key={i} style={{ fontSize:10.5, color:"#b08a3e", marginTop:4 }}>⚠ {w}</div>)}
          </div>
          {terms?.type === "stepdown" && (
            <div style={{ marginTop:8, fontSize:11, color:"#7d766a" }}>
              Step-down schedule (%, by loan year):
              <input value={(terms.stepdown || []).join(", ")}
                onChange={e => onUpdate(deal.id, { prepayTerms: { ...terms, stepdown: e.target.value.split(",").map(s => Number(s.trim())).filter(n => !isNaN(n)) } })}
                placeholder="e.g. 5, 4, 3, 2, 1"
                style={{ marginLeft:8, background:"#fff", border:"1px solid #e6dfd0", borderRadius:7, padding:"5px 9px", fontSize:12, width:180 }}/>
            </div>
          )}
          <div style={{ marginTop:8, fontSize:10, color:"#bcae97", lineHeight:1.5 }}>Reflects the prepayment terms in the loan documents. Step-down is exact; yield-maintenance & defeasance are indicative estimates (servicer conventions vary — confirm before payoff). No swap on file — import a swap confirmation above if this loan is hedged.</div>
        </>
      ) : (
        <>
          {/* Swap terms summary */}
          <div style={{ display:"flex", gap:14, flexWrap:"wrap", fontSize:11.5, color:"#6f6a5f", marginBottom:10 }}>
            <span>Notional <b style={{ color:"#383a37" }}>{fmt$(swap.notional ?? null)}</b></span>
            <span>Fixed <b style={{ color:"#383a37" }}>{swap.fixedRatePct != null ? `${swap.fixedRatePct}%` : "—"}</b></span>
            {swap.floatingIndex && <span>Float <b style={{ color:"#383a37" }}>{swap.floatingIndex}{swap.floatingSpreadBps != null ? ` + ${(swap.floatingSpreadBps/100).toFixed(2)}%` : ""}</b>{(() => {
              const rec = recognizeRateIndex(swap.floatingIndex);
              if (!rec) return <span title="Not a recognized rate index — double-check the name/tenor" style={{ marginLeft:4, fontWeight:700, color:"#b3403f" }}>⚠ unrecognized</span>;
              return <span title={rec.note ? `${rec.label} — ${rec.note}` : `Recognized rate index: ${rec.label}`} style={{ marginLeft:4, fontWeight:700, color: rec.warn ? "#9a6a12" : "#3f7a1f" }}>{rec.warn ? "⚠" : "✓"}</span>;
            })()}</span>}
            <span>Matures <b style={{ color:"#383a37" }}>{swap.terminationDate || "—"}</b></span>
            {swap.counterparty && <span>Dealer <b style={{ color:"#383a37" }}>{swap.counterparty}</b></span>}
          </div>

          <div style={{ display:"flex", gap:14, flexWrap:"wrap", alignItems:"flex-end", marginBottom:10 }}>
            <label style={{ display:"flex", flexDirection:"column", gap:4, fontSize:11, color:"#7d766a" }}>
              Current market swap rate (%)
              <input type="number" step="0.01" value={swapRate ?? ""} onChange={e => { setSwapRateTouched(true); setSwapRate(e.target.value === "" ? null : Number(e.target.value)); }}
                style={{ background:"#f5f1e8", border:"1px solid #e6dfd0", borderRadius:8, padding:"8px 10px", fontSize:13, color:"#383a37", width:140 }}/>
            </label>
            <div style={{ fontSize:10, color:"#bcae97", maxWidth:300, lineHeight:1.5 }}>
              All-in rate (current SOFR swap rate for your remaining term + your {swap.floatingSpreadBps != null ? `${(swap.floatingSpreadBps/100).toFixed(2)}%` : ""} spread), seeded from the live SOFR swap curve in Today's Rates — replace with your bank's actual quote for a tighter estimate. Breakage is very rate-sensitive, so a few bps here moves the number a lot.
            </div>
          </div>

          <div style={{ background:"#faf7f0", border:`1px solid ${swapColor}33`, borderRadius:10, padding:"12px 14px" }}>
            <div style={{ display:"flex", alignItems:"baseline", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
              <span style={{ fontSize:12.5, fontWeight:600, color:"#383a37" }}>{breakage.label}</span>
              <span style={{ fontFamily:"'Fraunces',serif", fontSize:22, fontWeight:600, color:swapColor }}>
                {breakage.value == null ? "—" : `${breakage.value > 0 ? "+" : breakage.value < 0 ? "−" : ""}${fmt$(Math.abs(breakage.value))}`}
              </span>
            </div>
            {breakage.detail && <div style={{ fontSize:11.5, color:"#6f6a5f", marginTop:5, lineHeight:1.5 }}>{breakage.detail}</div>}
            {breakage.direction === "credit" && <div style={{ fontSize:11, color:"#0f9d63", marginTop:4 }}>Rates rose above your locked fixed rate — breaking the swap would pay you.</div>}
            {breakage.direction === "cost" && <div style={{ fontSize:11, color:"#c0392b", marginTop:4 }}>Rates fell below your locked fixed rate — breaking the swap would cost you.</div>}
            {breakage.warnings.map((w, i) => <div key={i} style={{ fontSize:10.5, color:"#b08a3e", marginTop:4 }}>⚠ {w}</div>)}
          </div>
          <div style={{ marginTop:8, fontSize:10, color:"#bcae97", lineHeight:1.5 }}>Swapped loan — the underlying note is prepayable at par, so the early-payoff economics are the swap breakage above (the exact figure is your dealer's mark-to-market). Confirm with the bank before payoff.</div>
        </>
      )}
    </div>
  );
}

// ── Term sheet / closing statement PDF importer ──────────────────────────────
// Only shown on Owned/Sold deals. Extracts acquisition & financing terms via
// the existing server AI proxy and fills BLANK fields only — never overwrites.
function TermSheetImport({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    const taskId = startAiTask(`Reading term sheet — ${deal.propertyName || deal.fileName || "deal"}`, file.name);
    setBusy(true); setStatus("Reading term sheet…");
    try {
      const { text } = await extractAnyFile(file);
      setStatus("Extracting deal terms with AI…");
      // SHARED loan/term-sheet extractor — identical to the global Upload path. Gets
      // the stronger model, the same acquisition + financing schema, structured
      // prepay terms, conflict detection and review flags. buildLoanPatch fills BLANK
      // fields only (never overwrites). (Was a drifted duplicate prompt before.)
      const result = await extractLoan(text);
      const patch = buildLoanPatch(deal, result);
      const n = Object.keys(patch).filter(k => k !== "reviewQuestions").length;
      if (Object.keys(patch).length) onUpdate(deal.id, patch);
      setStatus(n ? `✓ Filled ${n} blank field${n>1?"s":""} from the term sheet — review and verify each before relying on it.` : "No new blank fields found to fill (existing entries were left untouched).");
      finishAiTask(taskId, "done", n ? `Term sheet — filled ${n} blank field${n>1?"s":""}` : "Term sheet read — no new blank fields to fill");
    } catch (err) {
      const m = err instanceof Error ? err.message : "Couldn't read that file — try again.";
      setStatus(m); finishAiTask(taskId, "error", "Couldn't read that term sheet");
    }
    setBusy(false);
  }

  return (
    <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap", marginBottom:14, background:"#fffaf2", border:"1px dashed #e7c48f", borderRadius:10, padding:"10px 14px" }}>
      <input ref={fileRef} type="file" accept="application/pdf" style={{ display:"none" }} onChange={handle}/>
      <button onClick={() => fileRef.current?.click()} disabled={busy}
        style={{ background:busy?"#efe8da":"#fff", border:"1px solid #e7c48f", color:"#9a6a1e", padding:"8px 14px", borderRadius:8, cursor:busy?"default":"pointer", fontSize:12, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
        {busy ? "Importing…" : "⬆ Import term sheet (PDF) to auto-fill blanks"}
      </button>
      <span style={{ fontSize:12, color:status.startsWith("✓")?"#0a7d4f":"#9a6a1e" }}>
        {status || "Upload a signed term sheet or closing statement — it fills empty fields only."}
      </span>
    </div>
  );
}

// ── Inline markdown renderer for PropertyChat responses ──────────────────────
function _pcInlineFmt(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} style={{ background:"#f1eadc", borderRadius:3, padding:"0 4px", fontSize:"0.9em" }}>{p.slice(1, -1)}</code>;
    return p;
  });
}
function _pcMarkdown({ text }: { text: string }) {
  const lines = text.split("\n");
  const els: React.ReactNode[] = [];
  lines.forEach((line, i) => {
    if (line.startsWith("### ")) els.push(<div key={i} style={{ fontWeight:600, fontSize:13, color:"#26281f", marginTop:8, marginBottom:2 }}>{_pcInlineFmt(line.slice(4))}</div>);
    else if (line.startsWith("## ")) els.push(<div key={i} style={{ fontWeight:600, fontSize:14, color:"#26281f", marginTop:10, marginBottom:2 }}>{_pcInlineFmt(line.slice(3))}</div>);
    else if (/^[-*] /.test(line)) els.push(<div key={i} style={{ display:"flex", gap:7, marginLeft:2 }}><span style={{ color:"#6dba43", flexShrink:0 }}>›</span><span>{_pcInlineFmt(line.slice(2))}</span></div>);
    else if (/^\d+\. /.test(line)) { const [num2,...rest] = line.split(". "); els.push(<div key={i} style={{ display:"flex", gap:7, marginLeft:2 }}><span style={{ color:"#a89f8f", flexShrink:0 }}>{num2}.</span><span>{_pcInlineFmt(rest.join(". "))}</span></div>); }
    else if (line === "") els.push(<div key={i} style={{ height:5 }}/>);
    else els.push(<span key={i}>{_pcInlineFmt(line)}<br/></span>);
  });
  return <>{els}</>;
}

// Floating scoped mini-chat — sends only this deal's data to the AI via the
// shared server proxy (same route as the main Analyst chat).
function PropertyChat({ deal, abstracts }: { deal: Deal; abstracts: LeaseAbstract[] }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [msgs, setMsgs] = useState<{ role: "user"|"assistant"; content: string }[]>([]);
  const [thinking, setThinking] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSuggestions) return;
    const handler = (e: MouseEvent) => {
      if (inputWrapRef.current && !inputWrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSuggestions]);
  const { mutateAsync: sendMessage } = useCreateAiMessage();

  useEffect(() => {
    if (open) endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, thinking, open]);

  // Give the assistant the FULL deal record (minus UI-only noise) plus the lease
  // abstracts on file, so it can never be "missing" data that lives on the property
  // — roof, debt, cash flow, income/expense breakdown, demographics, market sale,
  // KPR thesis/review/score, co-tenancy lease risk, tenant sales history, etc. Passing
  // the whole record (rather than a hand-picked subset) keeps it complete as new
  // fields are added.
  const buildContext = () => {
    const rest: Record<string, unknown> = { ...deal };
    for (const k of ["imageMeta", "reviewQuestions", "_processing", "_processingError"]) delete rest[k];
    return { ...rest, leaseAbstracts: abstracts.length ? abstracts : undefined };
  };

  const ask = async (text: string) => {
    if (!text.trim() || thinking) return;
    const next = [...msgs, { role: "user" as const, content: text }];
    setMsgs(next); setInput(""); setThinking(true);
    try {
      const system = `You are a commercial real estate analyst answering questions about ONE specific property. Use ONLY the property data below. If something isn't in the data, say it isn't available rather than guessing. Be concise and specific — cite tenant names, dollar figures, dates, and PSF where relevant.\n\nProperty data (JSON):\n${JSON.stringify(buildContext())}`;
      const resp = await sendMessage({
        data: {
          system,
          messages: next.map(m => ({ role: m.role, content: m.content })),
          max_tokens: 1200,
        }
      });
      const reply = ((resp as any)?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n").trim()
        || (resp as any)?.text
        || "No response.";
      setMsgs(h => [...h, { role: "assistant", content: reply }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Request failed";
      setMsgs(h => [...h, { role: "assistant", content: `Error: ${msg}` }]);
    } finally {
      setThinking(false);
    }
  };

  const suggestions = [
    "What are the biggest lease risks?",
    "Which tenants are on watch?",
    "Summarize the rent roll",
    "What's the WALT?",
    "What are the upside opportunities?",
  ];

  const wide = typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
  return (
    <>
      <button onClick={() => setOpen(o => !o)} title="Ask AI about this property"
        style={{ position:"fixed", bottom:24, right:24, zIndex:160, height:52, padding:"0 20px", borderRadius:26, background:"#6dba43", color:"#1f2b16", border:"none", boxShadow:"0 8px 24px -6px rgba(56,58,55,0.5)", cursor:"pointer", fontSize:14, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", gap:8, fontFamily:"'Inter',sans-serif" }}>
        ✦ Ask about this property
      </button>
      {open && (
        <>
          {/* Backdrop */}
          <div onClick={() => setOpen(false)}
            style={{ position:"fixed", inset:0, zIndex:1100, background:"rgba(38,40,31,0.42)", backdropFilter:"blur(2px)" }} />
          {/* Right-side drawer — half-screen on desktop, full on mobile */}
          <div role="dialog" aria-label="Property assistant"
            style={{ position:"fixed", top:0, right:0, bottom:0, zIndex:1101, width: wide ? "clamp(440px, 42vw, 720px)" : "100vw", background:"#fff", borderLeft: wide ? "1px solid #d8d2c1" : "none", boxShadow:"-8px 0 40px rgba(38,40,31,0.18)", display:"flex", flexDirection:"column", overflow:"hidden", animation:"slideInRight 0.2s ease both" }}>
          {/* Header */}
          <div style={{ padding:"13px 16px", borderBottom:"1px solid #f1eadc", background:"#faf7f0", flexShrink:0, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10 }}>
            <div style={{ minWidth:0 }}>
              <div style={{ fontFamily:"'Fraunces',serif", fontWeight:600, fontSize:15, color:"#26281f" }}>Property assistant</div>
              <div style={{ fontSize:11, color:"#a69e91", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{deal.propertyName || "This property"}</div>
            </div>
            <button onClick={() => setOpen(false)} aria-label="Close"
              style={{ background:"transparent", border:"1px solid #e3dccd", color:"#7d766a", width:32, height:32, borderRadius:8, cursor:"pointer", fontSize:16, lineHeight:1, flexShrink:0, display:"flex", alignItems:"center", justifyContent:"center" }}>✕</button>
          </div>
          {/* Messages */}
          <div style={{ flex:1, overflowY:"auto", padding:"14px 16px", display:"flex", flexDirection:"column", gap:11 }}>
            {msgs.length === 0 && (
              <div style={{ color:"#9a917f", fontSize:12.5, lineHeight:1.6 }}>
                Ask anything about this property — e.g. what a specific tenant pays and their sales. Try:
                <div style={{ display:"flex", flexDirection:"column", gap:6, marginTop:10 }}>
                  {suggestions.map(s => (
                    <button key={s} onClick={() => ask(s)}
                      style={{ textAlign:"left", background:"#f3eee3", border:"1px solid #e7e0d2", borderRadius:9, padding:"7px 11px", fontSize:12, color:"#5c5f57", cursor:"pointer", fontFamily:"'Inter',sans-serif" }}>{s}</button>
                  ))}
                </div>
              </div>
            )}
            {msgs.map((m, i) => (
              m.role === "user"
                ? <div key={i} style={{ alignSelf:"flex-end", background:"#383a37", color:"#fff", borderRadius:"12px 12px 4px 12px", padding:"8px 12px", fontSize:13, maxWidth:"85%" }}>{m.content}</div>
                : <div key={i} style={{ alignSelf:"flex-start", background:"#f5f1e8", borderRadius:"12px 12px 12px 4px", padding:"10px 13px", fontSize:13, color:"#383a37", maxWidth:"92%", lineHeight:1.55 }}><_pcMarkdown text={m.content}/></div>
            ))}
            {thinking && <div style={{ alignSelf:"flex-start", color:"#a69e91", fontSize:12.5 }}>Thinking…</div>}
            <div ref={endRef}/>
          </div>
          {/* Input */}
          <div ref={inputWrapRef} style={{ borderTop:"1px solid #f1eadc", padding:"10px 12px", display:"flex", gap:7, flexShrink:0, position:"relative" }}>
            {showSuggestions && (
              <div style={{ position:"absolute", bottom:"100%", left:12, right:12, background:"#fff", border:"1px solid #e3dccd", borderRadius:10, boxShadow:"0 4px 16px rgba(56,58,55,0.13)", overflow:"hidden", zIndex:10 }}>
                {suggestions.map(s => (
                  <button key={s}
                    onMouseDown={e => { e.preventDefault(); setInput(s); setShowSuggestions(false); }}
                    style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", borderBottom:"1px solid #f1eadc", padding:"9px 12px", fontSize:12.5, color:"#5c5f57", cursor:"pointer", fontFamily:"'Inter',sans-serif", lineHeight:1.4 }}
                    onMouseEnter={e => (e.currentTarget.style.background = "#faf7f0")}
                    onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                  >{s}</button>
                ))}
              </div>
            )}
            <input value={input}
              onChange={e => { setInput(e.target.value); if (e.target.value) setShowSuggestions(false); }}
              onFocus={() => { if (!input) setShowSuggestions(true); }}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); setShowSuggestions(false); ask(input); } if (e.key === "Escape") setShowSuggestions(false); }}
              disabled={thinking} placeholder="Ask about this property…"
              style={{ flex:1, background:"#fff", border:"1px solid #e3dccd", borderRadius:9, padding:"9px 12px", fontSize:13, color:"#383a37", outline:"none", fontFamily:"'Inter',sans-serif" }}/>
            <button onClick={() => { setShowSuggestions(false); ask(input); }} disabled={thinking || !input.trim()}
              style={{ background:(!thinking && input.trim()) ? "#6dba43" : "#efe8da", color:(!thinking && input.trim()) ? "#1f2b16" : "#b3aa9b", border:"none", borderRadius:9, padding:"0 15px", fontSize:15, fontWeight:700, cursor:(!thinking && input.trim()) ? "pointer" : "default" }}>↑</button>
          </div>
          </div>
        </>
      )}
    </>
  );
}

function PriceCapEditor({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  function commaFmt(v: string): string {
    const stripped = v.replace(/,/g, "");
    const num = parseFloat(stripped);
    if (!stripped || isNaN(num)) return v;
    return Math.round(num).toLocaleString("en-US");
  }
  const [price, setPrice] = useState<string>(deal.askingPrice != null ? Math.round(deal.askingPrice).toLocaleString("en-US") : "");
  const [cap, setCap] = useState<string|number>(deal.capRate ?? "");
  useEffect(() => { setPrice(deal.askingPrice != null ? Math.round(deal.askingPrice).toLocaleString("en-US") : ""); setCap(deal.capRate ?? ""); }, [deal.id]);
  const saveP = () => { const v = price===""?null:Number(String(price).replace(/,/g,"")); if (price===""?deal.askingPrice!=null:(!isNaN(Number(String(price).replace(/,/g,"")))&&v!==(deal.askingPrice??null))) onUpdate(deal.id, { askingPrice:v }); };
  const saveC = () => { const v = cap===""?null:Number(cap); if (cap===""?deal.capRate!=null:(!isNaN(Number(cap))&&v!==(deal.capRate??null))) onUpdate(deal.id, { capRate:v }); };
  const inp = { fontSize:12, padding:"5px 9px", border:"1px solid #e3dccd", borderRadius:6, color:"#383a37", background:"#fff", width:"100%", fontFamily:"'Inter',sans-serif", boxSizing:"border-box" as const };
  return (
    <div style={{ marginTop:12, paddingTop:12, borderTop:"1px dashed #e7e0d2" }}>
      <div style={{ fontSize:8.5, letterSpacing:"0.12em", color:"#a89f8f", marginBottom:7, textTransform:"uppercase", fontWeight:700 }}>Enter price / cap manually</div>
      <div style={{ display:"flex", gap:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:"#a69e91", marginBottom:3 }}>ASKING PRICE $</div>
          <input type="text" inputMode="numeric" value={price} onChange={e => setPrice(e.target.value)} onBlur={() => { setPrice(v => commaFmt(v)); saveP(); }} onFocus={() => setPrice(v => v.replace(/,/g, ""))} onKeyDown={e => e.key==="Enter"&&e.currentTarget.blur()} placeholder="—" style={inp}/>
        </div>
        <div style={{ width:92 }}>
          <div style={{ fontSize:9, color:"#a69e91", marginBottom:3 }}>CAP RATE %</div>
          <input value={cap} onChange={e => setCap(e.target.value)} onBlur={saveC} onKeyDown={e => e.key==="Enter"&&e.currentTarget.blur()} placeholder="—" inputMode="decimal" style={inp}/>
        </div>
      </div>
    </div>
  );
}
