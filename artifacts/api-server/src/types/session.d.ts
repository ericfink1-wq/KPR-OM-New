import "express-session";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    isAdmin?: boolean;
    userId?: string;
    userEmail?: string;
    userName?: string | null;
    loginAt?: number;
    // Whether the logged-in user has TOTP 2FA enabled (mirrored into the session at
    // login so the mandatory-2FA gate can check without a DB hit). 2FA is required
    // for all users, so a value of false means "must enroll before using the app".
    twoFactorEnabled?: boolean;
    // Partial login: password verified but a TOTP 2FA code is still required. Holds
    // the user id between POST /auth/login and POST /auth/2fa/verify. Cleared on
    // success (full auth) or logout.
    pending2faUserId?: string;
    pending2faAt?: number;
  }
}
