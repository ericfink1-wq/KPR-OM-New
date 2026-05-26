import { useState, useEffect } from "react";
import type { Deal } from "../lib/idb";
import { apiLoadImages, apiSaveDeal } from "../lib/api";
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
      apiLoadImages(deal.id).then(r => { if (alive) setSrc(r?.coverThumb || r?.cover || null); }).catch(() => {});
    }
    return () => { alive = false; };
  }, [deal.id]);
  return (
    <div style={{ width: 48, height: 40, borderRadius: 7, overflow: "hidden", flexShrink: 0, background: "#f1eadc", border: "1px solid #ece5d7", display: "flex", alignItems: "center", justifyContent: "center" }}>
      {src ? <img src={src} alt="" style={{ width: "100%", height: "100%", objectFit: "cover" }} /> : <span style={{ fontSize: 12, color: "#cabfa7" }}>▦</span>}
    </div>
  );
}

type GroupAction = "link" | "merge";

interface LinkMergeModal {
  action: GroupAction;
  deals: Deal[];
  keeperId?: string;
}

export default function DealGrid({ deals, onOpen, onUpdate, onCompare }: Props) {
  const [filterStatus, setFilterStatus] = useState("all");
  const [filterType, setFilterType] = useState("all");
  const [sortKey, setSortKey] = useState("uploadedAt");
  const [sortDir, setSortDir] = useState<"asc"|"desc">("desc");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<"table"|"grid">("table");
  const [modal, setModal] = useState<LinkMergeModal | null>(null);
  const [merging, setMerging] = useState(false);

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

  const selectedDeals = rows.filter(d => selected.has(d.id));

  const openModal = (action: GroupAction) => {
    const sel = deals.filter(d => selected.has(d.id));
    setModal({ action, deals: sel, keeperId: sel[0]?.id });
  };

  const commitLink = async () => {
    if (!modal) return;
    const groupId = modal.deals[0].propertyGroupId || (`grp_${Date.now()}`);
    for (const d of modal.deals) {
      onUpdate(d.id, { propertyGroupId: groupId });
    }
    setModal(null);
    setSelected(new Set());
  };

  const commitMerge = async () => {
    if (!modal || !modal.keeperId) return;
    setMerging(true);
    const keeper = modal.deals.find(d => d.id === modal.keeperId)!;
    const others = modal.deals.filter(d => d.id !== modal.keeperId);

    // User-entered fields to absorb from others into keeper (prefer non-empty, non-null over keeper's empty)
    const absorbableFields: (keyof Deal)[] = [
      "userNotes","status","txnPurchasePrice","txnSeller","txnLoiDate","txnCloseDate",
      "txnSalePrice","txnBuyer","txnSaleDate","txnBroker",
      "acqCapRate","acqNOIAtClose","acqEntity","acqBroker","acqContractDate","acqDDExpiration",
      "acqDeposit","acqClosingCosts","acqFee","acqTitleCo","acqCounsel","acqPropManager",
      "acqStrategy","acqHoldPeriod","acqTargetIRR","acqNotes",
      "debtLender","debtType","debtLoanAmount","debtRate","debtMaturityDate","debtNotes",
      "marketSale","marketDemographics",
    ];

    const merged: Partial<Deal> = {};
    for (const f of absorbableFields) {
      const keeperVal = keeper[f];
      if (keeperVal == null || keeperVal === "") {
        for (const o of others) {
          const v = o[f];
          if (v != null && v !== "") {
            (merged as Record<string, unknown>)[f] = v;
            break;
          }
        }
      }
    }

    // Merge verified fields
    const mergedVerified = { ...(keeper.verified || {}) };
    for (const o of others) {
      for (const [k, v] of Object.entries(o.verified || {})) {
        if (!mergedVerified[k]) mergedVerified[k] = v;
      }
    }
    merged.verified = mergedVerified;

    // Absorb missing images meta
    if (!keeper.imageMeta?.cover) {
      for (const o of others) {
        if (o.imageMeta?.cover) { merged.imageMeta = o.imageMeta; break; }
      }
    }

    // Absorb user notes by concatenating if both non-empty
    const otherNotes = others.map(o => o.userNotes).filter(Boolean).join("\n---\n");
    if (otherNotes && !keeper.userNotes) merged.userNotes = otherNotes;
    else if (otherNotes && keeper.userNotes) merged.userNotes = keeper.userNotes + "\n---\n" + otherNotes;

    // Save keeper with merged data
    const updatedKeeper: Deal = { ...keeper, ...merged };
    await apiSaveDeal(updatedKeeper).catch(() => {});
    onUpdate(keeper.id, merged);

    // Trash the others
    for (const o of others) {
      onUpdate(o.id, { trashedAt: new Date().toISOString() });
    }

    setMerging(false);
    setModal(null);
    setSelected(new Set());
  };

  const cols: [string, string, boolean][] = [
    ["propertyName","Property",false],["status","Status",false],["assetType","Type",false],
    ["market","Market",false],["totalSF","SF",true],["occupancy","Occ%",true],
    ["noi","NOI",true],["capRate","Cap",true],["walt","WALT",true],["uploadedAt","Added",false],
  ];

  return (
    <div style={{ padding: "0 28px 28px" }}>
      {/* Link/Merge Modal */}
      {modal && (
        <div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.35)", zIndex: 1000, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <div style={{ background: "#fff", borderRadius: 16, padding: "32px 36px", maxWidth: 480, width: "90%", boxShadow: "0 8px 40px rgba(0,0,0,0.15)", fontFamily: "'Inter', sans-serif" }}>
            {modal.action === "link" ? (
              <>
                <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 500, color: "#26281f", marginBottom: 6 }}>Link as same property</div>
                <div style={{ fontSize: 12, color: "#7d766a", marginBottom: 16, lineHeight: 1.6 }}>
                  Links these {modal.deals.length} deals as different years of the same property. <strong>Every OM is kept intact</strong> — nothing is deleted or merged. They'll appear together in Version History.
                </div>
                <div style={{ background: "#f1ece1", borderRadius: 10, padding: "12px 16px", marginBottom: 20 }}>
                  {modal.deals.map(d => (
                    <div key={d.id} style={{ fontSize: 12, color: "#383a37", padding: "3px 0" }}>
                      {d.propertyName || d.fileName || "Untitled"} {d.omDate ? `(${d.omDate.slice(0,4)})` : d.uploadedAt ? `(${new Date(d.uploadedAt).getFullYear()})` : ""}
                    </div>
                  ))}
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={() => setModal(null)} style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Cancel</button>
                  <button onClick={commitLink} style={{ background: "#26281f", color: "#f1ece1", border: "none", padding: "8px 20px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600 }}>Link deals</button>
                </div>
              </>
            ) : (
              <>
                <div style={{ fontFamily: "'Fraunces',serif", fontSize: 20, fontWeight: 500, color: "#26281f", marginBottom: 6 }}>Merge duplicates</div>
                <div style={{ fontSize: 12, color: "#7d766a", marginBottom: 4, lineHeight: 1.6 }}>
                  <strong>Warning:</strong> Merge is for the <em>same OM uploaded more than once</em>. The non-keeper copies will be moved to Trash (reversible). Pick which deal is the "keeper":
                </div>
                <div style={{ background: "#fff8e6", border: "1px solid #d9890c40", borderRadius: 8, padding: "8px 12px", marginBottom: 14, fontSize: 11, color: "#a06208" }}>
                  Use "Link" instead if these are different years of the same property — Merge is only for true duplicates of the same OM.
                </div>
                <div style={{ marginBottom: 18 }}>
                  {modal.deals.map(d => (
                    <label key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderRadius: 8, background: modal.keeperId === d.id ? "#6dba4312" : "transparent", border: modal.keeperId === d.id ? "1.5px solid #6dba43" : "1.5px solid transparent", marginBottom: 4, cursor: "pointer" }}>
                      <input type="radio" name="keeper" checked={modal.keeperId === d.id} onChange={() => setModal(m => m ? { ...m, keeperId: d.id } : m)} />
                      <div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: "#26281f" }}>{d.propertyName || d.fileName || "Untitled"}</div>
                        <div style={{ fontSize: 10, color: "#a89f8f" }}>{d.status} · uploaded {d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : "unknown"}</div>
                      </div>
                      {modal.keeperId === d.id && <span style={{ marginLeft: "auto", fontSize: 10, color: "#6dba43", fontWeight: 700 }}>KEEPER</span>}
                    </label>
                  ))}
                </div>
                <div style={{ fontSize: 11, color: "#a89f8f", marginBottom: 16 }}>
                  Human-entered data from the other copies will be absorbed into the keeper (notes, status, transaction details, images). The copies move to Trash.
                </div>
                <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
                  <button onClick={() => setModal(null)} style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "8px 16px", borderRadius: 8, cursor: "pointer", fontSize: 12 }}>Cancel</button>
                  <button onClick={commitMerge} disabled={merging} style={{ background: "#dc2626", color: "#fff", border: "none", padding: "8px 20px", borderRadius: 8, cursor: merging ? "wait" : "pointer", fontSize: 12, fontWeight: 600, opacity: merging ? 0.7 : 1 }}>
                    {merging ? "Merging…" : `Merge (trash ${modal.deals.length - 1} cop${modal.deals.length - 1 === 1 ? "y" : "ies"})`}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

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
          <div style={{ display: "flex", gap: 6 }}>
            <button onClick={() => onCompare(Array.from(selected))}
              style={{ background: "#383a37", border: "none", color: "#fff", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>
              Compare {selected.size}
            </button>
            <button onClick={() => openModal("link")}
              style={{ background: "#0f9d63", border: "none", color: "#fff", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>
              Link
            </button>
            <button onClick={() => openModal("merge")}
              style={{ background: "#fff", border: "1px solid #dc2626", color: "#dc2626", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>
              Merge
            </button>
          </div>
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
