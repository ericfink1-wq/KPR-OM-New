import { useState, useRef, useEffect } from "react";
import type { Tenant } from "../lib/idb";
import { fmtLeaseDate, fmtTenantSales, isVacant } from "../lib/utils";
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

function FlagTip({ content, children, color = "#b45309" }: { content: string; children: React.ReactNode; color?: string }) {
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
    <span ref={ref} style={{ position: "relative", display: "inline-block", marginLeft: 6 }}>
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

  function RentStepsCell({ schedule, bumps }: { schedule?: string | null; bumps?: string | null }) {
    const [expanded, setExpanded] = useState(false);
    if (!schedule) {
      return <span style={{ color:"#837c6e", fontSize:11 }}>{bumps || "—"}</span>;
    }
    const steps = schedule.split(";").map(s => s.trim()).filter(Boolean);
    const LIMIT = 3;
    const visible = expanded ? steps : steps.slice(0, LIMIT);
    const extra = steps.length - LIMIT;
    return (
      <div style={{ fontSize:11, color:"#5c5f57", minWidth:160, maxWidth:280 }}>
        {visible.map((step, i) => (
          <div key={i} style={{ lineHeight:1.45, marginBottom: i < visible.length - 1 ? 3 : 0 }}>{step}</div>
        ))}
        {!expanded && extra > 0 && (
          <button onClick={e => { e.stopPropagation(); setExpanded(true); }}
            style={{ background:"none", border:"none", padding:0, cursor:"pointer", color:"#a89f8f", fontSize:10, marginTop:3, fontFamily:"'Inter',sans-serif" }}>
            +{extra} more…
          </button>
        )}
      </div>
    );
  }

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
              <tr key={i} style={{ borderTop:"1px solid #f1eadc", opacity: isVacantRow(t) ? 0.65 : 1 }}>
                <td style={{ padding:"8px 10px", whiteSpace:"nowrap" }}>
                  {isVacantRow(t) ? (
                    <span style={{ color:"#a69e91", fontStyle:"italic", fontWeight:400, fontSize:11 }}>Vacant</span>
                  ) : (
                    <>
                      <span
                        onClick={onTenantClick && t.name ? () => onTenantClick(t.name!) : undefined}
                        title={onTenantClick && t.name ? `View ${t.name} across your portfolio` : undefined}
                        style={{ color:"#383a37", fontWeight:600, cursor:onTenantClick?"pointer":"default", textDecoration:onTenantClick?"underline":"none", textDecorationColor:"#d8cfbd", textUnderlineOffset:"2px" }}>
                        {t.name}
                      </span>
                      {t.isAnchor && <span style={{ fontSize:9, color:"#1f2b16", background:"#6dba4322", padding:"1px 6px", borderRadius:10, marginLeft:6, fontWeight:600 }}>ANCHOR</span>}
                      {t.name && isInvestmentGrade(t.name, t.creditRating) && <span style={{ fontSize:9, color:"#3f7a1f", background:"#eef3e6", border:"1px solid #b8d49a", padding:"1px 6px", borderRadius:4, marginLeft:6, fontWeight:700 }}>Investment Grade</span>}
                      {t.assumptionNote && <FlagTip content={t.assumptionNote}>⚑</FlagTip>}
                    </>
                  )}
                </td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap" }}>{n(t.sf)!=null?n(t.sf)!.toLocaleString():"—"}</td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#0f9d63", fontWeight:500, whiteSpace:"nowrap" }}>{n(t.rentPerSF)!=null?`$${n(t.rentPerSF)!.toFixed(2)}`:"—"}</td>
                <td style={{ padding:"8px 10px", textAlign:"right", color:"#383a37", whiteSpace:"nowrap" }}>{n(t.annualRent)!=null?`$${n(t.annualRent)!.toLocaleString()}`:"—"}</td>
                <td style={{ padding:"8px 10px", color:"#8b9097", whiteSpace:"nowrap" }}>{fmtLeaseDate(t.leaseStart)}</td>
                <td style={{ padding:"8px 10px", whiteSpace:"nowrap", color:n(t.remainingTermYears)!=null&&n(t.remainingTermYears)!<2?"#dc2626":n(t.remainingTermYears)!=null&&n(t.remainingTermYears)!<4?"#c97a18":"#5c5f57" }}>{fmtLeaseDate(t.leaseExpiry)}</td>
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap" }}>
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
                <td style={{ padding:"8px 10px", verticalAlign:"top" }}><RentStepsCell schedule={t.rentSchedule} bumps={t.rentBumps} /></td>
                <td style={{ padding:"8px 10px", color:"#837c6e", fontSize:11, whiteSpace:"nowrap" }}>{t.renewalOptions||"—"}</td>
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap", color:t.recentlyExercisedRenewal?"#0f9d63":"#a69e91" }}>{t.recentlyExercisedRenewal||"—"}</td>
                <td title={t.salesNotes||""} style={{ padding:"8px 10px", textAlign:"right", color:"#5c5f57", whiteSpace:"nowrap", cursor:t.salesNotes?"help":"default" }}>{fmtTenantSales(t.salesPSF, t.sf)}</td>
                <td style={{ padding:"8px 10px", textAlign:"right", whiteSpace:"nowrap", color:n(t.occupancyCost)!=null&&n(t.occupancyCost)!>15?"#dc2626":n(t.occupancyCost)!=null?"#0f9d63":"#a69e91" }}>{n(t.occupancyCost)!=null?`${t.occupancyCost}%`:"—"}</td>
                <td style={{ padding:"8px 10px", fontSize:11, whiteSpace:"nowrap", color:t.creditRating==="Investment Grade"?"#0f9d63":"#837c6e" }}>{t.creditRating||"—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div style={{ fontSize:10, color:"#a69e91", marginTop:9 }}>Click a column to sort · scroll sideways for more · tap or hover ⚑ for a tenant footnote.</div>
    </div>
  );
}
