import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import type {
  LeaseAbstract, AbstractCitation, AbstractField, GuarantyEntry,
  PartyChainEntry, AbstractOption, AbstractRentStep, AbstractExclusive,
  AbstractSizeHistory, AbstractFlag, AbstractSourceDoc,
} from "../lib/idb";
import { apiSaveLeaseAbstract, apiDeleteLeaseAbstract } from "../lib/api";

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

// ---- Viewer -------------------------------------------------------------------
function AbstractBody({ a }: { a: LeaseAbstract }) {
  const guaranties = (a.guaranties ?? []) as GuarantyEntry[];
  const tChain = (a.tenantChain ?? []) as PartyChainEntry[];
  const lChain = (a.landlordChain ?? []) as PartyChainEntry[];
  const options = (a.options ?? []) as AbstractOption[];
  const rent = (a.rentSchedule ?? []) as AbstractRentStep[];
  const exclusives = (a.exclusives ?? []) as AbstractExclusive[];
  const sizeHist = (a.sizeHistory ?? []) as AbstractSizeHistory[];
  const flags = (a.flags ?? []) as AbstractFlag[];
  const docs = (a.sourceDocuments ?? []) as AbstractSourceDoc[];

  const optStatusPill = (s?: string | null) => {
    const m = s === "exercised" ? { fg:C.green, bg:C.greenBg, bd:C.greenBorder }
      : s === "expired" ? { fg:C.faint, bg:"#f6f2ea", bd:C.line }
      : { fg:C.amber, bg:C.amberBg, bd:C.amberBorder };
    return <span style={{ fontSize:9, fontWeight:700, color:m.fg, background:m.bg, border:`1px solid ${m.bd}`, borderRadius:10, padding:"1px 7px", textTransform:"uppercase" }}>{s || "—"}</span>;
  };

  return (
    <div>
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

      {a.narrative && (
        <Section title="Summary">
          <div style={{ fontSize:13, color:C.ink, lineHeight:1.55 }}>{a.narrative}</div>
        </Section>
      )}

      <Section title="Premises & term">
        <div style={{ fontSize:13, color:C.ink, lineHeight:1.6 }}>
          <div><b style={{ fontWeight:600 }}>Size:</b> {a.currentSF != null ? `${a.currentSF}` : "—"} SF{sizeHist[0]?.cite ? <Cite cite={sizeHist[0].cite} /> : null}</div>
          {a.term?.value && <div style={{ marginTop:4 }}><b style={{ fontWeight:600 }}>Term:</b> {a.term.value}<Cite cite={a.term.cite} /></div>}
          {(a.commencement || a.expiration) && (
            <div style={{ marginTop:4, color:C.sub }}>Commences {a.commencement || "—"} · current expiration {a.expiration || "—"}</div>
          )}
        </div>
      </Section>

      {tChain.length > 0 && (
        <Section title="Tenant succession" count={tChain.length}>
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            {tChain.map((p, i) => (
              <div key={i} style={{ fontSize:12.5, color:C.ink, lineHeight:1.45 }}>
                <span style={{ color:C.faint }}>{i + 1}.</span> {p.entity}
                {p.effectiveDate ? <span style={{ color:C.sub }}> — {p.effectiveDate}</span> : null}
                {p.instrument ? <span style={{ color:C.sub }}> ({p.instrument})</span> : null}
                <Cite cite={p.cite} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {lChain.length > 0 && (
        <Section title="Landlord succession" count={lChain.length}>
          <div style={{ display:"flex", flexDirection:"column", gap:5 }}>
            {lChain.map((p, i) => (
              <div key={i} style={{ fontSize:12.5, color:C.ink, lineHeight:1.45 }}>
                <span style={{ color:C.faint }}>{i + 1}.</span> {p.entity}
                {p.effectiveDate ? <span style={{ color:C.sub }}> — {p.effectiveDate}</span> : null}
                <Cite cite={p.cite} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {guaranties.length > 0 && (
        <Section title="Guaranty stack" count={guaranties.length}>
          <div style={{ display:"flex", flexDirection:"column", gap:7 }}>
            {guaranties.map((g, i) => (
              <div key={i} style={{ fontSize:12.5, color:C.ink, lineHeight:1.5 }}>
                <div style={{ display:"flex", alignItems:"center", gap:7 }}>
                  <span style={{ fontWeight:700 }}>{g.guarantor}</span>
                  {g.inForce === true && <span style={{ fontSize:9, fontWeight:700, color:C.green, background:C.greenBg, border:`1px solid ${C.greenBorder}`, borderRadius:10, padding:"1px 7px" }}>IN FORCE</span>}
                  {g.inForce === false && <span style={{ fontSize:9, fontWeight:700, color:C.faint, background:"#f6f2ea", border:`1px solid ${C.line}`, borderRadius:10, padding:"1px 7px" }}>NOT IN FORCE</span>}
                </div>
                {g.scope && <div style={{ color:C.sub }}>{g.scope}{g.cap ? ` · Cap: ${g.cap}` : ""}<Cite cite={g.cite} /></div>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {options.length > 0 && (
        <Section title="Options" count={options.length}>
          <div style={{ display:"flex", flexDirection:"column", gap:6 }}>
            {options.map((o, i) => (
              <div key={i} style={{ fontSize:12.5, color:C.ink, lineHeight:1.5 }}>
                <div style={{ display:"flex", alignItems:"center", gap:7, flexWrap:"wrap" }}>
                  <span style={{ fontWeight:700 }}>Option {o.ordinal ?? i + 1}{o.length ? ` · ${o.length}` : ""}</span>
                  {optStatusPill(o.status)}
                  {(o.windowStart || o.windowEnd) && <span style={{ color:C.sub }}>{o.windowStart || "?"} – {o.windowEnd || "?"}</span>}
                  {o.rent && <span style={{ fontWeight:600 }}>{o.rent}</span>}
                  {o.exercisedDate && <span style={{ color:C.green, fontSize:11 }}>exercised {o.exercisedDate}</span>}
                </div>
                {o.exerciseConditions && <div style={{ color:C.sub, fontSize:11.5 }}>{o.exerciseConditions}</div>}
                <Cite cite={o.cite} />
              </div>
            ))}
          </div>
        </Section>
      )}

      {rent.length > 0 && (
        <Section title="Rent schedule" count={rent.length}>
          <div style={{ overflowX:"auto" }}>
            <table style={{ borderCollapse:"collapse", fontSize:12, width:"100%", minWidth:380 }}>
              <thead>
                <tr style={{ color:C.faint, fontSize:10, textAlign:"left" }}>
                  <th style={{ padding:"3px 8px 3px 0" }}>Period</th>
                  <th style={{ padding:"3px 8px", textAlign:"right" }}>Annual</th>
                  <th style={{ padding:"3px 8px", textAlign:"right" }}>Monthly</th>
                  <th style={{ padding:"3px 8px" }}>Note</th>
                </tr>
              </thead>
              <tbody>
                {rent.map((r, i) => (
                  <tr key={i} style={{ borderTop:`1px solid ${C.line}`, color:C.ink }}>
                    <td style={{ padding:"4px 8px 4px 0", whiteSpace:"nowrap" }}>{r.periodStart || "?"} – {r.periodEnd || "?"}</td>
                    <td style={{ padding:"4px 8px", textAlign:"right", fontWeight:600, whiteSpace:"nowrap" }}>{fmtMoney(r.annualRent)}</td>
                    <td style={{ padding:"4px 8px", textAlign:"right", color:C.sub, whiteSpace:"nowrap" }}>{fmtMoney(r.monthlyRent)}</td>
                    <td style={{ padding:"4px 8px", color:C.sub }}>{r.note || ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rent[0]?.cite && <div style={{ marginTop:4 }}><Cite cite={rent[0].cite} /></div>}
        </Section>
      )}

      <Section title="Rent extras">
        <div style={{ fontSize:13, color:C.ink, lineHeight:1.6 }}>
          <div><b style={{ fontWeight:600 }}>Percentage rent:</b> <FieldBlock field={a.percentageRent} /></div>
          <div style={{ marginTop:6 }}><b style={{ fontWeight:600 }}>Security deposit:</b> <FieldBlock field={a.securityDeposit} /></div>
        </div>
      </Section>

      {exclusives.length > 0 && (
        <Section title="Exclusives & use" count={exclusives.length}>
          <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
            {exclusives.map((e, i) => (
              <div key={i} style={{ fontSize:12.5, color:C.ink, lineHeight:1.5 }}>
                <div>{e.description}<Cite cite={e.cite} /></div>
                {(e.modifications ?? []).map((m, j) => (
                  <div key={j} style={{ marginTop:3, marginLeft:12, color:C.amber, fontSize:11.5 }}>
                    ↳ Waiver{m.date ? ` (${m.date})` : ""}: {m.change}<Cite cite={m.cite} />
                  </div>
                ))}
              </div>
            ))}
          </div>
        </Section>
      )}

      <Section title="Go-dark"><FieldBlock field={a.goDark} /></Section>
      <Section title="Assignment & subletting"><FieldBlock field={a.assignment} /></Section>
      <Section title="CAM & taxes"><FieldBlock field={a.camTax} /></Section>
      <Section title="Default"><FieldBlock field={a.defaultTerms} /></Section>
      {a.governingLaw && (
        <Section title="Governing law"><div style={{ fontSize:13, color:C.ink }}>{a.governingLaw}</div></Section>
      )}

      {docs.length > 0 && (
        <Section title="Source documents" count={docs.length}>
          <div style={{ display:"flex", flexWrap:"wrap", gap:6 }}>
            {docs.map((d, i) => (
              <span key={i} title={d.type || ""} style={{ fontSize:11, color:C.sub, background:"#f6f2ea", border:`1px solid ${C.line}`, borderRadius:8, padding:"2px 8px" }}>
                {d.name}{d.date ? ` · ${d.date}` : ""}
              </span>
            ))}
          </div>
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

  const save = async () => {
    setErr(null);
    let parsed: LeaseAbstract;
    try {
      parsed = JSON.parse(text) as LeaseAbstract;
    } catch {
      setErr("That isn't valid JSON. Paste the full abstract object Claude gave you (it starts with { and ends with }).");
      return;
    }
    if (lockTenant) parsed.tenantName = lockTenant; // ensure it links to the right roster tenant
    if (!parsed.tenantName || !String(parsed.tenantName).trim()) {
      setErr("The abstract needs a tenantName so it links to a roster tenant.");
      return;
    }
    setSaving(true);
    const res = await apiSaveLeaseAbstract(dealId, parsed);
    setSaving(false);
    if (!res.ok) { setErr(res.error || "Couldn't save."); return; }
    onSaved({ ...parsed, id: res.id, dealId, version: res.version });
  };

  return (
    <div>
      <p style={{ fontSize:12.5, color:C.sub, lineHeight:1.5, margin:"0 0 10px" }}>
        Paste the reconciled lease abstract JSON from Claude{lockTenant ? <> for <b style={{ color:C.ink }}>{lockTenant}</b></> : null}. It's stored, displayed here, and made available to the Analyst chat. Source PDFs aren't uploaded — each fact cites its document, section, and page.
      </p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder='{ "tenantName": "...", "term": { ... }, ... }'
        spellCheck={false}
        style={{ width:"100%", height:200, fontFamily:"'SF Mono',ui-monospace,monospace", fontSize:12, color:C.ink, border:`1px solid ${C.line}`, borderRadius:8, padding:"10px 12px", resize:"vertical", boxSizing:"border-box" }}
      />
      {err && <div style={{ marginTop:8, fontSize:12, color:C.red, background:C.redBg, border:`1px solid ${C.redBorder}`, borderRadius:8, padding:"8px 10px" }}>{err}</div>}
      <div style={{ marginTop:12, display:"flex", justifyContent:"flex-end" }}>
        <button onClick={save} disabled={saving || !text.trim()}
          style={{ fontSize:13, fontWeight:700, color:"#fff", background: saving || !text.trim() ? C.faint : C.green, border:"none", borderRadius:8, padding:"9px 18px", cursor: saving || !text.trim() ? "default" : "pointer" }}>
          {saving ? "Saving…" : "Save abstract"}
        </button>
      </div>
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
  isAdmin?: boolean;
  onSaved?: (a: LeaseAbstract) => void;
  onDeleted?: (id: string) => void;
}

export default function LeaseAbstractModal({ open, onClose, mode, abstract, dealId, tenantName, isAdmin, onSaved, onDeleted }: Props) {
  // "view" can flip into an inline update (paste) without closing.
  const [updating, setUpdating] = useState(false);
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
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:10, padding:"18px 22px 12px", borderBottom:`1px solid ${C.line}` }}>
          <div style={{ minWidth:0 }}>
            <div style={{ fontSize:16, fontWeight:700, color:C.ink, whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>{title}</div>
            {!showPaste && abstract && (
              <div style={{ fontSize:11, color:C.faint, marginTop:2 }}>
                Lease abstract{abstract.dba && abstract.dba !== abstract.tenantName ? ` · ${abstract.dba}` : ""}{abstract.version ? ` · v${abstract.version}` : ""}{abstract.asOf ? ` · as of ${abstract.asOf}` : ""}
              </div>
            )}
          </div>
          <div style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
            {!showPaste && abstract && (
              <button onClick={() => setUpdating(true)} style={{ fontSize:12, fontWeight:600, color:C.green, background:C.greenBg, border:`1px solid ${C.greenBorder}`, borderRadius:7, padding:"6px 12px", cursor:"pointer" }}>Update from Claude</button>
            )}
            {!showPaste && abstract && isAdmin && (
              <button onClick={handleDelete} style={{ fontSize:12, fontWeight:600, color:C.red, background:"#fff", border:`1px solid ${C.redBorder}`, borderRadius:7, padding:"6px 10px", cursor:"pointer" }}>Delete</button>
            )}
            <button onClick={onClose} aria-label="Close" style={{ fontSize:18, lineHeight:1, color:C.faint, background:"none", border:"none", cursor:"pointer", padding:"2px 6px" }}>×</button>
          </div>
        </div>
        <div style={{ overflowY:"auto", padding:"4px 22px 20px" }}>
          {showPaste ? (
            <div style={{ paddingTop:14 }}>
              <PasteBody dealId={dealId} lockTenant={lockTenant} onSaved={(a) => { onSaved?.(a); onClose(); }} />
            </div>
          ) : abstract ? (
            <AbstractBody a={abstract} />
          ) : (
            <div style={{ padding:"20px 0", color:C.faint }}>No abstract.</div>
          )}
        </div>
      </div>
    </>,
    document.body,
  );
}
