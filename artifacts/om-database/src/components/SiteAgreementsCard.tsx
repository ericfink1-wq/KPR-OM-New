import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { SiteAgreement, SiteAgreementFlag } from "../lib/idb";
import { apiListSiteAgreements, apiBulkSaveSiteAgreements, apiDeleteSiteAgreement } from "../lib/api";
import { exportSiteAgreementsWorkbook } from "../lib/siteAgreementExcel";

// Center-level "Site Agreements / REAs" section for the deal page. Mirrors the
// lease-abstract system but for property-level recorded documents (Operating
// Agreements, OEAs, reciprocal easements, pad declarations, use restrictions,
// cost-share/maintenance agreements, utility easements). Self-contained: loads its
// own data, has its own JSON upload + read-only viewer, so DetailView mounts it
// with a single line and it touches none of the roster/occupancy logic.

const C = {
  ink: "#383a37", sub: "#6f6a5f", faint: "#a69e91", line: "#efe8da",
  green: "#3f7a1f", greenBg: "#eef3e6", amber: "#c97a18", amberBg: "#fbf1e4",
  amberBorder: "#e0c9a8", red: "#dc2626", redBg: "#fdecec", blue: "#2a7de1",
  card: "#fffdf8",
};

function sevRank(s?: string | null): 0 | 1 | 2 {
  const v = (s || "info").toLowerCase();
  if (v === "critical" || v === "high") return 0;
  if (v === "watch" || v === "warn" || v === "medium") return 1;
  return 2;
}
function sevColor(s?: string | null): { fg: string; bg: string; label: string } {
  const r = sevRank(s);
  if (r === 0) return { fg: C.red, bg: C.redBg, label: "CRITICAL" };
  if (r === 1) return { fg: C.amber, bg: C.amberBg, label: "WATCH" };
  return { fg: C.sub, bg: "#f1efe8", label: "INFO" };
}
function typeLabel(t?: string | null): string {
  const map: Record<string, string> = {
    operating_agreement: "Operating Agreement",
    reciprocal_easement_OEA: "OEA / Reciprocal Easement",
    pad_declaration: "Pad Declaration",
    maintenance_easement: "Maintenance / Cost-share",
    use_restriction: "Use Restriction",
    developer_agreement: "Developer Agreement",
    drainage_easement: "Drainage Easement",
    utility_easement: "Utility Easement",
    other: "Other",
  };
  return (t && map[t]) || (t ? String(t) : "Agreement");
}
function asList(v: unknown): string[] {
  if (!v) return [];
  if (Array.isArray(v)) return v.map((x) => (typeof x === "string" ? x : JSON.stringify(x))).filter(Boolean);
  if (typeof v === "string") return v.trim() ? [v] : [];
  return [];
}
function hasRealRofr(a: SiteAgreement): boolean {
  return asList(a.purchaseRightsROFR).some((s) => {
    const l = s.toLowerCase();
    return l && !l.startsWith("none") && !l.startsWith("no purchase") && !l.startsWith("not ") && !l.startsWith("n/a");
  });
}

export default function SiteAgreementsCard({ dealId, dealName, isAdmin }: { dealId: string; dealName?: string; isAdmin?: boolean }) {
  const [items, setItems] = useState<SiteAgreement[] | null>(null);
  const [showUpload, setShowUpload] = useState(false);
  const [viewing, setViewing] = useState<SiteAgreement | null>(null);

  const reload = useCallback(() => {
    apiListSiteAgreements(dealId).then(setItems).catch(() => setItems([]));
  }, [dealId]);
  useEffect(() => { setItems(null); reload(); }, [reload]);

  const counts = useMemo(() => {
    let critical = 0, watch = 0, rofr = 0;
    for (const a of items ?? []) {
      for (const f of (a.flags ?? [])) {
        const r = sevRank(f.severity);
        if (r === 0) critical += 1; else if (r === 1) watch += 1;
      }
      if (hasRealRofr(a)) rofr += 1;
    }
    return { critical, watch, rofr };
  }, [items]);

  const sorted = useMemo(
    () => [...(items ?? [])].sort((a, b) => (a.center || "").localeCompare(b.center || "") || (a.agreementName || "").localeCompare(b.agreementName || "")),
    [items],
  );

  const sectionStyle: React.CSSProperties = { marginTop: 18, marginBottom: 22 };
  const headStyle: React.CSSProperties = { display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" };

  return (
    <div id="section-site-agreements" style={sectionStyle}>
      <div style={headStyle}>
        <div style={{ display: "flex", alignItems: "baseline", gap: 8, flexWrap: "wrap" }}>
          <span style={{ fontSize: 14.5, fontWeight: 700, color: C.ink, fontFamily: "'Inter',sans-serif" }}>Site Agreements / REAs</span>
          {items && items.length > 0 && (
            <span style={{ fontSize: 11.5, color: C.sub }}>
              {items.length} agreement{items.length === 1 ? "" : "s"}
              {counts.critical ? ` · ${counts.critical} critical` : ""}
              {counts.watch ? ` · ${counts.watch} to watch` : ""}
              {counts.rofr ? ` · ${counts.rofr} w/ purchase/ROFR` : ""}
            </span>
          )}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {items && items.length > 0 && (
            <button onClick={() => { void exportSiteAgreementsWorkbook(dealName || "deal", items).catch(() => {}); }}
              title="Export the REA / easement abstracts to Excel — a REA & Easements summary index plus one detailed tab per agreement"
              style={{ background: "#eafaf0", border: "1px solid #b7e4c7", color: "#1f6f43", padding: "6px 13px", borderRadius: 7, cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "'Inter',sans-serif", display: "flex", alignItems: "center", gap: 5 }}>
              ⬇ REA &amp; Easements — Excel
            </button>
          )}
          <button onClick={() => setShowUpload(true)}
            title="Upload a property's REA / easement / operating-agreement abstracts (one JSON, or a whole-property file)"
            style={{ background: "#fff", border: "1px solid #c2d6f0", color: "#1f4d8f", padding: "6px 13px", borderRadius: 7, cursor: "pointer", fontSize: 11.5, fontWeight: 600, fontFamily: "'Inter',sans-serif", display: "flex", alignItems: "center", gap: 5 }}>
            ⬆ Upload site agreements
          </button>
        </div>
      </div>

      {items === null && <div style={{ fontSize: 12, color: C.faint }}>Loading…</div>}
      {items && items.length === 0 && (
        <div style={{ fontSize: 12, color: C.sub, background: C.greenBg, border: `1px dashed ${C.line}`, borderRadius: 9, padding: "10px 13px" }}>
          No site agreements yet. These are the property-level recorded documents — REAs, OEAs, operating agreements, pad declarations, easements — that bind the land. Upload the REA abstract JSON to populate them here.
        </div>
      )}

      {sorted.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sorted.map((a) => {
            const flags = [...(a.flags ?? [])].sort((x, y) => sevRank(x.severity) - sevRank(y.severity));
            const top = flags[0];
            const rofr = hasRealRofr(a);
            return (
              <div key={a.id || a.agreementName}
                onClick={() => setViewing(a)}
                style={{ cursor: "pointer", background: C.card, border: `1px solid ${C.line}`, borderRadius: 10, padding: "11px 13px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, flexWrap: "wrap" }}>
                  <div style={{ flex: "1 1 260px", minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 700, color: C.ink, fontFamily: "'Inter',sans-serif" }}>{a.agreementName}</div>
                    <div style={{ fontSize: 11, color: C.sub, marginTop: 2 }}>
                      {[a.center, typeLabel(a.type), a.effectiveTerm].filter(Boolean).join(" · ")}
                    </div>
                  </div>
                  <div style={{ display: "flex", gap: 5, flexWrap: "wrap", alignItems: "center" }}>
                    {rofr && <span style={{ fontSize: 10, fontWeight: 700, color: "#1f6f43", background: "#e3f5e9", border: "1px solid #b7e4c7", borderRadius: 20, padding: "2px 8px" }}>PURCHASE / ROFR</span>}
                    {a.verifiedAgainstExecutedDoc === false && <span style={{ fontSize: 10, fontWeight: 700, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 20, padding: "2px 8px" }}>UNVERIFIED</span>}
                    {flags.length > 0 && (() => { const sc = sevColor(top?.severity); return (
                      <span style={{ fontSize: 10, fontWeight: 700, color: sc.fg, background: sc.bg, borderRadius: 20, padding: "2px 8px" }}>
                        {flags.length} flag{flags.length === 1 ? "" : "s"}
                      </span>
                    ); })()}
                  </div>
                </div>
                {a.materialityAssessment && (
                  <div style={{ fontSize: 11.5, color: C.sub, marginTop: 6 }}>{a.materialityAssessment}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {showUpload && (
        <UploadModal dealId={dealId} onClose={() => setShowUpload(false)} onSaved={() => { reload(); }} />
      )}
      {viewing && (
        <ViewerModal a={viewing} isAdmin={isAdmin} onClose={() => setViewing(null)}
          onDeleted={() => { setViewing(null); reload(); }} />
      )}
    </div>
  );
}

// ── Upload modal ──────────────────────────────────────────────────────────────
function UploadModal({ dealId, onClose, onSaved }: { dealId: string; onClose: () => void; onSaved: () => void }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ saved: number; skipped: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doParse = (raw: string): SiteAgreement[] | null => {
    let data: unknown;
    try { data = JSON.parse(raw); }
    catch { setErr("That isn't valid JSON. Upload the REA abstract JSON — one agreement, an array, or { siteAgreements: [...] }."); return null; }
    let arr: unknown[];
    const obj = data as { siteAgreements?: unknown; abstracts?: unknown };
    if (Array.isArray(data)) arr = data;
    else if (obj && typeof obj === "object" && Array.isArray(obj.siteAgreements)) arr = obj.siteAgreements;
    else if (obj && typeof obj === "object" && Array.isArray(obj.abstracts)) arr = obj.abstracts;
    else if (data && typeof data === "object") arr = [data];
    else { setErr("Expected an agreement object, an array, or { siteAgreements: [...] }."); return null; }
    const list = arr.filter((x): x is SiteAgreement => !!x && typeof x === "object" && typeof (x as SiteAgreement).agreementName === "string" && !!(x as SiteAgreement).agreementName.trim());
    if (!list.length) { setErr("No agreements with an agreementName were found in that JSON."); return null; }
    return list;
  };

  const save = async (list: SiteAgreement[]) => {
    setSaving(true); setErr(null);
    const res = await apiBulkSaveSiteAgreements(dealId, list);
    setSaving(false);
    if (!res.ok) { setErr(res.error || "Couldn't save."); return; }
    setResult({ saved: res.saved ?? list.length, skipped: (res.skipped ?? []).length });
    onSaved();
  };

  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    if (!f) return;
    setErr(null);
    let raw: string;
    try { raw = await f.text(); } catch { setErr("Couldn't read that file."); return; }
    const list = doParse(raw);
    if (list) await save(list);
  };

  const btn = (bg: string, on: boolean): React.CSSProperties => ({
    background: on ? bg : "#ccc", color: "#fff", border: "none", padding: "9px 18px",
    borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: on ? "pointer" : "default", fontFamily: "'Inter',sans-serif",
  });

  return createPortal(
    <>
      <div onClick={onClose} aria-hidden="true" style={{ position: "fixed", inset: 0, background: "rgba(42,44,40,0.52)", zIndex: 2000, backdropFilter: "blur(2px)" }} />
      <div role="dialog" aria-modal="true"
        style={{ position: "fixed", zIndex: 2001, top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(560px, calc(100vw - 24px))", maxHeight: "calc(100vh - 48px)", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,0.3)", padding: "18px 20px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>Upload site agreements / REAs</div>
            <div style={{ fontSize: 11.5, color: C.sub, marginTop: 2 }}>One agreement's JSON or a whole-property file ({"{ siteAgreements: [...] }"}). Each is keyed by its name; re-uploading updates in place.</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ fontSize: 18, color: C.faint, background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}>×</button>
        </div>

        {!result && (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)}
              placeholder={'{ "agreementName": "...", ... }   — or —   { "siteAgreements": [ {...}, {...} ] }'}
              style={{ width: "100%", minHeight: 140, fontSize: 11.5, padding: "9px 11px", border: `1px solid ${C.line}`, borderRadius: 8, fontFamily: "monospace", resize: "vertical", color: C.ink, boxSizing: "border-box" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              {/* iOS-safe file picker: real button calls input.click() via ref; input stays
                  in layout (not display:none) with NO accept attribute. */}
              <button type="button" onClick={() => fileRef.current?.click()}
                style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: C.green, border: "none", borderRadius: 8, padding: "9px 18px", cursor: "pointer", minHeight: 38, display: "inline-flex", alignItems: "center", gap: 6 }}>
                ⬆ Choose .json file
              </button>
              <input ref={fileRef} type="file" onChange={onPickFile} style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
              <button onClick={() => { const l = doParse(text); if (l) void save(l); }} disabled={!text.trim() || saving} style={btn(C.blue, !!text.trim() && !saving)}>
                {saving ? "Saving…" : "Save pasted JSON"}
              </button>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: C.faint }}>On a phone, tap “Choose .json file” and pick the REA file — no pasting needed.</div>
            {err && <div style={{ marginTop: 10, fontSize: 12, color: C.red }}>{err}</div>}
          </>
        )}

        {result && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13.5, color: C.ink, fontWeight: 600 }}>
              Saved {result.saved} agreement{result.saved === 1 ? "" : "s"}{result.skipped ? `, ${result.skipped} skipped (no name)` : ""}.
            </div>
            <button onClick={onClose} style={{ background: "#2a2c27", color: "#fff", border: "none", padding: "9px 18px", borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: "pointer", marginTop: 12, fontFamily: "'Inter',sans-serif" }}>Done</button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}

// ── Read-only viewer ─────────────────────────────────────────────────────────
function Dimension({ label, items }: { label: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, textTransform: "uppercase", letterSpacing: "0.04em" }}>{label}</div>
      <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
        {items.map((s, i) => <li key={i} style={{ fontSize: 12, color: C.sub, marginBottom: 3 }}>{s}</li>)}
      </ul>
    </div>
  );
}

function ViewerModal({ a, isAdmin, onClose, onDeleted }: { a: SiteAgreement; isAdmin?: boolean; onClose: () => void; onDeleted: () => void }) {
  const [deleting, setDeleting] = useState(false);
  const flags: SiteAgreementFlag[] = [...(a.flags ?? [])].sort((x, y) => sevRank(x.severity) - sevRank(y.severity));

  const doDelete = async () => {
    if (!a.id) return;
    if (!window.confirm(`Delete the abstract for “${a.agreementName}”? This can't be undone.`)) return;
    setDeleting(true);
    const res = await apiDeleteSiteAgreement(a.id);
    setDeleting(false);
    if (res.ok) onDeleted();
  };

  return createPortal(
    <>
      <div onClick={onClose} aria-hidden="true" style={{ position: "fixed", inset: 0, background: "rgba(42,44,40,0.52)", zIndex: 2000, backdropFilter: "blur(2px)" }} />
      <div role="dialog" aria-modal="true"
        style={{ position: "fixed", zIndex: 2001, top: "50%", left: "50%", transform: "translate(-50%,-50%)", width: "min(680px, calc(100vw - 24px))", maxHeight: "calc(100vh - 48px)", overflowY: "auto", background: "#fff", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,0.3)", padding: "18px 22px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 16.5, fontWeight: 700, color: C.ink, fontFamily: "'Inter',sans-serif" }}>{a.agreementName}</div>
            <div style={{ fontSize: 11.5, color: C.sub, marginTop: 2 }}>{[a.center, typeLabel(a.type), a.effectiveTerm, a.runsWithLand ? "runs with land" : null].filter(Boolean).join(" · ")}</div>
          </div>
          <button onClick={onClose} aria-label="Close" style={{ fontSize: 20, color: C.faint, background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}>×</button>
        </div>

        {a.verifiedAgainstExecutedDoc === false && (
          <div style={{ fontSize: 11.5, color: C.amber, background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 8, padding: "7px 11px", marginTop: 6 }}>
            ⚠ Marked unverified against the executed document — see flags.
          </div>
        )}

        {a.summary && <p style={{ fontSize: 12.5, color: C.ink, lineHeight: 1.5, marginTop: 10 }}>{a.summary}</p>}
        {a.kprImpact && (
          <div style={{ marginTop: 8, background: C.greenBg, border: `1px solid ${C.line}`, borderRadius: 8, padding: "9px 12px" }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: "0.04em" }}>What KPR inherits</div>
            <div style={{ fontSize: 12, color: C.ink, marginTop: 3, lineHeight: 1.5 }}>{a.kprImpact}</div>
          </div>
        )}
        {a.materialityAssessment && <div style={{ fontSize: 12, color: C.sub, marginTop: 8 }}><b>Materiality:</b> {a.materialityAssessment}</div>}

        <Dimension label="Purchase / ROFR / recapture" items={asList(a.purchaseRightsROFR)} />
        <Dimension label="Cost-sharing / recurring $" items={asList(a.costSharing)} />
        <Dimension label="Use restrictions" items={asList(a.useRestrictions)} />
        <Dimension label="Building / no-build" items={asList(a.buildingRestrictions)} />
        <Dimension label="Operating covenants" items={asList(a.operatingCovenants)} />
        <Dimension label="Approval rights" items={asList(a.approvalRights)} />
        <Dimension label="Maintenance obligations" items={asList(a.maintenanceObligations)} />
        <Dimension label="Termination / recapture" items={asList(a.terminationRecapture)} />
        <Dimension label="Easements" items={asList(a.easements)} />
        {a.assignmentTransfer && <Dimension label="Assignment / transfer" items={[a.assignmentTransfer]} />}
        {a.defaultRemedies && <Dimension label="Default / remedies" items={[a.defaultRemedies]} />}

        {flags.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>Flags / open questions</div>
            {flags.map((f, i) => { const sc = sevColor(f.severity); return (
              <div key={i} style={{ background: sc.bg, borderRadius: 8, padding: "8px 11px", marginBottom: 6 }}>
                <div style={{ fontSize: 11.5, fontWeight: 700, color: sc.fg }}>
                  <span style={{ fontSize: 9.5, fontWeight: 800, marginRight: 6 }}>{sc.label}</span>{f.issue}
                  {f.verifiedAgainstExecutedDoc === false && <span style={{ fontSize: 9.5, color: C.amber, marginLeft: 6 }}>(unverified)</span>}
                </div>
                {f.detail && <div style={{ fontSize: 11.5, color: C.ink, marginTop: 3, lineHeight: 1.45 }}>{f.detail}</div>}
              </div>
            ); })}
          </div>
        )}

        {a.crossCheckVsEricSummary && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, textTransform: "uppercase", letterSpacing: "0.04em" }}>Cross-check vs your REA summary</div>
            <div style={{ fontSize: 12, color: C.sub, marginTop: 3, lineHeight: 1.5 }}>{a.crossCheckVsEricSummary}</div>
          </div>
        )}

        {(a.documentChain ?? []).length > 0 && (
          <div style={{ marginTop: 10 }}>
            <div style={{ fontSize: 11, fontWeight: 700, color: C.ink, textTransform: "uppercase", letterSpacing: "0.04em" }}>Document chain</div>
            <ul style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {(a.documentChain ?? []).map((d, i) => (
                <li key={i} style={{ fontSize: 11.5, color: C.sub, marginBottom: 2 }}>
                  {[d.name, d.date, d.recording, d.role].filter(Boolean).join(" · ")}
                </li>
              ))}
            </ul>
          </div>
        )}

        {isAdmin && a.id && (
          <div style={{ marginTop: 16, borderTop: `1px solid ${C.line}`, paddingTop: 12 }}>
            <button onClick={doDelete} disabled={deleting}
              style={{ background: "#fff", border: `1px solid ${C.red}`, color: C.red, padding: "7px 14px", borderRadius: 8, fontSize: 12, fontWeight: 600, cursor: deleting ? "default" : "pointer", fontFamily: "'Inter',sans-serif" }}>
              {deleting ? "Deleting…" : "Delete this agreement"}
            </button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
