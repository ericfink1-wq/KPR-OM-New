import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { Deal, ImageBundle } from "../lib/idb";
import { apiImportDeal, apiSaveDeal, apiLoadSource, apiLoadImages, apiSaveSource, apiSaveImages } from "../lib/api";

interface Props {
  tab: string;
  onHelpOpen?: () => void;
  onTab: (t: string) => void;
  deals: Deal[];
  queueLen: number;
  onLogout?: () => void;
  onFiles: (files: FileList) => void;
  onDealsAdded?: (deals: Deal[]) => void;
}

export default function Header({ tab, onTab, deals, queueLen, onLogout, onFiles, onHelpOpen, onDealsAdded }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const restoreRef = useRef<HTMLInputElement>(null);
  const jsonRef = useRef<HTMLInputElement>(null);
  const uploadTriggerRef = useRef<HTMLDivElement>(null);
  const backupTriggerRef = useRef<HTMLDivElement>(null);
  const [backupMenu, setBackupMenu] = useState(false);
  const [uploadMenu, setUploadMenu] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const [restoreResult, setRestoreResult] = useState<string | null>(null);
  const [uploadRect, setUploadRect] = useState<DOMRect | null>(null);
  const [backupRect, setBackupRect] = useState<DOMRect | null>(null);
  const [importProgress, setImportProgress] = useState<{ current: number; total: number; done?: number; failed?: number; mergedNames?: string[] } | null>(null);

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
          style={{ height: 28, width: "auto", display: "block" }}
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
        <span style={{ fontSize: 9, color: "#958d80", letterSpacing: "0.22em", borderLeft: "1px solid #e3dccd", paddingLeft: 11, fontWeight: 600, textTransform: "uppercase" }}>Deal Intelligence</span>
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
          <button style={T(tab === "analytics")} onClick={() => onTab("analytics")}>Analytics</button>
          <button style={T(tab === "comps")} onClick={() => onTab("comps")}>Comps</button>
        </div>

        {/* Spacer pushes buttons to right on desktop; collapses on mobile */}
        <div style={{ flex: 1, minWidth: 16 }} />

        {/* Action buttons */}
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexShrink: 0, paddingRight: 28 }}>
        {queueLen > 0 && (
          <span style={{ fontSize: 11, color: "#d9890c", fontWeight: 600 }}>⏳ {queueLen} processing…</span>
        )}

        {/* Hidden inputs */}
        <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />
        <input ref={folderRef} type="file" multiple style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />
        <input ref={restoreRef} type="file" accept=".json" style={{ display: "none" }} onChange={handleRestore} />
        <input ref={jsonRef} type="file" accept=".json" multiple style={{ display: "none" }} onChange={handleJsonFiles} />

        {/* Upload OMs split button */}
        <div ref={uploadTriggerRef} style={{ position: "relative", display: "flex", borderRadius: 8, boxShadow: "0 1px 3px rgba(109,186,67,0.4)" }}>
          <button
            onClick={() => fileRef.current?.click()}
            style={{ background: "#6dba43", border: "none", color: "#1f2b16", padding: "8px 15px", borderRadius: "8px 0 0 8px", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Inter',sans-serif" }}>
            Upload OMs
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

        {/* Backup menu */}
        <div ref={backupTriggerRef} style={{ position: "relative" }}>
          <button
            onClick={() => {
              if (!backupMenu && backupTriggerRef.current) {
                setBackupRect(backupTriggerRef.current.getBoundingClientRect());
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
        </div>

        {backupMenu && backupRect && createPortal(
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
              {menuBtn(() => { setBackupMenu(false); setRestoreResult(null); restoreRef.current?.click(); }, "Restore from backup (.json)", "Merge by deal id — never deletes existing deals", false)}
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
    </>
  );
}
