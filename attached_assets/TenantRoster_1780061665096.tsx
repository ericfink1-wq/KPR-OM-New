import { useState, useRef, useEffect } from "react";
import { Info } from "lucide-react";
import type { Tenant } from "../lib/idb";
import { fmtLeaseDate, fmtTenantSales, isVacant, isNAPTenant } from "../lib/utils";
import { isInvestmentGrade } from "../lib/tenantCredit";

interface Props {
  tenants: Tenant[];
  onTenantClick?: (name: string) => void;
  tenantsAsOf?: string | null;
  tenantsSource?: string | null;
  omDate?: string | null;
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

  return (
    <span ref={ref} style={{ position: "relative", display: "inline-flex", alignItems: "center", marginLeft: 5, verticalAlign: "middle" }}>
      <span
        onMouseEnter={showSoon}
        onMouseLeave={cancelHover}
        onClick={(e) => { e.stopPropagation(); setOpen(o => !o); }}
        style={{ color, cursor: "pointer", userSelect: "none" }}
        aria-label={content}
        role="button"
        tabIndex={0}
      >
        {children}
      </span>
      {open && (
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
    </span>
  );
}

export default function TenantRoster({ tenants, onTenantClick, tenantsAsOf, tenantsSource, omDate }: Props) {
  const [q, setQ] = useState("");
  const [quick, setQuick] = useState("all");
  const [sortKey, setSortKey] = useState("sf");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");
  const [expandedRentStep, setExpandedRentStep] = useState<number | null>(null);
  const [expandedOption, setExpandedOption] = useState<number | null>(null);
  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);

  let rows = tenants.slice();
  if (quick==="anchors") rows = rows.filter(t => t.isAnchor);
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
              <tr key={i} style={{ borderTop:"1px solid #f1eadc", opacity: isNAPTenant(t) ? 0.7 : isVacantRow(t) ? 0.65 : 1 }}>
                <td style={{ padding:"8px 10px", whiteSpace:"nowrap" }}>
                  {isVacantRow(t) ? (
                    <span style={{ color:"#a69e91", fontStyle:"italic", fontWeight:400, fontSize:11 }}>Vacant</span>
                  ) : (
                    <div style={{ display:"flex", alignItems:"center", flexWrap:"nowrap", gap:4, minWidth:0 }}>
                      <span
                        onClick={onTenantClick && t.name ? () => onTenantClick(t.name!) : undefined}
                        title={onTenantClick && t.name ? `View ${t.name} across your portfolio` : undefined}
                        style={{ color:"#383a37", fontWeight:600, cursor:onTenantClick?"pointer":"default", textDecoration:onTenantClick?"underline":"none", textDecorationColor:"#d8cfbd", textUnderlineOffset:"2px", whiteSpace:"nowrap" }}>
                        {t.name}
                      </span>
                      {t.isAnchor && <span style={{ fontSize:9, color:"#1f2b16", background:"#6dba4322", padding:"1px 6px", borderRadius:10, fontWeight:600 }}>ANCHOR</span>}
                      {isNAPTenant(t) && (
                        <span style={{ fontSize:9, color:"#7c6340", background:"#f5ede0", border:"1px solid #e0c9a8", padding:"1px 6px", borderRadius:10, fontWeight:600 }} title="Not A Part — this tenant owns their parcel and pays no rent to the landlord">NAP</span>
                      )}
                      {t.name && isInvestmentGrade(t.name, t.creditRating) && <span style={{ fontSize:9, color:"#3f7a1f", background:"#eef3e6", border:"1px solid #b8d49a", padding:"1px 6px", borderRadius:4, fontWeight:700 }}>Investment Grade</span>}
                      {t.assumptionNote && <FlagTip content={t.assumptionNote}><Info size={12} strokeWidth={1.75} /></FlagTip>}
                    </div>
                  )}
                </td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>{n(t.sf)!=null?n(t.sf)!.toLocaleString():"—"}</td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#0f9d63", fontWeight:500, whiteSpace:"nowrap" }}>{n(t.rentPerSF)!=null?`$${n(t.rentPerSF)!.toFixed(2)}`:"—"}</td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#383a37", whiteSpace:"nowrap" }}>{n(t.annualRent)!=null?`$${n(t.annualRent)!.toLocaleString()}`:"—"}</td>
                <td style={{ padding:"8px 10px", color:"#8b9097", whiteSpace:"nowrap" }}>{fmtLeaseDate(t.leaseStart)}</td>
                <td style={{ padding:"8px 10px", whiteSpace:"nowrap", color:n(t.remainingTermYears)!=null&&n(t.remainingTermYears)!<2?"#dc2626":n(t.remainingTermYears)!=null&&n(t.remainingTermYears)!<4?"#c97a18":"#5c5f57" }}>{fmtLeaseDate(t.leaseExpiry)}</td>
                <td title={t.reimbursementMethod || t.leaseType || ""} style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap", maxWidth:120, overflow:"hidden", textOverflow:"ellipsis" }}>
                  {(() => {
                    const m = t.reimbursementMethod || t.leaseType || "";
                    const gross = /gross/i.test(m), fixed = /\bfixed\b/i.test(m);
                    const flag = gross ? { t:"GROSS", c:"#b91c1c", bg:"#fdecea", tip:"Gross lease — landlord absorbs expense growth (no recovery)" }
                              : fixed ? { t:"FIXED", c:"#b45309", bg:"#fbe6cf", tip:"Fixed reimbursement — landlord absorbs expense growth above the fixed amount" } : null;
                    return (
                      <span style={{ display:"inline-flex", alignItems:"center", gap:6, color:flag?flag.c:"#5c5f57" }}>
                        {flag && <span title={flag.tip} style={{ fontSize:8.5, fontWeight:700, letterSpacing:"0.04em", color:flag.c, background:flag.bg, padding:"1px 6px", borderRadius:9, cursor:"help" }}>{flag.t}</span>}
                        {m || "—"}
                      </span>
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
                    if (!s) return <span style={{ color:"#c4bbaa" }}>—</span>;
                    const opts = s.split(";").map((p: string) => p.trim()).filter(Boolean);
                    const joined = opts.join("; ");
                    if (expandedOption !== i) {
                      return (
                        <span title="Click to expand options" style={{ display:"flex", alignItems:"center", gap:4 }}>
                          <span style={{ whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis", maxWidth:180, display:"inline-block" }}>
                            {joined.length > 60 ? joined.slice(0,60)+"…" : joined}
                          </span>
                          {joined.length > 60 && <span style={{ fontSize:9, color:"#a69e91", flexShrink:0 }}>▼</span>}
                        </span>
                      );
                    }
                    return (
                      <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
                        {opts.map((opt: string, oi: number) => (
                          <div key={oi} style={{ display:"flex", alignItems:"flex-start", gap:6, padding:"3px 0", borderBottom: oi < opts.length-1 ? "1px solid #f1eadc" : "none" }}>
                            <span style={{ color:"#c4bbaa", fontSize:9, marginTop:1, flexShrink:0 }}>▸</span>
                            <span style={{ whiteSpace:"normal", lineHeight:1.5, fontSize:11 }}>{opt}</span>
                          </div>
                        ))}
                        <span style={{ fontSize:9, color:"#a69e91", marginTop:2 }}>▲ click to collapse</span>
                      </div>
                    );
                  })()}
                </td>
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap", color:t.recentlyExercisedRenewal?"#0f9d63":"#a69e91" }}>{t.recentlyExercisedRenewal||"—"}</td>
                <td title={t.salesNotes||""} style={{ padding:"8px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap", cursor:t.salesNotes?"help":"default" }}>{fmtTenantSales(t.salesPSF, t.sf)}</td>
                {(() => {
                  const src = n(t.occupancyCost);
                  const ar = t.annualRent != null && !isNaN(Number(t.annualRent)) ? Number(t.annualRent) : null;
                  const sp = n(t.salesPSF);
                  const sfn = n(t.sf);
                  const computed = src == null && ar != null && sp != null && sfn != null && sp > 0 && sfn > 0
                    ? (ar / (sp * sfn)) * 100
                    : null;
                  const occ = src ?? computed;
                  const isEst = src == null && computed != null;
                  const color = occ != null ? (occ > 15 ? "#dc2626" : "#0f9d63") : "#a69e91";
                  return (
                    <td style={{ padding:"8px 10px", textAlign:"right", whiteSpace:"nowrap", color }}>
                      {occ != null ? (
                        <span title={isEst ? "Estimated: annualRent ÷ (salesPSF × SF). Not sourced from OM." : undefined}>
                          {occ.toFixed(1)}%{isEst && <sup style={{ fontSize:8, color:"#a69e91", marginLeft:1 }}>est</sup>}
                        </span>
                      ) : "—"}
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
    </div>
  );
}
