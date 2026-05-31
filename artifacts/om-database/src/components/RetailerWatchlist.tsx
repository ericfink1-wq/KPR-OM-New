import { useState, useEffect, useMemo, useCallback } from "react";
import type { Deal } from "../lib/idb";
import { tenantKey, tenantLabel, isVacant } from "../lib/utils";

interface WatchRow {
  id: string;
  brand: string;
  status: string;          // watch | distressed | bankruptcy | liquidating
  note: string | null;
  sourceUrl: string | null;
  addedBy: string | null;
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

export default function RetailerWatchlist({ deals, onOpenDeal }: { deals: Deal[]; onOpenDeal?: (id: string) => void }) {
  const [rows, setRows] = useState<WatchRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ brand: "", status: "watch", note: "", sourceUrl: "" });
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [editId, setEditId] = useState<string | null>(null);

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

  // Build a map from canonical tenant key -> exposure across all deals (once per deals change)
  const exposureByKey = useMemo(() => {
    const map = new Map<string, Exposure>();
    for (const d of deals) {
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
  }, [deals]);

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
      setAdding(false); setEditId(null);
      load();
    } catch (e) { setError(e instanceof Error ? e.message : "Save failed"); }
    finally { setBusy(false); }
  };

  const remove = async (id: string, brand: string) => {
    if (!window.confirm(`Remove "${brand}" from the watchlist?`)) return;
    try {
      await fetch(`/api/watchlist/${id}`, { method: "DELETE", credentials: "include" });
      load();
    } catch { /* ignore */ }
  };

  const startEdit = (w: WatchRow) => {
    setEditId(w.id);
    setForm({ brand: w.brand, status: w.status, note: w.note || "", sourceUrl: w.sourceUrl || "" });
    setAdding(true);
  };

  const toggle = (id: string) => setExpanded(prev => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const inp: React.CSSProperties = { border: "1px solid #d9d2c4", borderRadius: 6, padding: "7px 9px", fontSize: 12.5, fontFamily: "'Inter',sans-serif", width: "100%", boxSizing: "border-box" };

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
        <div>
          <h3 style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#26281f", margin: 0 }}>Retailer Health Watchlist</h3>
          <p style={{ fontSize: 11.5, color: "#8b8578", margin: "3px 0 0", maxWidth: 560 }}>
            Track distressed chains and instantly see every center exposed. Matching uses the same brand grouping as the rest of the app, so "Party City #042" still counts.
          </p>
        </div>
        {!adding && (
          <button onClick={() => { setAdding(true); setEditId(null); setForm({ brand: "", status: "watch", note: "", sourceUrl: "" }); }}
            style={{ background: "#2a2c27", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap" }}>
            + Add retailer
          </button>
        )}
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

      {/* Add / edit form */}
      {adding && (
        <div style={{ background: "#fff", border: "1px solid #e3dccd", borderRadius: 10, padding: 14, marginBottom: 16 }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label style={{ fontSize: 10.5, color: "#8b8578", fontWeight: 600 }}>Brand</label>
              <input style={inp} value={form.brand} onChange={e => setForm(f => ({ ...f, brand: e.target.value }))} placeholder="e.g. Party City" />
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
          <div style={{ marginBottom: 12 }}>
            <label style={{ fontSize: 10.5, color: "#8b8578", fontWeight: 600 }}>Source link (optional)</label>
            <input style={inp} value={form.sourceUrl} onChange={e => setForm(f => ({ ...f, sourceUrl: e.target.value }))} placeholder="https://…" />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={submit} disabled={busy || !form.brand.trim()} style={{ background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: busy ? "default" : "pointer", opacity: busy || !form.brand.trim() ? 0.6 : 1 }}>
              {busy ? "Saving…" : editId ? "Save changes" : "Add to watchlist"}
            </button>
            <button onClick={() => { setAdding(false); setEditId(null); }} style={{ background: "transparent", color: "#8b8578", border: "1px solid #ddd4c2", borderRadius: 7, padding: "7px 14px", fontSize: 12, cursor: "pointer" }}>Cancel</button>
          </div>
        </div>
      )}

      {error && <div style={{ color: "#dc2626", fontSize: 12, marginBottom: 12 }}>⚠ {error}</div>}
      {!rows && !error && <div style={{ color: "#a69e91", fontSize: 13, padding: "20px 0" }}>Loading…</div>}

      {/* Watchlist rows */}
      {rows && watched.length === 0 && <div style={{ color: "#a69e91", fontSize: 13, padding: "20px 0" }}>No retailers on the watchlist yet. Add one above.</div>}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {watched.map(w => {
          const m = meta(w.status);
          const exposed = w.exp.centers.length > 0;
          const isOpen = expanded.has(w.id);
          return (
            <div key={w.id} style={{ background: "#fff", border: `1px solid ${exposed ? "#ecd9c0" : "#efe8da"}`, borderLeft: `3px solid ${exposed ? m.bg : "#efe8da"}`, borderRadius: 10, overflow: "hidden" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 14px", cursor: exposed ? "pointer" : "default", flexWrap: "wrap" }}
                onClick={() => exposed && toggle(w.id)}>
                <span style={{ fontSize: 9, fontWeight: 700, letterSpacing: "0.05em", color: m.color, background: m.bg, border: `1px solid ${m.border}`, borderRadius: 4, padding: "2px 7px", textTransform: "uppercase", whiteSpace: "nowrap" }}>{m.label}</span>
                <span style={{ fontSize: 14, fontWeight: 600, color: "#26281f", fontFamily: "'Fraunces',serif" }}>{w.brand}</span>
                {exposed ? (
                  <span style={{ fontSize: 11.5, color: "#b3261e", fontWeight: 600 }}>
                    {w.exp.centers.length} center{w.exp.centers.length !== 1 ? "s" : ""} · {fmtSF(w.exp.totalSF)} · {fmtMoney(w.exp.totalRent)} rent
                    {w.exp.darkCount > 0 && <span style={{ color: "#3a342b" }}> · {w.exp.darkCount} dark</span>}
                  </span>
                ) : (
                  <span style={{ fontSize: 11.5, color: "#9a9384" }}>No exposure in portfolio</span>
                )}
                <div style={{ marginLeft: "auto", display: "flex", gap: 6, alignItems: "center" }}>
                  {w.sourceUrl && <a href={w.sourceUrl} target="_blank" rel="noopener noreferrer" onClick={e => e.stopPropagation()} style={{ fontSize: 11, color: "#4f7aac" }}>source ↗</a>}
                  <button onClick={e => { e.stopPropagation(); startEdit(w); }} style={{ background: "transparent", border: "none", color: "#a69e91", cursor: "pointer", fontSize: 11 }}>edit</button>
                  <button onClick={e => { e.stopPropagation(); remove(w.id, w.brand); }} style={{ background: "transparent", border: "none", color: "#c98", cursor: "pointer", fontSize: 11 }}>remove</button>
                  {exposed && <span style={{ fontSize: 10, color: "#a69e91" }}>{isOpen ? "▲" : "▼"}</span>}
                </div>
              </div>
              {w.note && <div style={{ fontSize: 11.5, color: "#8b8578", padding: "0 14px 10px", marginTop: -4 }}>{w.note}</div>}
              {isOpen && exposed && (
                <div style={{ borderTop: "1px solid #f1ece1", padding: "4px 0" }}>
                  {w.exp.centers.sort((a, b) => b.annualRent - a.annualRent).map((c, i) => (
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
        })}
      </div>
    </div>
  );
}
