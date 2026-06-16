import type { Request, Response, NextFunction } from "express";
import { db, usersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

// Session auth guards, shared by all routes. The express-session SessionData
// augmentation (authenticated / isAdmin) lives in src/types/session.d.ts.

// Stamp the user's "last seen" (most recent authenticated access of ANY kind) at most
// once per throttle window, so the admin sees real recent activity — not just the last
// explicit sign-in (lastLoginAt). Throttled via a session-stored marker and written
// fire-and-forget so it never delays the request.
const SEEN_THROTTLE_MS = 5 * 60 * 1000;
function touchLastSeen(req: Request) {
  const uid = req.session.userId;
  if (!uid) return;
  const now = Date.now();
  if (now - (req.session.lastSeenStampedAt ?? 0) < SEEN_THROTTLE_MS) return;
  req.session.lastSeenStampedAt = now;
  void db.update(usersTable).set({ lastSeenAt: new Date() }).where(eq(usersTable.id, uid)).catch(() => {});
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.session.authenticated) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  touchLastSeen(req);
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
  touchLastSeen(req);
  next();
}
