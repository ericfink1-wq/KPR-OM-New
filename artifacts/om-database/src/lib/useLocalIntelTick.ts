import { useEffect } from "react";

// Advances queued Local Intel scans (after a new OM upload; the monthly re-scan of owned
// assets) from the open app — the live hosting only runs server code during a request, the
// same reason useAnalysisRefresh exists. One scan per step, every few minutes, while the
// server reports work queued. Silent; stops when the queue is empty.
const EVERY_MS = 3 * 60_000;

export function useLocalIntelTick(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, timer: number | undefined;
    const step = async () => {
      if (stopped) return;
      try {
        const r = await fetch("/api/local-intel/tick", { method: "POST", credentials: "include" });
        const j = r.ok ? await r.json() as { pending?: number; skipped?: string } : null;
        if (j && (j.skipped === "no API key" || !j.pending)) { stopped = true; return; }
      } catch { /* try again next round */ }
      if (!stopped) timer = window.setTimeout(step, EVERY_MS);
    };
    // First step soon after load: it also queues the monthly owned-asset re-scans (once a day).
    timer = window.setTimeout(step, 45_000);
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [enabled]);
}
