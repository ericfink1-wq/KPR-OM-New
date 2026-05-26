import { useState, useEffect, useCallback } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Deal } from "./lib/idb";
import { idbLoadDeals, idbSaveDeals, idbDeleteDeal } from "./lib/idb";
import Header from "./components/Header";
import UploadQueue from "./components/UploadQueue";
import DealGrid from "./components/DealGrid";
import DetailView from "./components/DetailView";
import AnalystChat from "./components/AnalystChat";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

type TabId = "analyst" | "portfolio";
type View = { type: "list" } | { type: "detail"; dealId: string } | { type: "compare"; dealIds: string[] };

function AppInner() {
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tab, setTab] = useState<TabId>("analyst");
  const [view, setView] = useState<View>({ type: "list" });
  const [loaded, setLoaded] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | undefined>();
  const [uploadKey, setUploadKey] = useState(0);

  // Load all deals from IndexedDB on mount
  useEffect(() => {
    idbLoadDeals()
      .then(d => { setDeals(d); setLoaded(true); })
      .catch(() => setLoaded(true));
  }, []);

  // Persist deals whenever they change
  const saveDeals = useCallback(async (next: Deal[]) => {
    setDeals(next);
    await idbSaveDeals(next).catch(() => {});
  }, []);

  const handleDealsAdded = useCallback((newDeals: Deal[]) => {
    setDeals(prev => {
      const byId = new Map(prev.map(d => [d.id, d]));
      for (const d of newDeals) byId.set(d.id, d);
      const next = Array.from(byId.values());
      idbSaveDeals(next).catch(() => {});
      return next;
    });
  }, []);

  const handleUpdate = useCallback((id: string, patch: Partial<Deal>) => {
    setDeals(prev => {
      const next = prev.map(d => d.id === id ? { ...d, ...patch } : d);
      idbSaveDeals(next).catch(() => {});
      return next;
    });
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await idbDeleteDeal(id).catch(() => {});
    setDeals(prev => prev.filter(d => d.id !== id));
    if (view.type === "detail" && view.dealId === id) setView({ type: "list" });
  }, [view]);

  const handleOpenDeal = useCallback((id: string) => {
    setView({ type: "detail", dealId: id });
    setTab("portfolio");
  }, []);

  const handleQuery = useCallback((q: string) => {
    setPendingQuery(q);
    setTab("analyst");
    setView({ type: "list" });
  }, []);

  const handleCompare = useCallback((ids: string[]) => {
    setView({ type: "compare", dealIds: ids });
    setTab("portfolio");
  }, []);

  const activeDeals = deals.filter(d => !d.trashedAt);
  const trashedDeals = deals.filter(d => d.trashedAt);

  if (!loaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f1ece1" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, color: "#383a37", fontWeight: 400 }}>KPR OM Database</div>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 8 }}>Loading…</div>
        </div>
      </div>
    );
  }

  const currentDeal = view.type === "detail" ? deals.find(d => d.id === view.dealId) : null;

  return (
    <div style={{ minHeight: "100vh", background: "#f1ece1", display: "flex", flexDirection: "column" }}>
      <Header tab={tab} onTab={t => { setTab(t as TabId); setView({ type: "list" }); }} deals={deals} queueLen={0} />

      {/* Analyst tab */}
      {tab === "analyst" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, height: "calc(100vh - 52px)" }}>
          <AnalystChat
            deals={deals}
            onOpenDeal={handleOpenDeal}
            initialQuery={pendingQuery}
            onClearQuery={() => setPendingQuery(undefined)}
          />
        </div>
      )}

      {/* Portfolio tab */}
      {tab === "portfolio" && (
        <div style={{ flex: 1, overflowY: "auto" }}>
          {/* Upload zone always visible at top of portfolio */}
          {view.type === "list" && (
            <UploadQueue
              key={uploadKey}
              onDealsAdded={handleDealsAdded}
              existingDeals={deals}
            />
          )}

          {view.type === "list" && (
            <>
              {activeDeals.length === 0 ? (
                <div style={{ textAlign: "center", padding: "48px 28px", color: "#a89f8f" }}>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 400, marginBottom: 8 }}>No deals yet</div>
                  <div style={{ fontSize: 13 }}>Drop Offering Memorandum PDFs above to get started.</div>
                </div>
              ) : (
                <DealGrid
                  deals={activeDeals}
                  onOpen={handleOpenDeal}
                  onUpdate={handleUpdate}
                  onCompare={handleCompare}
                />
              )}

              {/* Trash section */}
              {trashedDeals.length > 0 && (
                <div style={{ padding: "0 28px 28px" }}>
                  <div style={{ borderTop: "1px solid #e7e0d2", paddingTop: 18, marginTop: 4 }}>
                    <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#b3aa9b", fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>Trash ({trashedDeals.length})</div>
                    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                      {trashedDeals.map(d => (
                        <div key={d.id} style={{ display: "flex", alignItems: "center", gap: 10, background: "#fff", border: "1px solid #ece5d7", borderRadius: 8, padding: "8px 14px" }}>
                          <span style={{ flex: 1, fontSize: 12, color: "#a89f8f" }}>{d.propertyName || d.fileName || "Untitled"}</span>
                          <button onClick={() => handleUpdate(d.id, { trashedAt: undefined })}
                            style={{ fontSize: 10, color: "#6dba43", background: "transparent", border: "1px solid #6dba4340", padding: "2px 8px", borderRadius: 5, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>Restore</button>
                          <button onClick={() => handleDelete(d.id)}
                            style={{ fontSize: 10, color: "#dc2626", background: "transparent", border: "1px solid #dc262640", padding: "2px 8px", borderRadius: 5, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>Delete permanently</button>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {view.type === "detail" && currentDeal && (
            <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 52px)" }}>
              <DetailView
                deal={currentDeal}
                allDeals={deals}
                onBack={() => setView({ type: "list" })}
                onDelete={id => { handleUpdate(id, { trashedAt: new Date().toISOString() }); setView({ type: "list" }); }}
                onUpdate={handleUpdate}
                onQuery={handleQuery}
                onCompare={handleCompare}
              />
            </div>
          )}

          {view.type === "detail" && !currentDeal && (
            <div style={{ padding: 28 }}>
              <button onClick={() => setView({ type: "list" })} style={{ color: "#7d766a", background: "transparent", border: "1px solid #e7e0d2", padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>← Back</button>
              <p style={{ color: "#a89f8f", marginTop: 16 }}>Deal not found.</p>
            </div>
          )}

          {view.type === "compare" && (
            <CompareView
              deals={deals.filter(d => view.type === "compare" && view.dealIds.includes(d.id))}
              onBack={() => setView({ type: "list" })}
              onOpen={handleOpenDeal}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Simple side-by-side compare view
function CompareView({ deals, onBack, onOpen }: { deals: Deal[]; onBack: () => void; onOpen: (id: string) => void }) {
  const cols = [
    ["ASKING PRICE", (d: Deal) => d.askingPrice ? `$${Number(d.askingPrice).toLocaleString()}` : "—"],
    ["CAP RATE", (d: Deal) => d.capRate ? `${d.capRate}%` : "—"],
    ["NOI", (d: Deal) => d.noi ? `$${Number(d.noi).toLocaleString()}` : "—"],
    ["PRICE / SF", (d: Deal) => d.pricePerSF ? `$${d.pricePerSF}` : "—"],
    ["TOTAL SF", (d: Deal) => d.totalSF ? `${Number(d.totalSF).toLocaleString()} SF` : "—"],
    ["OCCUPANCY", (d: Deal) => d.occupancy ? `${d.occupancy}%` : "—"],
    ["WALT", (d: Deal) => d.walt ? `${d.walt} yrs` : "—"],
    ["MARKET", (d: Deal) => d.market || "—"],
    ["ASSET TYPE", (d: Deal) => d.assetType || "—"],
    ["# TENANTS", (d: Deal) => String((d.tenants||[]).length) || "—"],
    ["NOI / SF", (d: Deal) => d.noi && d.totalSF ? `$${(Number(d.noi)/Number(d.totalSF)).toFixed(2)}` : "—"],
  ] as [string, (d: Deal) => string][];

  return (
    <div style={{ padding: "20px 28px" }}>
      <button onClick={onBack} style={{ background:"transparent", border:"1px solid #e7e0d2", color:"#7d766a", padding:"5px 10px", borderRadius:4, cursor:"pointer", fontSize:11, fontFamily:"'Inter',sans-serif", marginBottom:18 }}>← Back</button>
      <div style={{ overflowX: "auto" }}>
        <table style={{ borderCollapse: "collapse", width: "100%", background: "#fff", border: "1px solid #ece5d7", borderRadius: 12, overflow: "hidden" }}>
          <thead>
            <tr style={{ background: "#faf7f0" }}>
              <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 9, fontWeight: 700, letterSpacing: "0.08em", color: "#a89f8f", textTransform: "uppercase", width: 160 }}>Metric</th>
              {deals.map(d => (
                <th key={d.id} style={{ padding: "10px 14px", textAlign: "left", minWidth: 180 }}>
                  <button onClick={() => onOpen(d.id)} style={{ background:"transparent", border:"none", cursor:"pointer", textAlign:"left", padding:0 }}>
                    <div style={{ fontFamily:"'Fraunces',serif", fontSize:14, fontWeight:500, color:"#26281f" }}>{d.propertyName||d.fileName||"Untitled"}</div>
                    <div style={{ fontSize:10, color:"#a89f8f" }}>{d.market||d.assetType||""}</div>
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {cols.map(([label, fn]) => (
              <tr key={label} style={{ borderTop: "1px solid #f1eadc" }}>
                <td style={{ padding:"9px 14px", fontSize:9.5, fontWeight:700, letterSpacing:"0.06em", color:"#a89f8f", textTransform:"uppercase", whiteSpace:"nowrap" }}>{label}</td>
                {deals.map(d => <td key={d.id} style={{ padding:"9px 14px", fontSize:12, color:"#383a37", fontWeight:500 }}>{fn(d)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export default function Root() {
  return (
    <QueryClientProvider client={queryClient}>
      <AppInner />
    </QueryClientProvider>
  );
}
