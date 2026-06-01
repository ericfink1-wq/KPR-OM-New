// Upload/AI gating was previously behind a shared password ("omkey"). That gate
// has been removed — uploads, analyst chat, and web lookups are open to any
// signed-in user. These functions are kept as no-ops so existing call sites work
// unchanged.

export function uploadsUnlocked(): boolean {
  return true;
}

export function ensureUploadAllowed(): boolean {
  return true;
}
