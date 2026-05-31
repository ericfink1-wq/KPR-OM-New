import { useState, useEffect } from "react";

// ── Global AI progress store ────────────────────────────────────────────────
// Any AI-running action (scoring, analyzing, rescoring, sale lookup, demographics,
// extraction, bulk refresh…) reports here so a single pinned progress bar at the
// app root can show that it's running, how long it's taken, and whether it
// succeeded or failed — no matter which page triggered it or where you navigate.

export type AiPhase = "running" | "done" | "error";

export interface AiTask {
  id: string;
  label: string;
  phase: AiPhase;
  startedAt: number;
  endedAt?: number;
  detail?: string;        // optional sub-message (e.g. "3 of 12")
  error?: string;
}

let tasks: AiTask[] = [];
const subscribers = new Set<(t: AiTask[]) => void>();
let seq = 0;

function emit() {
  const snapshot = tasks.slice();
  subscribers.forEach((fn) => fn(snapshot));
}

function newId(): string {
  return `ai_${Date.now().toString(36)}_${(seq++).toString(36)}`;
}

/** Start a task; returns its id. */
export function startAiTask(label: string, detail?: string): string {
  const id = newId();
  tasks = [...tasks, { id, label, phase: "running", startedAt: Date.now(), detail }];
  emit();
  return id;
}

/** Update a running task's label/detail (e.g. progress counts). */
export function updateAiTask(id: string, patch: { label?: string; detail?: string }): void {
  tasks = tasks.map((t) => (t.id === id ? { ...t, ...patch } : t));
  emit();
}

/** Mark a task done or error. It auto-clears from the bar after a short delay. */
export function finishAiTask(id: string, phase: "done" | "error", message?: string): void {
  tasks = tasks.map((t) =>
    t.id === id
      ? { ...t, phase, endedAt: Date.now(), ...(phase === "error" ? { error: message } : {}), ...(message ? { label: message } : {}) }
      : t,
  );
  emit();
  // Auto-remove finished tasks so the bar doesn't linger forever.
  const ttl = phase === "done" ? 3500 : 7000;
  setTimeout(() => {
    tasks = tasks.filter((t) => t.id !== id);
    emit();
  }, ttl);
}

/** Manually dismiss a task now. */
export function dismissAiTask(id: string): void {
  tasks = tasks.filter((t) => t.id !== id);
  emit();
}

/**
 * Wrap any async AI action so it reports start → done/error automatically.
 * Returns the action's result; re-throws on failure (after recording it) so
 * callers can still handle errors. `onDone` lets you craft the success message
 * from the result.
 */
export async function runWithProgress<T>(
  label: string,
  fn: (ctx: { update: (patch: { label?: string; detail?: string }) => void }) => Promise<T>,
  opts?: { doneLabel?: string | ((result: T) => string); errorLabel?: string },
): Promise<T> {
  const id = startAiTask(label);
  try {
    const result = await fn({ update: (patch) => updateAiTask(id, patch) });
    const done =
      typeof opts?.doneLabel === "function" ? opts.doneLabel(result) : opts?.doneLabel ?? `${label} — done`;
    finishAiTask(id, "done", done);
    return result;
  } catch (err) {
    const msg = opts?.errorLabel ?? (err instanceof Error ? err.message : `${label} failed`);
    finishAiTask(id, "error", msg);
    throw err;
  }
}

/** Subscribe to the live task list. */
export function useAiProgress(): AiTask[] {
  const [list, setList] = useState<AiTask[]>(() => tasks.slice());
  useEffect(() => {
    const fn = (t: AiTask[]) => setList(t);
    subscribers.add(fn);
    setList(tasks.slice());
    return () => { subscribers.delete(fn); };
  }, []);
  return list;
}
