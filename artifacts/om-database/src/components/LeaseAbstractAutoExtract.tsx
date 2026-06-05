import { useState } from "react";
import type { LeaseAbstract } from "../lib/idb";
import { apiAutoExtractLeaseAbstract, type LeaseAbstractDocInput } from "../lib/api";
import { extractPdfText } from "../lib/pdfExtract";

// DORMANT (Phase 2). Admin panel inside the lease-abstract modal: upload a
// tenant's full document set (PDFs), pull each one's text in the browser, and let
// the SERVER reconcile them into an abstract (instead of pasting Claude's JSON).
// Rendered only when LEASE_ABSTRACT_AUTOEXTRACT_UI is true AND the server
// endpoint is enabled; both are off by default, so this is inert today.

const C = {
  ink: "#383a37", sub: "#6f6a5f", faint: "#a69e91", line: "#efe8da",
  green: "#3f7a1f", greenBg: "#eef3e6", greenBorder: "#b8d49a",
  red: "#dc2626", redBg: "#fdecec", redBorder: "#f3c0c0",
};

const DOC_TYPES = ["lease", "amendment", "guaranty", "assignment", "option", "waiver", "letter", "license", "other"] as const;

function guessType(name: string): string {
  const n = name.toLowerCase();
  if (/(amendment|expansion|supplement)/.test(n)) return "amendment";
  if (/(guaranty|guarantee)/.test(n)) return "guaranty";
  if (/(assign)/.test(n)) return "assignment";
  if (/(option|extend|exercise|renew)/.test(n)) return "option";
  if (/(waiver|consent)/.test(n)) return "waiver";
  if (/(license)/.test(n)) return "license";
  if (/(letter|notice|ltr)/.test(n)) return "letter";
  if (/(lease|indenture)/.test(n)) return "lease";
  return "other";
}

interface PickedDoc { name: string; type: string; date: string; file: File }

export default function LeaseAbstractAutoExtract({ dealId, tenantName, dealName, onSaved }: {
  dealId: string; tenantName: string; dealName?: string | null; onSaved: (a: LeaseAbstract) => void;
}) {
  const [docs, setDocs] = useState<PickedDoc[]>([]);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const addFiles = (files: FileList | null) => {
    if (!files) return;
    const next: PickedDoc[] = Array.from(files).map((f) => ({
      name: f.name.replace(/\.[^.]+$/, ""), type: guessType(f.name), date: "", file: f,
    }));
    setDocs((cur) => [...cur, ...next]);
  };

  const update = (i: number, patch: Partial<PickedDoc>) =>
    setDocs((cur) => cur.map((d, j) => (j === i ? { ...d, ...patch } : d)));
  const remove = (i: number) => setDocs((cur) => cur.filter((_, j) => j !== i));

  const run = async () => {
    setErr(null);
    if (!docs.length) { setErr("Add at least one document first."); return; }
    setBusy(true);
    try {
      const inputs: LeaseAbstractDocInput[] = [];
      for (let i = 0; i < docs.length; i++) {
        const d = docs[i];
        setProgress(`Reading ${i + 1} of ${docs.length}: ${d.name}…`);
        let text = "";
        if (/\.pdf$/i.test(d.file.name)) {
          const buf = await d.file.arrayBuffer();
          text = (await extractPdfText(buf)).text;
        } else {
          text = await d.file.text();
        }
        if (text.trim()) inputs.push({ name: d.name, type: d.type, date: d.date || null, text });
      }
      if (!inputs.length) { setErr("Couldn't read text from any of those files."); setBusy(false); setProgress(""); return; }
      setProgress(`Reconciling ${inputs.length} document${inputs.length > 1 ? "s" : ""} — reading every page…`);
      const res = await apiAutoExtractLeaseAbstract(dealId, tenantName, inputs, dealName ?? undefined);
      if (!res.ok || !res.abstract) { setErr(res.error || "Auto-extraction failed."); setBusy(false); setProgress(""); return; }
      onSaved(res.abstract);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Auto-extraction failed.");
    } finally {
      setBusy(false);
      setProgress("");
    }
  };

  return (
    <div>
      <p style={{ fontSize:12.5, color:C.sub, lineHeight:1.5, margin:"0 0 10px" }}>
        Upload <b style={{ color:C.ink }}>{tenantName}</b>'s full lease document set (original lease + every amendment, assignment, guaranty, option exercise, waiver). The server reads each one in full and reconciles them into an abstract — latest document wins, with citations and flags. Confirm the doc type and date for each so the chronology is right.
      </p>

      <label style={{ display:"inline-block", fontSize:12.5, fontWeight:700, color:C.green, background:C.greenBg, border:`1px solid ${C.greenBorder}`, borderRadius:8, padding:"8px 14px", cursor: busy ? "default" : "pointer" }}>
        + Add documents
        <input type="file" accept=".pdf,.txt" multiple disabled={busy} onChange={(e) => addFiles(e.target.files)} style={{ display:"none" }} />
      </label>

      {docs.length > 0 && (
        <div style={{ marginTop:12, display:"flex", flexDirection:"column", gap:8 }}>
          {docs.map((d, i) => (
            <div key={i} style={{ display:"flex", gap:8, alignItems:"center", flexWrap:"wrap", border:`1px solid ${C.line}`, borderRadius:8, padding:"8px 10px" }}>
              <input value={d.name} disabled={busy} onChange={(e) => update(i, { name: e.target.value })}
                style={{ flex:"2 1 180px", minWidth:140, fontSize:12, color:C.ink, border:`1px solid ${C.line}`, borderRadius:6, padding:"5px 8px" }} />
              <select value={d.type} disabled={busy} onChange={(e) => update(i, { type: e.target.value })}
                style={{ fontSize:12, color:C.ink, border:`1px solid ${C.line}`, borderRadius:6, padding:"5px 8px" }}>
                {DOC_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
              <input type="date" value={d.date} disabled={busy} onChange={(e) => update(i, { date: e.target.value })}
                style={{ fontSize:12, color:C.ink, border:`1px solid ${C.line}`, borderRadius:6, padding:"5px 8px" }} />
              <button onClick={() => remove(i)} disabled={busy} aria-label="Remove"
                style={{ fontSize:16, lineHeight:1, color:C.faint, background:"none", border:"none", cursor: busy ? "default" : "pointer" }}>×</button>
            </div>
          ))}
        </div>
      )}

      {err && <div style={{ marginTop:10, fontSize:12, color:C.red, background:C.redBg, border:`1px solid ${C.redBorder}`, borderRadius:8, padding:"8px 10px" }}>{err}</div>}
      {busy && progress && <div style={{ marginTop:10, fontSize:12, color:C.sub }}>{progress}</div>}

      <div style={{ marginTop:12, display:"flex", justifyContent:"flex-end" }}>
        <button onClick={run} disabled={busy || !docs.length}
          style={{ fontSize:13, fontWeight:700, color:"#fff", background: busy || !docs.length ? C.faint : C.green, border:"none", borderRadius:8, padding:"9px 18px", cursor: busy || !docs.length ? "default" : "pointer" }}>
          {busy ? "Reconciling…" : "Reconcile into abstract"}
        </button>
      </div>
    </div>
  );
}
