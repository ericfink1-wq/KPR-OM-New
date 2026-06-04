import { drizzle } from "drizzle-orm/node-postgres";
import pg from "pg";
import * as schema from "./schema";

const { Pool } = pg;

if (!process.env.DATABASE_URL) {
  throw new Error(
    "DATABASE_URL must be set. Did you forget to provision a database?",
  );
}

// Plain pool. (Per-statement timeouts are set INSIDE the transaction that needs
// them — see the image-save route — because session/pool-level timeout parameters
// are unreliable through a connection pooler like pgBouncer.)
export const pool = new Pool({ connectionString: process.env.DATABASE_URL });
export const db = drizzle(pool, { schema });

export * from "./schema";
