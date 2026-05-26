import { useState, useEffect } from "react";
import type { Deal } from "../lib/idb";
import { idbLoadImages } from "../lib/idb";
import { STATUS_COLORS, STATUS_OPTS } from "../lib/constants";
import { classifyLocation, cityState, assessExtraction } from "../lib/utils";
import StatusTag from "./StatusTag";
import ScoreBadge from "./ScoreBadge";
import RecencyBadge from "./RecencyBadge";

interface Props {
  deals: Deal[];
  onOpen: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Deal>) => void;
  onCompare: (ids: string[]) => void;
}

function RowThumb({ deal }: { deal: Deal }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    if (deal.imageMeta?.cover) {
      idbLoadImages(deal.id).then(r => { if (alive) setSrc(r?.coverThumb || r?.cover || null); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [deal.id]);
  return (
    <div style={{ width: 48, height: 40, borderRadius: 7, overflow: "hidden", flexShrink: 0, background: "#f1eadc", border: "1px solid #ece5d7", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 12, color: "#cabfa7" }}>▦</span>}
    </div>
  );
}

export default function DealGrid({ deals, onOpen, onUpdate, onCompare }: Props) {
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [sortKey, setSortKey] = useState("uploadedAt");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"table"|"grid">("table");

  const types = Array.from(new Set(deals.map(d => d.assetType).filter(Boolean))) as string[];
  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);

  let rows = deals.slice();
  if (filterStatus !== "all") rows = rows.filter(d => d.status === filterStatus);
  if (filterType !== "all") rows = rows.filter(d => d.assetType === filterType);
  if (q.trim()) {
    const s = q.toLowerCase();
    rows = rows.filter(d => [d.propertyName, d.fileName, d.market, d.address, d.assetType].some(v => v?.toLowerCase().includes(s)));
  }
  rows.sort((a, b) => {
    const numKeys = ["capRate","noi","askingPrice","totalSF","occupancy","walt"];
    if (numKeys.includes(sortKey)) {
      const av = n(a[sortKey as keyof Deal]) ?? -Infinity;
      const bv = n(b[sortKey as keyof Deal]) ?? -Infinity;
      return sortDir === "asc" ? av - bv : bv - av;
    }
    const av = String(a[sortKey as keyof Deal] || "");
    const bv = String(b[sortKey as keyof Deal] || "");
    return sortDir === "asc" ? av.localeCompare(bv) : bv.localeCompare(av);
  });

  const toggleSort = (k: string) => {
    if (sortKey === k) setSortDir(d => d === "asc" ? "desc" : "asc");
    else { setSortKey(k); setSortDir("desc"); }
  };
  const arrow = (k: string) => sortKey === k ? (sortDir === "asc" ? " ▲" : " ▼") : "";
  const toggleSel = (id: string) => setSelected(s => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });

  const cols: [string, string, boolean][] = [
    ["propertyName","Property",false],["status","Status",false],["assetType","Type",false],
    ["market","Market",false],["totalSF","SF",true],["occupancy","Occ%",true],
    ["noi","NOI",true],["capRate","Cap",true],["walt","WALT",true],["uploadedAt","Added",false],
  ];

  return (
    <div style={{ padding: "0 28px 28px" }}>
      {/* Filters */}
      <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 14, flexWrap: "wrap" }}>
        <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search deals…"
          style={{ fontSize: 12, padding: "6px 12px", border: "1px solid #e3dccd", borderRadius: 8, color: "#383a37", background: "#fff", width: 200, fontFamily: "'Inter',sans-serif" }} />
        <select value={filterStatus} onChange={e => setFilterStatus(e.target.value)}
          style={{ fontSize: 12, padding: "6px 10px", border: "1px solid #e3dccd", borderRadius: 8, color: "#383a37", background: "#fff", fontFamily: "'Inter',sans-serif", cursor: "pointer" }}>
          <option value="all">All statuses</option>
          {STATUS_OPTS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>
        {types.length > 1 && (
          <select value={filterType} onChange={e => setFilterType(e.target.value)}
            style={{ fontSize: 12, padding: "6px 10px", border: "1px solid #e3dccd", borderRadius: 8, color: "#383a37", background: "#fff", fontFamily: "'Inter',sans-serif", cursor: "pointer" }}>
            <option value="all">All types</option>
            {types.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        )}
        <span style={{ fontSize: 11, color: "#a89f8f", marginLeft: "auto" }}>{rows.length} deal{rows.length !== 1 ? "s" : ""}</span>
        {selected.size >= 2 && (
          <button onClick={() => onCompare(Array.from(selected))}
            style={{ background: "#383a37", border: "none", color: "#fff", padding: "6px 14px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>
            Compare {selected.size}
          </button>
        )}
        <button onClick={() => setViewMode(v => v === "table" ? "grid" : "table")}
          style={{ background: "transparent", border: "1px solid #e3dccd", color: "#a89f8f", padding: "5px 10px", borderRadius: 7, cursor: "pointer", fontSize: 11 }}>
          {viewMode === "table" ? "⊞" : "☰"}
        </button>
      </div>

      {rows.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#a89f8f", fontSize: 14 }}>No deals match your filters.</div>
      )}

      {viewMode === "table" && rows.length > 0 && (
        <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 14, overflow: "hidden", boxShadow: "0 1px 2px rgba(56,58,55,0.04)" }}>
          <div style={{ overflowX: "auto" }}>
            <table style={{ borderCollapse: "collapse", width: "100%", minWidth: 900 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid #f1eadc", background: "#faf7f0" }}>
                  <th style={{ width: 28, padding: "10px 8px 10px 14px" }}>
                    <input type="checkbox" checked={selected.size === rows.length && rows.length > 0}
                      onChange={e => setSelected(e.target.checked ? new Set(rows.map(d => d.id)) : new Set())} />
                  </th>
                  <th style={{ width: 56, padding: "10px 8px" }} />
                  {cols.map(([k, label, right]) => (
                    <th key={k} onClick={() => toggleSort(k)}
                      style={{ padding: "10px 10px", textAlign: right ? "right" : "left", fontSize: 9.5, fontWeight: 700, letterSpacing: "0.08em", color: sortKey === k ? "#383a37" : "#a89f8f", cursor: "pointer", whiteSpace: "nowrap", userSelect: "none", textTransform: "uppercase" }}>
                      {label}{arrow(k)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((d, i) => {
                  const sc = STATUS_COLORS[d.status || ""] || "#a69e91";
                  const { quality } = assessExtraction(d);
                  return (
                    <tr key={d.id}
                      style={{ borderBottom: "1px solid #f4f0e8", background: selected.has(d.id) ? "#6dba4309" : i % 2 === 1 ? "#fdf9f3" : "#fff", cursor: "pointer" }}
                      onClick={() => onOpen(d.id)}>
                      <td style={{ padding: "10px 8px 10px 14px" }} onClick={e => { e.stopPropagation(); toggleSel(d.id); }}>
                        <input type="checkbox" checked={selected.has(d.id)} onChange={() => {}} />
                      </td>
                      <td style={{ padding: "10px 8px" }} onClick={e => e.stopPropagation()}>
                        <RowThumb deal={d} />
                      </td>
                      <td style={{ padding: "10px 10px" }}>
                        <div style={{ fontWeight: 600, color: "#26281f", fontSize: 12.5, whiteSpace: "nowrap", maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis" }}>{d.propertyName || d.fileName || "Untitled"}</div>
                        {quality !== "good" && <div style={{ fontSize: 9, color: quality === "thin" ? "#dc2626" : "#d9890c" }}>{quality === "thin" ? "thin extraction" : "partial"}</div>}
                      </td>
                      <td style={{ padding: "10px 10px" }}>
                        <StatusTag status={d.status} size="sm" />
                      </td>
                      <td style={{ padding: "10px 10px", fontSize: 11, color: "#6f6a5f", whiteSpace: "nowrap" }}>{d.assetType || "—"}</td>
                      <td style={{ padding: "10px 10px", fontSize: 11, color: "#6f6a5f", whiteSpace: "nowrap" }}>{d.market || "—"}</td>
                      <td style={{ padding: "10px 10px", textAlign: "right", fontSize: 11, color: "#5c5f57", whiteSpace: "nowrap" }}>{d.totalSF ? Number(d.totalSF).toLocaleString() : "—"}</td>
                      <td style={{ padding: "10px 10px", textAlign: "right", fontSize: 11, color: d.occupancy && Number(d.occupancy) < 90 ? "#dc2626" : "#5c5f57", whiteSpace: "nowrap" }}>{d.occupancy ? `${d.occupancy}%` : "—"}</td>
                      <td style={{ padding: "10px 10px", textAlign: "right", fontSize: 11, color: "#0f9d63", fontWeight: 500, whiteSpace: "nowrap" }}>{d.noi ? `$${Number(d.noi).toLocaleString()}` : "—"}</td>
                      <td style={{ padding: "10px 10px", textAlign: "right", fontSize: 11, color: "#0f9d63", fontWeight: 500, whiteSpace: "nowrap" }}>{d.capRate ? `${d.capRate}%` : "—"}</td>
                      <td style={{ padding: "10px 10px", textAlign: "right", fontSize: 11, color: d.walt && Number(d.walt) < 3 ? "#dc2626" : "#5c5f57", whiteSpace: "nowrap" }}>{d.walt ? `${d.walt}y` : "—"}</td>
                      <td style={{ padding: "10px 10px", fontSize: 10, color: "#a89f8f", whiteSpace: "nowrap" }}>{d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {viewMode === "grid" && rows.length > 0 && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: 14 }}>
          {rows.map(d => {
            const sc = STATUS_COLORS[d.status || ""] || "#a69e91";
            const loc = cityState(d);
            return (
              <button key={d.id} onClick={() => onOpen(d.id)}
                style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 14, padding: "16px 18px", textAlign: "left", cursor: "pointer", boxShadow: "0 1px 2px rgba(56,58,55,0.04)", transition: "transform .2s ease" }}
                onMouseEnter={e => (e.currentTarget.style.transform = "translateY(-2px)")}
                onMouseLeave={e => (e.currentTarget.style.transform = "none")}>
                <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
                  <span style={{ width: 8, height: 8, borderRadius: "50%", background: sc, flexShrink: 0 }} />
                  <span style={{ fontSize: 9, color: sc, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em" }}>{d.status}</span>
                  <ScoreBadge score={d.dealScore} size={11} />
                  <RecencyBadge deal={d} />
                </div>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 500, color: "#26281f", marginBottom: 2, lineHeight: 1.2 }}>{d.propertyName || d.fileName || "Untitled"}</div>
                {loc && <div style={{ fontSize: 11, color: "#a89f8f", marginBottom: 10 }}>{loc}</div>}
                <div style={{ display: "flex", gap: 14 }}>
                  {d.noi && <div><div style={{ fontSize: 8, color: "#a89f8f", letterSpacing: "0.05em" }}>NOI</div><div style={{ fontSize: 13, color: "#0f9d63", fontWeight: 600 }}>${(Number(d.noi)/1e6).toFixed(1)}M</div></div>}
                  {d.capRate && <div><div style={{ fontSize: 8, color: "#a89f8f", letterSpacing: "0.05em" }}>CAP</div><div style={{ fontSize: 13, color: "#0f9d63", fontWeight: 600 }}>{d.capRate}%</div></div>}
                  {d.walt && <div><div style={{ fontSize: 8, color: "#a89f8f", letterSpacing: "0.05em" }}>WALT</div><div style={{ fontSize: 13, color: Number(d.walt) < 3 ? "#dc2626" : "#383a37", fontWeight: 600 }}>{d.walt}y</div></div>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
