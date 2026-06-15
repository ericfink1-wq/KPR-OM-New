// Mandatory-2FA step-up policy. A 2FA-enabled user must re-enter an authenticator
// code periodically even within a live session — tightening the long-lived session
// without forcing a code on every request. The window is configurable via
// TWOFA_REVERIFY_DAYS (default 3 days); set it to 2 for tighter or 7 for looser.
export const TWOFA_REVERIFY_MS = Math.max(1, Number(process.env.TWOFA_REVERIFY_DAYS) || 3) * 24 * 60 * 60 * 1000;

// True when a 2FA-enabled session's last code verification is older than the window.
export function needs2faReverify(s: { twoFactorEnabled?: boolean; twoFactorVerifiedAt?: number } | undefined): boolean {
  if (!s?.twoFactorEnabled) return false;
  return Date.now() - (s.twoFactorVerifiedAt || 0) > TWOFA_REVERIFY_MS;
}
