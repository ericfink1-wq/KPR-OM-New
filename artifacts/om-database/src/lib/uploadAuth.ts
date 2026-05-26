const UPLOAD_PASSWORD = "omkey";

export function uploadsUnlocked(): boolean {
  try { return sessionStorage.getItem("kpr_upload_unlocked") === "1"; } catch { return false; }
}

export function ensureUploadAllowed(): boolean {
  if (uploadsUnlocked()) return true;
  const entry = window.prompt(
    "Enter the password to use AI features — uploads, analyst chat, and web lookups (this protects your API tokens):"
  );
  if (entry == null) return false;
  if (entry === UPLOAD_PASSWORD) {
    try { sessionStorage.setItem("kpr_upload_unlocked", "1"); } catch {}
    return true;
  }
  window.alert("Incorrect upload password — upload cancelled.");
  return false;
}
