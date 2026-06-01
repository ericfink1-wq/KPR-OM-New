import { useState, useEffect, useMemo, useCallback } from "react";
import { createPortal } from "react-dom";
import type { Deal } from "../lib/idb";
import { tenantKey, isVacant } from "../lib/utils";
import { invalidateWatchlist } from "../lib/useWatchlist";

interface WatchRow {
  id: string;
  brand: string;
  status: string;          // watch | distressed | bankruptcy | liquidating
  note: string | null;
  sourceUrl: string | null;
  addedBy: string | null;
}

interface WatchlistArticle {
  title: string;
  link: string;
  source: string;
  publishedAt: string | null;
}

interface Exposure {
  centers: Array<{ dealId: string; propertyName: string; sf: number; annualRent: number; isDark: boolean; status?: string }>;
  totalSF: number;
  totalRent: number;
  darkCount: number;
}

const STATUS_META: Record<string, { label: string; color: string; bg: string; border: string; rank: number }> = {
  liquidating: { label: "Liquidating", color: "#fff",    bg: "#b3261e", border: "#b3261e", rank: 4 },
  bankruptcy:  { label: "Bankruptcy",  color: "#fff",    bg: "#d9534f", border: "#d9534f", rank: 3 },
  distressed:  { label: "Distressed",  color: "#7a4a00", bg: "#fbe6cf", border: "#e8c49a", rank: 2 },
  watch:       { label: "Watch",       color: "#5a5340", bg: "#f1eadc", border: "#ddd4c2", rank: 1 },
};
function meta(status: string) {
  return STATUS_META[status] || STATUS_META.watch;
}

const fmtMoney = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n >= 1_000 ? `$${Math.round(n / 1_000)}K` : `$${Math.round(n)}`;
const fmtSF = (n: number) => n > 0 ? `${Math.round(n).toLocaleString()} SF` : "—";
const fmtNewsDate = (iso: string | null) => {
  if (!iso) return "";
  const d = new Date(iso);
  return isNaN(d.getTime()) ? "" : d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

export default function RetailerWatchlist({ deals, onOpenDeal, onTenantClick }: { deals: Deal[]; onOpenDeal?: (id: string) => void; onTenantClick?: (name: string) => void }) {
  const [rows, setRows] = useState<WatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ brand: "", status: "watch", note: "", sourceUrl: "" });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);
  const [scope, setScope] = useState<"all" | "owned">("all");
  const [news, setNews] = useState<WatchlistArticle[] | null>(null);
  const [newsLoading, setNewsLoading] = useState(false);

  const closeForm = useCallback(() => { setAdding(false); setEditId(null); setNews(null); }, []);

  // While the modal is open, pull recent headlines for the typed brand (debounced).
  useEffect(() => {
    if (!adding) { setNews(null); return; }
    const b = form.brand.trim();
    if (b.length < 2) { setNews(null); setNewsLoading(false); return; }
    let alive = true;
    setNewsLoading(true);
    const t = setTimeout(() => {
      fetch(`/api/watchlist/news?brand=${encodeURIComponent(b)}`, { credentials: "include" })
        .then(r => r.json())
        .then(d => { if (alive) setNews(Array.isArray(d.articles) ? d.articles : []); })
        .catch(() => { if (alive) setNews([]); })
        .finally(() => { if (alive) setNewsLoading(false); });
    }, 600);
    return () => { alive = false; clearTimeout(t); };
  }, [adding, form.brand]);

  // Esc closes the modal.
  useEffect(() => {
    if (!adding) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") closeForm(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [adding, closeForm]);

  const load = useCallback(() => {
    fetch("/api/watchlist", { credentials: "include" })
      .then(r => r.json())
      .then((d: WatchRow[] | { error: string }) => {
        if (Array.isArray(d)) setRows(d);
        else setError(d.error || "Failed to load");
      })
      .catch(e => setError(e.message));
  }, []);
  useEffect(() => { load(); }, [load]);

  // Build a map from canonical tenant key -> exposure across the in-scope deals.
  const scopedDeals = useMemo(
    () => scope === "owned" ? deals.filter(d => d.status === "Owned" || d.status === "Sold") : deals,
    [deals, scope],
  );
  const exposureByKey = useMemo(() => {
    const map = new Map<string, Exposure>();
    for (const d of scopedDeals) {
      const seenInDeal = new Set<string>(); // count a brand once per center
      for (const t of d.tenants || []) {
        if (!t.name || isVacant(t.name)) continue;
        const key = tenantKey(t.canonicalName || t.name);
        if (!key) continue;
        const sf = Number(t.sf) || 0;
        const rent = Number(t.annualRent) || 0;
        const isDark = t.isDark === true;
        let exp = map.get(key);
        if (!exp) { exp = { centers: [], totalSF: 0, totalRent: 0, darkCount: 0 }; map.set(key, exp); }
        if (!seenInDeal.has(key)) {
          seenInDeal.add(key);
          exp.centers.push({ dealId: d.id, propertyName: d.propertyName || d.fileName || "Untitled", sf, annualRent: rent, isDark, status: d.status });
          exp.totalSF += sf;
          exp.totalRent += rent;
          if (isDark) exp.darkCount += 1;
        }
      }
    }
    return map;
  }, [scopedDeals]);

  const watched = useMemo(() => {
    if (!rows) return [];
    return rows.map(w => {
      const exp = exposureByKey.get(tenantKey(w.brand));
      return { ...w, exp: exp || { centers: [], totalSF: 0, totalRent: 0, darkCount: 0 } };
    }).sort((a, b) => {
      // Exposed first, then by status severity, then by rent at risk
      const aExposed = a.exp.centers.length > 0 ? 1 : 0;
      const bExposed = b.exp.centers.length > 0 ? 1 : 0;
      if (aExposed !== bExposed) return bExposed - aExposed;
      const rk = meta(b.status).rank - meta(a.status).rank;
      if (rk !== 0) return rk;
      return b.exp.totalRent - a.exp.totalRent;
    });
  }, [rows, exposureByKey]);

  const exposedRows = useMemo(() => watched.filter(w => w.exp.centers.length > 0), [watched]);
  const noExposureRows = useMemo(() => watched.filter(w => w.exp.centers.length === 0), [watched]);

  const totals = useMemo(() => {
    const exposedBrands = watched.filter(w => w.exp.centers.length > 0);
    const centers = new Set<string>();
    let rent = 0, dark = 0;
    for (const w of exposedBrands) { for (const c of w.exp.centers) centers.add(c.dealId); rent += w.exp.totalRent; dark += w.exp.darkCount; }
    return { exposedBrands: exposedBrands.length, centers: centers.size, rent, dark };
  }, [watched]);

  const submit = async () => {
    if (!form.brand.trim()) return;
    setBusy(true);
    try {
      const url = editId ? `/api/watchlist/${editId}` : "/api/watchlist";
      const r = await fetch(url, {
        method: editId ? "PUT" : "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error(e.error || "Save failed"); }
      setForm({ brand: "", status: "watch", note: "", sourceUrl: "" });
      closeForm();
      load(); invalidateWatchlist();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string, brand: string) => {
    if (!window.confirm(`Remove "${brand}" from the watchlist?`)) return;
    try {
      await fetch(`/api/watchlist/${id}`, { method: "DELETE", credentials: "include" });
      load(); invalidateWatchlist();
    } catch { /* ignore */ }
  };

  const startEdit = (w: WatchRow) => {
    setEditId(w.id);
    setForm({ brand: w.brand, status: w.status, note: w.note || "", sourceUrl: w.sourceUrl || "" });
    setAdding(true);
  };

  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const inp: React.CSSProperties = { border: "1px solid #d9d2c4", borderRadius: 6, padding: "7px 9px", fontSize: 12.5, fontFamily: "'Inter',sans-serif", width: "100%", boxSizing: "border-box" };

  const scopeWord = scope === "owned" ? "owned portfolio" : "dataset";

  const renderRow = (w: (typeof watched)[number]) => {
    const m = meta(w.status);
    const exposed = w.exp.centers.length > 0;
    const isOpen = expanded.has(w.id);
    return (
      <div key={w.id} style={{ background: "#fff", border: `1px solid ${exposed ? "#ecd9c0" : "#efe8da"}`, borderLeft: `3px solid ${exposed ? m.bg : "#efe8da"}`, borderRadius: 10, overflow: "hidden" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", flexWrap: "wrap" }}>
          <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", color: m.color, background: m.bg, border: `1px solid ${m.border}`, borderRadius: 4, padding: "2px 7px", textTransform: "uppercase", whiteSpace: "nowrap" }}>{m.label}</span>
          {onTenantClick
            ? <button onClick={e => { e.stopPropagation(); onTenantClick(w.brand); }} title={`View ${w.brand} across the portfolio`}
                style={{ fontSize: 14, fontWeight: 600, color: "#26281f", fontFamily: "'Fraunces',serif", background: "transparent", border: "none", padding: 0, cursor: "pointer", textDecoration: "underline", textDecorationColor: "#d8cfbd", textUnderlineOffset: "2px" }}>{w.brand}</button>
            : <span style={{ fontSize: 14, fontWeight: 600, color: "#26281f", fontFamily: "'Fraunces',serif" }}>{w.brand}</span>}
          {exposed ? (
            <span style={{ fontSize: 11.5, color: "#b3261e", fontWeight: 600 }}>
              {w.exp.centers.length} center{w.exp.centers.length !== 1 ? "s" : ""} · {fmtSF(w.exp.totalSF)} · {fmtMoney(w.exp.totalRent)} rent
              {w.exp.darkCount > 0 && <span style={{ color: "#3a342b" }}> · {w.exp.darkCount} dark</span>}
            </span>
          ) : (
            <span style={{ fontSize: 11.5, color: "#9a9384" }}>No locations in {scopeWord}</span>
          )}
          <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
            {w.sourceUrl && <a href={w.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: "#4f7aac" }}>source ↗</a>}
            <button onClick={e => { e.stopPropagation(); startEdit(w); }} style={{ background: "transparent", border: "none", color: "#a69e91", cursor: "pointer", fontSize: 11 }}>edit</button>
            <button onClick={e => { e.stopPropagation(); remove(w.id, w.brand); }} style={{ background: "transparent", border: "none", color: "#c98", cursor: "pointer", fontSize: 11 }}>remove</button>
          </div>
        </div>
        {exposed && (
          <div style={{ display: "flex", justifyContent: "center", padding: "2px 0 8px" }}>
            <button onClick={() => toggle(w.id)}
              style={{ background: "transparent", border: "1px solid #e0d8c8", color: "#5c5047", borderRadius: 7, padding: "4px 16px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif", letterSpacing: "0.02em" }}>
              {isOpen ? "Collapse" : `Expand ${w.exp.centers.length} center${w.exp.centers.length !== 1 ? "s" : ""}`}
            </button>
          </div>
        )}
        {w.note && <div style={{ fontSize: 11.5, color: "#8b8578", padding: "0 14px 10px", marginTop: -4 }}>{w.note}</div>}
        {isOpen && exposed && (
          <div style={{ borderTop: "1px solid #f1ece1", padding: "4px 0" }}>
            {w.exp.centers.slice().sort((a, b) => b.annualRent - a.annualRent).map((c, i) => (
              <div key={c.dealId + i} onClick={() => onOpenDeal?.(c.dealId)}
                style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 16px", cursor: onOpenDeal ? "pointer" : "default", borderTop: i === 0 ? "none" : "1px solid #f6f2ea", flexWrap: "wrap" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#faf7f0")} onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <span style={{ fontSize: 12.5, fontWeight: 600, color: "#383a37", textDecoration: onOpenDeal ? "underline" : "none", textDecorationColor: "#d8cfbd" }}>{c.propertyName}</span>
                {c.isDark && <span style={{ fontSize: 9, fontWeight: 700, color: "#fff", background: "#3a342b", borderRadius: 10, padding: "1px 6px" }}>DARK</span>}
                {c.status && <span style={{ fontSize: 10, color: "#a69e91", textTransform: "capitalize" }}>{c.status}</span>}
                <span style={{ marginLeft: "auto", fontSize: 11.5, color: "#6f6a5f" }}>{fmtSF(c.sf)} · {fmtMoney(c.annualRent)} rent</span>
              </div>
            ))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h3 style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#26281f", margin: 0 }}>Retailer Health Watchlist</h3>
          <p style={{ fontSize: 11.5, color: "#8b8578", margin: "3px 0 0", maxWidth: 560 }}>
            Track distressed chains and instantly see every center exposed. Matching uses the same brand grouping as the rest of the app, so "Party City #042" still counts.
          </p>
        </div>
        <button onClick={() => { setNews(null); setEditId(null); setForm({ brand: "", status: "watch", note: "", sourceUrl: "" }); setAdding(true); }}
          style={{ background: "#2a2c27", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap" }}>
          + Add retailer
        </button>
      </div>

      {/* All / Owned scope toggle */}
      <div style={{ display: "flex", marginBottom: 14 }}>
        <div style={{ display: "flex", background: "#ede8df", borderRadius: 7, padding: 2, flexShrink: 0 }}>
          {(["all", "owned"] as const).map(opt => (
            <button key={opt} onClick={() => setScope(opt)}
              style={{ padding: "5px 14px", borderRadius: 5, border: "none", cursor: "pointer", fontSize: 11, fontWeight: 600, fontFamily: "'Inter',sans-serif",
                background: scope === opt ? "#383a37" : "transparent", color: scope === opt ? "#fff" : "#7d766a", transition: "background 0.15s, color 0.15s", whiteSpace: "nowrap" }}>
              {opt === "all" ? "All" : "Owned"}
            </button>
          ))}
        </div>
      </div>

      {/* Exposure summary strip */}
      {rows && (
        <div style={{ display: "flex", gap: 10, flexWrap: "wrap", marginBottom: 16 }}>
          {[
            { label: "Watched brands", val: rows.length.toString() },
            { label: "Exposed brands", val: totals.exposedBrands.toString() },
            { label: "Centers affected", val: totals.centers.toString() },
            { label: "Rent at risk", val: fmtMoney(totals.rent) },
            { label: "Dark already", val: totals.dark.toString() },
          ].map(s => (
            <div key={s.label} style={{ flex: "1 1 110px", minWidth: 110, background: "#fff", border: "1px solid #efe8da", borderRadius: 10, padding: "11px 13px" }}>
              <div style={{ fontSize: 20, fontWeight: 700, color: "#26281f", fontFamily: "'Fraunces',serif" }}>{s.val}</div>
              <div style={{ fontSize: 10, color: "#a69e91", textTransform: "uppercase", letterSpacing: "0.05em", marginTop: 2 }}>{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Add / edit form — centered overlay so it appears in front of you,
          not at the top of the page. */}
      {adding && createPortal(
        <>
          <div onClick={closeForm} style={{ position: "fixed", inset: 0, zIndex: 9600, background: "rgba(38,40,31,0.42)", backdropFilter: "blur(2px)" }} />
          <div role="dialog" aria-label={editId ? "Edit watchlist retailer" : "Add watchlist retailer"}
            style={{ position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)", zIndex: 9601, width: "min(540px, 94vw)", maxHeight: "88vh", background: "#faf7f0", border: "1px solid #e0d8c8", borderRadius: 14, boxShadow: "0 18px 56px rgba(38,40,31,0.28)", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "'Inter',sans-serif" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px 18px", borderBottom: "1px solid #ece5d7", background: "#fff", flexShrink: 0 }}>
              <span style={{ fontFamily: "'Fraunces',serif", fontSize: 17, fontWeight: 600, color: "#26281f" }}>{editId ? "Edit retailer" : "Add retailer to watchlist"}</span>
              <button onClick={closeForm} aria-label="Close" style={{ background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", width: 30, height: 30, borderRadius: 7, cursor: "pointer", fontSize: 15, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
            </div>

            <div style={{ padding: "16px 18px", overflowY: "auto" }}>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
                <div>
                  <label style={{ fontSize: 10.5, color: "#8b8578", fontWeight: 600 }}>Brand</label>
                  <input style={inp} value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="e.g. Party City" autoFocus />
                </div>
                <div>
                  <label style={{ fontSize: 10.5, color: "#8b8578", fontWeight: 600 }}>Status</label>
                  <select style={inp} value={form.status} onChange={e => setForm(f => ({ ...f, status: e.target.value }))}>
                    <option value="watch">Watch</option>
                    <option value="distressed">Distressed</option>
                    <option value="bankruptcy">Bankruptcy</option>
                    <option value="liquidating">Liquidating</option>
                  </select>
                </div>
              </div>
              <div style={{ marginBottom: 10 }}>
                <label style={{ fontSize: 10.5, color: "#8b8578", fontWeight: 600 }}>Note (optional)</label>
                <input style={inp} value={form.note} onChange={e => setForm(f => ({ ...f, note: e.target.value }))} placeholder="What's going on with this retailer" />
              </div>
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: 10.5, color: "#8b8578", fontWeight: 600 }}>Source link (optional)</label>
                <input style={inp} value={form.sourceUrl} onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))} placeholder="https://…" />
              </div>

              {/* Related news */}
              <div style={{ borderTop: "1px solid #ece5d7", paddingTop: 12 }}>
                <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 7 }}>
                  <label style={{ fontSize: 10.5, color: "#8b8578", fontWeight: 600, letterSpacing: "0.04em", textTransform: "uppercase" }}>Related news</label>
                  {newsLoading && <span style={{ fontSize: 10, color: "#a89f8f" }}>searching…</span>}
                </div>
                {form.brand.trim().length < 2 ? (
                  <div style={{ fontSize: 11.5, color: "#a89f8f" }}>Type a brand name to pull recent headlines.</div>
                ) : news && news.length === 0 && !newsLoading ? (
                  <div style={{ fontSize: 11.5, color: "#a89f8f" }}>No recent headlines found for “{form.brand.trim()}”.</div>
                ) : (
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    {(news || []).map((a, i) => (
                      <div key={i} style={{ border: "1px solid #ece5d7", borderRadius: 8, padding: "8px 10px", background: "#fff" }}>
                        <a href={a.link} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: "#26281f", fontWeight: 600, textDecoration: "none", lineHeight: 1.35, display: "block" }}>{a.title}</a>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginTop: 5 }}>
                          <span style={{ fontSize: 10, color: "#a89f8f" }}>{a.source}{a.publishedAt ? ` · ${fmtNewsDate(a.publishedAt)}` : ""}</span>
                          <button onClick={() => setForm(f => ({ ...f, sourceUrl: a.link }))} title="Use this link as the source"
                            style={{ background: form.sourceUrl === a.link ? "#eef3e7" : "transparent", border: "1px solid #ddd4c2", color: "#5c5047", borderRadius: 6, padding: "2px 8px", fontSize: 10, cursor: "pointer", whiteSpace: "nowrap" }}>
                            {form.sourceUrl === a.link ? "✓ source" : "use as source"}
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ fontSize: 9.5, color: "#bcae97", marginTop: 6 }}>Headlines via Google News (free) — quick context, not vetted.</div>
              </div>
            </div>

            <div style={{ display: "flex", gap: 8, padding: "12px 18px", borderTop: "1px solid #ece5d7", background: "#fff", flexShrink: 0 }}>
              <button onClick={submit} disabled={busy || !form.brand.trim()} style={{ background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 7, padding: "8px 16px", fontSize: 12, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy || !form.brand.trim() ? 0.6 : 1 }}>
                {busy ? "Saving…" : editId ? "Save changes" : "Add to watchlist"}
              </button>
              <button onClick={closeForm} style={{ background: "transparent", color: "#8b8578", border: "1px solid #ddd4c2", borderRadius: 7, padding: "8px 16px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
            </div>
          </div>
        </>,
        document.body
      )}

      {error && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 12 }}>⚠ {error}</div>}
      {!rows && !error && <div style={{ color: "#a69e91", fontSize: 13, padding: "20px 0" }}>Loading…</div>}

      {/* Watchlist rows */}
      {rows && watched.length === 0 && <div style={{ color: "#a69e91", fontSize: 13, padding: "20px 0" }}>No retailers on the watchlist yet. Add one above.</div>}

      {/* Section 1 — watched retailers WITH locations in the current scope */}
      {exposedRows.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "baseline", gap: 8, margin: "4px 0 10px" }}>
            <h4 style={{ fontFamily: "'Fraunces',serif", fontSize: 14, fontWeight: 600, color: "#26281f", margin: 0 }}>
              In your {scope === "owned" ? "owned portfolio" : "dataset"}
            </h4>
            <span style={{ fontSize: 11, color: "#a69e91" }}>{exposedRows.length} brand{exposedRows.length !== 1 ? "s" : ""} with locations</span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {exposedRows.map(renderRow)}
          </div>
        </>
      )}

      {/* Separation + Section 2 — watched retailers with NO locations in scope */}
      {noExposureRows.length > 0 && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 10, margin: exposedRows.length > 0 ? "26px 0 10px" : "4px 0 10px" }}>
            <div style={{ height: 1, background: "#e7ddcb", flex: 1 }} />
            <span style={{ fontSize: 11, fontWeight: 600, color: "#a69e91", textTransform: "uppercase", letterSpacing: "0.05em", whiteSpace: "nowrap" }}>
              Not in {scope === "owned" ? "owned portfolio" : "dataset"} · {noExposureRows.length}
            </span>
            <div style={{ height: 1, background: "#e7ddcb", flex: 1 }} />
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {noExposureRows.map(renderRow)}
          </div>
        </>
      )}
    </div>
  );
}
