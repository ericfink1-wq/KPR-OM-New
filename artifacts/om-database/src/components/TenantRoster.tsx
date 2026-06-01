import { useState, useRef, useEffect } from "react";
import { createPortal } from "react-dom";
import { Info, Moon } from "lucide-react";
import type { Tenant, OccBreakdown } from "../lib/idb";
import { fmtLeaseDate, fmtTenantSales, isVacant, isNAPTenant, tenantKey } from "../lib/utils";
import { isInvestmentGrade } from "../lib/tenantCredit";
import { useWatchlist, lookupWatch, WATCH_STATUS_META } from "../lib/useWatchlist";
import { useIsMobile } from "../hooks/use-mobile";

interface Props {
  tenants: Tenant[];
  onTenantClick?: (name: string) => void;
  onUpdateTenant?: (index: number, patch: Partial<Tenant>) => void;
  tenantsAsOf?: string | null;
  tenantsSource?: string | null;
  omDate?: string | null;
  // Estimated per-tenant recoveries (by tenantKey) — used as a fallback for the
  // occupancy-cost calc when the OM didn't disclose a tenant's recoveries.
  estimatedRecoveries?: Map<string, { value: number; estimated: boolean }>;
}

function OccTip({ val, source, breakdown }: { val: number; source: "stated" | "computed"; breakdown?: OccBreakdown | null }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLSpanElement>(null);
  const isMobile = useIsMobile();

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
        onMouseEnter={isMobile ? undefined : () => setOpen(true)}
        onMouseLeave={isMobile ? undefined : () => setOpen(false)}
        onClick={e => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ cursor: "pointer", display: "inline-flex", alignItems: "center", gap: 3 }}
      >
        {val.toFixed(1)}%
        <span style={{ fontSize: 8, letterSpacing: "0.04em", color: isStated ? "#0f9d63" : "#7d766a", background: isStated ? "#e7f8f0" : "#f3f4f6", border: `1px solid ${isStated ? "#a7f3d0" : "#d1d5db"}`, borderRadius: 3, padding: "0px 3px", fontWeight: 700, fontFamily: "'Inter',sans-serif" }}>
          {source}
        </span>
      </span>
      {open && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 6px)", right: 0,
          background: "#fff", border: "1px solid #e6dfd0", borderRadius: 10,
          boxShadow: "0 8px 24px rgba(56,58,55,0.18)", padding: "10px 14px",
          zIndex: 9999, minWidth: 200, maxWidth: "min(280px, calc(100vw - 32px))",
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
        </div>
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
  const showTimer = useRef<number | null>(null);
  const ref = useRef<HTMLSpanElement>(null);
  const isMobile = useIsMobile();

  const showSoon = () => {
    if (showTimer.current) window.clearTimeout(showTimer.current);
    showTimer.current = window.setTimeout(() => setOpen(true), 150);
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
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ color, cursor: "pointer", userSelect: "none" }}
        aria-label={content}
        role="button"
        tabIndex={0}
      >
        {children}
      </span>

      {/* Desktop: right-of-icon popover */}
      {open && !isMobile && (
        <span
          onClick={(e) => e.stopPropagation()}
          style={{
            position: "absolute",
            top: "calc(100% + 6px)",
            left: 0,
            background: "#26281f",
            color: "#f6f2ea",
            padding: "9px 13px",
            borderRadius: 7,
            fontSize: 12,
            lineHeight: 1.5,
            whiteSpace: "normal",
            width: "max-content",
            maxWidth: 320,
            zIndex: 10000,
            boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
          }}
        >
          {content}
        </span>
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

export default function TenantRoster({ tenants, onTenantClick, onUpdateTenant, tenantsAsOf, tenantsSource, omDate, estimatedRecoveries }: Props) {
  const watchMap = useWatchlist();
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState("all");
  const [sortKey, setSortKey] = useState("sf");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");
  const [expandedRentStep, setExpandedRentStep] = useState<number | null>(null);
  const [expandedOption, setExpandedOption] = useState<number | null>(null);
  const [expandedReimb, setExpandedReimb] = useState<number | null>(null);
  const [editingOcc, setEditingOcc] = useState<number | null>(null);
  const [editVals, setEditVals] = useState<{ reimb: string; pctRent: string; other: string }>({ reimb: "", pctRent: "", other: "" });
  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);

  let rows = tenants.slice();
  if (quick==="anchors") rows = rows.filter(t => t.isAnchor);
  else if (quick==="dark") rows = rows.filter(t => t.isDark);
  else if (quick==="expiring") rows = rows.filter(t => n(t.remainingTermYears) != null && n(t.remainingTermYears)! < 2);
  else if (quick==="footnotes") rows = rows.filter(t => t.assumptionNote);
  if (q.trim()) { const s = q.toLowerCase(); rows = rows.filter(t => (t.name||"").toLowerCase().includes(s)); }

  const numKeys = new Set(["sf","rentPerSF","annualRent","salesPSF","occupancyCost"]);
  if (sortKey) {
    rows = rows.slice().sort((a, b) => {
      if (numKeys.has(sortKey)) {
        let av = n((a as any)[sortKey]), bv = n((b as any)[sortKey]);
        av = av==null?-Infinity:av; bv = bv==null?-Infinity:bv;
        return sortDir==="asc" ? av-bv : bv-av;
      }
      const av = ((a as any)[sortKey]==null?"":String((a as any)[sortKey])).toLowerCase();
      const bv = ((b as any)[sortKey]==null?"":String((b as any)[sortKey])).toLowerCase();
      return sortDir==="asc" ? av.localeCompare(bv) : bv.localeCompare(av);
    });
  }

  const setSort = (k: string) => { if (sortKey===k) setSortDir(x => x==="asc"?"desc":"asc"); else { setSortKey(k); setSortDir("asc"); } };
  const arrow = (k: string) => sortKey===k ? (sortDir==="asc"?" ▲":" ▼") : "";
  const chip = (key: string, label: string) => (
    <button key={key} onClick={() => setQuick(key)} style={{ background:quick===key?"#2a2c27":"transparent", color:quick===key?"#f6f2ea":"#7d766a", border:`1px solid ${quick===key?"#2a2c27":"#e3dccd"}`, padding:"4px 11px", borderRadius:20, fontSize:11, cursor:"pointer", fontWeight:500, fontFamily:"'Inter',sans-serif" }}>{label}</button>
  );

  const cols: [string, string, boolean][] = [
    ["name","Tenant",false],["sf","SF",true],["rentPerSF","Rent/SF",true],["annualRent","Ann. Rent",true],
    ["leaseStart","Start",false],["leaseExpiry","Expiry",false],["reimbursementMethod","Reimb.",false],
    ["rentSchedule","Rent Steps",false],["renewalOptions","Options",false],["recentlyExercisedRenewal","Recent Renewal",false],
    ["salesPSF","Sales",true],["occupancyCost","Occ Cost",true],["creditRating","Credit",false],
  ];

  const isVacantRow = (t: Tenant) => isVacant(t.name);
  const vacantCount = tenants.filter(isVacantRow).length;
  const occupiedCount = tenants.length - vacantCount;

  const asOfDate = tenantsAsOf || omDate;
  const asOfLabel = tenantsSource === "rent-roll" ? "RENT ROLL" : "OM";

  return (
    <div style={{ background:"#fff", border:"1px solid #efe8da", borderRadius:12, padding:"18px 20px", marginBottom:14, boxShadow:"0 1px 2px rgba(56,58,55,0.04)" }}>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", gap:12, marginBottom:13, flexWrap:"wrap" }}>
        <div style={{ display:"flex", alignItems:"center", gap:10, flexWrap:"wrap" }}>
          <div style={{ fontSize:11, letterSpacing:"0.06em", color:"#a69e91", fontWeight:600, textTransform:"uppercase" }}>Tenant Roster — {rows.length===tenants.length ? `${occupiedCount} tenant${occupiedCount!==1?"s":""}${vacantCount>0?` · ${vacantCount} vacant`:""}` : `${rows.length} of ${tenants.length}`}</div>
          {asOfDate && (
            <span style={{ fontSize:9, letterSpacing:"0.07em", fontWeight:600, color: tenantsSource==="rent-roll" ? "#0d9488" : "#a89f8f", background: tenantsSource==="rent-roll" ? "#f0fdfa" : "#f6f2ea", border:`1px solid ${tenantsSource==="rent-roll" ? "#99f6e4" : "#e3dccd"}`, borderRadius:8, padding:"2px 8px", textTransform:"uppercase", whiteSpace:"nowrap" }}>
              AS OF {fmtAsOf(asOfDate)} · {asOfLabel}
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
      <div style={{ overflowX:"auto" }}>
        <table style={{ borderCollapse:"collapse", fontSize:12, minWidth:1180, width:"100%" }}>
          <thead>
            <tr style={{ fontSize:10, letterSpacing:"0.03em" }}>
              {cols.map(([k,label,right]) => (
                <th key={k} onClick={() => setSort(k)} style={{ padding:"6px 10px", textAlign:right?"right":"left", cursor:"pointer", whiteSpace:"nowrap", userSelect:"none", color:sortKey===k?"#383a37":"#a69e91", fontWeight:600 }}>{label}{arrow(k)}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((t,i) => (
              <tr key={i} style={{ borderTop:"1px solid #f1eadc", opacity: isNAPTenant(t) ? 0.7 : isVacantRow(t) ? 0.65 : 1, background: t.isDark && !isVacantRow(t) ? "#fbf1e4" : undefined }}>
                <td style={{ padding:"8px 10px", whiteSpace:"nowrap" }}>
                  {isVacantRow(t) ? (
                    <span style={{ color:"#a69e91", fontStyle:"italic", fontWeight:400, fontSize:11 }}>Vacant</span>
                  ) : (
                    <div style={{ display:"flex", alignItems:"center", flexWrap:"nowrap", gap:4, minWidth:0 }}>
                      <span
                        onClick={onTenantClick && t.name ? () => onTenantClick(t.name!) : undefined}
                        title={onTenantClick && t.name ? `View ${t.name} across your portfolio` : undefined}
                        style={{ color: t.isDark ? "#9a5b12" : "#383a37", fontWeight:600, cursor:onTenantClick?"pointer":"default", textDecoration:onTenantClick?"underline":"none", textDecorationColor:"#d8cfbd", textUnderlineOffset:"2px", whiteSpace:"nowrap" }}>
                        {t.name}
                      </span>
                      {t.isAnchor && <span style={{ fontSize:9, color:"#1f2b16", background:"#6dba4322", padding:"1px 6px", borderRadius:10, fontWeight:600 }}>ANCHOR</span>}
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
                      {t.name && isInvestmentGrade(t.name, t.creditRating) && <span style={{ fontSize:9, color:"#3f7a1f", background:"#eef3e6", border:"1px solid #b8d49a", padding:"1px 6px", borderRadius:4, fontWeight:700 }}>Investment Grade</span>}
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
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>{n(t.sf)!=null?n(t.sf)!.toLocaleString():"—"}</td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#0f9d63", fontWeight:500, whiteSpace:"nowrap" }}>{n(t.rentPerSF)!=null?`$${n(t.rentPerSF)!.toFixed(2)}`:"—"}</td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#383a37", whiteSpace:"nowrap" }}>{n(t.annualRent)!=null?`$${n(t.annualRent)!.toLocaleString()}`:"—"}</td>
                <td style={{ padding:"8px 10px", color:"#8b9097", whiteSpace:"nowrap" }}>{fmtLeaseDate(t.leaseStart)}</td>
                <td style={{ padding:"8px 10px", whiteSpace:"nowrap", color:n(t.remainingTermYears)!=null&&n(t.remainingTermYears)!<2?"#dc2626":n(t.remainingTermYears)!=null&&n(t.remainingTermYears)!<4?"#c97a18":"#5c5f57" }}>{fmtLeaseDate(t.leaseExpiry)}</td>
                <td
                  onClick={() => setExpandedReimb(expandedReimb === i ? null : i)}
                  style={{ padding:"8px 10px", fontSize:11, cursor:"pointer", verticalAlign:"top", maxWidth: expandedReimb === i ? 400 : 300, minWidth:120, overflow:"hidden" }}
                >
                  {(() => {
                    const m = t.reimbursementMethod || t.leaseType || "";
                    if (!m) return <span style={{ color:"#c4bbaa" }}>—</span>;
                    const gross = /gross/i.test(m), fixed = /\bfixed\b/i.test(m);
                    const flag = gross ? { t:"GROSS", c:"#b91c1c", bg:"#fdecea", tip:"Gross lease — landlord absorbs expense growth (no recovery)" }
                              : fixed ? { t:"FIXED", c:"#b45309", bg:"#fbe6cf", tip:"Fixed reimbursement — landlord absorbs expense growth above the fixed amount" } : null;
                    if (expandedReimb !== i) {
                      return (
                        <span title="Click to expand" style={{ display:"inline-flex", alignItems:"center", gap:6, color:flag?flag.c:"#5c5f57", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:"100%" }}>
                          {flag && <span style={{ fontSize:8.5, fontWeight:700, letterSpacing:"0.04em", color:flag.c, background:flag.bg, padding:"1px 6px", borderRadius:9, flexShrink:0 }}>{flag.t}</span>}
                          <span style={{ overflow:"hidden", textOverflow:"ellipsis" }}>{m}</span>
                          <span style={{ fontSize:9, color:"#a69e91", flexShrink:0 }}>▼</span>
                        </span>
                      );
                    }
                    return (
                      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        <span style={{ display:"inline-flex", alignItems:"center", gap:6, color:flag?flag.c:"#5c5f57", whiteSpace:"normal", lineHeight:1.5 }}>
                          {flag && <span style={{ fontSize:8.5, fontWeight:700, letterSpacing:"0.04em", color:flag.c, background:flag.bg, padding:"1px 6px", borderRadius:9, flexShrink:0 }}>{flag.t}</span>}
                          {m}
                        </span>
                        <span style={{ fontSize:9, color:"#a69e91", marginTop:2 }}>▲ click to collapse</span>
                      </div>
                    );
                  })()}
                </td>
                <td
                  onClick={() => setExpandedRentStep(expandedRentStep === i ? null : i)}
                  style={{ padding:"8px 10px", color:"#837c6e", fontSize:11, cursor:"pointer", verticalAlign:"top", maxWidth: expandedRentStep === i ? 340 : 220, minWidth: 120 }}
                >
                  {(() => {
                    const s = t.rentSchedule || t.rentBumps;
                    if (!s) return <span style={{ color:"#c4bbaa" }}>—</span>;
                    const expiryDate = t.leaseExpiry ? new Date(t.leaseExpiry) : null;
                    const MONTH_MAP: Record<string,number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
                    const filteredSteps = s.split(";").map((p: string) => p.trim()).filter(Boolean).filter((seg: string) => {
                      if (/option/i.test(seg)) return false;
                      if (expiryDate) {
                        const ey = expiryDate.getFullYear(), em = expiryDate.getMonth() + 1;
                        // YYYY-MM format
                        const m1 = seg.match(/^(\d{4})-(\d{2})/);
                        if (m1) {
                          const sy = parseInt(m1[1], 10), sm = parseInt(m1[2], 10);
                          if (sy > ey || (sy === ey && sm >= em)) return false;
                        }
                        // Mon-YYYY format (e.g. "Oct-2035: $12.54")
                        const m2 = seg.match(/^([A-Za-z]{3})[- ](\d{4})/);
                        if (m2) {
                          const sm = MONTH_MAP[m2[1].toLowerCase()] ?? 0;
                          const sy = parseInt(m2[2], 10);
                          if (sy > ey || (sy === ey && sm >= em)) return false;
                        }
                      }
                      return true;
                    });
                    if (filteredSteps.length === 0) return <span style={{ color:"#c4bbaa", fontStyle:"italic" }}>Flat</span>;
                    const joined = filteredSteps.join("; ");
                    if (expandedRentStep !== i) {
                      return (
                        <span title="Click to expand rent steps" style={{ display:"flex", alignItems:"center", gap:4 }}>
                          <span style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:180, display:"inline-block" }}>
                            {joined.length > 60 ? joined.slice(0,60)+"…" : joined}
                          </span>
                          {joined.length > 60 && <span style={{ fontSize:9, color:"#a69e91", flexShrink:0 }}>▼</span>}
                        </span>
                      );
                    }
                    return (
                      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        {filteredSteps.map((step: string, si: number) => (
                          <div key={si} style={{ display:"flex", alignItems:"flex-start", gap:6, padding:"3px 0", borderBottom: si < filteredSteps.length-1 ? "1px solid #f1eadc" : "none" }}>
                            <span style={{ color:"#c4bbaa", fontSize:9, marginTop:1, flexShrink:0 }}>▸</span>
                            <span style={{ whiteSpace:"normal", lineHeight:1.5, fontSize:11 }}>{step}</span>
                          </div>
                        ))}
                        <span style={{ fontSize:9, color:"#a69e91", marginTop:2 }}>▲ click to collapse</span>
                      </div>
                    );
                  })()}
                </td>
                <td
                  onClick={() => setExpandedOption(expandedOption === i ? null : i)}
                  style={{ padding:"8px 10px", color:"#837c6e", fontSize:11, cursor:"pointer", verticalAlign:"top", maxWidth: expandedOption === i ? 340 : 220, minWidth: 120 }}
                >
                  {(() => {
                    const s = t.renewalOptions;
                    const rs = t.rentSchedule || t.rentBumps || "";
                    const expiryDate = t.leaseExpiry ? new Date(t.leaseExpiry) : null;
                    const MONTH_MAP2: Record<string,number> = { jan:1,feb:2,mar:3,apr:4,may:5,jun:6,jul:7,aug:8,sep:9,oct:10,nov:11,dec:12 };
                    // Pull rent steps that are AFTER lease expiry (i.e. option period steps)
                    const optionSteps = rs ? rs.split(";").map((p: string) => p.trim()).filter(Boolean).filter((seg: string) => {
                      if (!expiryDate) return false;
                      const ey = expiryDate.getFullYear(), em = expiryDate.getMonth() + 1;
                      const m1 = seg.match(/^(\d{4})-(\d{2})/);
                      if (m1) { const sy = parseInt(m1[1],10), sm = parseInt(m1[2],10); return sy > ey || (sy === ey && sm >= em); }
                      const m2 = seg.match(/^([A-Za-z]{3})[- ](\d{4})/);
                      if (m2) { const sm = MONTH_MAP2[m2[1].toLowerCase()] ?? 0; const sy = parseInt(m2[2],10); return sy > ey || (sy === ey && sm >= em); }
                      return false;
                    }) : [];
                    if (!s && optionSteps.length === 0) return <span style={{ color:"#c4bbaa" }}>—</span>;
                    const opts = s ? s.split(";").map((p: string) => p.trim()).filter(Boolean) : [];
                    const summary = opts.join("; ");
                    if (expandedOption !== i) {
                      return (
                        <span title="Click to expand options" style={{ display:"flex", alignItems:"center", gap:4 }}>
                          <span style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:180, display:"inline-block" }}>
                            {summary.length > 60 ? summary.slice(0,60)+"…" : summary || `${optionSteps.length} rent step${optionSteps.length !== 1 ? "s" : ""}`}
                          </span>
                          {(summary.length > 60 || optionSteps.length > 0) && <span style={{ fontSize:9, color:"#a69e91", flexShrink:0 }}>▼</span>}
                        </span>
                      );
                    }
                    return (
                      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        {opts.map((opt: string, oi: number) => (
                          <div key={oi} style={{ display:"flex", alignItems:"flex-start", gap:6, padding:"3px 0", borderBottom:"1px solid #f1eadc" }}>
                            <span style={{ color:"#c4bbaa", fontSize:9, marginTop:1, flexShrink:0 }}>▸</span>
                            <span style={{ whiteSpace:"normal", lineHeight:1.5, fontSize:11 }}>{opt}</span>
                          </div>
                        ))}
                        {optionSteps.length > 0 && (
                          <>
                            <div style={{ fontSize:9, fontWeight:700, color:"#a69e91", letterSpacing:"0.06em", marginTop:opts.length>0?6:0, paddingTop:opts.length>0?4:0, borderTop:opts.length>0?"1px solid #ecdfc8":"none" }}>OPTION RENT STEPS</div>
                            {optionSteps.map((step: string, si: number) => (
                              <div key={si} style={{ display:"flex", alignItems:"flex-start", gap:6, padding:"3px 0", borderBottom: si < optionSteps.length-1 ? "1px solid #f1eadc" : "none" }}>
                                <span style={{ color:"#b8a98c", fontSize:9, marginTop:1, flexShrink:0 }}>▸</span>
                                <span style={{ whiteSpace:"normal", lineHeight:1.5, fontSize:11, color:"#837c6e" }}>{step}</span>
                              </div>
                            ))}
                          </>
                        )}
                        <span style={{ fontSize:9, color:"#a69e91", marginTop:2 }}>▲ click to collapse</span>
                      </div>
                    );
                  })()}
                </td>
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap", color:t.recentlyExercisedRenewal?"#0f9d63":"#a69e91" }}>{t.recentlyExercisedRenewal||"—"}</td>
                <td title={t.salesNotes||""} style={{ padding:"8px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap", cursor:t.salesNotes?"help":"default" }}>{fmtTenantSales(t.salesPSF, t.sf)}</td>
                {(() => {
                  const stated = n(t.occupancyCost);
                  const base = n(t.annualRent);
                  // Recoveries: OM-disclosed value first; else the SF-allocated
                  // estimate so occ cost can still be computed on NNN tenants.
                  const disclosedReimb = n(t.expenseReimbursements);
                  const est = estimatedRecoveries?.get(tenantKey(t.canonicalName || t.name));
                  const reimb = disclosedReimb ?? (est ? est.value : null);
                  const reimbEstimated = disclosedReimb == null && !!est?.estimated;
                  const pctRent = (t.percentageRent != null && typeof t.percentageRent === "number") ? t.percentageRent : 0;
                  const other = n(t.otherRent) ?? 0;
                  const sp = n(t.salesPSF);
                  const sfn = n(t.sf);
                  const sales = (sp != null && sfn != null && sp > 0 && sfn > 0) ? sp * sfn : null;

                  let occ: number | null = null;
                  let occSource: "stated" | "computed" | null = null;
                  let occBreakdown: OccBreakdown | null = null;

                  if (stated != null) {
                    occ = stated; occSource = "stated";
                  } else if (base != null && reimb != null && sales != null && sales > 0) {
                    const total = base + reimb + pctRent + other;
                    occ = (total / sales) * 100;
                    occSource = "computed";
                    occBreakdown = { base, reimbursements: reimb, percentRent: pctRent, other, total, sales, reimbEstimated };
                  }

                  const color = occ != null ? (occ > 15 ? "#dc2626" : "#0f9d63") : "#a69e91";
                  const canEdit = !!onUpdateTenant && !isVacant(t) && !isNAPTenant(t);
                  return (
                    <td style={{ padding: "8px 10px", textAlign: "right", whiteSpace: "nowrap", color }}>
                      <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                        {occ != null && occSource
                          ? <OccTip val={occ} source={occSource} breakdown={occBreakdown} />
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
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap", color:t.creditRating==="Investment Grade"?"#0f9d63":"#837c6e" }}>{t.creditRating||"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
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
    </div>
  );
}
