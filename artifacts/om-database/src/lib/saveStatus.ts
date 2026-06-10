// Tiny global save-status store. Deal saves are optimistic (the UI updates before
// the server confirms) and were previously fire-and-forget with an empty .catch —
// so a failed save vanished silently and the edit was lost on the next reload.
// This store lets a single indicator surface "saving / saved / couldn't save" and
// gives the user a Retry, without threading state through every component.

export type SaveStatus = "idle" | "saving" | "saved" | "error";

export interface SaveState {
  status: SaveStatus;
  inFlight: number;
  lastError: string | null;
  failedCount: number;
}

let state: SaveState = { status: "idle", inFlight: 0, lastError: null, failedCount: 0 };
const listeners = new Set<(s: SaveState) => void>();
// Latest failed save per deal id. Keyed by id so a newer successful save for the
// same deal clears the stale retry (a stale retry must never clobber a newer edit).
const retries = new Map<string, () => Promise<void>>();

let savedTimer: ReturnType<typeof setTimeout> | undefined;

function emit() {
  state = { ...state, failedCount: retries.size };
  for (const l of listeners) l(state);
}

export function subscribeSaveStatus(cb: (s: SaveState) => void): () => void {
  listeners.add(cb);
  cb(state);
  return () => { listeners.delete(cb); };
}

export function beginSave(): void {
  state = { ...state, inFlight: state.inFlight + 1, status: "saving" };
  emit();
}

export function endSaveOk(key: string): void {
  retries.delete(key);
  const inFlight = Math.max(0, state.inFlight - 1);
  if (inFlight === 0 && retries.size === 0) {
    state = { ...state, inFlight, status: "saved", lastError: null };
    emit();
    clearTimeout(savedTimer);
    savedTimer = setTimeout(() => {
      if (state.status === "saved") { state = { ...state, status: "idle" }; emit(); }
    }, 2000);
  } else {
    state = { ...state, inFlight, status: retries.size > 0 ? "error" : "saving" };
    emit();
  }
}

export function endSaveError(key: string, retry: () => Promise<void>, message: string): void {
  retries.set(key, retry);
  const inFlight = Math.max(0, state.inFlight - 1);
  state = { ...state, inFlight, status: "error", lastError: message };
  emit();
}

// Re-run every queued failed save. Each goes back through the normal save path, so
// success clears its retry and the indicator settles to "saved" once the queue drains.
export async function retryFailedSaves(): Promise<void> {
  const fns = [...retries.values()];
  for (const fn of fns) { try { await fn(); } catch { /* stays queued */ } }
}
