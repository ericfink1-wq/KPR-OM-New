import { useState } from "react";

// Generates a PDF on click by dynamically importing @react-pdf + the document
// component — keeps the heavy PDF engine out of every page's initial load. Shared
// by the deal page (rent roll) and the tenant / parent-company roll-up pages.
export default function PdfDownloadButton({ fileName, makeDoc, render, onError }: {
  fileName: string;
  makeDoc: () => Promise<React.ReactElement>;
  render: (busy: boolean) => React.ReactNode;
  onError?: (message: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const onClick = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const [{ pdf }, doc] = await Promise.all([import("@react-pdf/renderer"), makeDoc()]);
      const blob = await pdf(doc as Parameters<typeof pdf>[0]).toBlob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = fileName; a.click();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    } catch {
      // Never fail silently — the user is standing there waiting for a download.
      onError?.("Couldn't build the PDF. Try again, or use the Excel export.");
    } finally { setBusy(false); }
  };
  return <span onClick={onClick} style={{ display: "contents", cursor: "pointer" }}>{render(busy)}</span>;
}

/** Safe filename fragment for a download. */
export function safeFileName(s: string, max = 80): string {
  return String(s || "export").replace(/[/\\?%*:|"<>]/g, "-").replace(/\s+/g, "_").slice(0, max);
}

// Paired PDF + Excel export controls. Sits on the tenant / parent-company roll-up
// pages so a page can be shared without screenshotting it. Wraps on narrow screens.
export function ExportButtons({ fileName, makeDoc, onExcel, disabled }: {
  fileName: string;
  makeDoc: () => Promise<React.ReactElement>;
  onExcel: () => void;
  disabled?: boolean;
}) {
  const [err, setErr] = useState<string | null>(null);
  const base: React.CSSProperties = {
    padding: "5px 12px", borderRadius: 7, fontSize: 11.5, fontWeight: 600,
    fontFamily: "'Inter',sans-serif", cursor: disabled ? "not-allowed" : "pointer",
    opacity: disabled ? 0.45 : 1, display: "inline-flex", alignItems: "center", gap: 5,
    whiteSpace: "nowrap", lineHeight: 1.6,
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
      {err && <span style={{ fontSize: 11, color: "#b3261e" }}>{err}</span>}
      <button
        onClick={() => { if (!disabled) { setErr(null); try { onExcel(); } catch { setErr("Excel export failed."); } } }}
        disabled={disabled}
        title="Download these locations as an Excel file"
        style={{ ...base, background: "#eafaf0", border: "1px solid #b7e4c7", color: "#1f6f43" }}
      >
        ⬇ Excel
      </button>
      {disabled ? (
        <span style={{ ...base, background: "#2a2c27", border: "1px solid #2a2c27", color: "#fff" }}>⬇ PDF</span>
      ) : (
        <PdfDownloadButton
          fileName={fileName}
          makeDoc={makeDoc}
          onError={setErr}
          render={(busy) => (
            <span title="Download a branded one-page PDF of this view"
              style={{ ...base, background: "#2a2c27", border: "1px solid #2a2c27", color: "#fff" }}>
              {busy ? "Preparing…" : "⬇ PDF"}
            </span>
          )}
        />
      )}
    </span>
  );
}
