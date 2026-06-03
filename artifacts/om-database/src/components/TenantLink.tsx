import { useState, useMemo, useEffect } from "react";
import type { Deal } from "../lib/idb";
import {
  tenantKey, tenantLabel, isVacant, isNAPTenant,
  addUserMerge, removeUserMerge, getUserMerges, type UserMerge,
  fetchServerDecisions, applyServerMerges,
} from "../lib/utils";

interface Props {
  deals: Deal[];
}

interface TRow { key: string; displayName: string; locationCount: number; totalAnnualRent: number; }

// Dedicated "Link Tenants" page (reached from Tenant Analytics, like Tenant Name
// Audit). Live-search the full tenant list, tick the names that are the same
// brand, choose which name to keep, and link them — persisted to the DB so the
// grouping flows through analytics on every device. Existing links are listed
// below with an Unlink button.
export default function TenantLink({ deals }: Props) {
  const [search, setSearch] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [canonKey, setCanonKey] = useState<string | null>(null);
  const [version, setVersion] = useState(0);

  // Hydrate confirmed links from the DB (source of truth) so existing groups and
  // their effect on the list show immediately, on any browser.
  useEffect(() => {
    let alive = true;
    fetchServerDecisions().then(decs => { if (!alive) return; applyServerMerges(decs); setVersion(v => v + 1); });
    return () => { alive = false; };
  }, []);

  const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? 0 : Number(v);

  // Distinct tenant names across the whole library, grouped by canonical key
  // (which already folds in existing links). `version` forces a recompute after
  // a link/unlink so the list reflects the new grouping right away.
  const rows = useMemo<TRow[]>(() => {
    const m = new Map<string, TRow>();
    for (const d of deals) {
      for (const t of d.tenants || []) {
        const rawName = t.canonicalName || t.name;
        if (!rawName || isVacant(rawName) || isNAPTenant(t)) continue;
        const key = tenantKey(rawName);
        if (!m.has(key)) m.set(key, { key, displayName: rawName, locationCount: 0, totalAnnualRent: 0 });
        const r = m.get(key)!;
        r.locationCount += 1;
        r.totalAnnualRent += num(t.annualRent);
      }
    }
    return [...m.values()].sort((a, b) => b.totalAnnualRent - a.totalAnnualRent);
  }, [deals, version]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return q ? rows.filter(r => tenantLabel(r.displayName).toLowerCase().includes(q)) : rows;
  }, [rows, search]);

  // Sort the (searched) list by any column. Default: rent, highest first.
  const [sortKey, setSortKey] = useState<"name" | "locs" | "rent">("rent");
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const sorted = useMemo(() => {
    const arr = [...filtered];
    arr.sort((a, b) => {
      const d = sortKey === "name" ? tenantLabel(a.displayName).localeCompare(tenantLabel(b.displayName))
        : sortKey === "locs" ? a.locationCount - b.locationCount
        : a.totalAnnualRent - b.totalAnnualRent;
      return sortDir === "asc" ? d : -d;
    });
    return arr;
  }, [filtered, sortKey, sortDir]);
  const toggleSort = (k: "name" | "locs" | "rent") => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir(k === "name" ? "asc" : "desc"); }
  };
  const arrow = (k: "name" | "locs" | "rent") => sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";

  const selectedRows = useMemo(() => rows.filter(r => sel.has(r.key)), [rows, sel]);
  const effectiveCanonKey = canonKey && sel.has(canonKey)
    ? canonKey
    : ([...selectedRows].sort((a, b) => b.totalAnnualRent - a.totalAnnualRent)[0]?.key ?? null);

  const toggle = (key: string) => setSel(s => { const n = new Set(s); n.has(key) ? n.delete(key) : n.add(key); return n; });

  const doLink = () => {
    if (selectedRows.length < 2 || !effectiveCanonKey) return;
    const canonRow = selectedRows.find(r => r.key === effectiveCanonKey)!;
    addUserMerge({
      id: `merge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      canonical: tenantLabel(canonRow.displayName),
      variants: selectedRows.map(r => r.displayName),
    });
    setSel(new Set()); setCanonKey(null); setVersion(v => v + 1);
  };
  const unlink = (id: string) => { removeUserMerge(id); setVersion(v => v + 1); };
  const userMerges: UserMerge[] = getUserMerges();

  const fmtRent = (n: number) => n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : n > 0 ? `$${Math.round(n).toLocaleString()}` : "—";

  return (
    <div style={{ maxWidth: 760, margin: "0 auto", padding: "18px 18px 40px", width: "100%", boxSizing: "border-box", fontFamily: "'Inter',sans-serif" }}>
      <div style={{ fontFamily: "'Fraunces',serif", fontSize: 24, fontWeight: 500, color: "#26281f", letterSpacing: "-0.02em", marginBottom: 4 }}>Link Tenants</div>
      <div style={{ fontSize: 12.5, color: "#7d766a", lineHeight: 1.5, marginBottom: 16 }}>
        Combine the same brand spelled different ways (e.g. <i>Walmart</i> and <i>Wal-Mart</i>) so they group as one across analytics.
        Search to filter, tick the rows that are the same tenant, choose the name to keep, then Link.
      </div>

      {/* Live search */}
      <input
        autoFocus
        value={search}
        onChange={e => setSearch(e.target.value)}
        placeholder="Search tenants…"
        autoComplete="off"
        autoCorrect="off"
        spellCheck={false}
        style={{ width: "100%", boxSizing: "border-box", fontSize: 14, padding: "10px 12px", border: "1px solid #e3dccd", borderRadius: 9, color: "#383a37", background: "#fff", marginBottom: 12, fontFamily: "'Inter',sans-serif" }}
      />

      {/* Selection / link bar */}
      <div style={{ background: "#f4f8ef", border: "1px solid #d6e7c4", borderRadius: 10, padding: "11px 13px", marginBottom: 12 }}>
        {selectedRows.length < 2 ? (
          <div style={{ fontSize: 12.5, color: "#5c5047", lineHeight: 1.5 }}>
            Tick <b>two or more</b> rows that are the same tenant.
            {selectedRows.length === 1 && <span style={{ color: "#3f7a1f" }}> 1 selected — pick at least one more.</span>}
          </div>
        ) : (
          <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
            <span style={{ fontSize: 12.5, color: "#5c5047", fontWeight: 600 }}>Link {selectedRows.length} into:</span>
            <select value={effectiveCanonKey ?? ""} onChange={e => setCanonKey(e.target.value)}
              style={{ fontSize: 13, padding: "6px 9px", border: "1px solid #c8b89a", borderRadius: 7, background: "#fff", fontFamily: "'Inter',sans-serif", maxWidth: 260 }}>
              {selectedRows.map(r => <option key={r.key} value={r.key}>{tenantLabel(r.displayName)}</option>)}
            </select>
            <button onClick={doLink}
              style={{ background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
              Link tenants
            </button>
            <button onClick={() => { setSel(new Set()); setCanonKey(null); }}
              style={{ background: "transparent", color: "#a89f8f", border: "none", padding: "7px 8px", fontSize: 12.5, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
              Clear
            </button>
          </div>
        )}
      </div>

      {/* Tenant list */}
      <div style={{ border: "1px solid #ece5d7", borderRadius: 10, overflow: "hidden", marginBottom: 22 }}>
        {/* Sortable header */}
        <div style={{ display: "flex", alignItems: "center", gap: 11, padding: "8px 12px", background: "#f4f1ea", borderBottom: "1px solid #ece5d7" }}>
          <span style={{ width: 15, flexShrink: 0 }} />
          <button onClick={() => toggleSort("name")} style={{ flex: 1, textAlign: "left", background: "transparent", border: "none", cursor: "pointer", padding: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: sortKey === "name" ? "#3f7a1f" : "#a69e91", fontFamily: "'Inter',sans-serif" }}>Tenant{arrow("name")}</button>
          <button onClick={() => toggleSort("locs")} style={{ width: 64, flexShrink: 0, textAlign: "right", background: "transparent", border: "none", cursor: "pointer", padding: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: sortKey === "locs" ? "#3f7a1f" : "#a69e91", fontFamily: "'Inter',sans-serif" }}>Locs{arrow("locs")}</button>
          <button onClick={() => toggleSort("rent")} style={{ width: 90, flexShrink: 0, textAlign: "right", background: "transparent", border: "none", cursor: "pointer", padding: 0, fontSize: 10.5, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase", color: sortKey === "rent" ? "#3f7a1f" : "#a69e91", fontFamily: "'Inter',sans-serif" }}>Rent{arrow("rent")}</button>
        </div>
        <div style={{ maxHeight: 460, overflowY: "auto" }}>
          {sorted.length === 0 ? (
            <div style={{ padding: "26px 0", textAlign: "center", color: "#a89f8f", fontSize: 13 }}>No tenants match &ldquo;{search}&rdquo;</div>
          ) : (
            sorted.map((r, i) => {
              const checked = sel.has(r.key);
              return (
                <div
                  key={r.key}
                  onClick={() => toggle(r.key)}
                  style={{
                    display: "flex", alignItems: "center", gap: 11, padding: "9px 12px", cursor: "pointer",
                    borderTop: i ? "1px solid #f5f1ea" : "none",
                    background: checked ? "#eef6e4" : i % 2 ? "#faf8f4" : "#fff",
                  }}
                >
                  <input type="checkbox" checked={checked} readOnly style={{ width: 15, height: 15, flexShrink: 0, accentColor: "#3f7a1f" }} />
                  <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 13.5, color: "#383a37", fontWeight: checked ? 600 : 400 }}>
                    {tenantLabel(r.displayName)}
                  </span>
                  <span style={{ width: 64, flexShrink: 0, textAlign: "right", fontSize: 11.5, color: "#a89f8f", whiteSpace: "nowrap" }}>{r.locationCount}</span>
                  <span style={{ width: 90, flexShrink: 0, textAlign: "right", fontSize: 11.5, color: "#6f6a5f", whiteSpace: "nowrap" }}>{fmtRent(r.totalAnnualRent)}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Existing links */}
      <div style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "#8aa56b", fontWeight: 700, marginBottom: 8 }}>
        Linked tenants ({userMerges.length})
      </div>
      {userMerges.length === 0 ? (
        <div style={{ fontSize: 12.5, color: "#a89f8f" }}>No manual links yet.</div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {userMerges.map(m => (
            <div key={m.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #ece5d7", borderRadius: 8, padding: "9px 12px" }}>
              <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, color: "#5c5047", lineHeight: 1.5 }}>
                <b style={{ color: "#26281f" }}>{m.canonical}</b>
                <span style={{ color: "#a89f8f" }}> ← {m.variants.filter(v => tenantLabel(v) !== m.canonical).map(v => tenantLabel(v)).join(", ") || "(variants)"}</span>
              </span>
              <button onClick={() => unlink(m.id)} title="Unlink — split these names back apart"
                style={{ background: "transparent", border: "1px solid #e7c9bf", color: "#c0392b", cursor: "pointer", fontSize: 11.5, fontWeight: 600, borderRadius: 7, padding: "5px 11px", flexShrink: 0, fontFamily: "'Inter',sans-serif" }}>
                Unlink
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
