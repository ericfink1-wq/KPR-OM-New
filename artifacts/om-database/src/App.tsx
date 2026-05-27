import { useState, useEffect, useCallback, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Deal } from "./lib/idb";
import { apiLoadDeals, apiSaveDeal, apiDeleteDeal, apiCheckAuth, apiLogout } from "./lib/api";
import { PROSPECT_STALE_DAYS } from "./lib/constants";
import { ensureUploadAllowed } from "./lib/uploadAuth";
import Header from "./components/Header";
import UploadQueue from "./components/UploadQueue";
import DealGrid from "./components/DealGrid";
import DetailView from "./components/DetailView";
import TenantView from "./components/TenantView";
import AnalystChat from "./components/AnalystChat";
import PortfolioAnalytics from "./components/PortfolioAnalytics";
import CompsSearch from "./components/CompsSearch";
import Login from "./components/Login";
import HelpModal from "./components/HelpModal";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

type TabId = "analyst" | "portfolio" | "analytics" | "comps";
type View = { type: "list" } | { type: "detail"; dealId: string } | { type: "compare"; dealIds: string[] } | { type: "tenant"; tenantName: string };
type AuthState = "checking" | "authenticated" | "unauthenticated";

function AppInner() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tab, setTab] = useState<TabId>("analyst");
  const [view, setView] = useState<View>({ type: "list" });
  const [loaded, setLoaded] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | undefined>();
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);

  useEffect(() => {
    if (!localStorage.getItem("kpr_help_seen")) setHelpOpen(true);
  }, []);

  useEffect(() => {
    apiCheckAuth().then(authenticated => {
      setAuth(authenticated ? "authenticated" : "unauthenticated");
    });
  }, []);

  useEffect(() => {
    if (auth !== "authenticated") return;
    apiLoadDeals()
      .then(d => {
        const now = Date.now();
        const patched = d.map(deal => {
          if (deal.status === "Prospect" && !deal.trashedAt) {
            const since = deal.uploadedAt;
            const sinceMs = since ? new Date(since).getTime() : null;
            if (sinceMs && (now - sinceMs) >= PROSPECT_STALE_DAYS * 86400000) {
              const ts = new Date().toISOString();
              const updated: Deal = { ...deal, status: "Passed", autoPassed: true, autoPassedAt: ts };
              apiSaveDeal(updated).catch(() => {});
              return updated;
            }
          }
          return deal;
        });
        setDeals(patched);
        setLoaded(true);
      })
      .catch(() => setLoaded(true));
  }, [auth]);

  const handleUpdate = useCallback((id: string, patch: Partial<Deal>) => {
    setDeals(prev => {
      const next = prev.map(d => d.id === id ? { ...d, ...patch } : d);
      const updated = next.find(d => d.id === id);
      if (updated) apiSaveDeal(updated).catch(() => {});
      return next;
    });
  }, []);

  const handleDealsAdded = useCallback((newDeals: Deal[]) => {
    setDeals(prev => {
      const byId = new Map(prev.map(d => [d.id, d]));
      for (const d of newDeals) byId.set(d.id, d);
      return Array.from(byId.values());
    });
  }, []);

  const handleDealUpdated = useCallback((updated: Deal) => {
    setDeals(prev => prev.map(d => d.id === updated.id ? updated : d));
  }, []);

  const handleDelete = useCallback(async (id: string) => {
    await apiDeleteDeal(id).catch(() => {});
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

  const handleOpenTenant = useCallback((name: string) => {
    if (window.confirm(`View the tenant summary for ${name}? It shows every property in your database where ${name} is a tenant.`)) {
      setView({ type: "tenant", tenantName: name });
      setTab("portfolio");
    }
  }, []);

  const handleLogout = async () => {
    await apiLogout();
    setAuth("unauthenticated");
    setDeals([]);
    setLoaded(false);
  };

  const handleFiles = useCallback((fl: FileList) => {
    if (!ensureUploadAllowed()) return;
    const pdfs = Array.from(fl).filter(f => f.name.toLowerCase().endsWith(".pdf"));
    if (pdfs.length) setPendingFiles(pdfs);
  }, []);

  // Drag and drop on entire app — use a counter so child dragenter/dragleave
  // events don't misfire. Overlay shows on first enter, hides when counter hits 0.
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current += 1;
    if (dragCounter.current === 1) setDragging(true);
  };
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };
  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) { dragCounter.current = 0; setDragging(false); }
  };
  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    if (e.dataTransfer.files.length) handleFiles(e.dataTransfer.files);
  };

  // Hide overlay on Escape and on any window dragleave that exits the document
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => { if (e.key === "Escape") { dragCounter.current = 0; setDragging(false); } };
    const onDragLeaveDoc = (e: DragEvent) => { if (!e.relatedTarget) { dragCounter.current = 0; setDragging(false); } };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("dragleave", onDragLeaveDoc);
    return () => { window.removeEventListener("keydown", onKeyDown); document.removeEventListener("dragleave", onDragLeaveDoc); };
  }, []);

  const processingCount = 0; // UploadQueue tracks this internally now

  if (auth === "checking") {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f1ece1" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, color: "#383a37", fontWeight: 400 }}>KPR Deal Intelligence</div>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 8 }}>Loading…</div>
        </div>
      </div>
    );
  }

  if (auth === "unauthenticated") {
    return <Login onLogin={() => { setAuth("authenticated"); }} />;
  }

  if (!loaded) {
    return (
      <div style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: "100vh", background: "#f1ece1" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, color: "#383a37", fontWeight: 400 }}>KPR Deal Intelligence</div>
          <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 8 }}>Loading deals…</div>
        </div>
      </div>
    );
  }

  const activeDeals = deals.filter(d => !d.trashedAt);
  const trashedDeals = deals.filter(d => d.trashedAt);
  const currentDeal = view.type === "detail" ? deals.find(d => d.id === view.dealId) : null;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ height: "100dvh", background: "#f6f2ea", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "'Inter',-apple-system,sans-serif", color: "#383a37", WebkitFontSmoothing: "antialiased" as any }}>

      <Header
        tab={tab}
        onTab={t => { setTab(t as TabId); setView({ type: "list" }); }}
        deals={deals}
        queueLen={processingCount}
        onLogout={handleLogout}
        onFiles={handleFiles}
        onHelpOpen={() => setHelpOpen(true)}
      />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} />

      {/* Drag overlay */}
      {dragging && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(56,58,55,0.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ background: "#ffffff", border: "2px dashed #6dba43", borderRadius: 16, padding: "48px 64px", textAlign: "center", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📁</div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 600, color: "#383a37" }}>Drop your OMs to import</div>
            <div style={{ fontSize: 13, color: "#8b9aa8", marginTop: 6 }}>PDF files only</div>
          </div>
        </div>
      )}

      {/* Comps tab */}
      {tab === "comps" && (
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
          <CompsSearch onOpenDeal={id => { handleOpenDeal(id); }} />
        </div>
      )}

      {/* Analytics tab */}
      {tab === "analytics" && (
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
          <PortfolioAnalytics />
        </div>
      )}

      {/* Analyst tab */}
      {tab === "analyst" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0, height: "calc(100vh - 72px)" }}>
          <AnalystChat
            deals={deals}
            onOpenDeal={handleOpenDeal}
            onTenantClick={handleOpenTenant}
            initialQuery={pendingQuery}
            onClearQuery={() => setPendingQuery(undefined)}
          />
        </div>
      )}

      {/* Portfolio tab */}
      {tab === "portfolio" && (
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 80 }}>
          {view.type === "list" && (
            <>
              {activeDeals.length === 0 ? (
                <div style={{ textAlign: "center", padding: "80px 28px", color: "#a89f8f" }}>
                  <div style={{ fontSize: 36, marginBottom: 16 }}>📄</div>
                  <div style={{ fontFamily: "'Fraunces', serif", fontSize: 24, fontWeight: 400, marginBottom: 8, color: "#383a37" }}>No deals yet</div>
                  <div style={{ fontSize: 14, lineHeight: 1.6 }}>Upload Offering Memorandum PDFs using the <strong>Upload OMs</strong> button above,<br />or drag and drop PDFs anywhere on this page.</div>
                </div>
              ) : (
                <DealGrid
                  deals={activeDeals}
                  onOpen={handleOpenDeal}
                  onUpdate={handleUpdate}
                  onCompare={handleCompare}
                  onAddFiles={files => setPendingFiles(prev => [...prev, ...files])}
                />
              )}

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
            <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 72px)" }}>
              <DetailView
                deal={currentDeal}
                allDeals={deals}
                onBack={() => setView({ type: "list" })}
                onDelete={id => { handleUpdate(id, { trashedAt: new Date().toISOString() }); setView({ type: "list" }); }}
                onUpdate={handleUpdate}
                onQuery={handleQuery}
                onCompare={handleCompare}
                onTenantClick={handleOpenTenant}
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

          {view.type === "tenant" && (
            <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 72px)" }}>
              <TenantView
                tenantName={view.tenantName}
                deals={activeDeals}
                onBack={() => setView({ type: "list" })}
                onOpenDeal={d => setView({ type: "detail", dealId: d.id })}
              />
            </div>
          )}
        </div>
      )}

      {/* Global fixed-bottom upload queue — always rendered so it can track uploads from any tab */}
      <UploadQueue
        pendingFiles={pendingFiles}
        onFilesConsumed={() => setPendingFiles([])}
        onDealsAdded={handleDealsAdded}
        onDealUpdated={handleDealUpdated}
        onOpenDeal={handleOpenDeal}
        existingDeals={deals}
      />
    </div>
  );
}

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
