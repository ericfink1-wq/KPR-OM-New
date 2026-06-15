import { useState, useEffect, useCallback, useRef, useMemo, lazy, Suspense } from "react";
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
import AnalystChat from "./components/AnalystChat";
import Login from "./components/Login";
import TwoFactorModal from "./components/TwoFactorModal";
import HelpModal from "./components/HelpModal";
import ClosingCostEstimator from "./components/ClosingCostEstimator";
import AiProgressBar from "./components/AiProgressBar";
import SaveStatusIndicator from "./components/SaveStatusIndicator";
import CriticalDates from "./components/CriticalDates";
import MarkToMarket from "./components/MarkToMarket";
import CoTenancyCascade from "./components/CoTenancyCascade";
import GlobalSearch from "./components/GlobalSearch";
import { isSupportedUpload } from "./lib/fileExtract";
// Heavy, route-gated screens are lazy-loaded so they don't bloat the initial
// bundle (faster first paint, especially on mobile). They only fetch their chunk
// when first opened; a Suspense fallback covers the brief load.
//
// After a republish, a tab that loaded the OLD page references old chunk URLs
// that no longer exist — opening one of these screens would then throw a
// chunk-load error and hit the error screen. lazyWithReload catches that and
// reloads the page ONCE to pull the fresh assets (self-healing); a genuinely
// broken chunk still surfaces normally instead of looping.
function lazyWithReload<T extends React.ComponentType<unknown>>(factory: () => Promise<{ default: T }>) {
  return lazy(async () => {
    const KEY = "kpr-chunk-reloaded";
    try {
      const mod = await factory();
      try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
      return mod;
    } catch (err) {
      try {
        if (!sessionStorage.getItem(KEY)) {
          sessionStorage.setItem(KEY, "1");
          window.location.reload();
          return await new Promise<{ default: T }>(() => {}); // hang while reloading
        }
      } catch { /* ignore */ }
      throw err;
    }
  });
}

const DetailView = lazyWithReload(() => import("./components/DetailView"));
const TenantView = lazyWithReload(() => import("./components/TenantView"));
const TenantLink = lazyWithReload(() => import("./components/TenantLink"));
const LenderView = lazyWithReload(() => import("./components/LenderView"));
const PortfolioAnalytics = lazyWithReload(() => import("./components/PortfolioAnalytics"));
const RolloverYearView = lazyWithReload(() => import("./components/RolloverYearView"));
const CompsSearch = lazyWithReload(() => import("./components/CompsSearch"));
const ResetPassword = lazyWithReload(() => import("./components/ResetPassword"));
const VerifyEmail = lazyWithReload(() => import("./components/VerifyEmail"));
const TenantAudit = lazyWithReload(() => import("./components/TenantAudit"));
const TenantAnalytics = lazyWithReload(() => import("./components/TenantAnalytics"));
const RetailerWatchlist = lazyWithReload(() => import("./components/RetailerWatchlist"));
const ParentCompanyView = lazyWithReload(() => import("./components/ParentCompanyView"));
const CompareView = lazyWithReload(() => import("./components/CompareView"));

const queryClient = new QueryClient({
  defaultOptions: { queries: { retry: 1, staleTime: 30000 } },
});

// Fallback shown while a lazy-loaded screen's chunk is fetched (usually a blink).
function ViewLoading() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", minHeight: 240, color: "#a89f8f", fontSize: 13, fontFamily: "'Inter',sans-serif" }}>
      Loading…
    </div>
  );
}

type TabId = "analyst" | "portfolio" | "analytics" | "comps";
type View = { type: "list" } | { type: "detail"; dealId: string } | { type: "compare"; dealIds: string[] } | { type: "tenant"; tenantName: string } | { type: "parent"; parentName: string } | { type: "tenant-audit" } | { type: "tenant-link" } | { type: "tenant-analytics" } | { type: "lender"; lenderName: string } | { type: "rollover-year"; year: string; scope: "all" | "owned" };
type AuthState = "checking" | "authenticated" | "unauthenticated";

function AppInner() {
  const [auth, setAuth] = useState<AuthState>("checking");
  const [twoFAPending, setTwoFAPending] = useState(false);
  const [needs2fa, setNeeds2fa] = useState(false);
  // Password-reset deep link (?reset=1&email=…&token=…) from the reset email.
  const [resetParams, setResetParams] = useState<{ email: string; token: string } | null>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("reset") === "1" && p.get("token") && p.get("email")) {
        return { email: p.get("email") as string, token: p.get("token") as string };
      }
    } catch { /* ignore */ }
    return null;
  });
  // Email-verification deep link (?verify=1&email=…&token=…) from the verify email.
  const [verifyParams, setVerifyParams] = useState<{ email: string; token: string } | null>(() => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get("verify") === "1" && p.get("token") && p.get("email")) {
        return { email: p.get("email") as string, token: p.get("token") as string };
      }
    } catch { /* ignore */ }
    return null;
  });
  const [isAdmin, setIsAdmin] = useState(false);
  // Filtered vs total deal count from DealGrid, for the "39 of 94 …" header.
  const [dealCounts, setDealCounts] = useState<{ shown: number; total: number } | null>(null);
  const handleDealCounts = useCallback((shown: number, total: number) => {
    setDealCounts(prev => (prev && prev.shown === shown && prev.total === total) ? prev : { shown, total });
  }, []);
  const [deals, setDeals] = useState<Deal[]>([]);
  // Always-current mirror of `deals`. Background saves in UploadQueue finish out of
  // band, so they need to re-base their changes onto the LATEST deal (which may
  // include edits the user just made on the deal page) rather than a stale snapshot
  // captured when the upload started. Reading state inside an async callback would
  // see a stale closure; this ref is kept current synchronously by the racing
  // updaters below (and on every render as a backstop).
  const dealsRef = useRef<Deal[]>([]);
  dealsRef.current = deals;
  const getLatestDeal = useCallback((id: string) => dealsRef.current.find(d => d.id === id), []);
  const [tab, setTab] = useState<TabId>("analyst");
  // Right-side AI chat drawer (opened from the ask bar / "Ask about this property").
  const [chatOpen, setChatOpen] = useState(false);
  const [viewStack, setViewStack] = useState<View[]>([{ type: "list" }]);
  const view = viewStack[viewStack.length - 1];
  const navigate = useCallback((v: View) => setViewStack(prev => [...prev, v]), []);
  const goBack = useCallback(() => setViewStack(prev => prev.length > 1 ? prev.slice(0, -1) : prev), []);
  const resetToList = useCallback(() => setViewStack([{ type: "list" }]), []);

  // Make the BROWSER back button mirror the in-page Back button: when there's a
  // view to pop, intercept the back navigation and go back in-app instead of
  // leaving the site; at the root view, let the browser navigate away normally.
  const canGoBackRef = useRef(false);
  canGoBackRef.current = viewStack.length > 1;
  useEffect(() => {
    // Seed one sentinel entry so the first Back press has something to consume.
    window.history.pushState({ kpr: true }, "");
    const onPop = () => {
      if (canGoBackRef.current) {
        goBack();
        // Re-arm: keep a sentinel in place so subsequent Back presses stay caught
        // until we're at the root view.
        window.history.pushState({ kpr: true }, "");
      }
      // else: no in-app history left — allow the browser to leave the page.
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, [goBack]);

  // Tutorial "Go to" links → jump to the relevant page. On desktop the help panel
  // stays open (it's a side panel); on mobile HelpModal closes itself after calling this.
  const handleHelpNavigate = useCallback((dest: "portfolio" | "analytics" | "analytics-watchlist" | "comps" | "analyst") => {
    resetToList();
    if (dest === "portfolio") setTab("portfolio");
    else if (dest === "comps") setTab("comps");
    else if (dest === "analyst") setChatOpen(true);
    else if (dest === "analytics") { setTab("analytics"); setAnalyticsView("tenant"); }
    else if (dest === "analytics-watchlist") { setTab("analytics"); setAnalyticsView("watchlist"); }
  }, [resetToList]);

  // Top-nav Analytics dropdowns → jump straight to a section.
  const onAnalyticsNav = useCallback((dest: string) => {
    setTab("analytics");
    if (dest === "link-tenants") { navigate({ type: "tenant-link" }); return; }
    if (dest === "tenant-audit") { navigate({ type: "tenant-audit" }); return; }
    // Base analytics destinations show the segmented content; reset to the base
    // view (mirrors handleHelpNavigate) then pick the section.
    resetToList();
    if (dest === "portfolio-overview" || dest === "lease-rollover") setAnalyticsView("portfolio");
    else if (dest === "watchlist") setAnalyticsView("watchlist");
    else if (dest === "critical-dates") setAnalyticsView("calendar");
    else if (dest === "mark-to-market") setAnalyticsView("marktomarket");
    else if (dest === "cotenancy-cascade") setAnalyticsView("cotenancy");
    else setAnalyticsView("tenant");
    if (dest === "lease-rollover") {
      setTimeout(() => document.getElementById("section-lease-rollover")?.scrollIntoView({ behavior: "smooth", block: "start" }), 140);
    }
  }, [navigate, resetToList]);
  const [loaded, setLoaded] = useState(false);
  const [pendingQuery, setPendingQuery] = useState<string | undefined>();
  const [dragging, setDragging] = useState(false);
  const dragCounter = useRef(0);
  const analyticsScrollRef = useRef<HTMLDivElement>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploadPanelH, setUploadPanelH] = useState(0);
  const [helpOpen, setHelpOpen] = useState(false);
  const [closingCalcOpen, setClosingCalcOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [analyticsView, setAnalyticsView] = useState<"portfolio" | "tenant" | "watchlist" | "calendar" | "marktomarket" | "cotenancy">("tenant");

  // Scroll analytics content to top whenever the view changes
  useEffect(() => {
    if (analyticsScrollRef.current) analyticsScrollRef.current.scrollTop = 0;
  }, [view]);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  const checkAuth = useCallback(() => {
    apiCheckAuth().then(({ authenticated, isAdmin, twoFactorPending, needs2faSetup }) => {
      setAuth(authenticated ? "authenticated" : "unauthenticated");
      setIsAdmin(isAdmin);
      setTwoFAPending(!!twoFactorPending);
      setNeeds2fa(!!needs2faSetup);
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

  const handleReloadDeals = useCallback(() => {
    apiLoadDeals().then(d => setDeals(d)).catch(() => {});
  }, []);

  const handleUpdate = useCallback((id: string, patch: Partial<Deal>) => {
    // Merge onto the latest known deal and sync the ref synchronously, so a
    // background save that lands right after sees this edit (and vice-versa).
    const next = dealsRef.current.map(d => d.id === id ? { ...d, ...patch } : d);
    dealsRef.current = next;
    const updated = next.find(d => d.id === id);
    if (updated) apiSaveDeal(updated).catch(() => {});
    setDeals(next);
  }, []);

  const handleDealsAdded = useCallback((newDeals: Deal[]) => {
    setDeals(prev => {
      const byId = new Map(prev.map(d => [d.id, d]));
      for (const d of newDeals) byId.set(d.id, d);
      return Array.from(byId.values());
    });
  }, []);

  const handleDealUpdated = useCallback((updated: Deal) => {
    // Upsert — if the deal isn't in the list yet (e.g. an auto-merge target that
    // wasn't loaded), add it so the result shows immediately without a refresh.
    // Sync the ref synchronously so a chained background save (e.g. apply roster →
    // refresh analysis) re-bases onto this result instead of a stale snapshot.
    const next = dealsRef.current.some(d => d.id === updated.id)
      ? dealsRef.current.map(d => d.id === updated.id ? updated : d)
      : [...dealsRef.current, updated];
    dealsRef.current = next;
    setDeals(next);
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

  // Typing a question into the bottom ask bar (or "Ask about this property") opens
  // the answer in a right-side ~1/3 chat drawer — the full Analyst tab stays its
  // own home page, reached via the nav button.
  const handleQuery = useCallback((q: string) => {
    setPendingQuery(q);
    setChatOpen(true);
  }, []);

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
    const supported = Array.from(fl).filter(isSupportedUpload);
    if (supported.length) setPendingFiles(supported);
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

  // Hide overlay on Escape and on any window dragleave that exits the document.
  // Cmd/Ctrl+K opens global search (the standard shortcut).
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === "k" || e.key === "K")) { e.preventDefault(); setSearchOpen(o => !o); return; }
      if (e.key === "Escape") { dragCounter.current = 0; setDragging(false); setChatOpen(false); setSearchOpen(false); }
    };
    const onDragLeaveDoc = (e: DragEvent) => { if (!e.relatedTarget) { dragCounter.current = 0; setDragging(false); } };
    window.addEventListener("keydown", onKeyDown);
    document.addEventListener("dragleave", onDragLeaveDoc);
    return () => { window.removeEventListener("keydown", onKeyDown); document.removeEventListener("dragleave", onDragLeaveDoc); };
  }, []);

  const processingCount = 0; // UploadQueue tracks this internally now

  if (resetParams) {
    return (
      <Suspense fallback={<ViewLoading />}>
        <ResetPassword email={resetParams.email} token={resetParams.token} onDone={() => {
          try { window.history.replaceState({}, "", window.location.pathname); } catch { /* ignore */ }
          setResetParams(null);
        }} />
      </Suspense>
    );
  }

  if (verifyParams) {
    return (
      <Suspense fallback={<ViewLoading />}>
        <VerifyEmail email={verifyParams.email} token={verifyParams.token} onDone={() => {
          try { window.history.replaceState({}, "", window.location.pathname); } catch { /* ignore */ }
          setVerifyParams(null);
        }} />
      </Suspense>
    );
  }

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
    return <Login startOn2fa={twoFAPending} onLogin={() => { checkAuth(); }} />;
  }

  // Mandatory 2FA: an authenticated user who hasn't enrolled is blocked behind the
  // (non-dismissable) enrollment flow until they turn it on. The server enforces this
  // too — data routes return 2fa_setup_required until enrolled.
  if (needs2fa) {
    return <TwoFactorModal mandatory onClose={() => { checkAuth(); }} />;
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

  const activeDeals = useMemo(() => deals.filter(d => !d.trashedAt), [deals]);
  // Stable reference (only changes when the deal set changes) — it feeds the Owned
  // scope filter on Portfolio Analytics, whose reload effect depends on it; a fresh
  // array each render made the Owned view reload/reset on any unrelated App re-render.
  const ownedDealIds = useMemo(
    () => activeDeals.filter(d => d.status === "Owned" || d.status === "Sold").map(d => d.id),
    [activeDeals],
  );
  const currentDeal = view.type === "detail" ? deals.find(d => d.id === view.dealId) : null;

  return (
    <div
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={{ height: "100%", background: "#f6f2ea", display: "flex", flexDirection: "column", overflow: "hidden", paddingTop: 16, fontFamily: "'Inter',-apple-system,sans-serif", color: "#383a37", WebkitFontSmoothing: "antialiased" as any, paddingRight: helpOpen && isDesktop ? "clamp(420px, 33vw, 680px)" : 0, transition: "padding-right 0.2s ease" }}>

      <Header
        tab={tab}
        onTab={t => { setTab(t as TabId); resetToList(); }}
        deals={deals}
        queueLen={processingCount}
        onLogout={handleLogout}
        onFiles={handleFiles}
        onHelpOpen={() => setHelpOpen(true)}
        onClosingCalc={() => setClosingCalcOpen(true)}
        onDealsAdded={handleDealsAdded}
        isAdmin={isAdmin}
        onAdminChange={checkAuth}
        onAnalyticsNav={onAnalyticsNav}
        onOpenSearch={() => setSearchOpen(true)}
      />
      <HelpModal open={helpOpen} onClose={() => setHelpOpen(false)} onNavigate={handleHelpNavigate} />
      {closingCalcOpen && <ClosingCostEstimator deals={deals} onClose={() => setClosingCalcOpen(false)} />}
      {/* The deal page is crowded top (fixed action bar + title) and the toast
          would cover them at scroll-top — anchor it to the bottom there, clear of
          the Ask/flag buttons. Other pages keep it pinned near the top. */}
      <AiProgressBar {...(view.type === "detail" ? { bottom: 96 } : { top: 84 })} />

      {/* Each sub-page (tenant, parent, rollover, lender, compare, audits, detail)
          renders its own "← Back" in its header, so there is no global pinned one
          here — a second floating Back used to stack on top of theirs on mobile. */}

      {/* Drag overlay */}
      {dragging && (
        <div style={{ position: "fixed", inset: 0, zIndex: 500, background: "rgba(56,58,55,0.55)", backdropFilter: "blur(2px)", display: "flex", alignItems: "center", justifyContent: "center", pointerEvents: "none" }}>
          <div style={{ background: "#ffffff", border: "2px dashed #6dba43", borderRadius: 16, padding: "48px 64px", textAlign: "center", boxShadow: "0 24px 64px rgba(0,0,0,0.25)" }}>
            <div style={{ fontSize: 40, marginBottom: 8 }}>📁</div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 22, fontWeight: 600, color: "#383a37" }}>Drop OMs, rent rolls or sales reports</div>
            <div style={{ fontSize: 13, color: "#8b9aa8", marginTop: 6 }}>PDF or Excel — we'll sort each to the right property</div>
          </div>
        </div>
      )}

      <Suspense fallback={<ViewLoading />}>
      {/* Comps tab */}
      {tab === "comps" && (
        <div style={{ flex: 1, overflowY: "auto", paddingBottom: 88 }}>
          <CompsSearch onOpenDeal={id => { handleOpenDeal(id); }} />
        </div>
      )}

      {/* Analytics tab */}
      {tab === "analytics" && (
        <div style={{ flex:1, display:"flex", flexDirection:"column", overflow:"hidden" }}>
          {/* Scrollable content */}
          <div ref={analyticsScrollRef} style={{ flex:1, overflowY:"auto", paddingBottom:88 }}>
            {view.type === "tenant" ? (
              <TenantView
                tenantName={view.tenantName}
                deals={activeDeals}
                onBack={goBack}
                onOpenDeal={d => { navigate({ type: "detail", dealId: d.id }); setTab("portfolio"); }}
                onParentClick={name => handleOpenTenant("__parent__" + name)}
              />
            ) : view.type === "parent" ? (
              <ParentCompanyView
                parentName={view.parentName}
                deals={activeDeals}
                onBack={goBack}
                onTenantClick={handleOpenTenant}
                onOpenDeal={d => { navigate({ type: "detail", dealId: d.id }); setTab("portfolio"); }}
              />
            ) : view.type === "tenant-audit" ? (
              <div>
                <div style={{ padding: "14px 24px 0" }}>
                  <button onClick={goBack} style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif" }}>← Back</button>
                </div>
                <TenantAudit deals={activeDeals} onTenantClick={handleOpenTenant} onDealsChanged={handleReloadDeals} />
              </div>
            ) : view.type === "tenant-link" ? (
              <div>
                <div style={{ padding: "14px 24px 0" }}>
                  <button onClick={goBack} style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "5px 10px", borderRadius: 4, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif" }}>← Back</button>
                </div>
                <TenantLink deals={activeDeals} />
              </div>
            ) : view.type === "rollover-year" ? (
              <RolloverYearView year={view.year} initialScope={view.scope} ownedDealIds={ownedDealIds} onBack={goBack} onOpenDeal={id => { navigate({ type: "detail", dealId: id }); setTab("portfolio"); }} onTenantClick={handleOpenTenant} />
            ) : (
              <>
                {analyticsView === "portfolio" ? (
                  <PortfolioAnalytics onYearClick={(year, scope) => navigate({ type: "rollover-year", year, scope })} onTenantAudit={() => navigate({ type: "tenant-audit" })} ownedDealIds={ownedDealIds} isAdmin={isAdmin} />
                ) : analyticsView === "calendar" ? (
                  <CriticalDates deals={activeDeals} onOpenDeal={handleOpenDeal} />
                ) : analyticsView === "marktomarket" ? (
                  <MarkToMarket deals={activeDeals} onOpenDeal={handleOpenDeal} />
                ) : analyticsView === "cotenancy" ? (
                  <CoTenancyCascade deals={activeDeals} onOpenDeal={handleOpenDeal} />
                ) : analyticsView === "watchlist" ? (
                  <div style={{ padding: "24px 18px", maxWidth: 1100, margin: "0 auto", boxSizing: "border-box", width: "100%" }}>
                    <RetailerWatchlist deals={activeDeals} onOpenDeal={handleOpenDeal} onTenantClick={handleOpenTenant} />
                  </div>
                ) : (
                  <TenantAnalytics
                    deals={activeDeals}
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

      {/* Analyst home page (dashboard) — submitting a question opens the chat drawer */}
      {tab === "analyst" && (
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }}>
          <AnalystChat
            deals={deals}
            onOpenDeal={handleOpenDeal}
            onTenantClick={handleOpenTenant}
            onAsk={handleQuery}
          />
        </div>
      )}

      {/* Portfolio tab */}
      {tab === "portfolio" && (
        <div style={view.type === "detail"
          // Deal page: a plain flex column (NOT a scroll container) so DetailView
          // owns the single scroll. Nesting its own scroller inside an outer
          // overflow:auto made the page's bottom unreachable ("gets stuck").
          ? { flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minHeight: 0 }
          : { flex: 1, overflowY: "auto", paddingBottom: 88 }}>
          {view.type === "list" && (
            <>
              <div style={{ padding: "28px 28px 4px" }}>
                <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 400, color: "#383a37", letterSpacing: "-0.01em" }}>
                  Deal Library
                </div>
                <div style={{ fontSize: 13, color: "#a89f8f", marginTop: 4 }}>
                  {activeDeals.length === 0
                    ? "No deals uploaded yet"
                    : (dealCounts && dealCounts.shown < dealCounts.total)
                      ? `${dealCounts.shown} of ${dealCounts.total} offering memorand${dealCounts.total === 1 ? "um" : "a"} on file`
                      : `${activeDeals.length} offering memorand${activeDeals.length === 1 ? "um" : "a"} on file`}
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
                  onDelete={handleDelete}
                  onAddFiles={files => setPendingFiles(prev => [...prev, ...files])}
                  isAdmin={isAdmin}
                  onCountsChange={handleDealCounts}
                />
              )}
            </>
          )}

          {view.type === "detail" && currentDeal && (
            <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
              <DetailView
                deal={currentDeal}
                allDeals={deals}
                onBack={goBack}
                onDelete={handleDelete}
                onUpdate={handleUpdate}
                onQuery={handleQuery}
                onCompare={handleCompare}
                onTenantClick={handleOpenTenant}
                isAdmin={isAdmin}
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
              onTenantClick={handleOpenTenant}
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

      </Suspense>

      {tab !== "analyst" && view.type !== "detail" && (
        <AnalystBar onAsk={handleQuery} />
      )}

      {/* AI chat drawer — right side, ~1/3 of the screen on desktop, full on mobile */}
      {/* Backdrop — only when open */}
      {chatOpen && (
        <div onClick={() => setChatOpen(false)}
          style={{ position: "fixed", inset: 0, zIndex: 1100, background: "rgba(38,40,31,0.42)", backdropFilter: "blur(2px)" }} />
      )}
      {/* Chat drawer — kept MOUNTED and slid off-screen when closed, so the
          conversation persists across opens. Only rendered once any deals load. */}
      {deals.length > 0 && (
        <div role="dialog" aria-label="KPR Analyst" aria-hidden={!chatOpen}
          style={{ position: "fixed", top: 0, right: 0, bottom: 0, zIndex: 1101, width: isDesktop ? "clamp(420px, 34vw, 680px)" : "100vw", maxWidth: "100vw", background: "#faf7f0", borderLeft: isDesktop ? "1px solid #d8d2c1" : "none", boxShadow: chatOpen ? "-8px 0 40px rgba(38,40,31,0.18)" : "none", display: "flex", flexDirection: "column", overflow: "hidden", transform: chatOpen ? "translateX(0)" : "translateX(101%)", transition: "transform 0.22s ease", pointerEvents: chatOpen ? "auto" : "none" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 18px", borderBottom: "1px solid #ece5d7", flexShrink: 0, background: "#fff" }}>
            <span style={{ fontFamily: "'Fraunces',serif", fontSize: 17, fontWeight: 600, color: "#26281f" }}>KPR Analyst</span>
            <button onClick={() => setChatOpen(false)} aria-label="Close analyst"
              style={{ background: "transparent", border: "1px solid #e3dccd", color: "#7d766a", width: 32, height: 32, borderRadius: 8, cursor: "pointer", fontSize: 17, lineHeight: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>✕</button>
          </div>
          <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
            <AnalystChat
              deals={deals}
              onOpenDeal={id => { setChatOpen(false); handleOpenDeal(id); }}
              onTenantClick={name => { setChatOpen(false); handleOpenTenant(name); }}
              initialQuery={pendingQuery}
              onClearQuery={() => setPendingQuery(undefined)}
            />
          </div>
        </div>
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
        liftAbove={uploadPanelH}
      />

      {/* Global fixed-bottom upload queue — always rendered so it can track uploads from any tab */}
      <UploadQueue
        pendingFiles={pendingFiles}
        onFilesConsumed={() => setPendingFiles([])}
        onDealsAdded={handleDealsAdded}
        onDealUpdated={handleDealUpdated}
        getLatestDeal={getLatestDeal}
        onOpenDeal={handleOpenDeal}
        existingDeals={deals}
        onPanelHeightChange={setUploadPanelH}
      />
      <SaveStatusIndicator />
      <GlobalSearch open={searchOpen} deals={deals} onClose={() => setSearchOpen(false)} onOpenDeal={handleOpenDeal} />
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
