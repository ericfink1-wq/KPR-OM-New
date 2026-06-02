import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { pool, db } from "@workspace/db";
import { sql } from "drizzle-orm";

// DB-backed express sessions so logins SURVIVE redeploys/restarts (the previous
// in-memory store dropped everyone on each publish). The earlier attempt crashed
// because connect-pg-simple's auto-create reads a bundled table.sql that isn't
// present in the deployed bundle — so we provision the table ourselves and set
// createTableIfMissing:false (it never touches table.sql).

let ready: Promise<void> | null = null;
export function ensureSessionTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS "session" (
          "sid" varchar NOT NULL PRIMARY KEY,
          "sess" json NOT NULL,
          "expire" timestamp(6) NOT NULL
        )
      `);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS "IDX_session_expire" ON "session" ("expire")`);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

export function makeSessionStore(): session.Store {
  const PgSession = connectPgSimple(session);
  return new PgSession({
    pool,
    tableName: "session",
    createTableIfMissing: false,     // we own table creation (ensureSessionTable)
    pruneSessionInterval: 60 * 15,   // sweep expired rows every 15 min
  });
}
