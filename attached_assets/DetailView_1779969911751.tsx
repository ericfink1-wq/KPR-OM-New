import { useState, useEffect, useRef } from "react";
import type { Deal, ImageBundle, TenantSalesYear } from "../lib/idb";
import { apiLoadImages, apiSaveImages, apiReanalyzeDeal, apiPollDealStatus, apiIngestDeal, apiAiMessages, apiRefreshDemographics, apiRescore } from "../lib/api";
import { reconcileDeal, assessExtraction, classifyLocation, getRecency, buildCorrectionsNote, robustParseJSON } from "../lib/utils";
import { ensureUploadAllowed } from "../lib/uploadAuth";
import { STATUS_COLORS, GRADE_COLORS } from "../lib/constants";
import StatusTag from "./StatusTag";
import ScoreBadge from "./ScoreBadge";
import RecencyBadge from "./RecencyBadge";
import TenantRoster from "./TenantRoster";
import { loadPdfJs, _capturePagePhoto, extractPdfText } from "../lib/pdfExtract";
import { useCreateAiMessage } from "@workspace/api-client-react";
import { exportDealToExcel } from "../lib/exportExcel";
import MyUnderwritingPanel from "./MyUnderwritingPanel";
import LeaseRollover from "./LeaseRollover";
import { PDFDownloadLink } from "@react-pdf/renderer";
import DealSummaryPDF from "./DealSummaryPDF";
import { isInvestmentGrade } from "../lib/tenantCredit";
import ClosingCostsCard from "./ClosingCostsCard";
import TenantSalesPanel from "./TenantSalesPanel";
import { deriveExpenseRiskFlag } from "../lib/expenseRisk";

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

function ReconBadge({ msg }: { msg: string }) {
  return (
    <span title={msg} style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:15, height:15, borderRadius:3, background:"#fef3c7", border:"1px solid #f59e0b", color:"#92400e", fontSize:9, cursor:"help", flexShrink:0, lineHeight:1 }}>!</span>
  );
}

function StaleBadge() {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:4, background:"#fffbeb", border:"1px solid #f59e0b", borderRadius:5, padding:"2px 8px", fontSize:10, color:"#92400e", fontWeight:500, fontFamily:"'Inter',sans-serif", lineHeight:1.4 }}>
      ⚠ Roster updated — AI grade, summary &amp; red flags may be out of date.
    </span>
  );
}

function DataIntegrity({ deal }: { deal: Deal }) {
  const [open, setOpen] = useState(false);
  const { checks, errors, warns, hadData } = reconcileDeal(deal);
  const C = { error: "#dc2626", warn: "#b45309", ok: "#0f9d63" };
  if (!hadData) return null;
  if (checks.length === 0) {
    return (
      <div style={{ display:"flex", alignItems:"center", gap:8, background:"#0f9d6310", border:"1px solid #0f9d6333", borderRadius:8, padding:"10px 14px", marginBottom:12 }}>
        <span style={{ color:C.ok, fontSize:13 }}>✓</span>
        <span style={{ fontSize:11, color:"#0f6b46", fontWeight:500 }}>Data checks passed — extracted numbers are internally consistent.</span>
        <span style={{ fontSize:9, color:"#958d80", marginLeft:"auto" }}>Verify against the OM before deciding.</span>
      </div>
    );
  }
  const headColor = errors > 0 ? C.error : C.warn;
  const headBg = errors > 0 ? "#dc262610" : "#b4530910";
  const ordered = [...checks].sort((a, b) => (a.severity === "error" ? 0 : 1) - (b.severity === "error" ? 0 : 1));
  return (
    <div style={{ background:headBg, border:`1px solid ${headColor}40`, borderRadius:8, padding:"12px 16px", marginBottom:12 }}>
      <button onClick={() => setOpen(o => !o)} style={{ display:"flex", alignItems:"center", gap:10, width:"100%", background:"transparent", border:"none", cursor:"pointer", padding:0 }}>
        <span style={{ color:headColor, fontSize:14 }}>⚠</span>
        <span style={{ fontSize:11, fontWeight:700, letterSpacing:"0.06em", color:headColor }}>
          DATA INTEGRITY — {errors > 0 ? `${errors} error${errors>1?"s":""}` : ""}{errors > 0 && warns > 0 ? ", " : ""}{warns > 0 ? `${warns} to verify` : ""}
        </span>
        <span style={{ marginLeft:"auto", fontSize:10, color:"#958d80" }}>{open ? "HIDE ▴" : "REVIEW ▾"}</span>
      </button>
      {open && (
        <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:8 }}>
          {ordered.map((c, i) => (
            <div key={i} style={{ display:"flex", gap:10, padding:"8px 10px", background:"#fff", border:`1px solid ${C[c.severity]}33`, borderRadius:6 }}>
              <span style={{ color:C[c.severity], fontSize:9, fontWeight:700, letterSpacing:"0.05em", flexShrink:0, paddingTop:1 }}>{c.severity==="error"?"ERROR":"CHECK"}</span>
              <div>
                <div style={{ fontSize:11, color:"#383a37", fontWeight:600, marginBottom:2 }}>{c.label}</div>
                <div style={{ fontSize:11, color:"#6f6a5f", lineHeight:1.55 }}>{c.detail}</div>
              </div>
            </div>
          ))}
          <div style={{ fontSize:9, color:"#958d80", marginTop:2, lineHeight:1.5 }}>Automated checks — flag likely misreads, not confirmed errors. Verify against the OM.</div>
        </div>
      )}
    </div>
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

function SectionJump({ deal, scrollRef }: { deal: Deal; scrollRef: React.RefObject<HTMLDivElement | null> }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const items: { id: string; label: string }[] = [];
  items.push({ id: "section-cover", label: "Overview" });
  if (deal.notes) items.push({ id: "section-highlights", label: "Investment Highlights" });
  items.push({ id: "section-financials", label: "Key Financials" });
  items.push({ id: "section-demographics", label: "Demographics & Site" });
  items.push({ id: "section-trade-area", label: "Trade Area (Census)" });
  items.push({ id: "section-closing-costs", label: "Closing Costs" });
  if (deal.tenants && deal.tenants.length > 0) {
    items.push({ id: "section-tenants", label: "Tenant Roster" });
    items.push({ id: "section-tenant-sales", label: "Tenant Sales" });
    items.push({ id: "section-rollover", label: "Lease Rollover & WALT" });
  }
  if (deal.cashFlowProjection && deal.cashFlowProjection.length > 0) items.push({ id: "section-cashflow", label: "Cash Flow" });
  if ((deal.redFlags && deal.redFlags.length > 0) || deriveExpenseRiskFlag(deal)) items.push({ id: "section-redflags", label: "Red Flags" });
  if (deal.keyAssumptions) items.push({ id: "section-assumptions", label: "Key Assumptions" });
  items.push({ id: "section-notes", label: "Your Notes" });

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
      const y = el.getBoundingClientRect().top - container.getBoundingClientRect().top + container.scrollTop - 16;
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

export default function DetailView({ deal: d, allDeals, onBack, onDelete, onUpdate, onQuery, onCompare, onTenantClick }: Props) {
  const [confirmDel, setConfirmDel] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  const [imgs, setImgs] = useState<ImageBundle | null>(null);
  const [saleBusy, setSaleBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [analyzeOpen, setAnalyzeOpen] = useState(false);
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
  const [coverFinalized, setCoverFinalized] = useState(false);
  const [sitePlanFinalized, setSitePlanFinalized] = useState(false);
  const { mutateAsync: sendMessage } = useCreateAiMessage();
  const [rescoreBusy, setRescoreBusy] = useState(false);
  const autoRescoreTriggered = useRef(false);

  useEffect(() => {
    let alive = true;
    setImgs({});
    if (d.imageMeta && (d.imageMeta.cover || d.imageMeta.sitePlan)) {
      apiLoadImages(d.id).then(res => { if (alive) setImgs(res || {}); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [d.id]);

  // Auto-rescore when ≥10 new deals have been added to the portfolio since this deal was last scored
  useEffect(() => {
    const lastCount = d.lastScoredDealCount ?? 0;
    if (!autoRescoreTriggered.current && allDeals.length - lastCount >= 10) {
      autoRescoreTriggered.current = true;
      setRescoreBusy(true);
      apiRescore(d.id)
        .then(patch => onUpdate(d.id, patch as Partial<typeof d>))
        .catch(() => {})
        .finally(() => setRescoreBusy(false));
    }
  }, [d.id, allDeals.length]);

  const handleRescore = async () => {
    if (rescoreBusy) return;
    setRescoreBusy(true);
    try {
      const patch = await apiRescore(d.id);
      onUpdate(d.id, patch as Partial<typeof d>);
    } catch {}
    setRescoreBusy(false);
  };

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
    setRrBusy(true);
    setRrError(null);
    try {
      const { text } = await extractPdfText(await file.arrayBuffer());
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

      onUpdate(d.id, { tenants: newTenants, tenantsAsOf: asOf, tenantsSource: "rent-roll", analysisStale: true, ...recomputed });
    } catch (err: unknown) {
      setRrError(err instanceof Error ? err.message : "Rent roll import failed.");
    }
    setRrBusy(false);
  };

  const handleSalesUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ensureUploadAllowed()) return;
    setSalesBusy(true);
    setSalesError(null);
    try {
      const { text } = await extractPdfText(await file.arrayBuffer());
      const prompt = `You are a CRE data extraction engine. Extract tenant sales data from this document.
Return ONLY valid JSON — no markdown fences, no explanation — with this exact shape:
{
  "year": <integer — the SALES REPORTING YEAR this data represents, e.g. 2023. Look for phrases like "2023 Sales", "FY2023", "Year Ending Dec 2023". If ambiguous, use the most recent full calendar year mentioned.>,
  "tenants": [
    {
      "name": "string — tenant trade name only",
      "salesPSF": number_or_null,
      "annualSales": number_or_null,
      "sf": number_or_null,
      "occupancyCost": number_or_null
    }
  ]
}

RULES:
- annualSales: total annual sales volume in dollars. Convert from thousands (e.g. "$1,200" in a "Thousands" column → 1200000).
- salesPSF: sales per square foot (annual). If not provided but annualSales and sf are both present, compute it.
- occupancyCost: occupancy cost ratio as a percentage (e.g. 8.5 for 8.5%). Often labeled "OC%", "Occ Cost%", or "Rent/Sales".
- Skip vacant, storage, or non-reporting tenants. Only include tenants with at least one numeric value.
- year: CRITICAL — this field must represent the calendar/fiscal year the sales data belongs to. This is displayed to users so they know how current the data is.

TENANT SALES TEXT:
${text.slice(0, 60000)}`;

      const res = await apiAiMessages({
        model: "claude-haiku-4-5-20251001",
        max_tokens: 16000,
        messages: [{ role: "user", content: prompt }],
      });
      const raw = res.content.find((c: { type: string }) => c.type === "text")?.text ?? "";
      let parsed: { year?: number; tenants?: unknown[] };
      try { parsed = robustParseJSON(raw) as typeof parsed; } catch { throw new Error("Couldn't parse the AI response — try again."); }

      if (!parsed.year || typeof parsed.year !== "number") throw new Error("Could not detect a sales year from the document. Make sure the report mentions a year (e.g. '2023 Tenant Sales').");
      const newTenants = Array.isArray(parsed.tenants) ? parsed.tenants : [];
      if (newTenants.length === 0) throw new Error("No tenant sales found in the document.");

      const newSnapshot: TenantSalesYear = {
        year: parsed.year,
        uploadedAt: new Date().toISOString(),
        source: "upload",
        tenants: newTenants as TenantSalesYear["tenants"],
      };

      // Merge into existing history — replace if same year already exists
      const existing = (d.tenantSalesHistory || []).filter(s => s.year !== parsed.year);
      const updated = [...existing, newSnapshot].sort((a, b) => a.year - b.year);

      // Also update salesPSF on the current tenant roster if years match the most recent
      const latestYear = Math.max(...updated.map(s => s.year));
      const latestSnap = updated.find(s => s.year === latestYear);
      let updatedTenants = d.tenants;
      if (latestSnap && d.tenants?.length) {
        updatedTenants = d.tenants.map(t => {
          const match = latestSnap.tenants.find(
            s => s.name.toLowerCase().trim() === (t.name || "").toLowerCase().trim()
          );
          if (!match) return t;
          return {
            ...t,
            salesPSF: match.salesPSF ?? t.salesPSF,
            salesYear: latestSnap.year,
          };
        });
      }

      onUpdate(d.id, {
        tenantSalesHistory: updated,
        ...(updatedTenants !== d.tenants ? { tenants: updatedTenants } : {}),
      });
    } catch (err: unknown) {
      setSalesError(err instanceof Error ? err.message : "Sales upload failed.");
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
    setAnalyzeOpen(false);
    setReanalyzeBusy(true);
    try { await apiReanalyzeDeal(d.id); await pollUntilDone(d.id); onUpdate(d.id, { analysisStale: false }); } catch {}
    setReanalyzeBusy(false);
  };

  const handleRerunPdf = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (!ensureUploadAllowed()) return;
    setReanalyzeBusy(true);
    try {
      const { text, pages } = await extractPdfText(await file.arrayBuffer());
      await apiIngestDeal({ id: d.id, text, fileName: file.name, pageCount: pages, correctionsNote: buildCorrectionsNote(allDeals) });
      await pollUntilDone(d.id);
      onUpdate(d.id, { analysisStale: false });
    } catch {}
    setReanalyzeBusy(false);
  };

  const onLookupSale = async (id: string) => {
    if (!ensureUploadAllowed()) return;
    setSaleBusy(true);
    try {
      const resp = await sendMessage({ data: {
        system: "You are a CRE data analyst. Search for recent sale records of the property provided. Return JSON with: price (number), soldDate (string YYYY-MM-DD), capRate (number), buyer, seller, pricePerSF (number), summary (string), sources (array of {url, title}). If no sale found, return {notFound: true}.",
        messages: [{ role: "user", content: `Find sale records for: ${d.propertyName || d.fileName}, ${d.address || d.market}. Return JSON only.` }],
        max_tokens: 1024,
      }});
      const text = (resp as any)?.content?.[0]?.text || "";
      const jsonMatch = text.match(/\{[\s\S]+\}/);
      if (jsonMatch) {
        const data = JSON.parse(jsonMatch[0]);
        if (!data.notFound) {
          onUpdate(id, { marketSale: { ...data, lookedUpAt: new Date().toISOString() }, marketSaleChecked: new Date().toISOString() });
        } else {
          onUpdate(id, { marketSaleChecked: new Date().toISOString() });
        }
      }
    } catch { /* silently fail */ }
    finally { setSaleBusy(false); }
  };

  const onGetDemo = async (id: string) => {
    setDemoBusy(true);
    try {
      const demo = await apiRefreshDemographics(id);
      if (demo) {
        onUpdate(id, { marketDemographics: demo, demoChecked: new Date().toISOString() });
      } else {
        onUpdate(id, { demoChecked: new Date().toISOString() });
      }
    } catch { /* silently fail */ }
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
        const res = await _capturePagePhoto(pdf, pg, lib, sitePlanHalf);
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

  const handleCoverImageFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async () => {
      const dataUrl = reader.result as string;
      const current: ImageBundle = imgs || {};
      const next: ImageBundle = { ...current, cover: dataUrl };
      setImgs(next);
      await apiSaveImages(d.id, next);
      onUpdate(d.id, { imageMeta: { ...(d.imageMeta || {}), cover: true } });
    };
    reader.readAsDataURL(file);
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
    onUpdate(d.id, { tenants: newTenants, tenantsAsOf: asOf, tenantsSource: "rent-roll", analysisStale: true, ...recomputed });
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

  const Card = ({ title, children, accent }: { title: string; children: React.ReactNode; accent?: string }) => (
    <div style={{ background:"#fff", border:`1px solid ${accent||"#ece5d7"}`, borderRadius:12, padding:"16px 18px", boxShadow:"0 1px 2px rgba(56,58,55,0.04), 0 12px 28px -22px rgba(56,58,55,0.45)" }}>
      <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:accent||"#a89f8f", marginBottom:12 }}>{title}</div>
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
      { threshold: 0, rootMargin: "-80px 0px 0px 0px" }
    );
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const scrollContainerRef = useRef<HTMLDivElement>(null);

  return (
    <div ref={scrollContainerRef} style={{ flex:1, overflowY:"auto", padding:"20px 24px" }}>
      <div style={{
        position: "fixed",
        top: 72,
        left: 0,
        right: 0,
        zIndex: 90,
        background: "rgba(252,250,245,0.94)",
        backdropFilter: "blur(12px)",
        WebkitBackdropFilter: "blur(12px)",
        borderBottom: "1px solid #e7e0d2",
        padding: "10px 28px",
        boxShadow: titleScrolled ? "0 6px 18px -10px rgba(56,58,55,0.25)" : "none",
        transform: titleScrolled ? "translateY(0)" : "translateY(-110%)",
        transition: "transform 220ms cubic-bezier(0.4, 0, 0.2, 1), box-shadow 220ms ease",
        pointerEvents: titleScrolled ? "auto" : "none",
      }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <div style={{ flex: "1 1 auto", minWidth: 0 }}>
            <div style={{
              fontFamily: "'Fraunces',serif",
              fontSize: 17,
              fontWeight: 600,
              color: "#26281f",
              letterSpacing: "-0.01em",
              lineHeight: 1.2,
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
          <SectionJump deal={d} scrollRef={scrollContainerRef} />
        </div>
      </div>
      {/* Back */}
      <div style={{ marginBottom:10 }}>
        <button onClick={onBack} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif" }}>← BACK</button>
      </div>

      {/* Property name + jump */}
      <div style={{ display:"flex", alignItems:"flex-end", justifyContent:"space-between", gap:12, margin:"0 0 4px 0" }}>
        <h1 ref={titleRef} style={{ fontFamily:"'Fraunces',serif", fontSize:30, fontWeight:500, color:"#26281f", margin:0, letterSpacing:"-0.02em", lineHeight:1.08 }}>{d.propertyName||d.fileName}</h1>
        <SectionJump deal={d} scrollRef={scrollContainerRef} />
      </div>
      <p style={{ color:"#6f6a5f", fontSize:12, margin:"0 0 12px 0" }}>{fullAddress || "—"}</p>

      {/* Action buttons */}
      <div style={{ display:"flex", gap:6, flexWrap:"wrap", marginBottom:10 }}>
        {/* Analyze dropdown */}
        <div style={{ position:"relative" }}>
          <button onClick={() => setAnalyzeOpen(o => !o)} disabled={reanalyzeBusy}
            style={{ background:"transparent", border:"1px solid #383a37", color: reanalyzeBusy ? "#a69e91" : "#383a37", padding:"5px 10px", borderRadius:4, cursor: reanalyzeBusy ? "default" : "pointer", fontSize:10, fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:4 }}>
            {reanalyzeBusy ? "ANALYZING…" : <>ANALYZE <span style={{ fontSize:8 }}>▾</span></>}
          </button>
          {analyzeOpen && !reanalyzeBusy && (
            <div onClick={e => e.stopPropagation()} style={{ position:"absolute", top:"110%", right:0, background:"#fff", border:"1px solid #e3dccd", borderRadius:9, padding:4, zIndex:200, boxShadow:"0 8px 24px rgba(0,0,0,0.13)", minWidth:200 }}>
              <button onClick={handleReanalyze}
                style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"8px 12px", borderRadius:6, cursor:"pointer", fontSize:11.5, color:"#383a37", fontFamily:"'Inter',sans-serif" }}
                onMouseEnter={e => e.currentTarget.style.background="#f6f2ea"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                ↺ Re-analyze (stored text)
              </button>
              <button onClick={() => { setAnalyzeOpen(false); rerunPdfRef.current?.click(); }}
                style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"8px 12px", borderRadius:6, cursor:"pointer", fontSize:11.5, color:"#383a37", fontFamily:"'Inter',sans-serif" }}
                onMouseEnter={e => e.currentTarget.style.background="#f6f2ea"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                ↑ Re-run from PDF…
              </button>
              <div style={{ borderTop:"1px solid #f1ece1", margin:"4px 0" }}/>
              <button onClick={() => { setAnalyzeOpen(false); onQuery(`Full investment analysis on "${d.propertyName}": evaluate cap rate, WALT (${d.walt||"unknown"}yr), tenant credit quality, rent bumps, lease rollover risk. Give a buy/pass/watch recommendation.`); }}
                style={{ display:"block", width:"100%", textAlign:"left", background:"transparent", border:"none", padding:"8px 12px", borderRadius:6, cursor:"pointer", fontSize:11.5, color:"#6f6a5f", fontFamily:"'Inter',sans-serif" }}
                onMouseEnter={e => e.currentTarget.style.background="#f6f2ea"} onMouseLeave={e => e.currentTarget.style.background="transparent"}>
                ↗ Query Analyst
              </button>
            </div>
          )}
          <input ref={rerunPdfRef} type="file" accept=".pdf" style={{ display:"none" }} onChange={handleRerunPdf}/>
        </div>
        <button onClick={() => onQuery(`Find the 3 closest comps to "${d.propertyName}" (${d.assetType}, ${d.market}, ${d.totalSF?d.totalSF+" SF":"unknown size"}). Compare cap rates, WALT, and price/SF.`)}
          style={{ background:"transparent", border:"1px solid #6dba43", color:"#6dba43", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>COMPS</button>
        <button onClick={handleRescore} disabled={rescoreBusy} title={d.lastScoredAt ? `Last scored ${new Date(d.lastScoredAt).toLocaleDateString()}` : "Refresh score with latest portfolio benchmarks"}
          style={{ background:"transparent", border:`1px solid ${rescoreBusy?"#c8b89a":"#b08968"}`, color:rescoreBusy?"#c8b89a":"#b08968", padding:"5px 10px", borderRadius:4, cursor:rescoreBusy?"default":"pointer", fontSize:10, fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:4 }}>
          {rescoreBusy ? <><span style={{ display:"inline-block", animation:"spin 1s linear infinite", fontSize:11 }}>↻</span> SCORING…</> : <>↻ SCORE</>}
        </button>
        {((d.tenants||[]).length > 0 || (d.cashFlowProjection||[]).length > 0) && (
          <button onClick={() => exportDealToExcel(d)}
            style={{ background:"transparent", border:"1px solid #7c6f5e", color:"#7c6f5e", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:4 }}>
            <span style={{ fontSize:11, lineHeight:1 }}>⬇</span> EXCEL
          </button>
        )}
        <PDFDownloadLink
          document={<DealSummaryPDF deal={d} imgs={imgs} logoUrl={`${window.location.origin}/apple-touch-icon.png`} />}
          fileName={`${(d.propertyName||d.fileName||"deal").toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"")}-summary.pdf`}
          style={{ textDecoration:"none" }}
        >
          {({ loading }: { loading: boolean }) => (
            <button style={{ background:"transparent", border:"1px solid #4a7fb5", color: loading ? "#a69e91" : "#4a7fb5", padding:"5px 10px", borderRadius:4, cursor: loading ? "default" : "pointer", fontSize:10, fontFamily:"'Inter',sans-serif", display:"flex", alignItems:"center", gap:4, opacity: loading ? 0.7 : 1 }}>
              <span style={{ fontSize:11, lineHeight:1 }}>⬇</span>{loading ? "PDF…" : "SUMMARY"}
            </button>
          )}
        </PDFDownloadLink>
        <button onClick={() => onLookupSale(d.id)} disabled={saleBusy}
          style={{ background:"transparent", border:"1px solid #0d9488", color:saleBusy?"#a69e91":"#0d9488", padding:"5px 10px", borderRadius:4, cursor:saleBusy?"default":"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>{saleBusy?"SEARCHING…":"FIND SALE"}</button>
        {!confirmDel
          ? <button onClick={() => setConfirmDel(true)} style={{ background:"transparent", border:"1px solid #dc2626", color:"#dc2626", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>TRASH</button>
          : <>
              <button onClick={() => onDelete(d.id)} style={{ background:"#dc2626", border:"none", color:"#fff", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>CONFIRM DELETE</button>
              <button onClick={() => setConfirmDel(false)} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:10, fontFamily:"'Inter',sans-serif" }}>CANCEL</button>
            </>
        }
      </div>

      {/* Badges */}
      <div style={{ marginBottom:14 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", flexWrap:"wrap", gap:6, marginBottom:4 }}>
          <div style={{ display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
            <StatusTag status={d.status} onChange={s => onUpdate(d.id, { status:s })}/>
            <ScoreBadge score={d.dealScore} size={12}/>
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
            <div style={{ fontSize:10, color:"#a69e91" }}>{parts.join(" · ")}</div>
          ) : null;
        })()}
      </div>

      {/* Cover hero */}
      {imgs?.cover && (
        <div id="section-cover" onClick={() => setLightbox(imgs.cover!)} title="Click to enlarge"
          style={{ position:"relative", height:228, borderRadius:14, overflow:"hidden", marginBottom:16, cursor:"zoom-in", boxShadow:"0 1px 2px rgba(56,58,55,0.05), 0 20px 40px -28px rgba(56,58,55,0.6)", border:"1px solid #ece5d7" }}>
          <img src={imgs.cover} alt={`${d.propertyName||"Property"} cover`} style={{ width:"100%", height:"100%", objectFit:"cover", display:"block" }}/>
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(180deg, rgba(38,40,31,0) 45%, rgba(38,40,31,0.55) 100%)" }}/>
          <div style={{ position:"absolute", left:18, bottom:14, color:"#fff", fontSize:9, letterSpacing:"0.18em", textTransform:"uppercase", opacity:0.85, fontWeight:600 }}>From the offering memorandum</div>
        </div>
      )}

      {/* Cover fixer */}
      {imgs != null && (
        coverFinalized ? (
          <div style={{ marginBottom:16, textAlign:"right" }}>
            <button onClick={() => setCoverFinalized(false)} style={{ background:"transparent", border:"none", color:"#a69e91", fontSize:10.5, cursor:"pointer", fontFamily:"'Inter',sans-serif", padding:0, textDecoration:"underline", textDecorationColor:"#d8cfbd" }}>✎ edit cover photo</button>
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
                <input type="checkbox" id="coverFinalChk" onChange={e => { if (e.target.checked) setCoverFinalized(true); }} style={{ accentColor:"#6dba43", width:13, height:13, cursor:"pointer" }}/>
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

      <ExtractionQuality deal={d}/>
      <DataIntegrity deal={d}/>

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

      {/* AI highlights */}
      {(d.notes || d.analysisStale) && (
        <div id="section-highlights" style={{ background:"linear-gradient(180deg,#fff,#fcfbf6)", border:"1px solid #e3dccd", borderLeft:"3px solid #6dba43", borderRadius:12, padding:"16px 18px", marginBottom:12, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:8, marginBottom:9 }}>
            <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#3f6b24" }}>AI Investment Highlights</div>
            {d.analysisStale && <StaleBadge />}
          </div>
          {d.notes && <p style={{ color:"#5b574d", fontSize:13, lineHeight:1.75, margin:0 }}>{d.notes}</p>}
        </div>
      )}

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

      {/* My Underwriting */}
      <MyUnderwritingPanel deal={d} onUpdate={onUpdate}/>

      {/* Verified hint */}
      {(() => {
        const vcount = Object.keys(d.verified || {}).length;
        return (
          <div style={{ display:"flex", alignItems:"center", gap:8, marginBottom:12, fontSize:11, color:vcount?"#0f6b46":"#a69e91" }}>
            <span style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:15, height:15, borderRadius:4, border:`1px solid ${vcount?"#0f9d63":"#cfd6dd"}`, background:vcount?"#0f9d63":"transparent", color:"#fff", fontSize:9, flexShrink:0 }}>{vcount?"✓":""}</span>
            {vcount ? `${vcount} figure${vcount>1?"s":""} verified — locked against re-analyze.` : "Tip: click ☐ beside a figure to verify/lock it."}
          </div>
        );
      })()}

      {/* Site plan */}
      {imgs != null && imgs.sitePlan && imgs.sitePlan.length > 0 && (
        sitePlanFinalized ? (
          <div style={{ marginBottom:12, textAlign:"right" }}>
            <button onClick={() => setSitePlanFinalized(false)} style={{ background:"transparent", border:"none", color:"#a69e91", fontSize:10.5, cursor:"pointer", fontFamily:"'Inter',sans-serif", padding:0, textDecoration:"underline", textDecorationColor:"#d8cfbd" }}>✎ edit site plan</button>
          </div>
        ) : (
          <div style={{ background:"#fff", border:"1px solid #ece5d7", borderRadius:12, padding:"16px 18px", marginBottom:12, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ fontSize:9, letterSpacing:"0.16em", textTransform:"uppercase", fontWeight:700, color:"#a89f8f", marginBottom:12 }}>Site Plan</div>
            <div style={{ display:"grid", gap:10 }}>
              {imgs.sitePlan.map((src, i) => (
                <div key={i} onClick={() => setLightbox(src)} style={{ cursor:"zoom-in", borderRadius:9, overflow:"hidden", border:"1px solid #ece5d7" }}>
                  <img src={src} alt={`Site plan ${i+1}`} style={{ width:"100%", display:"block" }}/>
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
              <input type="checkbox" id="sitePlanFinalChk" onChange={e => { if (e.target.checked) setSitePlanFinalized(true); }} style={{ accentColor:"#6dba43", width:13, height:13, cursor:"pointer" }}/>
              <label htmlFor="sitePlanFinalChk" style={{ fontSize:11, color:"#7d766a", cursor:"pointer", userSelect:"none" }}>Confirmed / finalize — hides this box</label>
            </div>
          </div>
        )
      )}

      {/* Site plan — empty state (no images, no page picks yet) */}
      {imgs != null && (!imgs.sitePlan || imgs.sitePlan.length === 0) && (!imgs.pagePicks || imgs.pagePicks.length === 0) && (
        sitePlanFinalized ? (
          <div style={{ marginBottom:12, textAlign:"right" }}>
            <button onClick={() => setSitePlanFinalized(false)} style={{ background:"transparent", border:"none", color:"#a69e91", fontSize:10.5, cursor:"pointer", fontFamily:"'Inter',sans-serif", padding:0, textDecoration:"underline", textDecorationColor:"#d8cfbd" }}>✎ edit site plan</button>
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

      {/* Rent roll importer */}
      {(d.tenants||[]).length > 0 && (
        <div style={{ marginBottom:12, background:"#f3f7ee", border:"1px dashed #b8d49a", borderRadius:10, padding:"10px 14px" }}>
          <style>{`@keyframes rrIndeterminate{0%{transform:translateX(-110%)}100%{transform:translateX(310%)}}`}</style>
          <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
            <input ref={rrPdfRef} type="file" accept="application/pdf" style={{ display:"none" }} onChange={handleRentRoll}/>
            <button onClick={() => { setRrError(null); rrPdfRef.current?.click(); }} disabled={rrBusy}
              style={{ background: rrBusy ? "#e7ecde" : "#fff", border:"1px solid #8cbf63", color:"#3f7a1f", padding:"8px 14px", borderRadius:8, cursor: rrBusy ? "default" : "pointer", fontSize:12, fontWeight:600, fontFamily:"'Inter',sans-serif" }}>
              {rrBusy ? "Refreshing…" : "⬆ Refresh tenants from a current rent roll (PDF)"}
            </button>
            <span style={{ fontSize:12, color: rrError ? "#dc2626" : (d.tenantsSource === "rent-roll" && d.tenantsAsOf ? "#3f7a1f" : "#6f6a5f") }}>
              {rrError || (d.tenantsSource === "rent-roll" && d.tenantsAsOf
                ? `✓ Last refreshed from rent roll — ${d.tenantsAsOf}`
                : "Replaces the roster with the current rent roll and stamps its date.")}
            </span>
          </div>
          {rrBusy && (
            <div style={{ marginTop:9, height:5, borderRadius:3, background:"#dfe7d2", overflow:"hidden" }}>
              <div style={{ height:"100%", width:"40%", borderRadius:3, background:"#6dba43", animation:"rrIndeterminate 1.1s ease-in-out infinite" }}/>
            </div>
          )}
          <div style={{ marginTop:10, borderTop:"1px solid #d2e5ba", paddingTop:10 }}>
            <button onClick={() => { setPastePanelOpen(o => !o); setPasteError(null); }}
              style={{ background:"transparent", border:"none", color:"#4d8a2a", fontSize:11.5, fontWeight:600, cursor:"pointer", padding:0, fontFamily:"'Inter',sans-serif" }}>
              {pastePanelOpen ? "Close paste box" : "⌘ Paste roster from Claude (no API)"}
            </button>
            {pastePanelOpen && (
              <div style={{ marginTop:8, display:"flex", flexDirection:"column", gap:7 }}>
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
          </div>
        </div>
      )}

      {/* Tenant roster */}
      {(d.tenants||[]).length > 0 && (
        <div id="section-tenants"><TenantRoster
          tenants={d.tenants!}
          onTenantClick={onTenantClick}
          tenantsAsOf={d.tenantsAsOf}
          tenantsSource={d.tenantsSource}
          omDate={d.omDate}
        /></div>
      )}

      {/* Tenant Sales Panel — always show if tenants exist (even with no sales history yet) */}
      {(d.tenants||[]).length > 0 && (
        <div id="section-tenant-sales">
          <TenantSalesPanel
            salesHistory={d.tenantSalesHistory || []}
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
        <div style={{ background:"#faf7f0", border:"1px solid #e7e0d2", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
          <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:8, marginBottom:10 }}>
            <div style={{ fontSize:8, letterSpacing:"0.1em", color:"#958d80" }}>AI DEAL SCORE</div>
            {d.dealScore && <ScoreBadge score={d.dealScore}/>}
            {d.analysisStale && <StaleBadge />}
          </div>
          {d.dealScore && <>
            <p style={{ fontSize:12, color:"#5c5f57", lineHeight:1.7, margin:"0 0 12px 0" }}>{d.dealScore.rationale}</p>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div>
                <div style={{ fontSize:8, color:"#0f9d63", letterSpacing:"0.08em", marginBottom:5 }}>STRENGTHS</div>
                {(d.dealScore.strengths||[]).map((s,i) => <div key={i} style={{ fontSize:11, color:"#7d766a", marginBottom:2 }}>› {s}</div>)}
              </div>
              <div>
                <div style={{ fontSize:8, color:"#dc2626", letterSpacing:"0.08em", marginBottom:5 }}>RISKS</div>
                {(d.dealScore.risks||[]).map((r,i) => <div key={i} style={{ fontSize:11, color:"#7d766a", marginBottom:2 }}>› {r}</div>)}
              </div>
            </div>
          </>}
        </div>
      )}

      {/* Red flags */}
      {(() => {
        const expenseFlag = deriveExpenseRiskFlag(d);
        const sevOrder: Record<string, number> = { high: 0, medium: 1, low: 2 };
        const allRedFlags = [...(expenseFlag ? [expenseFlag] : []), ...(d.redFlags || [])]
          .sort((a, b) => (sevOrder[a.severity ?? "low"] ?? 2) - (sevOrder[b.severity ?? "low"] ?? 2));
        return (allRedFlags.length > 0 || d.analysisStale) && (
          <div id="section-redflags" style={{ background:"#faf7f0", border:"1px solid #dc262630", borderRadius:8, padding:"14px 16px", marginBottom:12 }}>
            <div style={{ display:"flex", alignItems:"center", flexWrap:"wrap", gap:8, marginBottom:10 }}>
              <div style={{ fontSize:8, letterSpacing:"0.1em", color:"#dc2626" }}>⚠ RED FLAGS</div>
              {d.analysisStale && <StaleBadge />}
            </div>
            {allRedFlags.map((f,i) => (
              <div key={i} style={{ display:"flex", gap:10, padding:"6px 0", borderBottom:i<allRedFlags.length-1?"1px solid #e7e0d2":"none", alignItems:"flex-start" }}>
                <span style={{ fontSize:9, padding:"2px 6px", borderRadius:3, background:f.severity==="high"?"#dc262615":f.severity==="medium"?"#f9731615":"#eab30815", color:f.severity==="high"?"#dc2626":f.severity==="medium"?"#ea6000":"#b08000", fontWeight:600, flexShrink:0 }}>{f.severity?.toUpperCase()}</span>
                <span style={{ fontSize:11, color:"#5c5f57" }}>{f.description}</span>
              </div>
            ))}
          </div>
        );
      })()}

      {/* Key assumptions */}
      <div id="section-assumptions"><KeyAssumptions deal={d} /></div>

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
      {(d.status === "Under Contract" || d.status === "Owned" || d.status === "Sold") && (() => {
        const owned = d.status === "Owned" || d.status === "Sold";
        const sold  = d.status === "Sold";
        const tf = (p: Omit<TxnFieldProps,"dealId"|"onUpdate">) =>
          <TxnField key={p.field as string} {...p} initial={d[p.field]} dealId={d.id} onUpdate={onUpdate} />;
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

            {owned && <TermSheetImport deal={d} onUpdate={onUpdate}/>}

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

            {/* Disposition */}
            <div style={{ fontSize:13, fontWeight:600, color:"#383a37", marginBottom:10, display:"flex", alignItems:"center", gap:8 }}>
              <span style={{ width:6, height:6, borderRadius:"50%", background:sold?"#0d9488":"#d0c9bc" }}/>{sold ? "Disposition Record" : "Disposition"}
            </div>

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
          </div>
        );
      })()}

      {/* FINANCING & DEBT — full loan record once a deal is Owned or Sold */}
      {(() => {
        const owned = d.status === "Owned" || d.status === "Sold";
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
              <span style={{ fontWeight:600, color:"#383a37" }}>Financing & Debt</span> — set this deal's status to <span style={{ fontWeight:600 }}>Owned</span> to record acquisition financing.
            </div>
            <button onClick={() => onUpdate(d.id, { status:"Owned" })}
              style={{ background:"#6dba43", border:"none", color:"#1f2b16", padding:"8px 16px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:700, whiteSpace:"nowrap" }}>
              Mark as Owned
            </button>
          </div>
        );

        return (
          <div style={{ background:"#ffffff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
            <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase", marginBottom:14 }}>Financing & Debt</div>
            <div style={{ display:"grid", gridTemplateColumns:"repeat(auto-fit, minmax(200px, 1fr))", gap:14 }}>
              <Group title="Lender & Loan"/>
              {f({ label:"Lender / Servicer", field:"debtLender", placeholder:"e.g. JPMorgan, Fannie Mae" })}
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
          <Row l="BROKER" v={d.broker}/>
          <Row l="SELLER" v={d.seller}/>
          <Row l="LAST SALE DATE" v={d.lastSaleDate}/>
          <Row l="LAST SALE PRICE" v={d.lastSalePrice?`$${Number(d.lastSalePrice).toLocaleString()}`:null}/>
        </Card>
      </div>

      <ClosingCostsCard deal={d} />

      {/* Demographics from OM */}
      {(d.trafficCountVPD || d.population3mi || d.medianHHIncome3mi) && (
        <div id="section-demographics"><Card title="DEMOGRAPHICS & SITE">
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
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>Trade Area — 1 / 3 / 5 Mile</div>
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
              <div style={{ fontSize:9, color:"#a69e91", marginTop:9 }}>Sourced from US Census Bureau ACS 5-Year Estimates. Tract-aggregated within radius rings — verify before relying on it.</div>

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
      if (!out) { setStatus("Couldn't read terms from that PDF — try a clearer term sheet."); setBusy(false); return; }
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
    } catch { setStatus("Couldn't read that PDF — try again."); }
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
  const endRef = useRef<HTMLDivElement>(null);
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
    "What's the largest near-term rollover risk?",
    "Which tenants pay below-market rent?",
    "Summarize the lease and reimbursement profile",
  ];

  return (
    <>
      <button onClick={() => setOpen(o => !o)} title="Ask AI about this property"
        style={{ position:"fixed", bottom:24, right:24, zIndex:160, height:52, padding:open?0:"0 20px", width:open?52:"auto", borderRadius:26, background:"#6dba43", color:"#1f2b16", border:"none", boxShadow:"0 8px 24px -6px rgba(56,58,55,0.5)", cursor:"pointer", fontSize:14, fontWeight:700, display:"flex", alignItems:"center", justifyContent:"center", gap:8, fontFamily:"'Inter',sans-serif", transition:"width .2s,padding .2s" }}>
        {open ? "✕" : "✦ Ask about this property"}
      </button>
      {open && (
        <div style={{ position:"fixed", bottom:88, right:24, zIndex:160, width:374, maxWidth:"calc(100vw - 48px)", height:480, maxHeight:"calc(100vh - 130px)", background:"#fff", border:"1px solid #e7e0d2", borderRadius:16, boxShadow:"0 16px 50px -12px rgba(56,58,55,0.4)", display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Header */}
          <div style={{ padding:"13px 16px", borderBottom:"1px solid #f1eadc", background:"#faf7f0", flexShrink:0 }}>
            <div style={{ fontFamily:"'Fraunces',serif", fontWeight:600, fontSize:15, color:"#26281f" }}>Property assistant</div>
            <div style={{ fontSize:11, color:"#a69e91", marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{deal.propertyName || "This property"}</div>
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
          <div style={{ borderTop:"1px solid #f1eadc", padding:"10px 12px", display:"flex", gap:7, flexShrink:0 }}>
            <input value={input} onChange={e => setInput(e.target.value)}
              onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); ask(input); } }}
              disabled={thinking} placeholder="Ask about this property…"
              style={{ flex:1, background:"#fff", border:"1px solid #e3dccd", borderRadius:9, padding:"9px 12px", fontSize:13, color:"#383a37", outline:"none", fontFamily:"'Inter',sans-serif" }}/>
            <button onClick={() => ask(input)} disabled={thinking || !input.trim()}
              style={{ background:(!thinking && input.trim()) ? "#6dba43" : "#efe8da", color:(!thinking && input.trim()) ? "#1f2b16" : "#b3aa9b", border:"none", borderRadius:9, padding:"0 15px", fontSize:15, fontWeight:700, cursor:(!thinking && input.trim()) ? "pointer" : "default" }}>↑</button>
          </div>
        </div>
      )}
    </>
  );
}

function PriceCapEditor({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  const [price, setPrice] = useState<string|number>(deal.askingPrice ?? "");
  const [cap, setCap] = useState<string|number>(deal.capRate ?? "");
  useEffect(() => { setPrice(deal.askingPrice ?? ""); setCap(deal.capRate ?? ""); }, [deal.id]);
  const saveP = () => { const v = price===""?null:Number(price); if (price===""?deal.askingPrice!=null:(!isNaN(Number(price))&&v!==(deal.askingPrice??null))) onUpdate(deal.id, { askingPrice:v }); };
  const saveC = () => { const v = cap===""?null:Number(cap); if (cap===""?deal.capRate!=null:(!isNaN(Number(cap))&&v!==(deal.capRate??null))) onUpdate(deal.id, { capRate:v }); };
  const inp = { fontSize:12, padding:"5px 9px", border:"1px solid #e3dccd", borderRadius:6, color:"#383a37", background:"#fff", width:"100%", fontFamily:"'Inter',sans-serif", boxSizing:"border-box" as const };
  return (
    <div style={{ marginTop:12, paddingTop:12, borderTop:"1px dashed #e7e0d2" }}>
      <div style={{ fontSize:8.5, letterSpacing:"0.12em", color:"#a89f8f", marginBottom:7, textTransform:"uppercase", fontWeight:700 }}>Enter price / cap manually</div>
      <div style={{ display:"flex", gap:8 }}>
        <div style={{ flex:1 }}>
          <div style={{ fontSize:9, color:"#a69e91", marginBottom:3 }}>ASKING PRICE $</div>
          <input value={price} onChange={e => setPrice(e.target.value)} onBlur={saveP} onKeyDown={e => e.key==="Enter"&&e.currentTarget.blur()} placeholder="—" inputMode="numeric" style={inp}/>
        </div>
        <div style={{ width:92 }}>
          <div style={{ fontSize:9, color:"#a69e91", marginBottom:3 }}>CAP RATE %</div>
          <input value={cap} onChange={e => setCap(e.target.value)} onBlur={saveC} onKeyDown={e => e.key==="Enter"&&e.currentTarget.blur()} placeholder="—" inputMode="decimal" style={inp}/>
        </div>
      </div>
    </div>
  );
}
