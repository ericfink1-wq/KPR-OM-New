import type { Request, Response, NextFunction } from "express";

// Session auth guards, shared by all routes. The express-session SessionData
// augmentation (authenticated / isAdmin) lives in src/types/session.d.ts.

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.authenticated) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.session.authenticated) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (!req.session.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
    return;
  }
  next();
}
