import { useRef, useState, useEffect } from "react";
import { createPortal } from "react-dom";
import type { Deal, ImageBundle } from "../lib/idb";
import { apiImportDeal, apiSaveDeal, apiLoadSource, apiLoadImages, apiSaveSource, apiSaveImages, apiCreateSnapshot, apiListSnapshots, apiRestoreSnapshot, apiListFeedback, apiSetFeedbackResolved, apiAdminUnlock, apiUploadLog } from "../lib/api";
import type { SnapshotMeta, FeedbackItem } from "../lib/api";
import RatesPanel from "./RatesPanel";
import Members from "./Members";
import ChangePassword from "./ChangePassword";

interface Props {
  tab: string;
  onHelpOpen?: () => void;
  onTab: (t: string) => void;
  deals: Deal[];
  queueLen: number;
  onLogout?: () => void;
  onFiles: (files: FileList) => void;
  onDealsAdded?: (deals: Deal[]) => void;
  isAdmin?: boolean;
  onAdminChange?: () => void;
  onAnalyticsNav?: (dest: string) => void;
}

export default function Header({ tab, onTab, deals, queueLen, onLogout, onFiles, onHelpOpen, onDealsAdded, isAdmin, onAdminChange, onAnalyticsNav }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const uploadTriggerRef = useRef<HTMLDivElement>(null);
  const backupTriggerRef = useRef<HTMLDivElement>(null);
  const [backupMenu, setBackupMenu] = useState(false);
  const [uploadMenu, setUploadMenu] = useState(false);
  const [ratesOpen, setRatesOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [pwOpen, setPwOpen] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);
  const [uploadRect, setUploadRect] = useState<DOMRect | null>(null);
  const [backupRect, setBackupRect] = useState<DOMRect | null>(null);
  // Count of upload failures in the last 24h → red badge on the admin Members button.
  const [uploadFails, setUploadFails] = useState(0);
  useEffect(() => {
    if (!isAdmin) return;
    apiUploadLog().then(list => {
      const since = Date.now() - 24 * 60 * 60 * 1000;
      setUploadFails(list.filter(u => u.status === "failed" && new Date(u.createdAt).getTime() >= since).length);
    }).catch(() => { /* non-fatal */ });
  }, [isAdmin]);
  // Analytics nav dropdowns (Portfolio Analytics ▾ / Tenant Analytics ▾)
  const [analyticsMenu, setAnalyticsMenu] = useState<null | "portfolio" | "tenant">(null);
  const [analyticsRect, setAnalyticsRect] = useState<DOMRect | null>(null);
  const pAnalyticsRef = useRef<HTMLDivElement>(null);
  const tAnalyticsRef = useRef<HTMLDivElement>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; done?: number; failed?: number; mergedNames?: string[] } | null>(null);
  const [snapshotModal, setSnapshotModal] = useState(false);
  const [snapshots, setSnapshots] = useState<SnapshotMeta[]>([]);
  const [snapshotLoading, setSnapshotLoading] = useState(false);
  const [snapshotRestoring, setSnapshotRestoring] = useState<number | null>(null);
  const [feedbackModal, setFeedbackModal] = useState(false);
  const [feedbackList, setFeedbackList] = useState<FeedbackItem[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackUnresolved, setFeedbackUnresolved] = useState<number | null>(null);
  const logoClickTimesRef = useRef<number[]>([]);
  const [adminPrompt, setAdminPrompt] = useState(false);
  const [adminPw, setAdminPw] = useState("");
  const [adminError, setAdminError] = useState<string | null>(null);
  const [adminSubmitting, setAdminSubmitting] = useState(false);

  const openFeedbackInbox = async () => {
    setBackupMenu(false);
    setFeedbackModal(true);
    setFeedbackLoading(true);
    try {
      const list = await apiListFeedback();
      const sorted = [...list.filter(f => !f.resolved), ...list.filter(f => f.resolved)];
      setFeedbackList(sorted);
      setFeedbackUnresolved(list.filter(f => !f.resolved).length);
    } catch {
      setFeedbackList([]);
    } finally {
      setFeedbackLoading(false);
    }
  };

  const handleLogoClick = () => {
    const now = Date.now();
    const recent = [...logoClickTimesRef.current, now].filter(t => now - t < 3000);
    logoClickTimesRef.current = recent;
    if (recent.length >= 5) {
      logoClickTimesRef.current = [];
      setAdminPw("");
      setAdminError(null);
      setAdminPrompt(true);
    }
  };

  const handleAdminUnlock = async () => {
    if (!adminPw.trim() || adminSubmitting) return;
    setAdminSubmitting(true);
    setAdminError(null);
    try {
      await apiAdminUnlock(adminPw);
      setAdminPrompt(false);
      setAdminPw("");
      onAdminChange?.();
    } catch {
      setAdminError("Incorrect password");
    } finally {
      setAdminSubmitting(false);
    }
  };

  const handleToggleResolved = async (id: number, resolved: boolean) => {
    await apiSetFeedbackResolved(id, resolved).catch(() => {});
    setFeedbackList(prev => {
      const updated = prev.map(f => f.id === id ? { ...f, resolved } : f);
      const sorted = [...updated.filter(f => !f.resolved), ...updated.filter(f => f.resolved)];
      return sorted;
    });
    setFeedbackUnresolved(prev => Math.max(0, (prev ?? 0) + (resolved ? -1 : 1)));
  };

  const SNAPSHOT_LABELS: Record<string, string> = {
    "auto": "Automatic backup",
    "before-import": "Before an upload",
    "before-delete": "Before a delete",
    "before-restore": "Before a restore",
    "before-restore-rollback": "Before snapshot restore",
    "manual": "Manual backup",
  };

  const openSnapshotModal = async () => {
    setBackupMenu(false);
    setSnapshotModal(true);
    setSnapshotLoading(true);
    try {
      const list = await apiListSnapshots();
      setSnapshots(list);
    } catch {
      setSnapshots([]);
    } finally {
      setSnapshotLoading(false);
    }
  };

  const handleSnapshotRestore = async (snap: SnapshotMeta) => {
    const label = SNAPSHOT_LABELS[snap.reason] ?? snap.reason;
    const date = new Date(snap.createdAt).toLocaleString();
    if (!window.confirm(`Restore snapshot from ${date}?\n\nLabel: ${label}\nDeals: ${snap.dealCount}\n\nThis restores deleted/overwritten deals without removing newer ones. A safety snapshot will be taken first.\n\nContinue?`)) return;
    setSnapshotRestoring(snap.id);
    try {
      const result = await apiRestoreSnapshot(snap.id);
      const total = result.restored + result.updated;
      alert(`Restored ${total} deal(s) (${result.restored} recovered, ${result.updated} updated). Reloading…`);
      window.location.reload();
    } catch (err) {
      alert("Restore failed: " + (err instanceof Error ? err.message : "unknown error"));
      setSnapshotRestoring(null);
    }
  };

  const active = deals.filter(d => !d.trashedAt);
  const handleFiles = (fl: FileList | null) => {
    if (fl && fl.length > 0) onFiles(fl);
  };

  const handleJsonFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (e.target) e.target.value = "";
    if (files.length === 0) return;

    const allDeals: Deal[] = [];
    const parseErrors: string[] = [];

    for (const file of files) {
      try {
        const text = await file.text();
        const raw = JSON.parse(text);
        const items: unknown[] = Array.isArray(raw)
          ? raw
          : (raw && typeof raw === "object" && Array.isArray((raw as any).deals))
            ? (raw as any).deals
            : [raw];
        for (let i = 0; i < items.length; i++) {
          const obj = items[i];
          if (!obj || typeof obj !== "object") continue;
          const r = { ...(obj as Record<string, unknown>) };
          if (typeof r.name === "string" && !r.propertyName) r.propertyName = r.name;
          delete r.name;
          if (!r.propertyName || typeof r.propertyName !== "string" || !(r.propertyName as string).trim()) {
            parseErrors.push(`"${file.name}" deal at index ${i}: missing propertyName`);
            continue;
          }
          if (!r.id || typeof r.id !== "string") {
            r.id = `${Date.now().toString(36)}_${allDeals.length}_${Math.random().toString(36).slice(2, 7)}`;
          }
          if (!r.status) r.status = "Prospect";
          if (!Array.isArray(r.tenants)) r.tenants = [];
          if (!r.uploadedAt) r.uploadedAt = new Date().toISOString();
          allDeals.push(r as unknown as Deal);
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        parseErrors.push(`"${file.name}": ${msg}`);
      }
    }

    if (allDeals.length === 0) {
      setImportProgress({ current: 0, total: 0, done: 0, failed: parseErrors.length });
      setTimeout(() => setImportProgress(null), 4000);
      console.warn("JSON upload errors:", parseErrors);
      return;
    }

    const existingActive = deals.filter(d => !d.trashedAt);
    const existingNames = new Set(existingActive.map(d => (d.propertyName || "").trim().toLowerCase()));
    const willUpdate = allDeals.filter(d => existingNames.has((d.propertyName || "").trim().toLowerCase())).length;
    const willAdd = allDeals.length - willUpdate;

    if (allDeals.length > 10 || willUpdate > 0) {
      const msg = `Import ${allDeals.length} deal(s)?\n\n${willUpdate > 0 ? `${willUpdate} will update existing deal(s).\n` : ""}${willAdd} will be added.\n\nContinue?`;
      if (!window.confirm(msg)) {
        setImportProgress(null);
        return;
      }
    }

    await apiCreateSnapshot("before-import").catch(() => {});

    const succeeded: Deal[] = [];
    const mergedNames: string[] = [];
    let failed = 0;
    for (let i = 0; i < allDeals.length; i++) {
      setImportProgress({ current: i + 1, total: allDeals.length });
      try {
        const result = await apiImportDeal(allDeals[i]);
        // For merged deals, update the local deal id to match the existing one
        const deal = result.merged
          ? { ...allDeals[i], id: result.id }
          : allDeals[i];
        succeeded.push(deal);
        if (result.merged) mergedNames.push(result.propertyName || allDeals[i].propertyName || "");
      } catch (err) {
        console.warn("[json import] failed:", allDeals[i].propertyName, err instanceof Error ? err.message : err);
        failed++;
      }
    }

    if (succeeded.length > 0 && onDealsAdded) onDealsAdded(succeeded);

    setImportProgress({ current: allDeals.length, total: allDeals.length, done: succeeded.length, failed, mergedNames });
    setTimeout(() => setImportProgress(null), mergedNames.length > 0 ? 6000 : 3500);
  };

  const exportCSV = () => {
    const cols: [string, (d: Deal) => string][] = [
      ["Property", d => d.propertyName || d.fileName || ""],
      ["Status", d => d.status || ""],
      ["Asset Type", d => (d as any).assetType || ""],
      ["Market", d => (d as any).market || ""],
      ["Address", d => (d as any).address || ""],
      ["Asking Price", d => String((d as any).askingPrice || "")],
      ["Cap Rate", d => String((d as any).capRate || "")],
      ["NOI", d => String((d as any).noi || "")],
      ["Total SF", d => String((d as any).totalSF || "")],
      ["Occupancy", d => String((d as any).occupancy || "")],
      ["WALT", d => String((d as any).walt || "")],
      ["Uploaded", d => d.uploadedAt ? new Date(d.uploadedAt).toLocaleDateString() : ""],
    ];
    const header = cols.map(([h]) => h).join(",");
    const rows = active.map(d => cols.map(([, fn]) => `"${fn(d).replace(/"/g, '""')}"`).join(","));
    const csv = [header, ...rows].join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = `kpr-deals-${new Date().toISOString().slice(0,10)}.csv`;
    a.click();
    setBackupMenu(false);
  };

  const handleFullBackup = async () => {
    setBackupMenu(false);
    try {
      const ids = deals.map(d => d.id);
      const [sourcePairs, imagePairs] = await Promise.all([
        Promise.all(ids.map(id => apiLoadSource(id).then(t => [id, t] as const).catch(() => [id, null] as const))),
        Promise.all(ids.map(id => apiLoadImages(id).then(img => [id, img] as const).catch(() => [id, null] as const))),
      ]);
      const sources: Record<string, string> = {};
      for (const [id, t] of sourcePairs) if (t) sources[id] = t;
      const images: Record<string, unknown> = {};
      for (const [id, img] of imagePairs) if (img) images[id] = img;

      const payload = {
        app: "KPR Deal Intelligence",
        schema: 2,
        exportedAt: new Date().toISOString(),
        dealCount: deals.length,
        deals,
        sources,
        images,
      };
      const a = document.createElement("a");
      a.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" }));
      a.download = `kpr-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
    } catch (err) {
      alert("Backup failed: " + (err instanceof Error ? err.message : "error"));
    }
  };

  const handleRestore = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (e.target) e.target.value = "";
    if (!file) return;
    setRestoreBusy(true);
    setRestoreResult(null);
    try {
      const raw = JSON.parse(await file.text());
      const incoming: Deal[] = Array.isArray(raw) ? raw : Array.isArray(raw.deals) ? raw.deals : [];
      if (incoming.length === 0) {
        setRestoreResult("No deals found in that file.");
        setRestoreBusy(false);
        return;
      }
      const existingIds = new Set(deals.map(d => d.id));
      const added = incoming.filter(d => d.id && !existingIds.has(d.id)).length;
      const updated = incoming.filter(d => d.id && existingIds.has(d.id)).length;

      const restoreMsg = `Restore ${incoming.length} deal(s) from this backup?\n\n${updated} will overwrite existing deals.\n${added} will be added.\nExisting deals are never deleted by a restore.\n\nContinue?`;
      if (!window.confirm(restoreMsg)) {
        setRestoreBusy(false);
        return;
      }

      await apiCreateSnapshot("before-restore").catch(() => {});

      await Promise.all(incoming.filter(d => !!d.id).map(d => apiSaveDeal(d).catch(() => {})));

      const srcMap: Record<string, string> = (raw && typeof raw === "object" && !Array.isArray(raw)) ? (raw.sources || {}) : {};
      const imgMap: Record<string, unknown> = (raw && typeof raw === "object" && !Array.isArray(raw)) ? (raw.images || {}) : {};

      await Promise.all([
        ...Object.entries(srcMap).map(([id, text]) =>
          typeof text === "string" ? apiSaveSource(id, text).catch(() => {}) : Promise.resolve()
        ),
        ...Object.entries(imgMap).map(([id, bundle]) =>
          bundle ? apiSaveImages(id, bundle as ImageBundle).catch(() => {}) : Promise.resolve()
        ),
      ]);

      const total = deals.length + added;
      setRestoreResult(`Restored — ${added} added, ${updated} updated, ${total} total.`);
      setTimeout(() => window.location.reload(), 2200);
    } catch {
      setRestoreResult("Restore failed — make sure the file is a valid KPR backup (.json).");
    }
    setRestoreBusy(false);
  };

  const T = (isActive: boolean) => ({
    background: isActive ? "#2a2c27" : "transparent",
    border: "none",
    color: isActive ? "#f6f2ea" : "#8a8579",
    padding: "8px 17px",
    borderRadius: 9,
    cursor: "pointer" as const,
    fontSize: 13.5,
    fontWeight: isActive ? 600 : 500,
    letterSpacing: "-0.01em",
    boxShadow: isActive ? "0 6px 18px -8px rgba(42,44,39,0.6)" : "none",
    fontFamily: "'Inter',sans-serif",
  });

  const menuBtn = (onClick: () => void, title: string, sub: string, border = true) => (
    <button onClick={onClick}
      style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: border ? "1px solid #f1eadc" : "none", padding: "12px 14px", cursor: "pointer", fontSize: 13, fontFamily: "'Inter',sans-serif" }}
      onMouseEnter={e => e.currentTarget.style.background = "#f9f6f0"}
      onMouseLeave={e => e.currentTarget.style.background = "transparent"}>
      <div style={{ fontWeight: 600, color: "#383a37" }}>{title}</div>
      <div style={{ fontSize: 11, color: "#a69e91", marginTop: 2 }}>{sub}</div>
    </button>
  );

  return (
    <>
    <div style={{
      borderBottom: "1px solid #e7e0d2",
      background: "rgba(252,250,245,0.92)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      paddingLeft: 28,
      display: "flex",
      alignItems: "center",
      height: 72,
      flexShrink: 0,
      position: "sticky",
      top: 0,
      zIndex: 100,
      boxShadow: "0 8px 28px -22px rgba(56,58,55,0.55)",
    }}>
      {/* Logo + wordmark — anchored, never scrolls */}
      <div style={{ display: "flex", alignItems: "center", gap: 11, flexShrink: 0 }}>
        <img
          src="https://kprcenters.com/wp-content/uploads/2018/11/KPR_logo_cmyk.png"
          alt="KPR Centers"
          onClick={handleLogoClick}
          style={{ height: 28, width: "auto", display: "block", cursor: "default" }}
          onError={e => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
            const sib = e.currentTarget.nextElementSibling as HTMLElement;
            if (sib) sib.style.display = "flex";
          }}
        />
        <div style={{ display: "none", alignItems: "center", gap: 8 }}>
          <div style={{ width: 8, height: 8, background: "#6dba43", borderRadius: "50%", boxShadow: "0 0 0 3px #6dba4326" }} />
          <span style={{ fontFamily: "'Fraunces',serif", fontWeight: 600, fontSize: 18, color: "#2a2c27", letterSpacing: "-0.01em" }}>KPR Centers</span>
        </div>
        <span className="deal-intel-label" style={{ fontSize: 9, color: "#958d80", letterSpacing: "0.22em", borderLeft: "1px solid #e3dccd", paddingLeft: 11, fontWeight: 600, textTransform: "uppercase" }}>Deal Intelligence</span>
        <style>{`@media (max-width: 640px) { .deal-intel-label { display: none; } }`}</style>
      </div>

      {/* Scrollable zone: tabs + action buttons — swipeable on mobile */}
      <div style={{
        display: "flex", alignItems: "center", flex: 1, minWidth: 0,
        overflowX: "auto", WebkitOverflowScrolling: "touch" as React.CSSProperties["WebkitOverflowScrolling"],
        scrollbarWidth: "none" as React.CSSProperties["scrollbarWidth"],
        paddingLeft: 28,
      }}>
        {/* Nav tabs */}
        <div style={{ display: "flex", gap: 2, flexShrink: 0 }}>
          <button style={T(tab === "analyst")} onClick={() => onTab("analyst")}>Analyst</button>
          <button style={T(tab === "portfolio")} onClick={() => onTab("portfolio")}>
            Portfolio{active.length > 0 ? ` (${active.length})` : ""}
          </button>
          <div ref={pAnalyticsRef} style={{ position: "relative", display: "inline-flex" }}>
            <button style={T(tab === "analytics")} onClick={() => {
              if (pAnalyticsRef.current) setAnalyticsRect(pAnalyticsRef.current.getBoundingClientRect());
              setAnalyticsMenu(m => m === "portfolio" ? null : "portfolio");
            }}>Portfolio Analytics <span style={{ fontSize: 9, color: "#a69e91" }}>▾</span></button>
          </div>
          <div ref={tAnalyticsRef} style={{ position: "relative", display: "inline-flex" }}>
            <button style={T(tab === "analytics")} onClick={() => {
              if (tAnalyticsRef.current) setAnalyticsRect(tAnalyticsRef.current.getBoundingClientRect());
              setAnalyticsMenu(m => m === "tenant" ? null : "tenant");
            }}>Tenant Analytics <span style={{ fontSize: 9, color: "#a69e91" }}>▾</span></button>
          </div>
          <button style={T(tab === "comps")} onClick={() => onTab("comps")}>Comps</button>
        </div>

        {/* Analytics nav dropdown menu (shared portal for both triggers) */}
        {analyticsMenu && analyticsRect && createPortal(
          <>
            <div onClick={() => setAnalyticsMenu(null)} style={{ position: "fixed", inset: 0, zIndex: 9000 }} />
            <div style={{
              position: "fixed", top: analyticsRect.bottom + 6, left: analyticsRect.left, zIndex: 9001,
              background: "#fff", border: "1px solid #e6dfd0", borderRadius: 10,
              boxShadow: "0 8px 28px rgba(56,58,55,0.16)", minWidth: 210, overflow: "hidden",
            }}>
              {(analyticsMenu === "portfolio"
                ? [["Portfolio Overview", "portfolio-overview"], ["Lease Rollover", "lease-rollover"]]
                : [["Tenant Analytics", "tenant-list"], ["Retailer Watchlist", "watchlist"], ["Tenant Name Audit", "tenant-audit"], ["Link Tenants", "link-tenants"]]
              ).map(([label, dest], i, arr) => (
                <button key={dest} onClick={() => { setAnalyticsMenu(null); onAnalyticsNav?.(dest); }}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: i < arr.length - 1 ? "1px solid #f1eadc" : "none", padding: "11px 14px", cursor: "pointer", fontSize: 13, fontFamily: "'Inter',sans-serif", color: "#383a37", fontWeight: 600, whiteSpace: "nowrap" }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#f9f6f0")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                  {label}
                </button>
              ))}
            </div>
          </>,
          document.body
        )}

        {/* Spacer pushes buttons to right on desktop; collapses on mobile */}
        <div style={{ flex: 1, minWidth: 16 }} />

        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, paddingRight: 28 }}>
        {queueLen > 0 && (
          <span style={{ fontSize: 11, color: "#d9890c", fontWeight: 600 }}>⏳ {queueLen} processing…</span>
        )}

        {/* Hidden inputs */}
        <input ref={fileRef} type="file" accept=".pdf,.xlsx,.xls,.xlsm,.xlsb,.csv" multiple style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />
        <input ref={folderRef} type="file" multiple style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />
        <input ref={restoreRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleRestore} />
        <input ref={jsonRef} type="file" accept=".json" multiple style={{ display: "none" }} onChange={handleJsonFiles} />

        {/* Today's Rates */}
        <button onClick={() => setRatesOpen(true)} title="Today's benchmark interest rates"
          style={{ background: "#fff", border: "1px solid #d9d2c4", color: "#5c5047", padding: "8px 13px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap" }}>
          📈 Today's Rates
        </button>
        {ratesOpen && <RatesPanel onClose={() => setRatesOpen(false)} />}

        {/* Upload OMs split button */}
        <div ref={uploadTriggerRef} style={{ position: "relative", display: "flex", borderRadius: 8, boxShadow: "0 1px 3px rgba(109,186,67,0.4)" }}>
          <button
            onClick={() => fileRef.current?.click()}
            style={{ background: "#6dba43", border: "none", color: "#1f2b16", padding: "8px 15px", borderRadius: "8px 0 0 8px", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Inter',sans-serif" }}>
            Upload
          </button>
          <button
            onClick={() => {
              if (!uploadMenu && uploadTriggerRef.current) {
                setUploadRect(uploadTriggerRef.current.getBoundingClientRect());
              }
              setUploadMenu(m => !m);
            }}
            style={{ background: "#6dba43", border: "none", borderLeft: "1px solid rgba(31,43,22,0.22)", color: "#1f2b16", padding: "8px 9px", borderRadius: "0 8px 8px 0", cursor: "pointer", fontSize: 10, fontWeight: 700 }}>
            ▾
          </button>
        </div>

        {uploadMenu && uploadRect && createPortal(
          <>
            <div onClick={() => setUploadMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9000 }} />
            <div style={{
              position: "fixed",
              top: uploadRect.bottom + 6,
              right: window.innerWidth - uploadRect.right,
              zIndex: 9001,
              background: "#fff", border: "1px solid #e6dfd0", borderRadius: 10,
              boxShadow: "0 8px 28px rgba(56,58,55,0.16)", width: 220, overflow: "hidden"
            }}>
              <button onClick={() => { setUploadMenu(false); fileRef.current?.click(); }}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid #f1eadc", padding: "11px 14px", cursor: "pointer", fontSize: 13, fontFamily: "'Inter',sans-serif" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f9f6f0")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <div style={{ fontWeight: 600, color: "#383a37" }}>Upload files…</div>
                <div style={{ fontSize: 11, color: "#a69e91", marginTop: 2 }}>Pick one or more PDFs</div>
              </button>
              <button onClick={() => { setUploadMenu(false); folderRef.current?.click(); }}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid #f1eadc", padding: "11px 14px", cursor: "pointer", fontSize: 13, fontFamily: "'Inter',sans-serif" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f9f6f0")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <div style={{ fontWeight: 600, color: "#383a37" }}>Import a folder…</div>
                <div style={{ fontSize: 11, color: "#a69e91", marginTop: 2 }}>Scan a whole folder of OMs</div>
              </button>
              <button onClick={() => { setUploadMenu(false); jsonRef.current?.click(); }}
                style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "11px 14px", cursor: "pointer", fontSize: 13, fontFamily: "'Inter',sans-serif" }}
                onMouseEnter={e => (e.currentTarget.style.background = "#f9f6f0")}
                onMouseLeave={e => (e.currentTarget.style.background = "transparent")}>
                <div style={{ fontWeight: 600, color: "#3f7a1f" }}>Upload .json deal(s)</div>
                <div style={{ fontSize: 11, color: "#a69e91", marginTop: 2 }}>Pre-extracted deals from Claude — no API tokens used</div>
              </button>
            </div>
          </>,
          document.body
        )}

        {/* Members (account approvals) — admin only */}
        {isAdmin && (
          <div style={{ position: "relative", display: "inline-flex" }}>
            <button onClick={() => { setMembersOpen(true); setUploadFails(0); }}
              style={{ background: "#fff", border: "1px solid #ddd4c2", color: "#52554e", padding: "8px 13px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>
              Members
            </button>
            {uploadFails > 0 && (
              <span title={`${uploadFails} failed upload${uploadFails === 1 ? "" : "s"} in the last 24h`}
                style={{ position: "absolute", top: -6, right: -6, minWidth: 17, height: 17, padding: "0 4px", boxSizing: "border-box", background: "#c0392b", color: "#fff", borderRadius: 9, fontSize: 10, fontWeight: 700, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Inter',sans-serif", border: "2px solid #faf7f0" }}>
                {uploadFails}
              </span>
            )}
          </div>
        )}
        {membersOpen && <Members onClose={() => setMembersOpen(false)} />}

        {/* Backup menu — admin only */}
        {isAdmin && <div ref={backupTriggerRef} style={{ position: "relative" }}>
          <button
            onClick={() => {
              if (!backupMenu) {
                if (backupTriggerRef.current) setBackupRect(backupTriggerRef.current.getBoundingClientRect());
                apiListFeedback()
                  .then(list => setFeedbackUnresolved(list.filter(f => !f.resolved).length))
                  .catch(() => {});
              }
              setBackupMenu(m => !m);
            }}
            disabled={restoreBusy}
            style={{ background: "#fff", border: "1px solid #ddd4c2", color: "#52554e", padding: "8px 13px", borderRadius: 8, cursor: restoreBusy ? "default" : "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, fontFamily: "'Inter',sans-serif", opacity: restoreBusy ? 0.7 : 1 }}>
            {restoreBusy ? "Restoring…" : "Backup"} <span style={{ fontSize: 9, color: "#a69e91" }}>▾</span>
          </button>
          {restoreResult && (
            <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, background: restoreResult.startsWith("Restore failed") ? "#fef2f2" : "#f0fdf4", border: `1px solid ${restoreResult.startsWith("Restore failed") ? "#fecaca" : "#bbf7d0"}`, borderRadius: 9, padding: "10px 14px", fontSize: 12, color: restoreResult.startsWith("Restore failed") ? "#b91c1c" : "#166534", whiteSpace: "nowrap", boxShadow: "0 4px 16px rgba(56,58,55,0.12)" }}>
              {restoreResult}
            </div>
          )}
        </div>}

        {isAdmin && backupMenu && backupRect && createPortal(
          <>
            <div onClick={() => setBackupMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 9000 }} />
            <div style={{
              position: "fixed",
              top: backupRect.bottom + 6,
              right: window.innerWidth - backupRect.right,
              zIndex: 9001,
              background: "#fff", border: "1px solid #e6dfd0", borderRadius: 10,
              boxShadow: "0 8px 28px rgba(56,58,55,0.16)", width: 260, overflow: "hidden"
            }}>
              {menuBtn(handleFullBackup, "Full backup (.json)", `All deals, sources & images · ${deals.length} deal${deals.length !== 1 ? "s" : ""}`)}
              {menuBtn(exportCSV, "Export spreadsheet (.csv)", "Key fields for Excel")}
              {menuBtn(() => { setBackupMenu(false); setRestoreResult(null); restoreRef.current?.click(); }, "Restore from backup (.json)", "Merge by deal id — never deletes existing deals")}
              {menuBtn(openSnapshotModal, "Restore a snapshot…", "Auto-saved before imports, deletes & restores")}
              {menuBtn(openFeedbackInbox, `Feedback${feedbackUnresolved ? ` (${feedbackUnresolved})` : ""}`, "Bug reports, ideas & comments", false)}
            </div>
          </>,
          document.body
        )}

        <button
          type="button"
          onClick={onHelpOpen}
          aria-label="Open tutorial"
          style={{ background:"#4f7aac", border:"none", color:"#fff", padding:"7px 13px", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600, fontFamily:"'Inter',sans-serif", flexShrink:0 }}
          onMouseEnter={e => (e.currentTarget.style.background = "#3f6595")}
          onMouseLeave={e => (e.currentTarget.style.background = "#4f7aac")}
          onFocus={e => (e.currentTarget.style.outline = "2px solid #4f7aac", e.currentTarget.style.outlineOffset = "2px")}
          onBlur={e => (e.currentTarget.style.outline = "none")}
        >Tutorial</button>

        <span style={{ width: 1, height: 24, background: "#e3dccd" }} />

        <button onClick={() => setPwOpen(true)}
          style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#a89f8f", padding: "6px 11px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", letterSpacing: "0.04em" }}>
          Change password
        </button>
        {pwOpen && <ChangePassword onClose={() => setPwOpen(false)} />}

        {onLogout && (
          <button onClick={onLogout}
            style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#a89f8f", padding: "6px 11px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", letterSpacing: "0.04em" }}>
            Sign out
          </button>
        )}
        </div>
      </div>
    </div>

    {importProgress && createPortal(
      <div style={{
        position: "fixed",
        bottom: 24,
        right: 24,
        zIndex: 9500,
        background: "#fff",
        border: "1px solid #e3dccd",
        borderLeft: importProgress.failed && importProgress.failed > 0 ? "3px solid #d9890c" : "3px solid #6dba43",
        borderRadius: 10,
        padding: "12px 18px",
        boxShadow: "0 12px 36px rgba(56,58,55,0.18)",
        fontSize: 12,
        fontFamily: "'Inter',sans-serif",
        color: "#383a37",
        maxWidth: 320,
      }}>
        {importProgress.done !== undefined ? (
          <div>
            <div style={{ fontWeight: 700, marginBottom: 2 }}>
              {importProgress.failed && importProgress.failed > 0
                ? `Imported ${importProgress.done} · ${importProgress.failed} failed`
                : `✓ Imported ${importProgress.done} deal${importProgress.done !== 1 ? "s" : ""}`}
            </div>
            {importProgress.failed && importProgress.failed > 0 ? (
              <div style={{ fontSize: 11, color: "#a69e91" }}>Check console for details</div>
            ) : null}
            {importProgress.mergedNames && importProgress.mergedNames.length > 0 ? (
              <div style={{ marginTop: 6, borderTop: "1px solid #f1eadc", paddingTop: 6 }}>
                {importProgress.mergedNames.map(name => (
                  <div key={name} style={{ fontSize: 11, color: "#3f7a1f", lineHeight: 1.45 }}>
                    <strong>{name}</strong> updated — tenant roster, financials, and red flags refreshed. Your notes and deal info were preserved.
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : (
          <div>
            <div style={{ fontWeight: 600, marginBottom: 6 }}>Importing deal {importProgress.current} of {importProgress.total}…</div>
            <div style={{ background: "#f0f0ec", borderRadius: 4, height: 4, overflow: "hidden" }}>
              <div style={{ background: "#6dba43", height: "100%", width: `${(importProgress.current / importProgress.total) * 100}%`, transition: "width 0.2s" }} />
            </div>
          </div>
        )}
      </div>,
      document.body
    )}

    {adminPrompt && createPortal(
      <>
        <div
          onClick={() => setAdminPrompt(false)}
          style={{ position: "fixed", inset: 0, zIndex: 9800, background: "rgba(38,40,31,0.35)" }}
        />
        <div style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          zIndex: 9801, background: "#fff", border: "1px solid #e6dfd0", borderRadius: 12,
          boxShadow: "0 16px 48px rgba(56,58,55,0.22)", padding: "24px 28px", width: 300, maxWidth: "90vw",
          fontFamily: "'Inter',sans-serif",
        }}>
          <input
            type="password"
            value={adminPw}
            onChange={e => { setAdminPw(e.target.value); setAdminError(null); }}
            onKeyDown={e => { if (e.key === "Enter") handleAdminUnlock(); if (e.key === "Escape") setAdminPrompt(false); }}
            placeholder="Password"
            autoFocus
            style={{
              width: "100%", boxSizing: "border-box", padding: "9px 12px",
              border: adminError ? "1px solid #fca5a5" : "1px solid #e3dccd",
              borderRadius: 8, fontSize: 13.5, fontFamily: "'Inter',sans-serif",
              color: "#383a37", outline: "none",
            }}
          />
          {adminError && (
            <div style={{ fontSize: 11, color: "#b91c1c", marginTop: 6 }}>{adminError}</div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 14, justifyContent: "flex-end" }}>
            <button
              onClick={() => setAdminPrompt(false)}
              style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "7px 14px", borderRadius: 7, cursor: "pointer", fontSize: 12, fontFamily: "'Inter',sans-serif" }}
            >Cancel</button>
            <button
              onClick={handleAdminUnlock}
              disabled={adminSubmitting || !adminPw.trim()}
              style={{ background: adminPw.trim() && !adminSubmitting ? "#26281f" : "#e3dccd", border: "none", color: adminPw.trim() && !adminSubmitting ? "#e8e0cf" : "#a89f8f", padding: "7px 18px", borderRadius: 7, cursor: adminPw.trim() && !adminSubmitting ? "pointer" : "default", fontSize: 12, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}
            >{adminSubmitting ? "…" : "Unlock"}</button>
          </div>
        </div>
      </>,
      document.body
    )}

    {feedbackModal && createPortal(
      <>
        <div
          onClick={() => setFeedbackModal(false)}
          style={{ position: "fixed", inset: 0, zIndex: 9100, background: "rgba(38,40,31,0.38)" }}
        />
        <div style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          zIndex: 9101, background: "#fff", border: "1px solid #e6dfd0", borderRadius: 14,
          boxShadow: "0 16px 48px rgba(56,58,55,0.22)", width: 580, maxWidth: "92vw",
          maxHeight: "75vh", display: "flex", flexDirection: "column", overflow: "hidden",
          fontFamily: "'Inter',sans-serif",
        }}>
          <div style={{ padding: "18px 22px 13px", borderBottom: "1px solid #f1eadc", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 19, fontWeight: 500, color: "#26281f" }}>
                Feedback inbox
                {feedbackUnresolved != null && feedbackUnresolved > 0 && (
                  <span style={{ marginLeft: 10, background: "#6dba43", color: "#fff", borderRadius: 10, fontSize: 11, fontWeight: 700, padding: "2px 8px", fontFamily: "'Inter',sans-serif", verticalAlign: "middle" }}>
                    {feedbackUnresolved}
                  </span>
                )}
              </div>
              <div style={{ fontSize: 12, color: "#9a917f", marginTop: 3 }}>Submitted via the feedback button. Unresolved items shown first.</div>
            </div>
            <button onClick={() => setFeedbackModal(false)} style={{ background: "none", border: "none", color: "#b0a898", cursor: "pointer", fontSize: 22, lineHeight: 1, padding: 0 }}>×</button>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {feedbackLoading ? (
              <div style={{ padding: "28px 22px", textAlign: "center", color: "#a89f8f", fontSize: 13 }}>Loading…</div>
            ) : feedbackList.length === 0 ? (
              <div style={{ padding: "28px 22px", textAlign: "center", color: "#a89f8f", fontSize: 13 }}>No feedback yet.</div>
            ) : feedbackList.map((f, i) => {
              const date = new Date(f.createdAt).toLocaleString(undefined, {
                month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit",
              });
              const typeColors: Record<string, { bg: string; color: string }> = {
                bug: { bg: "#fef2f2", color: "#b91c1c" },
                idea: { bg: "#eff6ff", color: "#1d4ed8" },
                other: { bg: "#f5f5f4", color: "#57534e" },
              };
              const tc = typeColors[f.type.toLowerCase()] ?? typeColors.other;
              return (
                <div key={f.id} style={{
                  padding: "13px 22px",
                  borderBottom: i < feedbackList.length - 1 ? "1px solid #f5efe2" : "none",
                  opacity: f.resolved ? 0.55 : 1,
                }}>
                  <div style={{ display: "flex", alignItems: "flex-start", gap: 10, marginBottom: 6 }}>
                    <span style={{ background: tc.bg, color: tc.color, fontSize: 10, fontWeight: 700, padding: "2px 8px", borderRadius: 6, textTransform: "uppercase", letterSpacing: "0.05em", flexShrink: 0 }}>
                      {f.type}
                    </span>
                    <span style={{ fontSize: 12, color: "#a89f8f", flexShrink: 0 }}>
                      {f.name || "anonymous"} · {f.page || "unknown page"} · {date}
                    </span>
                  </div>
                  <div style={{ fontSize: 13, color: "#383a37", lineHeight: 1.55, marginBottom: 8, whiteSpace: "pre-wrap" }}>{f.message}</div>
                  {/* Email status chip */}
                  {(() => {
                    const es = f.emailStatus;
                    if (!es) return null;
                    if (es === "sent") return (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f0fdf4", border: "1px solid #bbf7d0", color: "#16a34a", borderRadius: 6, padding: "2px 8px", fontSize: 10.5, fontWeight: 600, marginBottom: 8 }}>
                        ✓ emailed
                      </div>
                    );
                    if (es === "skipped") return (
                      <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#f5f5f4", border: "1px solid #e7e5e4", color: "#78716c", borderRadius: 6, padding: "2px 8px", fontSize: 10.5, fontWeight: 600, marginBottom: 8 }}>
                        email skipped
                      </div>
                    );
                    if (es === "failed") return (
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ display: "inline-flex", alignItems: "center", gap: 4, background: "#fef2f2", border: "1px solid #fecaca", color: "#b91c1c", borderRadius: 6, padding: "2px 8px", fontSize: 10.5, fontWeight: 600 }}>
                          ✕ email failed
                        </div>
                        {f.emailError && (
                          <div style={{ marginTop: 4, fontSize: 10.5, color: "#b91c1c", fontFamily: "'Inter',monospace", background: "#fef2f2", padding: "4px 8px", borderRadius: 4, wordBreak: "break-all" }}>
                            {f.emailError}
                          </div>
                        )}
                      </div>
                    );
                    return null;
                  })()}
                  <button
                    onClick={() => handleToggleResolved(f.id, !f.resolved)}
                    style={{
                      background: "transparent",
                      border: "1px solid #ddd4c2",
                      color: f.resolved ? "#6dba43" : "#7d766a",
                      padding: "4px 12px",
                      borderRadius: 6,
                      cursor: "pointer",
                      fontSize: 11,
                      fontFamily: "'Inter',sans-serif",
                      fontWeight: 600,
                    }}
                  >
                    {f.resolved ? "✓ Resolved — Reopen" : "Mark resolved"}
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ padding: "10px 22px", borderTop: "1px solid #f1eadc", flexShrink: 0 }}>
            <button onClick={() => setFeedbackModal(false)} style={{ background: "transparent", border: "1px solid #ddd4c2", color: "#7d766a", padding: "5px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif" }}>Close</button>
          </div>
        </div>
      </>,
      document.body
    )}

    {snapshotModal && createPortal(
      <>
        <div
          onClick={() => setSnapshotModal(false)}
          style={{ position: "fixed", inset: 0, zIndex: 9100, background: "rgba(38,40,31,0.38)" }}
        />
        <div style={{
          position: "fixed", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          zIndex: 9101, background: "#fff", border: "1px solid #e6dfd0", borderRadius: 14,
          boxShadow: "0 16px 48px rgba(56,58,55,0.22)", width: 540, maxWidth: "90vw",
          maxHeight: "72vh", display: "flex", flexDirection: "column", overflow: "hidden",
        }}>
          <div style={{ padding: "18px 22px 13px", borderBottom: "1px solid #f1eadc", flexShrink: 0 }}>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 19, fontWeight: 500, color: "#26281f" }}>Restore a snapshot</div>
            <div style={{ fontSize: 12, color: "#9a917f", marginTop: 4, lineHeight: 1.5 }}>
              Snapshots are taken automatically before imports, deletes, and restores. Restoring is additive — it never removes existing deals.
            </div>
          </div>
          <div style={{ overflowY: "auto", flex: 1 }}>
            {snapshotLoading ? (
              <div style={{ padding: "28px 22px", textAlign: "center", color: "#a89f8f", fontSize: 13 }}>Loading…</div>
            ) : snapshots.length === 0 ? (
              <div style={{ padding: "28px 22px", textAlign: "center", color: "#a89f8f", fontSize: 13 }}>
                No snapshots yet. They are created automatically before major changes.
              </div>
            ) : snapshots.map((snap, i) => {
              const label = SNAPSHOT_LABELS[snap.reason] ?? snap.reason;
              const date = new Date(snap.createdAt).toLocaleString(undefined, {
                month: "short", day: "numeric", year: "numeric",
                hour: "numeric", minute: "2-digit",
              });
              const isRestoring = snapshotRestoring === snap.id;
              return (
                <div key={snap.id} style={{
                  display: "flex", alignItems: "center", gap: 14,
                  padding: "11px 22px",
                  borderBottom: i < snapshots.length - 1 ? "1px solid #f5efe2" : "none",
                }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#383a37", fontFamily: "'Inter',sans-serif" }}>{label}</div>
                    <div style={{ fontSize: 11, color: "#a89f8f", marginTop: 2, fontFamily: "'Inter',sans-serif" }}>
                      {date} · {snap.dealCount} deal{snap.dealCount !== 1 ? "s" : ""}
                    </div>
                  </div>
                  <button
                    onClick={() => handleSnapshotRestore(snap)}
                    disabled={snapshotRestoring !== null}
                    style={{
                      background: isRestoring ? "#f6f2ea" : "transparent",
                      border: "1px solid #ddd4c2",
                      color: isRestoring ? "#a89f8f" : "#52554e",
                      padding: "5px 14px", borderRadius: 6,
                      cursor: snapshotRestoring !== null ? (isRestoring ? "wait" : "default") : "pointer",
                      fontSize: 11, fontFamily: "'Inter',sans-serif", fontWeight: 600,
                      whiteSpace: "nowrap", flexShrink: 0,
                    }}
                  >
                    {isRestoring ? "Restoring…" : "Restore"}
                  </button>
                </div>
              );
            })}
          </div>
          <div style={{ padding: "10px 22px", borderTop: "1px solid #f1eadc", flexShrink: 0 }}>
            <button
              onClick={() => setSnapshotModal(false)}
              style={{ background: "transparent", border: "1px solid #ddd4c2", color: "#7d766a", padding: "5px 14px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif" }}
            >Close</button>
          </div>
        </div>
      </>,
      document.body
    )}
    </>
  );
}
