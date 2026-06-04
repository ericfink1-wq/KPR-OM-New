import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Timeouts so a single stuck query can't zombie a connection and block every later
// write to the same row (the cause of image saves "timing out after 45s": a write
// blocked on a lock held by an earlier hung request). With these, a blocked write
// fails fast (and the client can retry), and a zombie that holds a lock is killed
// instead of hanging the table indefinitely.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  statement_timeout: 20_000,                 // kill any query running > 20s
  lock_timeout: 12_000,                       // don't wait > 12s for a row/table lock
  idle_in_transaction_session_timeout: 30_000, // kill a transaction left open/idle (frees its locks)
  connectionTimeoutMillis: 10_000,            // fail fast if no pool connection is free
});
export const db = drizzle(pool, { schema });

export * from "./schema";
