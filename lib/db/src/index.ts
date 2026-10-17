import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Plain pool, plus a CLIENT-SIDE connection-acquire timeout (node-postgres option,
// NOT sent to the server, so it's safe through a pooler like pgBouncer). Without it,
// if every pooled connection is busy/stuck a new query waits forever; with it the
// acquire fails fast and the caller gets a clear error instead of hanging.
// (Per-statement timeouts are set INSIDE the transaction that needs them.)
// Pool size is explicit (node-postgres defaults to 10). Startup jobs now run one at a time
// (api-server lib/startup.ts), so 10 leaves ample room for requests; PG_POOL_MAX overrides.
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: Number(process.env.PG_POOL_MAX) || 10,
  connectionTimeoutMillis: 10000,
  idleTimeoutMillis: 30000,
});

// CRITICAL: a pg Pool with no 'error' listener CRASHES the whole process when an
// IDLE pooled connection errors (a network blip, an SSL renegotiation, the managed
// pooler dropping a backend). That presents as "app built but failed to start"
// (the process dies seconds after boot). Handle it so a transient connection error
// is logged, not fatal — the pool just opens a fresh connection on the next query.
pool.on("error", (err) => {
  // eslint-disable-next-line no-console
  console.error("pg pool idle-client error (non-fatal, connection will be re-established):", err?.message ?? err);
});

export const db = drizzle(pool, { schema });

export * from "./schema";
