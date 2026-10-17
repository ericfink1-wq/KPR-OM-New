import { useEffect } from "react";

// Drives the one-time background re-analysis from the open app (10/17/26). The live site's
// hosting only gives the server CPU while it answers a request, so a server-side timer
// barely runs; instead, while anyone has the site open and there's work left, the page asks
// the server every couple of minutes to do one bounded slice. Silent; no UI; stops itself
// when the server reports nothing left to do.
const EVERY_MS = 2 * 60_000;

export function useAnalysisRefresh(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    let stopped = false, timer: number | undefined;
    const step = async () => {
      if (stopped) return;
      try {
        // Runs in a background tab too (10/17/26: the refresh sat frozen for 30 minutes while
        // a tab was open but not in front). Browsers slow background timers to about once a
        // minute, which this 2-minute step is already under.
        const r = await fetch("/api/analysis-refresh/tick", { method: "POST", credentials: "include" });
        const j = r.ok ? await r.json() as { status?: { workPending?: boolean } } : null;
        if (j && j.status && !j.status.workPending) { stopped = true; return; }
      } catch { /* try again next round */ }
      if (!stopped) timer = window.setTimeout(step, EVERY_MS);
    };
    (async () => {
      try {
        const r = await fetch("/api/analysis-refresh/status", { credentials: "include" });
        const s = r.ok ? await r.json() as { workPending?: boolean } : null;
        if (s?.workPending) timer = window.setTimeout(step, 20_000);
      } catch { /* not signed in yet, or offline */ }
    })();
    return () => { stopped = true; if (timer) window.clearTimeout(timer); };
  }, [enabled]);
}
