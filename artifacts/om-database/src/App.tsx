import { useState, useEffect, useCallback, useRef } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Deal } from "./lib/idb";
import { apiLoadDeals, apiSaveDeal, apiDeleteDeal, apiCheckAuth, apiLogout, apiCreateSnapshot } from "./lib/api";
import { PROSPECT_STALE_DAYS } from "./lib/constants";
import { ensureUploadAllowed } from "./lib/uploadAuth";
import Header from "./components/Header";
import FeedbackWidget from "./components/FeedbackWidget";
import AnalystBar from "./components/AnalystBar";
import UploadQueue from "./components/UploadQueue";
import DealGrid from "./components/DealGrid";
import DetailView from "./components/DetailView";
import TenantView from "./components/TenantView";
import LenderView from "./components/LenderView";
import AnalystChat from "./components/AnalystChat";
import PortfolioAnalytics from "./components/PortfolioAnalytics";
import CompsSearch from "./components/CompsSearch";
import Login from "./components/Login";
import HelpModal from "./components/HelpModal";
import TenantAudit from "./components/TenantAudit";
import TenantAnalytics from "./components/TenantAnalytics";
import ParentCompanyView from "./components/ParentCompanyView";

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

type TabId = "analyst" | "portfolio" | "analytics" | "comps";
type View = { type: "list" } | { type: "detail"; dealId: string } | { type: "compare"; dealIds: string[] } | { type: "tenant"; tenantName: string } | { type: "parent"; parentName: string } | { type: "tenant-audit" } | { type: "tenant-analytics" } | { type: "lender"; lenderName: string };
type AuthState = "checking" | "authenticated" | "unauthenticated";

function AppInner() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [isAdmin, setIsAdmin] = useState(false);
  const [deals, setDeals] = useState<Deal[]>([]);
  const [tab, setTab] = useState<TabId>("analyst");
  const [viewStack, setViewStack] = useState<View[]>([{ type: "list" }]);
  const view = viewStack[viewStack.length - 1];
  const navigate = useCallback((v: View) => setViewStack(prev => [...prev, v]), []);
  const goBack = useCallback(() => setViewStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev), []);
  const resetToList = useCallback(() => setViewStack([{ type: "list" }]), []);
  const [loaded, setLoaded] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | undefined>();
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [analyticsView, setAnalyticsView] = useState<"portfolio" | "tenant">("tenant");
  const [analyticsFilter, setAnalyticsFilter] = useState<"all" | "owned">("all");

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const checkAuth = useCallback(() => {
    apiCheckAuth().then(({ authenticated, isAdmin }) => {
      setAuth(authenticated ? "authenticated" : "unauthenticated");
      setIsAdmin(isAdmin);
    });
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

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
        apiCreateSnapshot("auto").catch(() => {});
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
    await apiCreateSnapshot("before-delete").catch(() => {});
    await apiDeleteDeal(id).catch(() => {});
    setDeals(prev => prev.filter(d => d.id !== id));
    if (view.type === "detail" && view.dealId === id) resetToList();
  }, [view, resetToList]);

  const handleOpenDeal = useCallback((id: string) => {
    navigate({ type: "detail", dealId: id });
    setTab("portfolio");
  }, [navigate]);

  const handleQuery = useCallback((q: string) => {
    setPendingQuery(q);
    setTab("analyst");
    resetToList();
  }, [resetToList]);

  const handleCompare = useCallback((ids: string[]) => {
    navigate({ type: "compare", dealIds: ids });
    setTab("portfolio");
  }, [navigate]);

  const handleOpenTenant = useCallback((name: string) => {
    if (name.startsWith("__lender__")) {
      navigate({ type: "lender", lenderName: name.replace("__lender__", "") });
      setTab("portfolio");
    } else if (name.startsWith("__parent__")) {
      navigate({ type: "parent", parentName: name.replace("__parent__", "") });
    } else {
      navigate({ type: "tenant", tenantName: name });
      if (tab !== "analytics") setTab("portfolio");
    }
  }, [navigate, tab]);

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
      style={{ height: "100dvh", background: "#f6f2ea", display: "flex", flexDirection: "column", overflow: "hidden", paddingTop: 16, fontFamily: "'Inter',-apple-system,sans-serif", color: "#383a37", WebkitFontSmoothing: "antialiased" as any, paddingRight: helpOpen && isDesktop ? 420 : 0, transition: "padding-right 0.2s ease" }}>

      <Header
        tab={tab}
        onTab={t => { setTab(t as TabId); resetToList(); }}
        deals={deals}
        queueLen={processingCount}
        onLogout={handleLogout}
        onFiles={handleFiles}
        onHelpOpen={() => setHelpOpen(true)}
        onDealsAdded={handleDealsAdded}
        isAdmin={isAdmin}
        onAdminChange={checkAuth}
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
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 88 }}>
          <CompsSearch onOpenDeal={id => { handleOpenDeal(id); }} />
        </div>
      )}

      {/* Analytics tab */}
      {tab === "analytics" && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* All/Owned bar — never scrolls. Hidden for tenant/parent/audit detail views */}
          {view.type !== "tenant" && view.type !== "parent" && view.type !== "tenant-audit" && (
            <div style={{ background:"#f6f2ea", borderBottom:"1px solid #ece5d7", padding:"9px 24px", display:"flex", alignItems:"center", justifyContent:"space-between", flexShrink:0 }}>
              <span style={{ fontSize:11, color:"#a89f8f", fontFamily:"'Inter',sans-serif" }}>
                {analyticsFilter === "owned" ? "Owned & sold only" : "All properties"}
              </span>
              <div style={{ display:"flex", background:"#ece5d7", borderRadius:8, padding:2, gap:1 }}>
                {(["all", "owned"] as const).map(v => (
                  <button key={v} onClick={() => setAnalyticsFilter(v)}
                    style={{ padding:"5px 14px", borderRadius:6, border:"none", background: analyticsFilter===v ? "#2a2c27" : "transparent", color: analyticsFilter===v ? "#f6f2ea" : "#8a8579", fontSize:12, fontWeight: analyticsFilter===v ? 600 : 500, cursor:"pointer", fontFamily:"'Inter',sans-serif", whiteSpace:"nowrap" }}>
                    {v === "all" ? "All Deals" : "Owned"}
                  </button>
                ))}
              </div>
            </div>
          )}
          {/* Scrollable content */}
          <div style={{ flex:1, overflowY:"auto", paddingBottom:88 }}>
            {view.type === "tenant" ? (
              <TenantView
                tenantName={view.tenantName}
                deals={deals}
                onBack={goBack}
                onOpenDeal={d => { navigate({ type: "detail", dealId: d.id }); setTab("portfolio"); }}
                onParentClick={name => handleOpenTenant("__parent__" + name)}
              />
            ) : view.type === "parent" ? (
              <ParentCompanyView
                parentName={view.parentName}
                deals={deals}
                onBack={goBack}
                onTenantClick={handleOpenTenant}
                onOpenDeal={d => { navigate({ type: "detail", dealId: d.id }); setTab("portfolio"); }}
              />
            ) : view.type === "tenant-audit" ? (
              <div>
                <div style={{ padding: "14px 24px 0" }}>
                  <button onClick={goBack} style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif" }}>← Back</button>
                </div>
                <TenantAudit deals={deals} onTenantClick={handleOpenTenant} />
              </div>
            ) : (
              <>
                {/* Segmented toggle */}
                <div style={{ display: "flex", justifyContent: "center", padding: "16px 0 0" }}>
                  <div style={{ display: "flex", background: "#f1eadc", borderRadius: 9, padding: 3, gap: 2 }}>
                    {(["tenant", "portfolio"] as const).map(v => (
                      <button
                        key={v}
                        onClick={() => setAnalyticsView(v)}
                        style={{
                          padding: "7px 18px",
                          borderRadius: 7,
                          border: "none",
                          background: analyticsView === v ? "#2a2c27" : "transparent",
                          color: analyticsView === v ? "#f6f2ea" : "#8a8579",
                          fontSize: 12.5,
                          fontWeight: analyticsView === v ? 600 : 500,
                          cursor: "pointer",
                          fontFamily: "'Inter',sans-serif",
                          letterSpacing: "-0.01em",
                          boxShadow: analyticsView === v ? "0 4px 14px -6px rgba(42,44,39,0.55)" : "none",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {v === "portfolio" ? "Portfolio Analytics" : "Tenant Analytics"}
                      </button>
                    ))}
                  </div>
                </div>
                {analyticsView === "portfolio" ? (
                  <PortfolioAnalytics filter={analyticsFilter} onTenantAudit={() => navigate({ type: "tenant-audit" })} />
                ) : (
                  <TenantAnalytics
                    filter={analyticsFilter}
                    deals={deals}
                    onTenantClick={handleOpenTenant}
                    onParentClick={name => handleOpenTenant("__parent__" + name)}
                    onTenantAudit={() => navigate({ type: "tenant-audit" })}
                  />
                )}
              </>
            )}
          </div>
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
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 88 }}>
          {view.type === "list" && (
            <>
              <div style={{ padding: "28px 28px 4px" }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 400, color: "#383a37", letterSpacing: "-0.01em" }}>
                  Deal Library
                </div>
                <div style={{ fontSize: 13, color: "#a89f8f", marginTop: 4 }}>
                  {activeDeals.length > 0 ? `${activeDeals.length} offering memorand${activeDeals.length === 1 ? "um" : "a"} on file` : "No deals uploaded yet"}
                </div>
              </div>
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
                          {isAdmin && (
                            <button onClick={() => {
                                const name = d.propertyName || d.fileName || "this deal";
                                if (window.confirm(`Permanently delete "${name}"? This removes the deal, its images, and its source text from the database and cannot be undone.`)) handleDelete(d.id);
                              }}
                              style={{ fontSize: 10, color: "#dc2626", background: "transparent", border: "1px solid #dc262640", padding: "2px 8px", borderRadius: 5, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>Delete permanently</button>
                          )}
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
                onBack={goBack}
                onDelete={id => { handleUpdate(id, { trashedAt: new Date().toISOString() }); resetToList(); }}
                onUpdate={handleUpdate}
                onQuery={handleQuery}
                onCompare={handleCompare}
                onTenantClick={handleOpenTenant}
              />
            </div>
          )}

          {view.type === "detail" && !currentDeal && (
            <div style={{ padding: 28 }}>
              <button onClick={goBack} style={{ color: "#7d766a", background: "transparent", border: "1px solid #e7e0d2", padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11 }}>← Back</button>
              <p style={{ color: "#a89f8f", marginTop: 16 }}>Deal not found.</p>
            </div>
          )}

          {view.type === "compare" && (
            <CompareView
              deals={deals.filter(d => view.type === "compare" && view.dealIds.includes(d.id))}
              onBack={goBack}
              onOpen={handleOpenDeal}
            />
          )}

          {view.type === "lender" && (
            <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 160px)" }}>
              <LenderView
                lenderName={view.lenderName}
                deals={activeDeals}
                onBack={goBack}
                onOpenDeal={d => navigate({ type: "detail", dealId: d.id })}
              />
            </div>
          )}

          {view.type === "tenant" && (
            <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 160px)" }}>
              <TenantView
                tenantName={view.tenantName}
                deals={activeDeals}
                onBack={goBack}
                onOpenDeal={d => navigate({ type: "detail", dealId: d.id })}
                onParentClick={name => handleOpenTenant("__parent__" + name)}
              />
            </div>
          )}

          {view.type === "parent" && (
            <div style={{ display: "flex", flexDirection: "column", height: "calc(100dvh - 160px)" }}>
              <ParentCompanyView
                parentName={view.parentName}
                deals={deals}
                onBack={goBack}
                onTenantClick={handleOpenTenant}
                onOpenDeal={d => { navigate({ type: "detail", dealId: d.id }); setTab("portfolio"); }}
              />
            </div>
          )}
        </div>
      )}

      {tab !== "analyst" && view.type !== "detail" && (
        <AnalystBar onAsk={handleQuery} />
      )}

      <FeedbackWidget
        currentPage={
          view.type === "detail" ? `deal / ${tab}` :
          view.type === "tenant-audit" ? "tenant-audit" :
          view.type === "tenant" ? `tenant / ${view.tenantName}` :
          view.type === "parent" ? `parent / ${view.parentName}` :
          view.type === "lender" ? `lender / ${view.lenderName}` :
          view.type === "compare" ? "compare" :
          tab
        }
        liftAboveBar={view.type !== "detail"}
      />

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
