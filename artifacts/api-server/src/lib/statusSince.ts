// Record WHEN a deal's pipeline status last changed. The auto-pass rule (a Prospect
// with no activity for ~6 weeks becomes Passed) measures from this, so moving a deal
// back to Prospect actually restarts its clock instead of being auto-passed again on
// the next page load. Stamped server-side so every way of changing a status counts.
export function stampStatusChange(
  prev: Record<string, unknown> | null | undefined,
  next: Record<string, unknown>,
  now: Date = new Date(),
): void {
  const before = typeof prev?.status === "string" ? prev.status : null;
  const after = typeof next.status === "string" ? next.status : null;
  if (!after || before === after) return;
  next.statusSince = now.toISOString();
  // A person moving an auto-passed deal back out of Passed: it is no longer auto-passed.
  if (after !== "Passed" && next.autoPassed) {
    next.autoPassed = false;
    delete next.autoPassedAt;
  }
}
