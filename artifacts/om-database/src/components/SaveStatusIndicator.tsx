import { useEffect, useState } from "react";
import { subscribeSaveStatus, retryFailedSaves, type SaveState } from "../lib/saveStatus";

// Fixed bottom-right pill that mirrors the global save state. Stays out of the way
// (nothing shown when idle), confirms a save briefly, and — the important part —
// makes a failed save visible with a finger-friendly Retry instead of losing the
// edit silently. Sized/positioned to clear mobile thumbs and the help panel.
export default function SaveStatusIndicator() {
  const [s, setS] = useState<SaveState>({ status: "idle", inFlight: 0, lastError: null, failedCount: 0 });
  const [retrying, setRetrying] = useState(false);

  useEffect(() => subscribeSaveStatus(setS), []);

  if (s.status === "idle") return null;

  const isError = s.status === "error";
  const isSaved = s.status === "saved";

  const bg = isError ? "#fdecec" : isSaved ? "#eef7e8" : "#fff";
  const border = isError ? "#e7b4b4" : isSaved ? "#cfe6bb" : "#e7e0d2";
  const fg = isError ? "#a33a3a" : isSaved ? "#2f6b1f" : "#6f6a5f";

  const doRetry = async () => {
    setRetrying(true);
    try { await retryFailedSaves(); } finally { setRetrying(false); }
  };

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed", right: 14, bottom: 14, zIndex: 4000,
        display: "flex", alignItems: "center", gap: 10,
        background: bg, border: `1px solid ${border}`, color: fg,
        borderRadius: 999, padding: "8px 14px",
        fontSize: 12.5, fontFamily: "'Inter',sans-serif", fontWeight: 600,
        boxShadow: "0 4px 16px rgba(0,0,0,0.12)", maxWidth: "min(92vw, 360px)",
      }}
    >
      <span style={{ display: "inline-flex", alignItems: "center", gap: 7 }}>
        {s.status === "saving" && <Spinner />}
        {isSaved && <span aria-hidden>✓</span>}
        {isError && <span aria-hidden>⚠</span>}
        <span>
          {s.status === "saving"
            ? "Saving…"
            : isSaved
              ? "All changes saved"
              : s.failedCount > 1
                ? `${s.failedCount} changes didn't save`
                : "A change didn't save"}
        </span>
      </span>
      {isError && (
        <button
          onClick={doRetry}
          disabled={retrying}
          style={{
            border: "1px solid #c98b8b", background: retrying ? "#f3dcdc" : "#fff",
            color: "#a33a3a", borderRadius: 999, padding: "5px 12px",
            fontSize: 12, fontWeight: 700, cursor: retrying ? "default" : "pointer",
            minHeight: 30,
          }}
        >
          {retrying ? "Retrying…" : "Retry"}
        </button>
      )}
    </div>
  );
}

function Spinner() {
  return (
    <span
      aria-hidden
      style={{
        width: 12, height: 12, borderRadius: "50%",
        border: "2px solid #d9d2c4", borderTopColor: "#7a7466",
        display: "inline-block", animation: "kpr-spin 0.7s linear infinite",
      }}
    >
      <style>{`@keyframes kpr-spin { to { transform: rotate(360deg); } }`}</style>
    </span>
  );
}
