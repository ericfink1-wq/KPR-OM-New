import { useState } from "react";
import type { DealUploader, UploadHistoryEntry } from "../lib/api";
import { DOC_TYPE_LABEL, type DocType } from "../lib/docClassify";

// Per-deal Upload history (Eric, 10/19/26): every file uploaded against this deal — what
// it was, what it did, who, when — so "who uploaded this?" is never a guess. From the
// upload log; newest first. A file that was turned away ("Not an OM — not added") is
// never tied to a deal, so it only shows in the site-wide Upload log.
export const RESULT_STYLE: Record<string, { label: string; color: string; bg: string }> = {
  created: { label: "Created deal", color: "#2f6b1c", bg: "#ecf6e5" },
  attached: { label: "Added to deal", color: "#1d5f8a", bg: "#e8f1f8" },
  skipped: { label: "Skipped", color: "#676767", bg: "#efede6" },
  rejected: { label: "Not added", color: "#8a5a08", bg: "#f8efdc" },
  failed: { label: "Failed", color: "#a1361f", bg: "#fbece8" },
};
export const docTypeLabel = (t: string | null | undefined) => (t && (DOC_TYPE_LABEL as Record<string, string>)[t as DocType]) || (t ? t : "—");
export const whoOf = (p: { userName: string | null; userEmail: string | null } | null | undefined) => p ? (p.userName || p.userEmail || "Unknown") : "Unknown";
export const fmtWhen = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleString(undefined, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
  : "";

export default function UploadHistoryCard({ data }: { data: DealUploader | null }) {
  const [open, setOpen] = useState(false);
  const hist: UploadHistoryEntry[] = data?.history ?? [];
  if (!hist.length) return null;
  const shown = open ? hist : hist.slice(0, 3);
  return (
    <div style={{ background: "#fff", border: "1px solid #dfddd6", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontSize: 9, letterSpacing: "0.16em", textTransform: "uppercase", fontWeight: 700, color: "#6b6a65" }}>Upload history</div>
        <div style={{ fontSize: 11, color: "#9b9992" }}>
          {data?.createdBy ? <>Created by <b style={{ color: "#383a37" }}>{whoOf(data.createdBy)}</b> · {fmtWhen(data.createdBy.at)}</> : "Created before upload tracking"}
        </div>
      </div>
      <div style={{ display: "flex", flexDirection: "column", marginTop: 8 }}>
        {shown.map(h => {
          const r = RESULT_STYLE[h.result] ?? RESULT_STYLE.attached;
          return (
            <div key={h.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "baseline", columnGap: 10, rowGap: 3, padding: "7px 0", borderTop: "1px solid #f1efe9", fontSize: 12.5 }}>
              <span style={{ flex: "1 1 240px", minWidth: 0, color: "#232422", overflowWrap: "break-word" }} title={h.detail || ""}>{h.fileName || "(file)"}</span>
              <span style={{ fontSize: 10, fontWeight: 700, color: "#676767", background: "#f3f2ee", padding: "2px 7px", borderRadius: 4, textTransform: "uppercase", letterSpacing: "0.04em", whiteSpace: "nowrap" }}>{docTypeLabel(h.docType)}</span>
              <span style={{ fontSize: 10.5, fontWeight: 700, color: r.color, background: r.bg, padding: "2px 7px", borderRadius: 4, whiteSpace: "nowrap" }}>{r.label}</span>
              <span style={{ color: "#52554e", whiteSpace: "nowrap" }} title={h.userEmail || ""}>{h.userName || h.userEmail || "Unknown"}</span>
              <span style={{ color: "#9b9992", fontSize: 11.5, whiteSpace: "nowrap", fontVariantNumeric: "tabular-nums" }}>{fmtWhen(h.at)}</span>
            </div>
          );
        })}
      </div>
      {hist.length > 3 && (
        <button onClick={() => setOpen(o => !o)}
          style={{ marginTop: 6, background: "transparent", border: "none", padding: "6px 0", color: "#2c6e9b", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Roboto',sans-serif" }}>
          {open ? "Show less" : `Show all ${hist.length}`}
        </button>
      )}
    </div>
  );
}
