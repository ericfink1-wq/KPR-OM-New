import "express-session";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    isAdmin?: boolean;
    userId?: string;
    userEmail?: string;
    userName?: string | null;
    loginAt?: number;
    // Partial login: password verified but a TOTP 2FA code is still required. Holds
    // the user id between POST /auth/login and POST /auth/2fa/verify. Cleared on
    // success (full auth) or logout.
    pending2faUserId?: string;
    pending2faAt?: number;
  }
}
