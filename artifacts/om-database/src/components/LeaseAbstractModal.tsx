import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type {
  LeaseAbstract, AbstractCitation, AbstractField, GuarantyEntry,
  PartyChainEntry, AbstractOption, AbstractRentStep, AbstractExclusive,
  AbstractFlag, AbstractDocRef, AbstractNoticeAddress, LeaseNote, Tenant,
} from "../lib/idb";
import { LEASE_NOTE_SECTIONS } from "../lib/idb";
import { useWatchlist } from "../lib/useWatchlist";
import { computeAbstractChecks } from "../lib/abstractChecks";
import { apiSaveLeaseAbstract, apiDeleteLeaseAbstract, apiBulkSaveLeaseAbstracts } from "../lib/api";
import { exportLeaseAbstract } from "../lib/abstractExcel";
import { useIsMobile } from "../hooks/use-mobile";

// A lease abstract is a reconciled summary of a tenant's full lease document set.
// This modal both VIEWS an abstract (cited, sectioned) and ACCEPTS a pasted
// Claude-reconciled JSON to create/update one (the "no API" path, mirroring the
// roster paste box). Source PDFs are never stored — each fact cites doc/section/page.

const C = {
  ink: "#383a37", sub: "#6f6a5f", faint: "#a69e91", line: "#efe8da",
  green: "#3f7a1f", greenBg: "#eef3e6", greenBorder: "#b8d49a",
  amber: "#c97a18", amberBg: "#fbf1e4", amberBorder: "#e0c9a8",
  red: "#dc2626", redBg: "#fdecec", redBorder: "#f3c0c0",
};

function fmtMoney(v: number | string | null | undefined): string {
  if (v == null || v === "") return "—";
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^0-9.-]/g, ""));
  if (!Number.isFinite(n)) return String(v);
  return `$${Math.round(n).toLocaleString()}`;
}

function Cite({ cite }: { cite?: AbstractCitation | null }) {
  if (!cite || (!cite.doc && !cite.section && !cite.page)) return null;
  const parts = [cite.doc, cite.section, cite.page ? `p. ${cite.page}` : null].filter(Boolean);
  return (
    <span style={{ display:"inline", color:C.faint, fontSize:10.5, fontStyle:"italic", whiteSpace:"normal" }}>
      {" — "}{parts.join(", ")}
    </span>
  );
}

function Section({ title, children, count }: { title: string; children: React.ReactNode; count?: number }) {
  return (
    <div style={{ borderTop:`1px solid ${C.line}`, padding:"13px 0" }}>
      <div style={{ fontSize:10.5, letterSpacing:"0.06em", color:C.faint, fontWeight:700, textTransform:"uppercase", marginBottom:8 }}>
        {title}{count != null ? ` (${count})` : ""}
      </div>
      {children}
    </div>
  );
}

function FieldBlock({ field }: { field?: AbstractField | null }) {
  if (!field || !field.value) return <span style={{ color:C.faint }}>—</span>;
  return (
    <div style={{ fontSize:13, color:C.ink, lineHeight:1.5 }}>
      {field.value}<Cite cite={field.cite} />
    </div>
  );
}

function flagColor(sev?: string | null) {
  if (sev === "defect") return { fg:C.red, bg:C.redBg, bd:C.redBorder, label:"DEFECT" };
  if (sev === "watch") return { fg:C.amber, bg:C.amberBg, bd:C.amberBorder, label:"WATCH" };
  return { fg:C.green, bg:C.greenBg, bd:C.greenBorder, label:"NOTE" };
}

// ---- Viewer (mirrors the per-tenant abstract tab layout) ----------------------

// A label / value (/ citation) row, like the tab's left-aligned field rows.
function KV({ label, value, cite, indent }: { label: string; value?: React.ReactNode; cite?: AbstractCitation | null; indent?: boolean }) {
  const isMobile = useIsMobile();
  return (
    <div style={{ display:"flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 0 : 10, padding:"4px 0", borderBottom:`1px solid ${C.line}`, marginLeft: indent ? 14 : 0 }}>
      <div style={{ flex: isMobile ? "none" : "0 0 168px", fontSize:11.5, color:C.sub, fontWeight:600 }}>{label}</div>
      <div style={{ flex:"1 1 auto", fontSize:12.5, color:C.ink, lineHeight:1.5, wordBreak:"break-word" }}>
        {value != null && value !== "" ? value : <span style={{ color:C.faint }}>—</span>}<Cite cite={cite} />
      </div>
    </div>
  );
}
const dval = (f?: AbstractField | null): string => (f && f.value != null ? String(f.value) : "");

function AbstractBody({ a, tenants, onFillRoster }: { a: LeaseAbstract; tenants?: Tenant[]; onFillRoster?: (tenantIndex: number, patch: Partial<Tenant>) => void }) {
  const isMobile = useIsMobile();
  const watchMap = useWatchlist();
  const checks = computeAbstractChecks(a, tenants ?? [], watchMap);
  const fillKeys = Object.keys(checks.fill);
  const guaranties = (a.guaranties ?? []) as GuarantyEntry[];
  const tChain = (a.tenantChain ?? []) as PartyChainEntry[];
  const lChain = (a.landlordChain ?? []) as PartyChainEntry[];
  const options = (a.options ?? []) as AbstractOption[];
  const rent = (a.rentSchedule ?? []) as AbstractRentStep[];
  const exclusives = (a.exclusives ?? []) as AbstractExclusive[];
  const flags = (a.flags ?? []) as AbstractFlag[];
  const documents = (a.documents ?? []) as AbstractDocRef[];
  const notices = (a.noticeAddresses ?? []) as AbstractNoticeAddress[];
  const d = a.dates || {};
  const dep = a.deposit;
  const pr = a.percentageRentDetail;
  const cite = (c?: AbstractCitation | null) => <Cite cite={c} />;

  // Lease Notes keyed by code, rendered in canonical (tab) order.
  const notesByCode = new Map<string, LeaseNote>((a.leaseNotes ?? []).map((n) => [String(n.code), n]));

  const th: React.CSSProperties = { padding:"4px 8px", textAlign:"left", color:C.faint, fontSize:10, fontWeight:700, whiteSpace:"nowrap" };
  const td: React.CSSProperties = { padding:"4px 8px", color:C.ink, verticalAlign:"top" };

  return (
    <div>
      {(checks.discrepancies.length > 0 || checks.risks.length > 0 || (fillKeys.length > 0 && !!onFillRoster)) && (
        <Section title="Checks — review (live)">
          {fillKeys.length > 0 && onFillRoster && checks.tenantIndex >= 0 && (
            <div style={{ background:C.greenBg, border:`1px solid ${C.greenBorder}`, borderRadius:8, padding:"8px 10px", marginBottom: (checks.discrepancies.length || checks.risks.length) ? 7 : 0, display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, flexWrap:"wrap" }}>
              <div style={{ minWidth:0 }}>
                <div style={{ fontSize:11, fontWeight:800, color:C.green, letterSpacing:"0.04em", marginBottom:2 }}>FILL ROSTER FROM LEASE</div>
                <div style={{ fontSize:12, color:C.sub, lineHeight:1.4 }}>The roster is missing {fillKeys.length} field{fillKeys.length > 1 ? "s" : ""} this lease can supply: {checks.fillLabels.join(", ")}.</div>
              </div>
              <button onClick={() => onFillRoster(checks.tenantIndex, checks.fill)} style={{ fontSize:12, fontWeight:700, color:"#fff", background:C.green, border:"none", borderRadius:7, padding:"7px 14px", cursor:"pointer", flexShrink:0 }}>Apply to roster</button>
            </div>
          )}
          {checks.discrepancies.length > 0 && (
            <div style={{ background:C.amberBg, border:`1px solid ${C.amberBorder}`, borderRadius:8, padding:"8px 10px", marginBottom: checks.risks.length ? 7 : 0 }}>
              <div style={{ fontSize:11, fontWeight:800, color:C.amber, letterSpacing:"0.04em", marginBottom:3 }}>ROSTER vs. LEASE — INVESTIGATE</div>
              <div style={{ fontSize:11.5, color:C.sub, marginBottom:4 }}>The roster figures came from a broker/OM/rent-roll. The lease (this abstract) is authoritative — please verify and correct the roster:</div>
              {checks.discrepancies.map((dsc, i) => <div key={i} style={{ fontSize:12.5, color:C.ink, lineHeight:1.45 }}>• {dsc}</div>)}
            </div>
          )}
          {checks.risks.map((rk, i) => (
            <div key={i} style={{ background:C.redBg, border:`1px solid ${C.redBorder}`, borderRadius:8, padding:"8px 10px", marginBottom:6 }}>
              <div style={{ fontSize:11, fontWeight:800, color:C.red, letterSpacing:"0.04em", marginBottom:2 }}>CO-TENANCY / WATCHLIST RISK</div>
              <div style={{ fontSize:12.5, color:C.ink, lineHeight:1.45 }}>{rk}</div>
            </div>
          ))}
        </Section>
      )}
      {flags.length > 0 && (
        <Section title="Flags — verify these" count={flags.length}>
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {flags.map((f, i) => {
              const m = flagColor(f.severity);
              return (
                <div key={i} style={{ background:m.bg, border:`1px solid ${m.bd}`, borderRadius:8, padding:"8px 10px" }}>
                  <div style={{ display:"flex", alignItems:"center", gap:7, marginBottom:2 }}>
                    <span style={{ fontSize:9, fontWeight:800, color:m.fg, letterSpacing:"0.04em" }}>{m.label}</span>
                    <span style={{ fontSize:12.5, fontWeight:700, color:C.ink }}>{f.issue}</span>
                  </div>
                  {f.detail && <div style={{ fontSize:12, color:C.sub, lineHeight:1.5 }}>{f.detail}</div>}
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <Section title="Lease – Property / Tenant Information">
        <KV label="Building Name" value={a.center} />
        <KV label="Suite #" value={a.suite} />
        <KV label="Tenant Name" value={a.tenantName} />
        <KV label="DBA" value={a.dba} />
        <KV label="Premises GLA" value={(a.premisesGLA ?? a.currentSF) != null ? Number(a.premisesGLA ?? a.currentSF).toLocaleString() : ""} />
        {a.mriNumber && <KV label="MRI #" value={a.mriNumber} />}
      </Section>

      {documents.length > 0 && (
        <Section title="Lease & Amendments" count={documents.length}>
          <div style={{ display:"flex", flexDirection:"column", gap:4 }}>
            {documents.map((dc, i) => (
              <div key={i} style={{ fontSize:12.5, color:C.ink, lineHeight:1.45 }}>
                <span style={{ color:C.sub, fontFamily:"'SF Mono',ui-monospace,monospace", fontSize:11 }}>{dc.date || "—"}</span>{"  "}
                <span style={{ fontWeight:600 }}>{dc.name}</span>{dc.description ? <span style={{ color:C.sub }}> — {dc.description}</span> : null}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Lease Dates">
        <KV label="Lease Date" value={dval(d.leaseDate)} cite={d.leaseDate?.cite} />
        <KV label="Open Date" value={dval(d.openDate)} cite={d.openDate?.cite} />
        <KV label="Lease Commencement" value={dval(d.leaseCommencement)} cite={d.leaseCommencement?.cite} />
        <KV label="Cancel" value={dval(d.cancelDate)} cite={d.cancelDate?.cite} />
        <KV label="Lease Expiration" value={dval(d.leaseExpiration)} cite={d.leaseExpiration?.cite} />
        <KV label="Rent Start Date" value={dval(d.rentStartDate)} cite={d.rentStartDate?.cite} />
      </Section>

      {dep && (
        <Section title="Deposit Information">
          <KV label="Cash Deposit" value={dep.cashDeposit} />
          <KV label="Non-Cash Deposit" value={dep.nonCashDeposit} />
          <KV label="Interest Bearing" value={dep.interestBearing} />
          {dep.vendorId && <KV label="Vendor ID" value={dep.vendorId} />}
          {dep.insuranceCertExp && <KV label="Insurance Cert. Exp." value={dep.insuranceCertExp} />}
        </Section>
      )}

      {notices.length > 0 && (
        <Section title="Notice Address" count={notices.length}>
          {notices.map((na, i) => (
            <div key={i} style={{ marginBottom:8 }}>
              <div style={{ fontSize:11, fontWeight:700, color:C.green, marginBottom:2 }}>{na.type || "Address"}{cite(na.cite)}</div>
              {na.name && <KV label="Name" value={na.name} indent />}
              {na.attn && <KV label="Attn" value={na.attn} indent />}
              {(na.address1 || na.address2) && <KV label="Address" value={[na.address1, na.address2].filter(Boolean).join(", ")} indent />}
              {(na.city || na.state || na.zip) && <KV label="City/State/Zip" value={[na.city, na.state, na.zip].filter(Boolean).join(", ")} indent />}
              {na.phone && <KV label="Phone" value={na.phone} indent />}
              {na.email && <KV label="Email" value={na.email} indent />}
            </div>
          ))}
        </Section>
      )}

      {options.length > 0 && (
        <Section title="Lease – Options" count={options.length}>
          <div style={{ overflowX:"auto" }}>
            <table style={{ borderCollapse:"collapse", fontSize:11.5, width:"100%", minWidth:560 }}>
              <thead><tr>
                <th style={th}>Number</th><th style={th}>Date</th><th style={th}>Type</th><th style={th}>Notice</th>
                <th style={th}>SF</th><th style={th}>Term (mo)</th><th style={th}>Rate (PSF)</th><th style={th}>Expire</th><th style={th}>Source</th>
              </tr></thead>
              <tbody>
                {options.map((o, i) => (
                  <tr key={i} style={{ borderTop:`1px solid ${C.line}` }}>
                    <td style={{ ...td, fontWeight:600, whiteSpace:"nowrap" }}>{o.number ?? (o.ordinal != null ? `${o.ordinal}` : "")}</td>
                    <td style={{ ...td, whiteSpace:"nowrap" }}>{o.windowStart || "—"}</td>
                    <td style={td}>{o.optionType || "—"}</td>
                    <td style={{ ...td, whiteSpace:"nowrap" }}>{o.noticeDate || "—"}</td>
                    <td style={{ ...td, whiteSpace:"nowrap" }}>{o.squareFeet != null ? Number(o.squareFeet).toLocaleString() : "—"}</td>
                    <td style={td}>{o.termMonths ?? "—"}</td>
                    <td style={{ ...td, whiteSpace:"nowrap" }}>{o.ratePSF != null ? `$${o.ratePSF}` : (o.rent || "—")}</td>
                    <td style={{ ...td, whiteSpace:"nowrap" }}>{o.expireDate || o.windowEnd || "—"}</td>
                    <td style={{ ...td, color:C.faint, fontSize:10.5 }}>{o.cite ? [o.cite.doc, o.cite.section].filter(Boolean).join(" ") : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {a.optionNotes && <div style={{ marginTop:6, fontSize:12, color:C.sub, lineHeight:1.5 }}><b style={{ fontWeight:600, color:C.ink }}>Option Notes:</b> {a.optionNotes}</div>}
        </Section>
      )}

      {rent.length > 0 && (
        <Section title="Billing – Recurring Charges" count={rent.length}>
          <div style={{ overflowX:"auto" }}>
            <table style={{ borderCollapse:"collapse", fontSize:11.5, width:"100%", minWidth:520 }}>
              <thead><tr>
                <th style={th}>Income</th><th style={th}>Effective</th><th style={th}>End</th>
                <th style={{ ...th, textAlign:"right" }}>$/SF</th><th style={{ ...th, textAlign:"right" }}>Annual</th><th style={{ ...th, textAlign:"right" }}>Monthly</th><th style={th}>Note</th>
              </tr></thead>
              <tbody>
                {rent.map((r, i) => (
                  <tr key={i} style={{ borderTop:`1px solid ${C.line}` }}>
                    <td style={td}>{r.incomeCategory || "RNT"}</td>
                    <td style={{ ...td, whiteSpace:"nowrap" }}>{r.periodStart || "—"}</td>
                    <td style={{ ...td, whiteSpace:"nowrap" }}>{r.periodEnd || "—"}</td>
                    <td style={{ ...td, textAlign:"right", whiteSpace:"nowrap" }}>{(r.amountPerSF ?? r.psf) != null ? `$${Number(r.amountPerSF ?? r.psf).toFixed(2)}` : "—"}</td>
                    <td style={{ ...td, textAlign:"right", fontWeight:600, whiteSpace:"nowrap" }}>{fmtMoney(r.annualRent)}</td>
                    <td style={{ ...td, textAlign:"right", color:C.sub, whiteSpace:"nowrap" }}>{fmtMoney(r.monthlyRent)}</td>
                    <td style={{ ...td, color:C.sub }}>{r.note || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rent[0]?.cite && <div style={{ marginTop:4 }}>{cite(rent[0].cite)}</div>}
        </Section>
      )}

      {(pr || a.percentageRent) && (
        <Section title="Retail – Percentage Rent">
          {pr ? (
            <>
              {pr.summary && <KV label="Summary" value={pr.summary} />}
              <KV label="Reporting Frequency" value={pr.reportingFrequency} />
              <KV label="Natural Breakpoint" value={pr.naturalBreakpoint == null ? "" : pr.naturalBreakpoint ? "Yes" : "No"} />
              <KV label="In Lieu of Minimum" value={pr.inLieuOfMinimum == null ? "" : pr.inLieuOfMinimum ? "Yes" : "No"} />
              {pr.salesYearEnd && <KV label="Sales Year End" value={pr.salesYearEnd} />}
              {pr.paymentTiming && <KV label="Payment" value={pr.paymentTiming} cite={pr.cite} />}
              {(pr.breakpoints ?? []).length > 0 && (
                <div style={{ overflowX:"auto", marginTop:6 }}>
                  <table style={{ borderCollapse:"collapse", fontSize:11.5, minWidth:320 }}>
                    <thead><tr><th style={th}>Start Date</th><th style={th}>Percentage</th><th style={{ ...th, textAlign:"right" }}>Breakpoint</th></tr></thead>
                    <tbody>
                      {(pr.breakpoints ?? []).map((b, i) => (
                        <tr key={i} style={{ borderTop:`1px solid ${C.line}` }}>
                          <td style={{ ...td, whiteSpace:"nowrap" }}>{b.startDate || "—"}</td>
                          <td style={td}>{b.percentage || "—"}</td>
                          <td style={{ ...td, textAlign:"right", whiteSpace:"nowrap" }}>{fmtMoney(b.breakpoint)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          ) : (
            <FieldBlock field={a.percentageRent} />
          )}
        </Section>
      )}

      <Section title="Lease Notes">
        <div style={{ display:"flex", flexDirection:"column" }}>
          {LEASE_NOTE_SECTIONS.map((sec) => {
            const n = notesByCode.get(sec.code);
            if (!n) return null;
            return (
              <div key={sec.code} style={{ display:"flex", flexDirection: isMobile ? "column" : "row", gap: isMobile ? 1 : 10, padding:"6px 0", borderBottom:`1px solid ${C.line}` }}>
                <div style={{ flex: isMobile ? "none" : "0 0 150px", fontSize:11.5, color:C.sub, fontWeight:700 }}>{sec.label}</div>
                <div style={{ flex:"1 1 auto", fontSize:12.5, color:C.ink, lineHeight:1.5, wordBreak:"break-word" }}>
                  {n.value || <span style={{ color:C.faint }}>—</span>}{cite(n.cite)}
                </div>
              </div>
            );
          })}
        </div>
      </Section>

      {/* KPR supplemental analysis (beyond the standard tab) */}
      {(a.narrative || tChain.length > 0 || lChain.length > 0 || guaranties.length > 0 || exclusives.length > 0) && (
        <Section title="KPR analysis">
          {a.narrative && <div style={{ fontSize:13, color:C.ink, lineHeight:1.55, marginBottom: tChain.length || lChain.length || guaranties.length ? 10 : 0 }}>{a.narrative}</div>}
          {tChain.length > 0 && (
            <div style={{ marginBottom:8 }}>
              <div style={{ fontSize:10.5, color:C.faint, fontWeight:700, textTransform:"uppercase", marginBottom:3 }}>Tenant succession</div>
              {tChain.map((p, i) => <div key={i} style={{ fontSize:12, color:C.ink }}><span style={{ color:C.faint }}>{i + 1}.</span> {p.entity}{p.effectiveDate ? <span style={{ color:C.sub }}> — {p.effectiveDate}</span> : null}{cite(p.cite)}</div>)}
            </div>
          )}
          {lChain.length > 0 && (
            <div style={{ marginBottom:8 }}>
              <div style={{ fontSize:10.5, color:C.faint, fontWeight:700, textTransform:"uppercase", marginBottom:3 }}>Landlord succession</div>
              {lChain.map((p, i) => <div key={i} style={{ fontSize:12, color:C.ink }}><span style={{ color:C.faint }}>{i + 1}.</span> {p.entity}{p.effectiveDate ? <span style={{ color:C.sub }}> — {p.effectiveDate}</span> : null}{cite(p.cite)}</div>)}
            </div>
          )}
          {guaranties.length > 0 && (
            <div style={{ marginBottom: exclusives.length ? 8 : 0 }}>
              <div style={{ fontSize:10.5, color:C.faint, fontWeight:700, textTransform:"uppercase", marginBottom:3 }}>Guaranty stack</div>
              {guaranties.map((g, i) => <div key={i} style={{ fontSize:12, color:C.ink, lineHeight:1.45 }}><b style={{ fontWeight:700 }}>{g.guarantor}</b>{g.scope ? <span style={{ color:C.sub }}> — {g.scope}</span> : null}{cite(g.cite)}</div>)}
            </div>
          )}
          {exclusives.length > 0 && (exclusives.some((e) => (e.modifications ?? []).length > 0)) && (
            <div>
              <div style={{ fontSize:10.5, color:C.faint, fontWeight:700, textTransform:"uppercase", marginBottom:3 }}>Exclusive — waivers/modifications</div>
              {exclusives.flatMap((e, i) => (e.modifications ?? []).map((m, j) => (
                <div key={`${i}-${j}`} style={{ fontSize:12, color:C.amber }}>↳ {m.date ? `(${m.date}) ` : ""}{m.change}{cite(m.cite)}</div>
              )))}
            </div>
          )}
        </Section>
      )}
    </div>
  );
}

// ---- Paste / update -----------------------------------------------------------
function PasteBody({ dealId, lockTenant, onSaved }: {
  dealId: string; lockTenant?: string | null; onSaved: (a: LeaseAbstract) => void;
}) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const doSave = async (raw: string) => {
    setErr(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      setErr("That isn't valid JSON. Paste the abstract JSON Claude gave you — a single object, an array, or { \"abstracts\": [...] }.");
      return;
    }
    // Bulk: an array, or { abstracts: [...] } — upsert the whole set at once.
    const arr = Array.isArray(parsed) ? parsed : (Array.isArray((parsed as { abstracts?: unknown })?.abstracts) ? (parsed as { abstracts: LeaseAbstract[] }).abstracts : null);
    if (arr) {
      const missing = arr.filter((a) => !(a as LeaseAbstract)?.tenantName || !String((a as LeaseAbstract).tenantName).trim()).length;
      if (!arr.length) { setErr("That array is empty."); return; }
      setSaving(true);
      const res = await apiBulkSaveLeaseAbstracts(dealId, arr as LeaseAbstract[]);
      setSaving(false);
      if (!res.ok) { setErr(res.error || "Couldn't save."); return; }
      onSaved({ tenantName: `${res.saved ?? arr.length} abstracts` } as LeaseAbstract); // signal reload
      if (missing) setErr(`Saved ${res.saved}, skipped ${missing} without a tenantName.`);
      return;
    }
    // Single abstract.
    const single = parsed as LeaseAbstract;
    if (lockTenant) single.tenantName = lockTenant; // ensure it links to the right roster tenant
    if (!single.tenantName || !String(single.tenantName).trim()) {
      setErr("The abstract needs a tenantName so it links to a roster tenant.");
      return;
    }
    setSaving(true);
    const res = await apiSaveLeaseAbstract(dealId, single);
    setSaving(false);
    if (!res.ok) { setErr(res.error || "Couldn't save."); return; }
    onSaved({ ...single, id: res.id, dealId, version: res.version });
  };

  const save = () => doSave(text);

  // Phone-friendly path: pick the .json file and save it straight from the file
  // (don't stuff a multi-hundred-KB whole-property file into the textarea).
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // allow re-picking the same file
    if (!f) return;
    setErr(null); setSaving(true);
    let raw: string;
    try { raw = await f.text(); }
    catch { setSaving(false); setErr("Couldn't read that file."); return; }
    setSaving(false);
    await doSave(raw);
  };

  return (
    <div>
      <p style={{ fontSize:12.5, color:C.sub, lineHeight:1.5, margin:"0 0 10px" }}>
        Paste the reconciled lease abstract JSON from Claude{lockTenant ? <> for <b style={{ color:C.ink }}>{lockTenant}</b></> : null}. A single object, an array, or {"{ abstracts: [...] }"} for a whole property at once. It's stored, displayed here, and made available to the Analyst chat. Source PDFs aren't uploaded — each fact cites its document, section, and page.
      </p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder='{ "tenantName": "...", "term": { ... }, ... }'
        spellCheck={false}
        style={{ width:"100%", height:200, fontFamily:"'SF Mono',ui-monospace,monospace", fontSize:12, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"10px 12px", resize:"vertical", boxSizing:"border-box" }}
      />
      {err && <div style={{ marginTop:8, fontSize:12, color:C.red, background:C.redBg, border:`1px solid ${C.redBorder}`, borderRadius:8, padding:"8px 10px" }}>{err}</div>}
      <div style={{ marginTop:12, display:"flex", justifyContent:"space-between", alignItems:"center", gap:10, flexWrap:"wrap" }}>
        <label style={{ fontSize:13, fontWeight:700, color: saving ? C.faint : C.green, background:"#fff", border:`1px solid ${saving ? C.line : C.green}`, borderRadius:8, padding:"8px 16px", cursor: saving ? "default" : "pointer", minHeight:38, display:"inline-flex", alignItems:"center" }}>
          ⬆ Choose .json file
          <input type="file" accept=".json,application/json" disabled={saving} onChange={onPickFile} style={{ display:"none" }} />
        </label>
        <button onClick={save} disabled={saving || !text.trim()}
          style={{ fontSize:13, fontWeight:700, color:"#fff", background: saving || !text.trim() ? C.faint : C.green, border:"none", borderRadius:8, padding:"9px 18px", cursor: saving || !text.trim() ? "default" : "pointer", minHeight:38 }}>
          {saving ? "Saving…" : "Save pasted"}
        </button>
      </div>
      <div style={{ marginTop:8, fontSize:11, color:C.faint }}>On a phone: tap “Choose .json file” and pick the file Claude sent — no pasting needed.</div>
    </div>
  );
}

// ---- Modal shell --------------------------------------------------------------
interface Props {
  open: boolean;
  onClose: () => void;
  mode: "view" | "add";
  abstract?: LeaseAbstract | null;
  dealId: string;
  tenantName?: string | null;
  tenants?: Tenant[];
  isAdmin?: boolean;
  onSaved?: (a: LeaseAbstract) => void;
  onDeleted?: (id: string) => void;
  onFillRoster?: (tenantIndex: number, patch: Partial<Tenant>) => void;
}

export default function LeaseAbstractModal({ open, onClose, mode, abstract, dealId, tenantName, tenants, isAdmin, onSaved, onDeleted, onFillRoster }: Props) {
  // "view" can flip into an inline update (paste) without closing.
  const [updating, setUpdating] = useState(false);
  const isMobile = useIsMobile();
  useEffect(() => { if (open) setUpdating(false); }, [open, abstract]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, onClose]);

  if (!open) return null;

  const showPaste = mode === "add" || updating;
  const title = showPaste
    ? (mode === "add" ? "Add lease abstract" : "Update lease abstract")
    : (abstract?.tenantName || tenantName || "Lease abstract");
  const lockTenant = mode === "add" ? (tenantName ?? null) : (abstract?.tenantName ?? tenantName ?? null);

  const handleDelete = async () => {
    if (!abstract?.id) return;
    if (!window.confirm("Delete this lease abstract? This can't be undone.")) return;
    const res = await apiDeleteLeaseAbstract(abstract.id);
    if (res.ok) { onDeleted?.(abstract.id); onClose(); }
    else window.alert(res.error || "Couldn't delete.");
  };

  return createPortal(
    <>
      <div onClick={onClose} style={{ position:"fixed", inset:0, background:"rgba(42,44,40,0.52)", zIndex:2000, backdropFilter:"blur(2px)" }} aria-hidden="true" />
      <div
        role="dialog" aria-modal="true"
        style={{ position:"fixed", top:"50%", left:"50%", transform:"translate(-50%,-50%)", zIndex:2001, width:"min(760px, calc(100vw - 24px))", maxHeight:"88vh", display:"flex", flexDirection:"column", background:"#fff", borderRadius:14, boxShadow:"0 20px 60px rgba(42,44,40,0.22)", fontFamily:"'Inter',-apple-system,sans-serif" }}
      >
        <div style={{ display:"flex", flexDirection: isMobile ? "column" : "row", alignItems: isMobile ? "stretch" : "center", justifyContent:"space-between", gap:10, padding: isMobile ? "14px 16px 10px" : "18px 22px 12px", borderBottom:`1px solid ${C.line}` }}>
          <div style={{ display:"flex", alignItems:"flex-start", gap:8, minWidth:0 }}>
            <div style={{ minWidth:0, flex:1 }}>
              <div style={{ fontSize: isMobile ? 15 : 16, fontWeight:700, color:C.ink, whiteSpace: isMobile ? "normal" : "nowrap", overflow:"hidden", textOverflow:"ellipsis", lineHeight:1.25 }}>{title}</div>
              {!showPaste && abstract && (
                <div style={{ fontSize:11, color:C.faint, marginTop:2, lineHeight:1.3 }}>
                  Lease abstract{abstract.version ? ` · v${abstract.version}` : ""}{abstract.asOf ? ` · as of ${abstract.asOf}` : ""}
                </div>
              )}
            </div>
            {isMobile && (
              <button onClick={onClose} aria-label="Close" style={{ fontSize:22, lineHeight:1, color:C.faint, background:"none", border:"none", cursor:"pointer", padding:"0 4px", flexShrink:0 }}>×</button>
            )}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0, flexWrap:"wrap" }}>
            {!showPaste && abstract && (
              <button onClick={() => { void exportLeaseAbstract(abstract).catch(() => {}); }} title="Export this abstract to Excel (mirrors your per-tenant tab)" style={{ fontSize:12, fontWeight:600, color:"#1f6f43", background:"#eafaf0", border:"1px solid #b7e4c7", borderRadius:7, padding:"6px 12px", cursor:"pointer" }}>⬇ Export to Excel</button>
            )}
            {!showPaste && abstract && (
              <button onClick={() => setUpdating(true)} style={{ fontSize:12, fontWeight:600, color:C.green, background:C.greenBg, border:`1px solid ${C.greenBorder}`, borderRadius:7, padding:"6px 12px", cursor:"pointer" }}>Update from Claude</button>
            )}
            {!showPaste && abstract && isAdmin && (
              <button onClick={handleDelete} style={{ fontSize:12, fontWeight:600, color:C.red, background:"#fff", border:`1px solid ${C.redBorder}`, borderRadius:7, padding:"6px 10px", cursor:"pointer" }}>Delete</button>
            )}
            {!isMobile && (
              <button onClick={onClose} aria-label="Close" style={{ fontSize:18, lineHeight:1, color:C.faint, background:"none", border:"none", cursor:"pointer", padding:"2px 6px" }}>×</button>
            )}
          </div>
        </div>
        <div style={{ overflowY:"auto", padding:"4px 22px 20px" }}>
          {showPaste ? (
            <div style={{ paddingTop:14 }}>
              <PasteBody dealId={dealId} lockTenant={lockTenant} onSaved={(a) => { onSaved?.(a); onClose(); }} />
            </div>
          ) : abstract ? (
            <AbstractBody a={abstract} tenants={tenants} onFillRoster={onFillRoster ? (i, p) => { onFillRoster(i, p); onClose(); } : undefined} />
          ) : (
            <div style={{ padding:"20px 0", color:C.faint }}>No abstract.</div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
