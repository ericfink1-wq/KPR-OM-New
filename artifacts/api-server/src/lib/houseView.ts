// The "House View": a single, distilled statement of how the KPR team underwrites —
// what they consistently reward/penalize, cap-rate expectations by product/market,
// and recurring concerns — learned from their per-deal reviews. Stored as one row;
// injected into every future deal's analysis so the analyst reasons the way KPR does.
import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

let ready: Promise<void> | null = null;
export function ensureHouseViewTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS analyst_house_view (
          id integer PRIMARY KEY DEFAULT 1,
          content text NOT NULL DEFAULT '',
          source_count integer NOT NULL DEFAULT 0,
          last_distilled_at timestamptz,
          updated_at timestamptz NOT NULL DEFAULT now(),
          updated_by text
        )
      `);
      await db.execute(sql`INSERT INTO analyst_house_view (id, content) VALUES (1, '') ON CONFLICT (id) DO NOTHING`);
    })().catch((err) => { ready = null; throw err; });
  }
  return ready;
}

export interface HouseView {
  content: string;
  sourceCount: number;
  lastDistilledAt: string | null;
  updatedAt: string | null;
  updatedBy: string | null;
}

export async function getHouseView(): Promise<HouseView> {
  await ensureHouseViewTable();
  const r = await pool.query(`SELECT content, source_count, last_distilled_at, updated_at, updated_by FROM analyst_house_view WHERE id = 1`);
  const row = r.rows[0] ?? {};
  return {
    content: row.content ?? "",
    sourceCount: row.source_count ?? 0,
    lastDistilledAt: row.last_distilled_at ? new Date(row.last_distilled_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
    updatedBy: row.updated_by ?? null,
  };
}

// Save the House View. distilled=true also stamps last_distilled_at + source_count
// (used by the rebuild pass); a manual edit leaves those untouched.
export async function saveHouseView(content: string, updatedBy: string | null, distilled?: { sourceCount: number }): Promise<void> {
  await ensureHouseViewTable();
  if (distilled) {
    await pool.query(
      `UPDATE analyst_house_view SET content = $1, source_count = $2, last_distilled_at = now(), updated_at = now(), updated_by = $3 WHERE id = 1`,
      [content, distilled.sourceCount, updatedBy],
    );
  } else {
    await pool.query(
      `UPDATE analyst_house_view SET content = $1, updated_at = now(), updated_by = $2 WHERE id = 1`,
      [content, updatedBy],
    );
  }
}
