import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { resolve } from "node:path";
import { getTableConfig } from "drizzle-orm/pg-core";
import * as dbSchema from "@workspace/db";

// WHY THIS TEST EXISTS — it guards live production data, not code style.
// ---------------------------------------------------------------------
// Most tables here are provisioned TWICE: once at runtime by an
// ensure*Table() helper (CREATE TABLE IF NOT EXISTS / ALTER TABLE ADD COLUMN
// IF NOT EXISTS), and once as a drizzle declaration in lib/db/src/schema so the
// deploy's schema-diff knows the table should exist.
//
// If those two descriptions of the same table DISAGREE, the diff often cannot
// ALTER its way across the gap and instead proposes
//     DROP TABLE "<table>" CASCADE;
// which silently destroys every row on publish. That is not hypothetical: on
// 2026-09-10 mcp_api_keys was declared with user_id NOT NULL while the runtime
// created it nullable, and declared none of the two indexes the runtime creates.
// The publish diff proposed the DROP and the live access key was lost.
//
// So this test parses the REAL DDL out of the runtime source and holds every
// drizzle declaration to it — column for column, nullability for nullability,
// index for index. Adding a table or a column means updating BOTH sides.

const ROOT = resolve(__dirname, "../../../../..");

type Cols = Map<string, boolean>;          // column name → NOT NULL?
type Idxs = Map<string, boolean>;          // index name  → UNIQUE?

/** Structural keywords that appear where a column name would, in a CREATE TABLE body. */
const TABLE_CONSTRAINT = /^(primary|unique|constraint|foreign|check)$/i;

function parseRuntimeDdl(): { tables: Map<string, Cols>; indexes: Map<string, Idxs> } {
  const files = execSync(
    'grep -rl "CREATE TABLE IF NOT EXISTS" --include=*.ts artifacts/api-server/src lib',
    { encoding: "utf8", cwd: ROOT },
  ).trim().split("\n").filter(Boolean);

  const tables = new Map<string, Cols>();
  const indexes = new Map<string, Idxs>();

  for (const f of files) {
    const src = readFileSync(resolve(ROOT, f), "utf8");

    for (const m of src.matchAll(/CREATE TABLE IF NOT EXISTS "?([a-z_]+)"? \(([\s\S]*?)\n\s*\)/g)) {
      const cols: Cols = tables.get(m[1]) ?? new Map();
      for (const raw of m[2].split(",")) {
        const line = raw.trim().replace(/\s+/g, " ");
        const c = line.match(/^"?([a-z_]+)"? (.+)$/);
        if (!c || TABLE_CONSTRAINT.test(c[1])) continue;
        // PRIMARY KEY implies NOT NULL in postgres.
        cols.set(c[1], /\bNOT NULL\b/i.test(c[2]) || /\bPRIMARY KEY\b/i.test(c[2]));
      }
      tables.set(m[1], cols);
    }

    // Columns bolted on after the fact are part of the live shape too. A column
    // added this way can only be NOT NULL if it carries a DEFAULT (otherwise the
    // ALTER fails on existing rows) — which is exactly the trap that made
    // mcp_api_keys.user_id nullable at runtime but NOT NULL in the declaration.
    for (const m of src.matchAll(
      /ALTER TABLE "?([a-z_]+)"? ADD COLUMN IF NOT EXISTS "?([a-z_]+)"? ([^`;]*)/g,
    )) {
      const cols = tables.get(m[1]);
      if (!cols) continue;   // table created elsewhere / not runtime-provisioned here
      if (!cols.has(m[2])) cols.set(m[2], /\bNOT NULL\b/i.test(m[3]));
    }

    for (const m of src.matchAll(
      /CREATE (UNIQUE )?INDEX IF NOT EXISTS "?([a-zA-Z_]+)"? ON "?([a-z_]+)"?/g,
    )) {
      const bag = indexes.get(m[3]) ?? new Map<string, boolean>();
      bag.set(m[2], Boolean(m[1]));
      indexes.set(m[3], bag);
    }
  }
  return { tables, indexes };
}

const { tables: runtimeTables, indexes: runtimeIndexes } = parseRuntimeDdl();

const declared = new Map<string, ReturnType<typeof getTableConfig>>();
for (const value of Object.values(dbSchema as Record<string, unknown>)) {
  try { const cfg = getTableConfig(value as never); declared.set(cfg.name, cfg); } catch { /* not a table */ }
}

describe("runtime DDL vs drizzle schema (guards against DROP TABLE on publish)", () => {
  it("actually found the runtime DDL (so a parsing break can't make this suite vacuously pass)", () => {
    expect(runtimeTables.size).toBeGreaterThanOrEqual(14);
    expect(runtimeTables.get("mcp_api_keys")?.size).toBeGreaterThan(10);
    expect(runtimeIndexes.get("mcp_api_keys")?.size).toBe(2);
  });

  for (const [table, cols] of runtimeTables) {
    describe(table, () => {
      it("is declared in lib/db/src/schema", () => {
        expect(declared.has(table), `${table} is created at runtime but never declared — the diff will propose DROP`).toBe(true);
      });

      it("declares the same columns the runtime creates", () => {
        const cfg = declared.get(table);
        if (!cfg) return;
        const names = new Set(cfg.columns.map((c) => c.name));
        for (const col of cols.keys()) {
          expect(names.has(col), `${table}.${col}: runtime creates it, schema does not declare it`).toBe(true);
        }
        for (const col of names) {
          expect(cols.has(col), `${table}.${col}: schema declares it, runtime never creates it`).toBe(true);
        }
      });

      it("matches NULLABILITY on every column (a NOT NULL mismatch is what triggers the DROP)", () => {
        const cfg = declared.get(table);
        if (!cfg) return;
        for (const c of cfg.columns) {
          if (!cols.has(c.name)) continue;
          expect(c.notNull, `${table}.${c.name}: runtime notNull=${cols.get(c.name)}, schema notNull=${c.notNull}`)
            .toBe(cols.get(c.name));
        }
      });

      it("declares every runtime index, with matching uniqueness", () => {
        const cfg = declared.get(table);
        if (!cfg) return;
        const mine = new Map(cfg.indexes.map((i) => [i.config.name, Boolean(i.config.unique)]));
        const theirs = runtimeIndexes.get(table) ?? new Map<string, boolean>();
        for (const [name, unique] of theirs) {
          expect(mine.has(name), `${table}: index ${name} created at runtime but not declared — DROP risk`).toBe(true);
          if (mine.has(name)) expect(mine.get(name), `${table}: index ${name} uniqueness mismatch`).toBe(unique);
        }
        for (const name of mine.keys()) {
          expect(theirs.has(name), `${table}: index ${name} declared but never created at runtime`).toBe(true);
        }
      });
    });
  }
});

// The table that actually got dropped — pinned explicitly so the specific
// regression is named in the suite, not just covered by the generic sweep.
describe("mcp_api_keys (the 2026-09-10 regression)", () => {
  it("keeps user_id NULLABLE on both sides — ADD COLUMN IF NOT EXISTS cannot backfill NOT NULL", () => {
    expect(runtimeTables.get("mcp_api_keys")!.get("user_id")).toBe(false);
    expect(declared.get("mcp_api_keys")!.columns.find((c) => c.name === "user_id")!.notNull).toBe(false);
    // The invariant is enforced in code instead, and it fails closed: verifyMcpKey()
    // rejects a key with no owner, so an ownerless row can never authenticate.
    expect(readFileSync(resolve(__dirname, "..", "mcpKeys.ts"), "utf8"))
      .toMatch(/if \(!row\.userId\) return null;/);
  });
});
