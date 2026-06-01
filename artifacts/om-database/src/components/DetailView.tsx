import { useState, useEffect, useRef, useCallback } from "react";
import type { Deal, ImageBundle, TenantSalesYear } from "../lib/idb";
import { apiLoadImages, apiSaveImages, apiReanalyzeDeal, apiRefreshAnalysis, apiPollDealStatus, apiIngestDeal, apiAiMessages, apiRefreshDemographics, apiRescore } from "../lib/api";
import { reconcileDeal, assessExtraction, classifyLocation, getRecency, buildCorrectionsNote, robustParseJSON, lenderLabel, openReviewCount } from "../lib/utils";
import ImportReview from "./ImportReview";
import { ensureUploadAllowed } from "../lib/uploadAuth";
import { STATUS_COLORS, GRADE_COLORS, ANALYSIS_VERSION } from "../lib/constants";
import StatusTag from "./StatusTag";
import ScoreBadge from "./ScoreBadge";
import RecencyBadge from "./RecencyBadge";
import TenantRoster from "./TenantRoster";
import { loadPdfJs, _capturePagePhoto, extractPdfText } from "../lib/pdfExtract";
import { useCreateAiMessage } from "@workspace/api-client-react";
import { exportDealToExcel, exportRosterToExcel } from "../lib/exportExcel";
import RentRollPDF from "./RentRollPDF";
import { extractAnyFile } from "../lib/fileExtract";
import MyUnderwritingPanel from "./MyUnderwritingPanel";
import LeaseRollover from "./LeaseRollover";
import { PDFDownloadLink } from "@react-pdf/renderer";
import DealSummaryPDF from "./DealSummaryPDF";
import { isInvestmentGrade } from "../lib/tenantCredit";
import { useWatchlist } from "../lib/useWatchlist";
import { computeWatchlistImpact } from "../lib/watchlistImpact";
import { runWithProgress, startAiTask, finishAiTask } from "../lib/aiProgress";
import ClosingCostsCard from "./ClosingCostsCard";
import TenantSalesPanel from "./TenantSalesPanel";
import { deriveExpenseRiskFlag } from "../lib/expenseRisk";

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
}

// Downscale/recompress an uploaded image before we store it as a data URL.
// Cover photos straight off a phone can be 10MB+ and slow to load; this caps the
// longest edge and re-encodes to JPEG, falling back to the original on anything
// it can't safely shrink (small images keep their original bytes/format).
async function downscaleImageFile(file: File, maxDim = 1600, quality = 0.82): Promise<string> {
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
    const heavy = dataUrl.length > 600_000; // already-lean images keep their original bytes
    if (!tooBig && !heavy) return dataUrl;
    const scale = Math.min(1, maxDim / longest);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return dataUrl;
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL("image/jpeg", quality);
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

function ExtractionQuality({ deal }: { deal: Deal }) {
  const { quality, missing } = assessExtraction(deal);
  if (quality === "good") return null;
  const color = quality === "thin" ? "#dc2626" : "#d9890c";
  const bg = quality === "thin" ? "#dc262610" : "#d9890c10";
  return (
    <div style={{ background:bg, border:`1px solid ${color}40`, borderRadius:8, padding:"10px 14px", marginBottom:12 }}>
      <div style={{ fontSize:10, fontWeight:700, color, letterSpacing:"0.06em", marginBottom:3 }}>
        {quality === "thin" ? "⚠ THIN EXTRACTION" : "PARTIAL EXTRACTION"}
      </div>
      <div style={{ fontSize:11, color:"#6f6a5f" }}>
        Missing: {missing.join(", ")}. Consider re-uploading a higher-quality PDF.
      </div>
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
  sf: number | null; source: "owned" | "broker" | "om"; excluded: boolean;
}
interface BmResult {
  insufficient: boolean; tierLabel: string; relaxed: string[]; excludedInvalid: number;
  n: number; dateRange: { from: string; to: string } | null;
  sourceMix: { owned: number; broker: number; om: number };
  capRate: BmStats | null; pricePerSf: BmStats | null;
  last12: { n: number; capRate: BmStats | null; pricePerSf: BmStats | null } | null;
  capDeltaBps: number | null; psfDeltaPct: number | null;
  comps: BmMatch[]; subject: { capRate: number | null; pricePerSf: number | null };
}

function CompBenchmarkCard({ deal }: { deal: Deal }) {
  const lsKey = `bm-overrides-${deal.id}`;
  const readLs = (): { excludeIds?: number[]; includeIds?: number[] } => {
    try { return JSON.parse(localStorage.getItem(lsKey) ?? "{}"); } catch { return {}; }
  };

  const [bm, setBm] = useState<BmResult | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [excludeOm, setExcludeOm] = useState(false);
  const [excludeIds, setExcludeIds] = useState<number[]>(() => readLs().excludeIds ?? []);
  const [includeIds, setIncludeIds] = useState<number[]>(() => readLs().includeIds ?? []);
  const [addQ, setAddQ] = useState("");
  const [suggestions, setSuggestions] = useState<Array<{ id: number; name: string | null; sourceDealName: string | null; salePrice: number | null; market: string | null; saleDate: string | null }>>([]);
  const [sugsLoading, setSugsLoading] = useState(false);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    try { localStorage.setItem(lsKey, JSON.stringify({ excludeIds, includeIds })); } catch { /* ignore */ }
  }, [lsKey, excludeIds, includeIds]);

  const toggleExclude = (id: number) =>
    setExcludeIds(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);

  const addInclude = (id: number) => {
    setIncludeIds(prev => prev.includes(id) ? prev : [...prev, id]);
    setAddQ(""); setSuggestions([]);
  };
  const removeInclude = (id: number) =>
    setIncludeIds(prev => prev.filter(x => x !== id));

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

  useEffect(() => {
    let cancelled = false;
    const payload = JSON.stringify({
      dealId: deal.id, market: deal.market ?? null,
      state: (deal as unknown as Record<string, unknown>).state ?? null,
      propertyType: (deal as unknown as Record<string, unknown>).propertyType ?? null,
      sf: deal.totalSF ?? null,
      capRate: deal.capRate ?? null, pricePerSf: subjectPsf ?? null,
      excludeOmComps: excludeOm,
      excludeCompIds: excludeIds,
      includeCompIds: includeIds,
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
  }, [deal.id, excludeOm, excludeIds, includeIds, retryKey]);

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
                Based on {bm.n} comp{bm.n !== 1 ? "s" : ""} · {bm.tierLabel}
                {bm.dateRange ? ` · ${fmtD(bm.dateRange.from)}–${fmtD(bm.dateRange.to)}` : ""}
              </span>
              {bm.relaxed.length > 0 && (
                <span style={{ fontSize: 11, color: "#a89f8f", marginLeft: 6 }}>(relaxed: {bm.relaxed.join(", ")})</span>
              )}
            </div>
            <div style={{ fontSize: 11, color: "#7d766a", marginBottom: bm.insufficient ? 4 : 12 }}>
              {bm.n} comp{bm.n !== 1 ? "s" : ""} — {bm.sourceMix.owned} owned, {bm.sourceMix.broker} broker/manual, {bm.sourceMix.om} OM-sourced
              {bm.excludedInvalid > 0 && <span style={{ color: "#a89f8f" }}> · {bm.excludedInvalid} excluded (invalid data)</span>}
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
              <div style={{ fontSize: 11, color: "#7d766a", marginBottom: 6 }}>
                <span style={{ fontWeight: 600, color: "#6dba43" }}>{activeComps.length} comp{activeComps.length !== 1 ? "s" : ""}</span> in benchmark
                {excludedCount > 0 && <span style={{ color: "#a89f8f", marginLeft: 5 }}>· {excludedCount} manually excluded</span>}
                <span style={{ fontSize: 10, color: "#c0b8ab", marginLeft: 6 }}>— × removes added comps · eye excludes/re-includes others</span>
              </div>
              <div style={{ overflowX: "auto" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11, fontFamily: "'Inter',sans-serif" }}>
                  <thead>
                    <tr style={{ borderBottom: "2px solid #ece5d7" }}>
                      <th style={{ width: 26 }} />
                      {["Name", "Market", "Date", "Sale Price", "Cap %", "$/SF", "SF", "Source"].map(h => (
                        <th key={h} style={{ textAlign: "left", padding: "4px 8px", fontSize: 9, letterSpacing: "0.1em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, whiteSpace: "nowrap" }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {bm.comps.map(c => (
                      <tr key={c.id} style={{ borderBottom: "1px solid #f5f1ea", opacity: c.excluded ? 0.38 : 1 }}>
                        <td style={{ padding: "5px 2px 5px 6px", verticalAlign: "middle" }}>
                          {includeIds.includes(c.id)
                            ? <button onClick={() => removeInclude(c.id)}
                                title="Remove from benchmark"
                                style={{ background: "transparent", border: "none", cursor: "pointer", padding: "0 4px", color: "#dc2626", fontSize: 16, lineHeight: 1, display: "inline-flex", alignItems: "center", flexShrink: 0, fontFamily: "sans-serif" }}>×</button>
                            : <EyeBtn id={c.id} isExcluded={c.excluded} />}
                        </td>
                        <td style={{ padding: "6px 8px", color: c.excluded ? "#a89f8f" : "#383a37", fontWeight: 500, maxWidth: 180, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name || c.sourceDealName || c.market || "Unnamed comp"}</td>
                        <td style={{ padding: "6px 8px", color: "#5c5850", whiteSpace: "nowrap" }}>{c.market || "—"}</td>
                        <td style={{ padding: "6px 8px", color: "#5c5850", whiteSpace: "nowrap" }}>{fmtD(c.saleDate)}</td>
                        <td style={{ padding: "6px 8px", color: "#383a37", whiteSpace: "nowrap" }}>{fmtM(c.salePrice)}</td>
                        <td style={{ padding: "6px 8px", color: c.capRate != null ? "#26281f" : "#c9c2b8", fontWeight: c.capRate != null ? 600 : 400, whiteSpace: "nowrap" }}>{fmtPct2(c.capRate)}</td>
                        <td style={{ padding: "6px 8px", color: "#383a37", whiteSpace: "nowrap" }}>{fmtPsf(c.pricePerSf)}</td>
                        <td style={{ padding: "6px 8px", color: "#5c5850", whiteSpace: "nowrap" }}>{fmtSf(c.sf)}</td>
                        <td style={{ padding: "6px 8px" }}>{sourceBadge(c.source)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
  "section-tenant-sales": "Tenant Sales",
  "section-rollover": "Lease Rollover & WALT",
  "section-upside": "Upside Items",
  "section-redflags": "Red Flags",
  "section-financials": "Key Financials",
  "section-assumptions": "Key Assumptions",
  "section-thesis": "Our Thesis",
  "section-comp-benchmark": "Comp Benchmark",
  "section-closing-costs": "Estimated Closing Costs",
  "section-cashflow": "Cash Flow",
  "section-demographics": "Demographics & Site",
  "section-trade-area": "Trade Area (Census)",
  "section-notes": "Your Notes",
};

function SectionJump({ deal, scrollRef }: { deal: Deal; scrollRef: React.RefObject<HTMLDivElement | null> }) {
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

  useEffect(() => { rebuildItems(); }, [rebuildItems, deal.id, open]);

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

// KPR thesis / assumptions box — free text the acquisitions team writes about why
// they like a deal / what they're underwriting to. Saving stores the text (free);
// "Save & Re-grade" folds it into the AI analysis (advisory — the model can push
// back where the data doesn't support a claim).
function DealThesisBox({ deal, onUpdate, onRegrade, regrading }: {
  deal: Deal;
  onUpdate: (id: string, patch: Partial<Deal>) => void;
  onRegrade: () => void | Promise<void>;
  regrading: boolean;
}) {
  const [text, setText] = useState(deal.dealThesis ?? "");
  const saved = (deal.dealThesis ?? "");
  const dirty = text.trim() !== saved.trim();

  // Keep the box in sync when the saved value changes from outside (deal reloaded,
  // another user's edit, post-regrade) — but never clobber unsaved local edits.
  const lastSavedRef = useRef(saved);
  useEffect(() => {
    const prevSaved = lastSavedRef.current;
    if (saved !== prevSaved) {
      lastSavedRef.current = saved;
      // Adopt the new saved value only if the box wasn't mid-edit (i.e. it still
      // matched the previously-saved text or was empty).
      setText(prev => (prev.trim() === "" || prev === prevSaved ? saved : prev));
    }
  }, [saved]);

  const save = () => { if (dirty) onUpdate(deal.id, { dealThesis: text.trim() || null }); };
  const saveAndRegrade = async () => {
    if (dirty) onUpdate(deal.id, { dealThesis: text.trim() || null });
    // Let the save propagate, then re-grade (reads the deal incl. the new thesis).
    await Promise.resolve();
    await onRegrade();
  };

  return (
    <div style={{ background:"#f3f7fc", border:"1px solid #c9dbf0", borderRadius:12, padding:"16px 18px", marginBottom:14 }}>
      <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:6 }}>
        <span style={{ fontSize:13 }}>📝</span>
        <span style={{ fontSize:12, fontWeight:700, letterSpacing:"0.04em", color:"#2d4ecf", textTransform:"uppercase" }}>Our Thesis / Assumptions</span>
      </div>
      <div style={{ fontSize:11, color:"#6f7a8c", marginBottom:10, lineHeight:1.5 }}>
        Why we like this deal, what we're underwriting to, risks we're discounting. Folded into the AI grade when you re-grade — the analyst weighs it but stays objective and will flag anything the data contradicts.
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        onBlur={save}
        placeholder="e.g. Underwriting to mark-to-market on the inline shops at rollover; comfortable with the grocer's below-market sales given the dense infill location and lack of nearby competition; assume the vacant pad leases within 18 months…"
        rows={4}
        style={{ width:"100%", boxSizing:"border-box", resize:"vertical", fontFamily:"'Inter',sans-serif", fontSize:13, lineHeight:1.55, padding:"10px 12px", border:"1px solid #c9dbf0", borderRadius:8, color:"#383a37", background:"#fff", outline:"none" }}
      />
      <div style={{ display:"flex", alignItems:"center", gap:10, marginTop:10, flexWrap:"wrap" }}>
        <button onClick={save} disabled={!dirty}
          style={{ background: dirty ? "#fff" : "#f1eadc", border:"1px solid #c9dbf0", color: dirty ? "#2d4ecf" : "#a89f8f", padding:"7px 14px", borderRadius:7, cursor: dirty ? "pointer" : "default", fontSize:12, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
          {dirty ? "Save" : "Saved"}
        </button>
        <button onClick={saveAndRegrade} disabled={regrading || (!saved && !text.trim())}
          style={{ background:"#2d4ecf", border:"none", color:"#fff", padding:"7px 14px", borderRadius:7, cursor: regrading ? "default" : "pointer", fontSize:12, fontWeight:600, fontFamily:"'Inter',sans-serif", opacity: regrading ? 0.6 : 1 }}>
          {regrading ? "Re-grading…" : "✨ Save & Re-grade with this thesis"}
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

export default function DetailView({ deal: d, allDeals, onBack, onDelete, onUpdate, onQuery, onCompare, onTenantClick }: Props) {
  const watchMap = useWatchlist();
  const watchImpact = computeWatchlistImpact(d, watchMap);
  const adjustedScore = watchImpact.adjustScore(d.dealScore);
  const [confirmDel, setConfirmDel] = useState(false);
  // Which image a delete-confirmation is open for ("cover" | "site" | null).
  const [confirmDelImg, setConfirmDelImg] = useState<null | "cover" | "site">(null);
  const [reviewOpen, setReviewOpen] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [imgs, setImgs] = useState<ImageBundle | null>(null);
  const [saleBusy, setSaleBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [actionsHelpOpen, setActionsHelpOpen] = useState(false);
  const [reanalyzeBusy, setReanalyzeBusy] = useState(false);
  const rerunPdfRef = useRef<HTMLInputElement>(null);
  const [rrBusy, setRrBusy] = useState(false);
  const [rrError, setRrError] = useState<string | null>(null);
  const rrPdfRef = useRef<HTMLInputElement>(null);
  const [salesBusy, setSalesBusy] = useState(false);
  const [salesError, setSalesError] = useState<string | null>(null);
  const [notesOpen, setNotesOpen] = useState(false);
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
    if (d.imageMeta && (d.imageMeta.cover || d.imageMeta.sitePlan)) {
      apiLoadImages(d.id).then(res => { if (alive) setImgs(res || {}); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [d.id]);

  // Resync confirmation boxes to the persisted flags when switching properties.
  useEffect(() => {
    setCoverFinalized(!!d.imageMeta?.coverConfirmed);
    setSitePlanFinalized(!!d.imageMeta?.sitePlanConfirmed);
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
      const prompt = `You are a CRE data extraction engine. Extract every occupied tenant from this rent roll.
Return ONLY valid JSON — no markdown fences, no explanation — with this exact shape:
{
  "asOf": "<'as of' date printed on the rent roll header as YYYY-MM-DD, or null if not shown>",
  "tenants": [
    {
      "name": "string",
      "sf": number_or_null,
      "rentPerSF": number_or_null,
      "annualRent": number_or_null,
      "leaseStart": "string_or_null",
      "leaseExpiry": "string_or_null",
      "remainingTermYears": number_or_null,
      "reimbursementMethod": "string_or_null",
      "leaseType": "string_or_null",
      "rentBumps": "string_or_null",
      "renewalOptions": "string_or_null",
      "isAnchor": boolean
    }
  ]
}

COLUMN MAPPING RULES (apply to Yardi/MRI and similar property-management exports):
- annualRent  → use the "Annual Rent" column (base rent only). NEVER use "Gross Annual Rent", "Gross Monthly Rent", "Annual Rent Increase", or "Annual Option Rent".
- rentPerSF   → use the "Rent/SF" column (base rent per SF). Never use a gross or option PSF figure.
- leaseStart  → "Term Comm. Date" or "Commencement Date" (not option dates).
- leaseExpiry → "Term Exp. Date" or "Expiration Date" (not option expiry).
- reimbursementMethod → infer from expense columns: if CAM, tax, and insurance are billed separately to the tenant → "NNN"; if the tenant pays a fixed lump or nothing for expenses → "Gross" or "Modified Gross". Use the actual column label when present.

RENT STEPS (rentBumps field):
- The "Annual Rent Increase" (or "Rent Steps" / "Scheduled Increases") block lists each future in-term step as one row with columns: [ Effective Date | New Annual Rent | Incr/SF (or $/SF) ].
- Read ACROSS each row — every date MUST be paired with the Incr/SF dollar amount from that same row. Never emit a date without its amount.
- Format as a semicolon-separated list of per-SF rate + month-year: "$19.06 Jan-28; $19.63 Jan-29; $20.22 Jan-30"
- Use the per-SF value (Incr/SF column). If only an annual total is given, divide by the tenant's SF and round to 2 decimal places.
- If there are no in-term scheduled steps, set rentBumps to null. Never output a bare date with no dollar amount.

RENEWAL OPTIONS (renewalOptions field):
- Capture option counts, term lengths, and option-period rents ONLY in renewalOptions (e.g. "2 × 5yr @ $21.50/SF").
- NEVER copy renewal-option dates or option rents into rentBumps.
- Option rents are NOT current rents — never use them for rentPerSF or annualRent.

TENANT NAME RULES:
- Take only the primary trade name from the first line of the tenant cell.
- Strip any parenthetical echo that repeats the name (e.g. "Tenant Name (Tenant Name)").
- Strip guarantor, DBA, or legal-entity lines that appear on subsequent lines beneath the tenant name.

ROW FILTERING — skip these rows entirely (do not include them in the output):
- Total, Subtotal, and Grand Total summary rows.
- Artifact rows where both SF and Annual Rent are 0 or null (data-entry placeholders).
- KEEP real gross-lease tenants that have $0 CAM but positive base rent — those are legitimate occupied suites.

Return only the JSON object.

RENT ROLL TEXT:
${text.slice(0, 60000)}`;

      const res = await apiAiMessages({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 32000,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = res.content.find(c => c.type === "text")?.text ?? "";
      let parsed: { asOf?: string | null; tenants?: unknown[] };
      try { parsed = robustParseJSON(raw) as typeof parsed; } catch { throw new Error("Couldn't parse the AI response — try again."); }

      const newTenants = Array.isArray(parsed.tenants) ? parsed.tenants as Deal["tenants"] : [];
      if (!newTenants || newTenants.length === 0) throw new Error("No tenants found in the rent roll. Check the PDF.");

      const asOf = parsed.asOf || new Date().toISOString().slice(0, 10);

      const nv = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
      const recomputed: Partial<Deal> = {};

      if (!d.verified?.occupancy && d.totalSF) {
        const occupiedSF = newTenants.reduce((s, t) => s + (nv((t as Record<string,unknown>).sf) ?? 0), 0);
        const occ = Math.round(occupiedSF / Number(d.totalSF) * 1000) / 10;
        if (occ > 0 && occ <= 100) recomputed.occupancy = occ;
      }
      if (!d.verified?.walt) {
        const sfT = newTenants.reduce((s, t) => s + (nv((t as Record<string,unknown>).sf) ?? 0), 0);
        const wT = newTenants.reduce((s, t) => {
          const sf = nv((t as Record<string,unknown>).sf), yr = nv((t as Record<string,unknown>).remainingTermYears);
          return s + (sf ?? 0) * (yr ?? 0);
        }, 0);
        if (sfT > 0) recomputed.walt = Math.round(wT / sfT * 10) / 10;
      }
      if (!d.verified?.weightedAvgRentPSF) {
        const sfR = newTenants.filter(t => nv((t as Record<string,unknown>).sf) && nv((t as Record<string,unknown>).rentPerSF)).reduce((s, t) => s + (nv((t as Record<string,unknown>).sf) ?? 0), 0);
        const wR = newTenants.reduce((s, t) => {
          const sf = nv((t as Record<string,unknown>).sf), r = nv((t as Record<string,unknown>).rentPerSF);
          return s + (sf && r ? sf * r : 0);
        }, 0);
        if (sfR > 0) recomputed.weightedAvgRentPSF = Math.round(wR / sfR * 100) / 100;
      }

      onUpdate(d.id, { tenants: newTenants, tenantsAsOf: asOf, tenantsSource: "rent-roll", tenantsManual: true, analysisStale: true, ...recomputed });
      finishAiTask(taskId, "done", `Roster updated — ${newTenants.length} tenants from the rent roll`);
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
      const prompt = `You are a CRE data extraction engine. Extract tenant sales data from this retail sales report.
Return ONLY valid JSON — no markdown fences, no explanation — with this exact shape:
{
  "year": <integer — the sales year this report covers, e.g. 2023>,
  "tenants": [
    {
      "name": "string",
      "salesPSF": number_or_null,
      "annualSales": number_or_null,
      "sf": number_or_null,
      "occupancyCost": number_or_null
    }
  ]
}

RULES:
- year: infer from the header or period label of the report (e.g. "2023 Sales Report" → 2023). If truly ambiguous, use the most recent full calendar year mentioned.
- salesPSF: sales per square foot (dollars). Often labeled "Sales/SF", "$/SF", or "PSF".
- annualSales: total annual sales volume in dollars (not PSF). If shown in thousands, convert to full dollars.
- sf: tenant GLA / leased SF for use in sales calculations.
- occupancyCost: TOTAL occupancy cost percentage = (base rent + expense reimbursements/CAM+taxes+insurance + percentage rent + other rent) ÷ gross sales. Often labeled "Occ Cost %", "OC%", or "Occupancy Cost" — capture the report's stated total. Do NOT report a base-rent-only ratio.
- Skip total/subtotal rows and blank rows.
- Include all tenants that have any sales data, even if some fields are null.

SALES REPORT TEXT:
${text.slice(0, 40000)}`;

      const res = await apiAiMessages({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16000,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = res.content.find((c: { type: string }) => c.type === "text")?.text ?? "";
      let parsed: { year?: number; tenants?: unknown[] };
      try { parsed = robustParseJSON(raw) as typeof parsed; } catch { throw new Error("Couldn't parse the AI response — try again."); }

      const year = typeof parsed.year === "number" ? parsed.year : new Date().getFullYear() - 1;
      const tenants = Array.isArray(parsed.tenants) ? parsed.tenants as TenantSalesYear["tenants"] : [];
      if (tenants.length === 0) throw new Error("No tenant sales data found in the PDF.");

      const newSnap: TenantSalesYear = {
        year,
        uploadedAt: new Date().toISOString(),
        source: "upload",
        tenants,
      };

      // Replace any existing snapshot for the same year, append otherwise
      const existing = (d.tenantSalesHistory || []).filter(s => s.year !== year);
      onUpdate(d.id, { tenantSalesHistory: [...existing, newSnap] });
      finishAiTask(taskId, "done", `Sales loaded — ${tenants.length} tenants (${year})`);
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
    const dataUrl = await downscaleImageFile(file);
    const current: ImageBundle = imgs || {};
    const next: ImageBundle = { ...current, cover: dataUrl };
    setImgs(next);
    await apiSaveImages(d.id, next);
    onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), cover: true } });
  };

  const handleSitePlanImageFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (e.target) e.target.value = "";
    if (!files.length) return;
    const urls = await Promise.all(files.map(f => new Promise<string>(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.readAsDataURL(f);
    })));
    const current: ImageBundle = imgs || {};
    const next: ImageBundle = { ...current, sitePlan: urls, pagePicks: [], needsSitePlanPick: false };
    setImgs(next);
    await apiSaveImages(d.id, next);
    onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), sitePlan: urls.length, needsSitePlanPick: false } });
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

  const applyParsed = (parsed: { asOf?: string | null; tenants?: unknown[] }) => {
    const newTenants = Array.isArray(parsed.tenants) ? parsed.tenants as Deal["tenants"] : [];
    if (!newTenants || newTenants.length === 0) { setPasteError("No tenants found — check the pasted text."); return; }
    const asOf = parsed.asOf || new Date().toISOString().slice(0, 10);
    const nv = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
    const recomputed: Partial<Deal> = {};
    if (!d.verified?.occupancy && d.totalSF) {
      const occupiedSF = newTenants.reduce((s, t) => s + (nv((t as Record<string,unknown>).sf) ?? 0), 0);
      const occ = Math.round(occupiedSF / Number(d.totalSF) * 1000) / 10;
      if (occ > 0 && occ <= 100) recomputed.occupancy = occ;
    }
    if (!d.verified?.walt) {
      const sfT = newTenants.reduce((s, t) => s + (nv((t as Record<string,unknown>).sf) ?? 0), 0);
      const wT = newTenants.reduce((s, t) => {
        const sf = nv((t as Record<string,unknown>).sf), yr = nv((t as Record<string,unknown>).remainingTermYears);
        return s + (sf ?? 0) * (yr ?? 0);
      }, 0);
      if (sfT > 0) recomputed.walt = Math.round(wT / sfT * 10) / 10;
    }
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

  const fullAddress = (() => {
    const street = (d.address || "").trim();
    const city = (d.city || "").trim();
    const state = (d.state || "").trim();
    if (state && new RegExp(`\\b${state}\\b`, "i").test(street)) return street;
    const parts = [street, city, state].filter(Boolean);
    return parts.join(", ");
  })();

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

  return (
    <div ref={scrollContainerRef} style={{ flex:1, overflowY:"auto", padding:"32px 24px 20px 24px" }}>
      <div style={{
        position: "fixed",
        top: 88,
        left: 0,
        right: 0,
        zIndex: 90,
        background: "rgba(252,250,245,0.94)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid #e7e0d2",
        padding: "12px 16px",
        boxShadow: titleScrolled ? "0 6px 18px -10px rgba(56,58,55,0.25)" : "none",
        transform: titleScrolled ? "translateY(0)" : "translateY(-110%)",
        transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 220ms ease",
        pointerEvents: titleScrolled ? "auto" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
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
          <div style={{ flexShrink: 0 }}><SectionJump deal={d} scrollRef={scrollContainerRef} /></div>
        </div>
      </div>
      {/* Back */}
      <div style={{ marginBottom:10 }}>
        <button onClick={onBack} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>← BACK</button>
      </div>

      {/* Property name + Actions + Jump To */}
      <div style={{ display:"flex", alignItems:"flex-start", justifyContent:"space-between", gap:8, margin:"0 0 4px 0" }}>
        <h1 ref={titleRef} style={{ fontFamily:"'Fraunces',serif", fontSize:30, fontWeight:500, color:"#26281f", margin:0, letterSpacing:"-0.02em", lineHeight:1.15, paddingTop:2, flex:"1 1 auto", minWidth:0 }}>{d.propertyName||d.fileName}</h1>
        <div style={{ display:"flex", alignItems:"center", gap:6, flexShrink:0 }}>
          <div style={{ position:"relative" }}>
            <button onClick={() => setActionsOpen(o => { if (o) setActionsHelpOpen(false); return !o; })}
              style={{ background:"#2a2c27", border:"none", color:"#fff", padding:"6px 12px", borderRadius:6, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:5, fontWeight:500 }}>
              Actions <span style={{ fontSize:9 }}>▾</span>
            </button>
            {actionsOpen && (
              <div onClick={e => e.stopPropagation()} style={{ position:"absolute", top:"110%", right:0, background:"#fff", border:"1px solid #e3dccd", borderRadius:9, padding:4, zIndex:300, boxShadow:"0 8px 24px rgba(0,0,0,0.13)", minWidth:210 }}>
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
          <SectionJump deal={d} scrollRef={scrollContainerRef} />
        </div>
      </div>
      <p style={{ color:"#6f6a5f", fontSize:12, margin:"0 0 12px 0" }}>{fullAddress || "—"}</p>

      {/* Export buttons */}
      <div style={{ display:"flex", gap:8, marginBottom:12 }}>
        {((d.tenants||[]).length > 0 || (d.cashFlowProjection||[]).length > 0) && (
          <button onClick={() => exportDealToExcel(d)}
            style={{ background:"#f6f2ea", border:"1px solid #c8b89a", color:"#5c5047", padding:"8px 16px", borderRadius:6, cursor:"pointer", fontSize:12, fontFamily:"'Inter',sans-serif", fontWeight:600, display:"flex", alignItems:"center", gap:5 }}>
            <span style={{ fontSize:13 }}>⬇</span> Excel
          </button>
        )}
        <PDFDownloadLink
          document={<DealSummaryPDF deal={d} imgs={imgs} logoUrl={`${window.location.origin}/apple-touch-icon.png`} />}
          fileName={`${(d.propertyName||d.fileName||"deal").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}-summary.pdf`}
          style={{ textDecoration:"none" }}
        >
          {({ loading }: { loading: boolean }) => (
            <button style={{ background:"#f6f2ea", border:"1px solid #c8b89a", color: loading ? "#a69e91" : "#4a7fb5", padding:"8px 16px", borderRadius:6, cursor: loading ? "default" : "pointer", fontSize:12, fontFamily:"'Inter',sans-serif", fontWeight:600, display:"flex", alignItems:"center", gap:5, opacity: loading ? 0.7 : 1 }}>
              <span style={{ fontSize:13 }}>⬇</span>{loading ? "PDF…" : "Summary PDF"}
            </button>
          )}
        </PDFDownloadLink>
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

      {/* Cover hero — fit the whole photo to the window (cap to viewport height,
          contain so nothing is cropped or overflows), centered on a soft backdrop. */}
      {imgs?.cover && (
        <div id="section-cover"
          style={{ position:"relative", display:"flex", justifyContent:"center", borderRadius:14, overflow:"hidden", marginBottom:16, boxShadow:"0 1px 2px rgba(56,58,55,0.05), 0 20px 40px -28px rgba(56,58,55,0.6)", border:"1px solid #ece5d7", background:"#faf7f0" }}>
          <img onClick={() => setLightbox(imgs.cover!)} title="Click to enlarge" src={imgs.cover} alt={`${d.propertyName||"Property"} cover`} style={{ maxWidth:"100%", maxHeight:"70vh", width:"auto", height:"auto", objectFit:"contain", display:"block", cursor:"zoom-in" }}/>
          <div style={{ position:"absolute", left:18, bottom:14, color:"#fff", fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", opacity:0.9, fontWeight:600, pointerEvents:"none", textShadow:"0 1px 3px rgba(0,0,0,0.6)" }}>From the offering memorandum</div>
          <button onClick={() => setConfirmDelImg("cover")} title="Remove cover photo"
            style={{ position:"absolute", top:10, right:10, background:"rgba(38,40,31,0.62)", border:"none", color:"#fff", width:30, height:30, borderRadius:8, cursor:"pointer", fontSize:14, display:"flex", alignItems:"center", justifyContent:"center" }}>🗑</button>
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

      <ExtractionQuality deal={d}/>

      {/* Market sale */}
      {d.marketSale && (
        <div style={{ background:"#0d948810", border:"1px solid #0d948840", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:9, gap:10, flexWrap:"wrap" }}>
            <div style={{ fontSize:9, letterSpacing:"0.1em", color:"#0d9488", fontWeight:700 }}>↗ MARKET SALE — FOUND ONLINE</div>
            <button onClick={() => onLookupSale(d.id)} disabled={saleBusy} style={{ background:"transparent", border:"1px solid #0d9488", color:saleBusy?"#a69e91":"#0d9488", padding:"3px 9px", borderRadius:4, cursor:saleBusy?"default":"pointer", fontSize:9, fontFamily:"'Inter',sans-serif" }}>{saleBusy?"SEARCHING…":"RE-CHECK"}</button>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:10, marginBottom:9 }}>
            {([["SALE PRICE", d.marketSale.price!=null?`$${Number(d.marketSale.price).toLocaleString()}`:null],
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

      {/* KPR thesis / assumptions — folded into the AI grade on re-grade. Placed
          above the site plan. */}
      <div id="section-thesis" data-jump="Our Thesis">
        <DealThesisBox deal={d} onUpdate={onUpdate} onRegrade={handleRefreshAnalysis} regrading={reanalyzeBusy}/>
      </div>

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
                <div key={i} onClick={() => setLightbox(src)} style={{ cursor:"zoom-in", borderRadius:9, overflow:"hidden", border:"1px solid #ece5d7", display:"flex", justifyContent:"center", background:"#faf7f0" }}>
                  <img src={src} alt={`Site plan ${i+1}`} style={{ maxWidth:"100%", maxHeight:"75vh", width:"auto", height:"auto", objectFit:"contain", display:"block" }}/>
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
                <div key={i} onClick={() => setLightbox(src)} style={{ cursor:"zoom-in", borderRadius:9, overflow:"hidden", border:"1px solid #ece5d7", display:"flex", justifyContent:"center", background:"#faf7f0" }}>
                  <img src={src} alt={`Site plan ${i+1}`} style={{ maxWidth:"100%", maxHeight:"75vh", width:"auto", height:"auto", objectFit:"contain", display:"block" }}/>
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
              <PDFDownloadLink
                document={<RentRollPDF deal={d} />}
                fileName={`KPR_RentRoll_${(d.propertyName||d.fileName||"deal").replace(/[/\\?%*:|"<>]/g,"-").slice(0,80)}.pdf`}
                style={{ textDecoration:"none" }}
              >
                {({ loading }) => (
                  <span style={{ background:"#2a2c27", border:"1px solid #2a2c27", color:"#fff", padding:"6px 13px", borderRadius:7, cursor:"pointer", fontSize:11.5, fontWeight:600, fontFamily:"'Inter',sans-serif", display:"inline-flex", alignItems:"center", gap:5 }}>
                    {loading ? "Preparing…" : "⬇ Rent roll — PDF"}
                  </span>
                )}
              </PDFDownloadLink>
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
        /></div>
      )}

      {/* Tenant Sales Panel */}
      {(d.tenants||[]).length > 0 && (
        <div id="section-tenant-sales">
          <TenantSalesPanel
            salesHistory={d.tenantSalesHistory || []}
            omTenants={d.tenants}
            omDate={d.omDate}
            onUpload={handleSalesUpload}
            uploadBusy={salesBusy}
            uploadError={salesError}
          />
        </div>
      )}

      {/* Lease Rollover & WALT */}
      {(d.tenants||[]).length > 0 && (
        <div id="section-rollover"><LeaseRollover tenants={d.tenants!} tenantsAsOf={d.tenantsAsOf} /></div>
      )}

      {/* Deal score */}
      {(d.dealScore || d.analysisStale) && (
        <CollapsibleBox collapsedHeight={300} fadeColor="#faf7f0">
          {(expanded) => { const fs = 1; void expanded; return (
          <div style={{ background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:8, padding:"14px 16px" }}>
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
      {(d.upsideItems && d.upsideItems.length > 0) && (() => {
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
        const expenseFlag = deriveExpenseRiskFlag(d);
        const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const allRedFlags = [...(expenseFlag ? [expenseFlag] : []), ...watchImpact.flags, ...(d.redFlags || [])]
          .sort((a, b) => (sevOrder[a.severity ?? "low"] ?? 2) - (sevOrder[b.severity ?? "low"] ?? 2));
        return (allRedFlags.length > 0 || d.analysisStale) && (
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

      {/* Edit metrics — below red flags */}
      <MetricsEditor deal={d} onUpdate={onUpdate}/>

      {/* Financial grid */}
      <div id="section-financials" style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(240px, 1fr))", gap:12, marginBottom:12 }}>
        <Card title="KEY FINANCIALS">
          <Row l="ASKING PRICE" v={d.askingPrice?`$${Number(d.askingPrice).toLocaleString()}`:null} c="#6dba43" field="askingPrice"/>
          <Row l="CAP RATE" v={d.capRate?`${d.capRate}%`:null} c="#0f9d63" field="capRate"/>
          <Row l="NOI" v={d.noi?`$${Number(d.noi).toLocaleString()}`:null} c="#0f9d63" field="noi"/>
          <Row l="PRICE / SF" v={d.pricePerSF?`$${d.pricePerSF}`:null} field="pricePerSF"/>
          <Row l="TOTAL SF" v={d.totalSF?`${Number(d.totalSF).toLocaleString()} SF`:null} field="totalSF"/>
          <Row l="OCCUPANCY" v={d.occupancy?`${d.occupancy}%`:null} c="#383a37" field="occupancy" warn={reconWarns.occupancy}/>
          <PriceCapEditor deal={d} onUpdate={onUpdate}/>
        </Card>
        <Card title="INCOME & EXPENSES">
          <Row l="GROSS POTENTIAL RENT" v={d.grossPotentialRent?`$${Number(d.grossPotentialRent).toLocaleString()}`:null} field="grossPotentialRent" warn={reconWarns.grossPotentialRent}/>
          <Row l="EFF. GROSS INCOME" v={d.effectiveGrossIncome?`$${Number(d.effectiveGrossIncome).toLocaleString()}`:null} field="effectiveGrossIncome"/>
          <Row l="OPERATING EXPENSES" v={d.operatingExpenses?`$${Number(d.operatingExpenses).toLocaleString()}`:null} field="operatingExpenses"/>
          <Row l="NNN RECOVERIES" v={d.nnnRecoveries?`$${Number(d.nnnRecoveries).toLocaleString()}`:null}/>
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
          <Row l="YEAR BUILT" v={d.yearBuilt}/>
          <Row l="RENOVATION YEAR" v={d.renovationYear}/>
          <Row l="LOT SIZE" v={d.lotSizeAcres?`${d.lotSizeAcres} ac`:null}/>
          <Row l="PARKING RATIO" v={d.parkingRatio?`${d.parkingRatio}/1k SF`:null}/>
          <Row l="# BUILDINGS" v={d.numberOfBuildings}/>
        </Card>
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

      {/* Key assumptions — above My Underwriting */}
      <div id="section-assumptions"><KeyAssumptions deal={d} /></div>

      {/* My Underwriting */}
      <div id="section-underwriting" data-jump="My Underwriting"><MyUnderwritingPanel deal={d} onUpdate={onUpdate}/></div>

      {/* Comp Benchmark — below My Underwriting */}
      <CompBenchmarkCard deal={d} />

      <ClosingCostsCard deal={d} />

      {/* Cash flow */}
      {(d.cashFlowProjection||[]).length > 0 && (
        <div id="section-cashflow" style={{ background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", marginBottom:12, fontWeight:600, textTransform:"uppercase" }}>Cash Flow Projection — {d.cashFlowProjection!.length} periods</div>
          <div style={{ overflowX:"auto" }}>
            <table style={{ borderCollapse:"collapse", fontSize:12, minWidth:150+d.cashFlowProjection!.length*108 }}>
              <thead>
                <tr style={{ fontSize:10, color:"#a69e91", fontWeight:600 }}>
                  <th style={{ textAlign:"left", padding:"6px 10px", position:"sticky", left:0, background:"#fff", zIndex:1 }}></th>
                  {d.cashFlowProjection!.map((r,i) => <th key={i} style={{ textAlign:"right", padding:"6px 10px", whiteSpace:"nowrap", fontWeight:i===0?700:600, color:i===0?"#383a37":"#a69e91" }}>{r.label}</th>)}
                </tr>
              </thead>
              <tbody>
                {([["Base Rent","totalBaseRent","#5c5f57"],["Reimbursements","reimbursements","#5c5f57"],["Eff. Gross Rev.","egr","#383a37"],["Operating Expenses","operatingExpenses","#837c6e"],["NOI","noi","#0f9d63"]] as [string,string,string][]).map(([label,key,color]) => (
                  <tr key={key} style={{ borderTop:"1px solid #f1eadc", background:key==="noi"?"#0f9d6308":"transparent" }}>
                    <td style={{ textAlign:"left", padding:"8px 10px", color:key==="noi"?"#0f7a4e":"#a69e91", fontWeight:key==="noi"?700:500, whiteSpace:"nowrap", position:"sticky", left:0, background:key==="noi"?"#f2faef":"#fff", zIndex:1 }}>{label}</td>
                    {d.cashFlowProjection!.map((r,ci) => (
                      <td key={ci} style={{ textAlign:"right", padding:"8px 10px", color, fontWeight:key==="noi"?700:400, whiteSpace:"nowrap" }}>{(r as any)[key]!=null?`$${Number((r as any)[key]).toLocaleString()}`:"—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

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
          <div style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:14, flexWrap:"wrap", gap:8 }}>
              <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>
                {owned ? "Acquisition Record" : "Transaction Details"}
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
                      {done ? "✓ Acquisition record complete" : `Acquisition record ${pct}% complete — ${missing.length} key detail${missing.length===1?"":"s"} still needed`}
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
                {allInBasis && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>All-In Basis</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#383a37" }}>${allInBasis.toLocaleString()}</div></div>}
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
        const pp2    = Number(d.txnPurchasePrice)||0;
        const equity = pp2 && amt ? pp2 - amt : null;
        const ltvCalc  = pp2 && amt ? (amt/pp2*100) : null;
        const noi2     = Number(d.noi)||0;
        const dscrCalc = annualDS && noi2 ? noi2/annualDS : null;

        if (!owned) return (
          <div style={{ background:"#ffffff", border:"1px dashed #ddd4c2", borderRadius:12, padding:"16px 20px", marginBottom:14, display:"flex", alignItems:"center", justifyContent:"space-between", gap:12, flexWrap:"wrap" }}>
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
          <div style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:14 }}>Financing & Debt</div>
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
              {f({ label:"Loan Type", field:"debtType", options:["Senior / Acquisition","Permanent","Bridge","Construction","Mezzanine","CMBS","Agency (Fannie/Freddie)","Life Co","Bank","Other"] })}
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
              <Group title="Preferred Equity (if applicable)"/>
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
            </div>
            {(annualDS || equity != null || ltvCalc || dscrCalc) && (
              <div style={{ marginTop:18, paddingTop:16, borderTop:"1px solid #f1eadc", display:"flex", gap:30, flexWrap:"wrap" }}>
                {annualDS && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Est. Annual Debt Service</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#383a37" }}>${Math.round(annualDS).toLocaleString()}</div></div>}
                {equity != null && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Equity Invested</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:"#383a37" }}>${equity.toLocaleString()}</div></div>}
                {ltvCalc && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Implied LTV</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:ltvCalc>75?"#dc2626":"#0f9d63" }}>{ltvCalc.toFixed(1)}%</div></div>}
                {dscrCalc && <div><div style={{ fontSize:11, color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:4 }}>Implied DSCR (NOI)</div><div style={{ fontFamily:"'Fraunces',serif", fontSize:21, fontWeight:600, color:dscrCalc<1.2?"#dc2626":"#0f9d63" }}>{dscrCalc.toFixed(2)}x</div></div>}
              </div>
            )}
            <div style={{ marginTop:12, fontSize:11, color:"#b3aa9b", lineHeight:1.5 }}>Derived figures are estimates (debt service assumes level amortization; LTV/DSCR use your purchase price and the OM NOI). For reference only.</div>
          </div>
        );
      })()}

      {/* Property info */}
      <div style={{ marginBottom:12 }}>
        <Card title="PROPERTY INFO">
          <Row l="MARKET" v={d.market}/>
          <Row l="SUBMARKET" v={d.submarket}/>
          {/* Broker & Seller are LINKED with the Transaction Details fields —
              editing here writes both so you only enter each once. */}
          <EditableTextRow label="BROKER" value={d.broker ?? d.acqBroker} placeholder="Listing / deal broker" onSave={v => onUpdate(d.id, { broker: v, acqBroker: v })} />
          <EditableTextRow label="SELLER" value={d.seller ?? d.txnSeller} placeholder="Seller / current owner" onSave={v => onUpdate(d.id, { seller: v, txnSeller: v })} />
          <Row l="LAST SALE DATE" v={d.lastSaleDate}/>
          <Row l="LAST SALE PRICE" v={d.lastSalePrice?`$${Number(d.lastSalePrice).toLocaleString()}`:null}/>
        </Card>
      </div>

      {/* Demographics from OM */}
      {(d.trafficCountVPD || d.population3mi || d.medianHHIncome3mi) && (
        <div id="section-demographics"><Card title="DEMOGRAPHICS & SITE" source="OM">
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4, 1fr)", gap:8 }}>
            {[["TRAFFIC/DAY", d.trafficCountVPD?`${Number(d.trafficCountVPD).toLocaleString()} VPD`:null],
              ["POP. 3MI", d.population3mi?`${Number(d.population3mi).toLocaleString()}`:null],
              ["MED. HHI 3MI", d.medianHHIncome3mi?`$${Number(d.medianHHIncome3mi).toLocaleString()}`:null],
              ["AVG. HHI 3MI", d.avgHHIncome3mi?`$${Number(d.avgHHIncome3mi).toLocaleString()}`:null],
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
          const fmtD = (v: number|null|undefined) => v!=null ? `$${Number(v).toLocaleString()}` : "—";
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

      <PropertyChat deal={d} />
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
  const fmt = (v: unknown): string => {
    if (v == null || v === "") return "";
    if (isMoney) { const n = Number(String(v).replace(/[^0-9.\-]/g,"")); return isNaN(n) ? String(v) : n.toLocaleString("en-US"); }
    return String(v);
  };
  const [val, setVal] = useState(() => fmt(initial));
  useEffect(() => { setVal(fmt(initial)); }, [initial, dealId]);
  const commit = () => {
    if (val === "" || val == null) { onUpdate(dealId, { [field]: null } as Partial<Deal>); return; }
    if (isNum) {
      const n = Number(String(val).replace(/[^0-9.\-]/g,""));
      if (isNaN(n)) { onUpdate(dealId, { [field]: null } as Partial<Deal>); setVal(""); return; }
      setVal(isMoney ? n.toLocaleString("en-US") : String(n));
      onUpdate(dealId, { [field]: n } as Partial<Deal>);
    } else {
      onUpdate(dealId, { [field]: val } as Partial<Deal>);
    }
  };
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:5, gridColumn: wide?"1 / -1":"auto" }}>
      <label style={{ fontSize:11, color:"#a69e91", fontWeight:600, letterSpacing:"0.03em", textTransform:"uppercase" }}>{label}</label>
      {options ? (
        <select value={val} onChange={e => { setVal(e.target.value); onUpdate(dealId, { [field]: e.target.value || null } as Partial<Deal>); }}
          style={{ background:"#f5f1e8", border:"1px solid #e6dfd0", borderRadius:8, padding:"10px", fontSize:14, color:"#383a37", outline:"none" }}>
          <option value="">—</option>
          {options.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <div style={{ display:"flex", alignItems:"center", background:"#f5f1e8", border:"1px solid #e6dfd0", borderRadius:8, padding:"0 10px" }}>
          {prefix && <span style={{ color:"#a69e91", fontSize:14 }}>{prefix}</span>}
          <input
            value={val}
            onChange={e => setVal(e.target.value)}
            onBlur={commit}
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
            Correct any figure that doesn't match the OM. Changes save automatically and are logged in this deal's edit history — and the fields you most often correct get flagged for extra care on future extractions.
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

// ── Term sheet / closing statement PDF importer ──────────────────────────────
// Only shown on Owned/Sold deals. Extracts acquisition & financing terms via
// the existing server AI proxy and fills BLANK fields only — never overwrites.
function TermSheetImport({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const { mutateAsync: sendMessage } = useCreateAiMessage();

  const SCHEMA: Record<string, string> = {
    txnPurchasePrice:"purchase price (number)", txnSeller:"seller / counterparty", txnCloseDate:"closing date YYYY-MM-DD",
    acqCapRate:"going-in cap rate %", acqNOIAtClose:"in-place NOI at close (number)", acqEntity:"acquiring entity / borrower",
    acqBroker:"broker", acqDeposit:"earnest money / deposit (number)", acqClosingCosts:"closing costs (number)", acqFee:"acquisition fee (number)",
    acqCounsel:"legal counsel", acqStrategy:"strategy (Core/Core-Plus/Value-Add/Opportunistic)", acqHoldPeriod:"target hold years", acqTargetIRR:"target IRR %",
    debtLender:"lender", debtType:"loan type", debtLoanAmount:"loan amount (number)", debtRate:"interest rate %", debtRateType:"Fixed or Floating",
    debtIndex:"floating index", debtSpread:"spread in bps (number)", debtOriginationDate:"origination date YYYY-MM-DD", debtMaturityDate:"maturity date YYYY-MM-DD",
    debtTermYears:"term years", debtAmortYears:"amortization years", debtIOPeriod:"interest-only months", debtLTV:"LTV %", debtRecourse:"recourse",
    debtPrepay:"prepayment terms", debtExtensions:"extension options", debtEscrows:"escrows / reserves", debtAssumable:"assumable", debtContact:"lender contact",
  };

  async function handle(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    const taskId = startAiTask(`Reading term sheet — ${deal.propertyName || deal.fileName || "deal"}`, file.name);
    setBusy(true); setStatus("Reading term sheet…");
    try {
      const buf = await file.arrayBuffer();
      const { text } = await extractPdfText(buf);
      setStatus("Extracting deal terms with AI…");
      const sys = `You extract acquisition and financing terms from a commercial real estate term sheet, loan term sheet, or closing statement. Output ONLY a single JSON object with exactly these keys; use null for anything not clearly stated. For money use plain numbers (no $ or commas); for percentages use numbers (6.25 not "6.25%"). Keys and meanings: ${JSON.stringify(SCHEMA)}`;
      const resp = await sendMessage({ data: {
        system: sys,
        messages: [{ role: "user", content: `Term sheet / closing document text:\n${(text||"").slice(0,60000)}\n\nReturn ONLY the JSON object, no prose.` }],
        max_tokens: 1500,
      }});
      const raw = ((resp as any)?.content || []).filter((b: any) => b.type === "text").map((b: any) => b.text).join("\n");
      let out: Record<string, unknown> | null = null;
      try {
        const m = raw.match(/\{[\s\S]+\}/);
        if (m) out = JSON.parse(m[0]);
      } catch {}
      if (!out) { setStatus("Couldn't read terms from that PDF — try a clearer term sheet."); finishAiTask(taskId, "error", "Couldn't read terms from that term sheet"); setBusy(false); return; }
      const patch: Partial<Deal> = {};
      for (const k of Object.keys(SCHEMA)) {
        const v = out[k];
        if (v == null || v === "") continue;
        if ((deal as any)[k] != null && (deal as any)[k] !== "") continue;
        (patch as any)[k] = NUMERIC_TXN_FIELDS.has(k) && !isNaN(Number(v)) ? Number(v) : v;
      }
      const n = Object.keys(patch).length;
      if (n) onUpdate(deal.id, patch);
      setStatus(n ? `✓ Filled ${n} blank field${n>1?"s":""} from the term sheet — review and verify each before relying on it.` : "No new blank fields found to fill (existing entries were left untouched).");
      finishAiTask(taskId, "done", n ? `Term sheet — filled ${n} blank field${n>1?"s":""}` : "Term sheet read — no new blank fields to fill");
    } catch { setStatus("Couldn't read that PDF — try again."); finishAiTask(taskId, "error", "Couldn't read that term sheet PDF"); }
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
function PropertyChat({ deal }: { deal: Deal }) {
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

  const buildContext = () => ({
    property: deal.propertyName, address: deal.address, market: deal.market,
    assetType: deal.assetType, centerType: deal.centerType, status: deal.status,
    totalSF: deal.totalSF, occupancy: deal.occupancy, noi: deal.noi, capRate: deal.capRate,
    askingPrice: deal.askingPrice, walt: deal.walt, weightedAvgRentPSF: deal.weightedAvgRentPSF,
    grossPotentialRent: deal.grossPotentialRent, operatingExpenses: deal.operatingExpenses,
    nnnRecoveries: deal.nnnRecoveries, yearBuilt: deal.yearBuilt,
    highlights: deal.notes, redFlags: deal.redFlags, keyAssumptions: deal.keyAssumptions,
    demographics: deal.marketDemographics, sale: deal.marketSale,
    tenants: (deal.tenants || []).map(t => ({
      name: t.name, sf: t.sf, rentPSF: t.rentPerSF, annualRent: t.annualRent,
      start: t.leaseStart, expiry: t.leaseExpiry, reimbursement: t.reimbursementMethod,
      salesPSF: t.salesPSF, anchor: t.isAnchor || undefined,
      options: t.renewalOptions, rentSteps: t.rentSchedule,
    })),
  });

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
