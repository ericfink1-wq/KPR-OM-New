import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { createPortal } from "react-dom";
import { apiUploadLog, type UploadLogEntry } from "../lib/api";
import { useIsMobile } from "../hooks/use-mobile";
import { RESULT_STYLE, docTypeLabel, fmtWhen } from "./UploadHistoryCard";

// Site-wide Upload log (Eric, 10/19/26) — owners / admins. Every upload: when, who, which
// file, what kind of document it was read as, and what it did (created a deal / added to
// one / skipped / turned away as "Not an OM — not added" / failed), with a link to the
// deal. Filter by person and date. Built on the existing upload_log rows (GET /upload-log).

// The "Not an OM — not added." lead-in is already the Result chip; show only the reason.
const reasonOf = (d: string) => d.replace(/^Not an OM — not added\.\s*/, "");
const resultOf = (u: UploadLogEntry) => u.result || (u.status === "failed" ? "failed" : "attached");
const dayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

export default function UploadLogPage({ onClose, onOpenDeal }: { onClose: () => void; onOpenDeal?: (id: string) => void }) {
  const isPhone = useIsMobile();
  const [rows, setRows] = useState<UploadLogEntry[] | null>(null);
  const [user, setUser] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [result, setResult] = useState("");

  useEffect(() => { apiUploadLog({ limit: 2000 }).then(setRows).catch(() => setRows([])); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const people = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows || []) {
      const key = (r.userEmail || r.userName || "").toLowerCase();
      if (key && !m.has(key)) m.set(key, r.userName ? `${r.userName}${r.userEmail ? ` (${r.userEmail})` : ""}` : (r.userEmail || key));
    }
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [rows]);

  // Dates compare on the viewer's LOCAL day, so "Oct 19" means Oct 19 where they are.
  const shown = useMemo(() => (rows || []).filter(r => {
    if (user && (r.userEmail || r.userName || "").toLowerCase() !== user) return false;
    const day = dayKey(r.createdAt);
    if (from && day < from) return false;
    if (to && day > to) return false;
    if (result && resultOf(r) !== result) return false;
    return true;
  }), [rows, user, from, to, result]);

  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const r of shown) c[resultOf(r)] = (c[resultOf(r)] || 0) + 1;
    return c;
  }, [shown]);

  const input: CSSProperties = { fontSize: 13, padding: "8px 10px", minHeight: 38, border: "1px solid #d7d5ce", borderRadius: 8, background: "#fff", fontFamily: "'Roboto',sans-serif", color: "#232422", minWidth: 0 };
  const chip = (res: string) => {
    const s = RESULT_STYLE[res] ?? RESULT_STYLE.attached;
    return <span style={{ fontSize: 10.5, fontWeight: 700, color: s.color, background: s.bg, padding: "2px 8px", borderRadius: 4, whiteSpace: "nowrap" }}>{s.label}</span>;
  };
  const dealCell = (r: UploadLogEntry) => {
    if (!r.dealId) return <span style={{ color: "#b8b5ad" }}>—</span>;
    const name = r.dealName || "deal";
    if (r.dealExists && onOpenDeal) {
      return <button onClick={() => { onOpenDeal(r.dealId!); onClose(); }}
        style={{ background: "none", border: "none", padding: 0, color: "#2c6e9b", fontSize: "inherit", fontWeight: 600, cursor: "pointer", textAlign: "left", overflowWrap: "break-word", fontFamily: "inherit" }}>{name}</button>;
    }
    return <span style={{ color: "#9b9992" }} title="This deal was deleted or is in the Trash">{name} (removed)</span>;
  };

  // Portalled to <body>: the Header that opens it is its own stacking context, which clipped a fixed overlay to the header strip.
  return createPortal(
    <div role="dialog" aria-label="Upload log" style={{ position: "fixed", inset: 0, zIndex: 9700, background: "#FAF9F5", overflowY: "auto", fontFamily: "'Roboto',sans-serif" }}>
      <div style={{ maxWidth: 1240, margin: "0 auto", padding: isPhone ? "16px 16px 40px" : "28px 32px 48px" }}>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
          <div style={{ minWidth: 0 }}>
            <div className="kpr-page-kicker">Admin</div>
            <h1 className="kpr-page-title" style={{ margin: 0 }}>Upload log</h1>
            <div className="kpr-page-sub">Every file uploaded to the site — who, what it was read as, and what it did.</div>
          </div>
          <button onClick={onClose} className="kpr-btn" style={{ flexShrink: 0, minHeight: 38 }}>Close</button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: isPhone ? "1fr 1fr" : "minmax(220px,2fr) 1fr 1fr 1fr auto", gap: 8, alignItems: "end", marginBottom: 12 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "#676767", gridColumn: isPhone ? "1 / -1" : undefined }}>Person
            <select value={user} onChange={e => setUser(e.target.value)} style={input}>
              <option value="">Everyone</option>
              {people.map(([k, label]) => <option key={k} value={k}>{label}</option>)}
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "#676767" }}>From
            <input type="date" value={from} onChange={e => setFrom(e.target.value)} style={input} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "#676767" }}>To
            <input type="date" value={to} onChange={e => setTo(e.target.value)} style={input} />
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, color: "#676767" }}>Result
            <select value={result} onChange={e => setResult(e.target.value)} style={input}>
              <option value="">All results</option>
              {Object.entries(RESULT_STYLE).map(([k, s]) => <option key={k} value={k}>{s.label}</option>)}
            </select>
          </label>
          {(user || from || to || result) ? (
            <button onClick={() => { setUser(""); setFrom(""); setTo(""); setResult(""); }} className="kpr-btn" style={{ minHeight: 38 }}>Clear</button>
          ) : <span />}
        </div>

        <div style={{ fontSize: 12, color: "#676767", marginBottom: 10, display: "flex", gap: 10, flexWrap: "wrap" }}>
          {rows == null ? "Loading…" : <>
            <span><b style={{ color: "#232422" }}>{shown.length}</b> upload{shown.length === 1 ? "" : "s"}</span>
            {Object.entries(RESULT_STYLE).filter(([k]) => counts[k]).map(([k, s]) => <span key={k} style={{ color: s.color }}>{counts[k]} {s.label.toLowerCase()}</span>)}
          </>}
        </div>

        {rows != null && shown.length === 0 && (
          <div className="kpr-card" style={{ padding: 20, color: "#676767", fontSize: 13 }}>No uploads match these filters.</div>
        )}

        {shown.length > 0 && (isPhone ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {shown.map(r => (
              <div key={r.id} className="kpr-card" style={{ padding: "11px 13px" }}>
                <div style={{ fontSize: 13, color: "#232422", fontWeight: 600, overflowWrap: "break-word" }}>{r.fileName || "(file)"}</div>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginTop: 5 }}>
                  {chip(resultOf(r))}
                  <span style={{ fontSize: 10, fontWeight: 700, color: "#676767", background: "#f3f2ee", padding: "2px 7px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.04em" }}>{docTypeLabel(r.docType)}</span>
                </div>
                <div style={{ fontSize: 12, color: "#52554e", marginTop: 6 }}>{r.userName || r.userEmail || "Unknown"}{r.userName && r.userEmail ? <span style={{ color: "#9b9992" }}> · {r.userEmail}</span> : null}</div>
                <div style={{ fontSize: 11.5, color: "#9b9992", marginTop: 2 }}>{fmtWhen(r.createdAt)}</div>
                {r.dealId && <div style={{ fontSize: 12.5, marginTop: 6 }}>→ {dealCell(r)}</div>}
                {r.detail && resultOf(r) !== "created" && resultOf(r) !== "attached" && <div style={{ fontSize: 11.5, color: "#8a8579", marginTop: 5, lineHeight: 1.4, overflowWrap: "break-word" }}>{reasonOf(r.detail)}</div>}
              </div>
            ))}
          </div>
        ) : (
          <div className="kpr-card" style={{ padding: 0, overflowX: "auto" }}>
            <style>{`.kpr-upload-log th, .kpr-upload-log td { padding: 9px 12px; vertical-align: top; } .kpr-upload-log th:first-child, .kpr-upload-log td:first-child { padding-left: 16px; }`}</style>
            <table className="kpr-table am-pin kpr-upload-log" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5 }}>
              <thead>
                <tr>
                  <th style={{ textAlign: "left", position: "sticky", left: 0, zIndex: 3 }}>Date</th>
                  <th style={{ textAlign: "left" }}>User</th>
                  <th style={{ textAlign: "left" }}>File</th>
                  <th style={{ textAlign: "left" }}>Doc type</th>
                  <th style={{ textAlign: "left" }}>Result</th>
                  <th style={{ textAlign: "left" }}>Deal</th>
                </tr>
              </thead>
              <tbody>
                {shown.map(r => (
                  <tr key={r.id}>
                    <td style={{ whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums", color: "#52554e" }}>{fmtWhen(r.createdAt)}</td>
                    <td><div style={{ color: "#232422" }}>{r.userName || r.userEmail || "Unknown"}</div>{r.userName && r.userEmail ? <div style={{ fontSize: 11, color: "#9b9992" }}>{r.userEmail}</div> : null}</td>
                    <td style={{ minWidth: 220, overflowWrap: "break-word" }} title={r.detail || ""}>
                      {r.fileName || "(file)"}
                      {r.detail && resultOf(r) !== "created" && resultOf(r) !== "attached" && <div style={{ fontSize: 11, color: "#8a8579", marginTop: 2, lineHeight: 1.35 }}>{reasonOf(r.detail).length > 160 ? reasonOf(r.detail).slice(0, 157) + "…" : reasonOf(r.detail)}</div>}
                    </td>
                    <td style={{ whiteSpace: "nowrap" }}>{docTypeLabel(r.docType)}</td>
                    <td>{chip(resultOf(r))}</td>
                    <td style={{ minWidth: 160 }}>{dealCell(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>,
    document.body,
  );
}
