import { useRef, useState } from "react";
import { STATUS_COLORS } from "../lib/constants";
import type { Deal } from "../lib/idb";

interface Props {
  tab: string;
  onTab: (t: string) => void;
  deals: Deal[];
  queueLen: number;
  onLogout?: () => void;
  onFiles: (files: FileList) => void;
}

export default function Header({ tab, onTab, deals, queueLen, onLogout, onFiles }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const [backupMenu, setBackupMenu] = useState(false);
  const [uploadMenu, setUploadMenu] = useState(false);

  const active = deals.filter(d => !d.trashedAt);
  const fresh = active.filter(d => {
    const src = (d as any).omDate || d.uploadedAt;
    if (!src) return false;
    return (Date.now() - new Date(src).getTime()) < 6 * 30.4 * 86400000;
  }).length;
  const brands = new Set(
    active.flatMap(d => ((d as any).tenants || []).map((t: any) => t.name?.toLowerCase()).filter(Boolean))
  ).size;

  const handleFiles = (fl: FileList | null) => {
    if (fl && fl.length > 0) onFiles(fl);
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

  return (
    <div style={{
      borderBottom: "1px solid #e7e0d2",
      background: "rgba(252,250,245,0.92)",
      backdropFilter: "blur(12px)",
      WebkitBackdropFilter: "blur(12px)",
      padding: "0 28px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      height: 72,
      flexShrink: 0,
      position: "sticky",
      top: 0,
      zIndex: 100,
      boxShadow: "0 8px 28px -22px rgba(56,58,55,0.55)",
    }}>
      {/* Logo + tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
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
        <div style={{ display: "flex", gap: 2 }}>
          <button style={T(tab === "analyst")} onClick={() => onTab("analyst")}>Analyst</button>
          <button style={T(tab === "portfolio")} onClick={() => onTab("portfolio")}>
            Portfolio{active.length > 0 ? ` (${active.length})` : ""}
          </button>
        </div>
      </div>

      {/* Right side: stats + upload + backup + logout */}
      <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
        <span className="hdr-stats" style={{ fontSize: 11, color: "#a69e91", letterSpacing: "0.02em" }}>
          {fresh} fresh · {brands} brands · {active.length} deals
        </span>
        {queueLen > 0 && (
          <span style={{ fontSize: 11, color: "#d9890c", fontWeight: 600 }}>⏳ {queueLen} processing…</span>
        )}

        {/* Hidden inputs */}
        <input ref={fileRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />
        <input ref={folderRef} type="file" multiple style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />

        {/* Upload OMs split button */}
        <div style={{ position: "relative", display: "flex", borderRadius: 8, boxShadow: "0 1px 3px rgba(109,186,67,0.4)" }}>
          <button
            onClick={() => fileRef.current?.click()}
            style={{ background: "#6dba43", border: "none", color: "#1f2b16", padding: "8px 15px", borderRadius: "8px 0 0 8px", cursor: "pointer", fontSize: 12, fontWeight: 700, fontFamily: "'Inter',sans-serif" }}>
            Upload OMs
          </button>
          <button
            onClick={() => setUploadMenu(m => !m)}
            style={{ background: "#6dba43", border: "none", borderLeft: "1px solid rgba(31,43,22,0.22)", color: "#1f2b16", padding: "8px 9px", borderRadius: "0 8px 8px 0", cursor: "pointer", fontSize: 10, fontWeight: 700 }}>
            ▾
          </button>
          {uploadMenu && (
            <>
              <div onClick={() => setUploadMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, background: "#fff", border: "1px solid #e6dfd0", borderRadius: 10, boxShadow: "0 8px 28px rgba(56,58,55,0.16)", width: 220, overflow: "hidden" }}>
                <button onClick={() => { setUploadMenu(false); fileRef.current?.click(); }}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid #f1eadc", padding: "11px 14px", cursor: "pointer", fontSize: 13, fontFamily: "'Inter',sans-serif" }}>
                  <div style={{ fontWeight: 600, color: "#383a37" }}>Upload files…</div>
                  <div style={{ fontSize: 11, color: "#a69e91", marginTop: 2 }}>Pick one or more PDFs</div>
                </button>
                <button onClick={() => { setUploadMenu(false); folderRef.current?.click(); }}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "11px 14px", cursor: "pointer", fontSize: 13, fontFamily: "'Inter',sans-serif" }}>
                  <div style={{ fontWeight: 600, color: "#383a37" }}>Import a folder…</div>
                  <div style={{ fontSize: 11, color: "#a69e91", marginTop: 2 }}>Scan a whole folder of OMs</div>
                </button>
              </div>
            </>
          )}
        </div>

        {/* Backup menu */}
        <div style={{ position: "relative" }}>
          <button onClick={() => setBackupMenu(m => !m)}
            style={{ background: "#fff", border: "1px solid #ddd4c2", color: "#52554e", padding: "8px 13px", borderRadius: 8, cursor: "pointer", fontSize: 12, fontWeight: 600, display: "flex", alignItems: "center", gap: 5, fontFamily: "'Inter',sans-serif" }}>
            Backup <span style={{ fontSize: 9, color: "#a69e91" }}>▾</span>
          </button>
          {backupMenu && (
            <>
              <div onClick={() => setBackupMenu(false)} style={{ position: "fixed", inset: 0, zIndex: 40 }} />
              <div style={{ position: "absolute", top: "calc(100% + 6px)", right: 0, zIndex: 41, background: "#fff", border: "1px solid #e6dfd0", borderRadius: 10, boxShadow: "0 8px 28px rgba(56,58,55,0.16)", width: 240, overflow: "hidden" }}>
                <button onClick={exportCSV}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: "1px solid #f1eadc", padding: "12px 14px", cursor: "pointer", fontSize: 13, fontFamily: "'Inter',sans-serif" }}>
                  <div style={{ fontWeight: 600, color: "#383a37" }}>Export spreadsheet</div>
                  <div style={{ fontSize: 11, color: "#a69e91", marginTop: 2 }}>Key fields for Excel (.csv)</div>
                </button>
                <button onClick={() => setBackupMenu(false)}
                  style={{ display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "12px 14px", cursor: "pointer", fontSize: 13, fontFamily: "'Inter',sans-serif" }}>
                  <div style={{ fontWeight: 600, color: "#383a37" }}>More options coming soon</div>
                  <div style={{ fontSize: 11, color: "#a69e91", marginTop: 2 }}>Full backup / restore</div>
                </button>
              </div>
            </>
          )}
        </div>

        <span style={{ width: 1, height: 24, background: "#e3dccd" }} />

        {onLogout && (
          <button onClick={onLogout}
            style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#a89f8f", padding: "6px 11px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", letterSpacing: "0.04em" }}>
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
