import { useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { LeaseAbstract } from "../lib/idb";
import { apiSaveLeaseAbstract } from "../lib/api";

// One deal-level "Upload abstracts" entry point. Accepts a single tenant's JSON
// or a whole-property array, then AUTO-ROUTES each abstract to the matching
// roster tenant by a normalized tenantName match. Anything it can't confidently
// match is surfaced for the user to assign from a dropdown — nothing is saved to
// the wrong tenant or silently dropped. Saving loops apiSaveLeaseAbstract, which
// upserts by (deal, tenantName), so this works as bulk upload without a new API.

const C = {
  ink: "#383a37", sub: "#6f6a5f", faint: "#a69e91", line: "#efe8da",
  green: "#3f7a1f", greenBg: "#eef3e6", amber: "#c97a18", amberBg: "#fbf1e4",
  amberBorder: "#e0c9a8", red: "#dc2626", blue: "#2a7de1",
};

// Normalize a tenant name for matching: drop entity suffixes, store numbers and
// punctuation so "Office Depot, Inc. #3362" ≈ "Office Depot" and "Ulta Beauty" ≈ "Ulta".
function normalize(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/\b(inc|llc|ltd|corp|corporation|company|co|stores?|store|the|of|and)\b/g, " ")
    .replace(/#?\s*\d[\d-]*/g, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, "")
    .trim();
}

type Parsed = { abstract: LeaseAbstract; rawName: string; assigned: string | null };

type Props = {
  dealId: string;
  tenantNames: string[];
  onClose: () => void;
  onSaved: () => void;
};

export default function AbstractUploadModal({ dealId, tenantNames, onClose, onSaved }: Props) {
  const [text, setText] = useState("");
  const [items, setItems] = useState<Parsed[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [result, setResult] = useState<{ saved: number; failed: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Read the chosen file and parse it straight to the match preview. Kept separate
  // from the textarea so a multi-hundred-KB whole-property file never has to be pasted.
  const onPickFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = ""; // let the same file be re-picked
    if (!f) return;
    setErr(null);
    let raw: string;
    try { raw = await f.text(); } catch { setErr("Couldn't read that file."); return; }
    parse(raw);
  };

  const normMap = useMemo(() => {
    const m = new Map<string, string>(); // normalized -> exact roster name
    for (const n of tenantNames) { const k = normalize(n); if (k) m.set(k, n); }
    return m;
  }, [tenantNames]);

  const sortedTenantNames = useMemo(
    () => [...tenantNames].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })),
    [tenantNames]
  );

  function matchName(raw: string): string | null {
    const k = normalize(raw);
    if (!k) return null;
    if (normMap.has(k)) return normMap.get(k) ?? null;
    const cands: string[] = [];
    for (const [nk, exact] of normMap) {
      if (nk.length >= 4 && (nk.includes(k) || k.includes(nk))) cands.push(exact);
    }
    return cands.length === 1 ? cands[0] : null; // only auto-match when unambiguous
  }

  function parse(rawArg?: string) {
    setErr(null); setResult(null);
    const raw = rawArg ?? text;
    let data: unknown;
    try { data = JSON.parse(raw); }
    catch { setErr("That isn't valid JSON. Paste the abstract JSON — one tenant, or an array of tenants."); return; }

    let arr: unknown[];
    const obj = data as { abstracts?: unknown };
    if (Array.isArray(data)) arr = data;
    else if (obj && typeof obj === "object" && Array.isArray(obj.abstracts)) arr = obj.abstracts;
    else if (data && typeof data === "object") arr = [data];
    else { setErr("Expected an abstract object, an array, or { abstracts: [...] }."); return; }

    const parsed: Parsed[] = [];
    let missingName = false;
    for (const it of arr) {
      const a = it as LeaseAbstract;
      const raw = a && typeof a.tenantName === "string" ? a.tenantName : "";
      if (!raw.trim()) missingName = true;
      parsed.push({ abstract: a, rawName: raw, assigned: matchName(raw) });
    }
    if (!parsed.length) { setErr("No abstracts found in that JSON."); return; }
    if (missingName) setErr("Heads up: one or more abstracts have no tenantName — assign them below.");
    setItems(parsed);
  }

  async function save() {
    if (!items) return;
    const ready = items.filter((i) => i.assigned);
    if (!ready.length) { setErr("Assign at least one abstract to a tenant first."); return; }
    setSaving(true); setErr(null);
    let saved = 0, failed = 0;
    for (const i of ready) {
      const payload: LeaseAbstract = { ...i.abstract, tenantName: i.assigned ?? "" };
      const res = await apiSaveLeaseAbstract(dealId, payload);
      if (res.ok) saved += 1; else failed += 1;
    }
    setSaving(false);
    setResult({ saved, failed });
    if (saved) onSaved();
  }

  const matched = items?.filter((i) => i.assigned) ?? [];
  const unmatched = items?.filter((i) => !i.assigned) ?? [];

  const btn = (bg: string, on: boolean): React.CSSProperties => ({
    background: on ? bg : "#ccc", color: "#fff", border: "none", padding: "9px 18px",
    borderRadius: 8, fontWeight: 700, fontSize: 13, cursor: on ? "pointer" : "default",
    fontFamily: "'Inter',sans-serif",
  });

  return createPortal(
    <>
      <div onClick={onClose} aria-hidden="true"
        style={{ position: "fixed", inset: 0, background: "rgba(42,44,40,0.52)", zIndex: 2000, backdropFilter: "blur(2px)" }} />
      <div role="dialog" aria-modal="true"
        style={{ position: "fixed", zIndex: 2001, top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          width: "min(560px, calc(100vw - 24px))", maxHeight: "calc(100vh - 48px)", overflowY: "auto",
          background: "#fff", borderRadius: 14, boxShadow: "0 18px 50px rgba(0,0,0,0.3)", padding: "18px 20px", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 8 }}>
          <div>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.ink }}>Upload lease abstracts</div>
            <div style={{ fontSize: 11.5, color: C.sub, marginTop: 2 }}>
              Paste one tenant's JSON or a whole-property array. Each routes to the matching tenant automatically; anything unmatched you assign below.
            </div>
          </div>
          <button onClick={onClose} aria-label="Close"
            style={{ fontSize: 18, color: C.faint, background: "none", border: "none", cursor: "pointer", padding: "2px 6px" }}>×</button>
        </div>

        {!items && (
          <>
            <textarea value={text} onChange={(e) => setText(e.target.value)}
              placeholder={'{ "tenantName": "...", ... }   — or —   [ {...}, {...} ]'}
              style={{ width: "100%", minHeight: 150, fontSize: 11.5, padding: "9px 11px", border: `1px solid ${C.line}`,
                borderRadius: 8, fontFamily: "monospace", resize: "vertical", color: C.ink, boxSizing: "border-box" }} />
            <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 8, flexWrap: "wrap" }}>
              {/* iOS-safe file picker: a real button calls the input's .click() via a ref.
                  The input must stay in the layout (NOT display:none) and have NO `accept`
                  attribute, or iOS Safari refuses to open the picker / greys out .json. */}
              <button type="button" onClick={() => fileRef.current?.click()}
                style={{ fontSize: 13, fontWeight: 700, color: "#fff", background: C.green, border: "none",
                  borderRadius: 8, padding: "9px 18px", cursor: "pointer", minHeight: 38, display: "inline-flex", alignItems: "center", gap: 6 }}>
                ⬆ Choose .json file
              </button>
              <input ref={fileRef} type="file" onChange={onPickFile}
                style={{ position: "absolute", width: 1, height: 1, opacity: 0, pointerEvents: "none" }} />
              <button onClick={() => parse()} disabled={!text.trim()} style={btn(C.blue, !!text.trim())}>Match pasted text</button>
            </div>
            <div style={{ marginTop: 6, fontSize: 11, color: C.faint }}>On a phone, tap “Choose .json file” and pick the file Claude sent — no pasting needed.</div>
          </>
        )}

        {err && <div style={{ marginTop: 10, fontSize: 12, color: C.red }}>{err}</div>}

        {items && !result && (
          <div style={{ marginTop: 4 }}>
            {matched.length > 0 && (
              <div style={{ marginBottom: 12 }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.green, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                  Matched ({matched.length})
                </div>
                {matched.map((i, ix) => (
                  <div key={ix} style={{ fontSize: 12.5, color: C.ink, padding: "3px 0", display: "flex", gap: 8 }}>
                    <span style={{ color: C.green }}>✓</span>
                    <span><b>{i.rawName || "(no name)"}</b> → {i.assigned}</span>
                  </div>
                ))}
              </div>
            )}
            {unmatched.length > 0 && (
              <div style={{ marginBottom: 12, background: C.amberBg, border: `1px solid ${C.amberBorder}`, borderRadius: 9, padding: "10px 12px" }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: C.amber, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 6 }}>
                  Needs assignment ({unmatched.length})
                </div>
                {items.map((i, ix) => i.assigned ? null : (
                  <div key={ix} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", flexWrap: "wrap" }}>
                    <span style={{ fontSize: 12.5, color: C.ink, flex: "1 1 150px" }}>&ldquo;{i.rawName || "(no name)"}&rdquo; →</span>
                    <select value=""
                      onChange={(e) => { const v = e.target.value; setItems((prev) => (prev ?? []).map((p, pi) => pi === ix ? { ...p, assigned: v || null } : p)); }}
                      style={{ flex: "1 1 180px", fontSize: 12.5, padding: "6px 8px", border: `1px solid ${C.amberBorder}`, borderRadius: 7, color: C.ink, background: "#fff", minHeight: 34 }}>
                      <option value="">— pick a tenant —</option>
                      {sortedTenantNames.map((n) => <option key={n} value={n}>{n}</option>)}
                    </select>
                  </div>
                ))}
              </div>
            )}
            <div style={{ display: "flex", gap: 10, marginTop: 4, flexWrap: "wrap" }}>
              <button onClick={save} disabled={saving || matched.length === 0} style={btn(C.green, !saving && matched.length > 0)}>
                {saving ? "Saving…" : `Save ${matched.length} abstract${matched.length === 1 ? "" : "s"}`}
              </button>
              <button onClick={() => { setItems(null); setErr(null); }}
                style={{ background: "transparent", border: `1px solid ${C.line}`, color: C.sub, padding: "9px 14px", borderRadius: 8, fontSize: 12, cursor: "pointer" }}>Back</button>
            </div>
          </div>
        )}

        {result && (
          <div style={{ marginTop: 12 }}>
            <div style={{ fontSize: 13.5, color: C.ink, fontWeight: 600 }}>
              Saved {result.saved} abstract{result.saved === 1 ? "" : "s"}{result.failed ? `, ${result.failed} failed` : ""}.
              {unmatched.length ? ` ${unmatched.length} left unassigned.` : ""}
            </div>
            <button onClick={onClose} style={{ ...btn("#2a2c27", true), marginTop: 12 }}>Done</button>
          </div>
        )}
      </div>
    </>,
    document.body,
  );
}
