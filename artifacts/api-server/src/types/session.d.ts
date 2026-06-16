import "express-session";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    isAdmin?: boolean;
    userId?: string;
    userEmail?: string;
    userName?: string | null;
    loginAt?: number;
    // Throttle marker for the "last seen" stamp — the last time we wrote the user's
    // lastSeenAt to the DB, so we don't write on every single request.
    lastSeenStampedAt?: number;
    // Whether the logged-in user has TOTP 2FA enabled (mirrored into the session at
    // login so the mandatory-2FA gate can check without a DB hit). 2FA is required
    // for all users, so a value of false means "must enroll before using the app".
    twoFactorEnabled?: boolean;
    // Last time a 2FA code was verified (login or step-up). Drives the periodic
    // re-verification window (see lib/twoFactorPolicy).
    twoFactorVerifiedAt?: number;
    // Partial login: password verified but a TOTP 2FA code is still required. Holds
    // the user id between POST /auth/login and POST /auth/2fa/verify. Cleared on
    // success (full auth) or logout.
    pending2faUserId?: string;
    pending2faAt?: number;
  }
}
