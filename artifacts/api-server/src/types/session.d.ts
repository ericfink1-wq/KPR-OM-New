import "express-session";

declare module "express-session" {
  interface SessionData {
    authenticated?: boolean;
    isAdmin?: boolean;
    userId?: string;
    userEmail?: string;
    userName?: string | null;
    loginAt?: number;
  }
}
