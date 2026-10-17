import { db } from "@workspace/db";
import { sql } from "drizzle-orm";

// PER-USER SETTINGS, stored on the server so they follow a person across devices and
// publishes (Eric, 10/17/26: "save it to that user's account on the server, not
// localStorage"). One row per user, a jsonb bag of named sections. Today the only section
// is the Rates-panel loan sizer: a starred default base rate plus the last-used inputs.
//
// Runtime-provisioned here AND declared in lib/db/src/schema/userPrefs.ts AND mirrored in
// lib/db/scripts/ensure-runtime-tables.mjs — all three, or a publish proposes a DROP.

export interface LoanSizerPrefs {
  defaultBase?: string | null;
  spreadBps?: number; premiumBps?: number; cushionBps?: number;
  dscr?: number; debtYieldPct?: number; ltvPct?: number;
  io?: boolean; amortYears?: number;
}
export interface UserPrefs { loanSizer?: LoanSizerPrefs }

let ready: Promise<void> | null = null;
export function ensureUserPrefsTable(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      await db.execute(sql`
        CREATE TABLE IF NOT EXISTS user_prefs (
          user_id text PRIMARY KEY,
          prefs jsonb NOT NULL DEFAULT '{}'::jsonb,
          updated_at timestamptz NOT NULL DEFAULT now()
        )
      `);
    })().catch(err => { ready = null; throw err; });
  }
  return ready;
}

const inRange = (v: unknown, lo: number, hi: number): number | undefined =>
  typeof v === "number" && Number.isFinite(v) && v >= lo && v <= hi ? Math.round(v * 10000) / 10000 : undefined;

/** Keep only known loan-sizer fields with sane values; anything else is dropped, never stored. */
export function sanitizeLoanSizer(raw: unknown): LoanSizerPrefs {
  const r = (raw && typeof raw === "object" && !Array.isArray(raw)) ? raw as Record<string, unknown> : {};
  const out: LoanSizerPrefs = {};
  if (r.defaultBase === null) out.defaultBase = null;
  else if (typeof r.defaultBase === "string" && /^[a-z0-9-]{1,24}$/.test(r.defaultBase)) out.defaultBase = r.defaultBase;
  const nums: Array<[keyof LoanSizerPrefs, number, number]> = [
    ["spreadBps", 0, 2000], ["premiumBps", 0, 2000], ["cushionBps", 0, 2000],
    ["dscr", 0.5, 5], ["debtYieldPct", 0, 30], ["ltvPct", 0, 100], ["amortYears", 1, 50],
  ];
  for (const [k, lo, hi] of nums) { const v = inRange(r[k], lo, hi); if (v !== undefined) (out as Record<string, unknown>)[k] = v; }
  if (typeof r.io === "boolean") out.io = r.io;
  return out;
}

export async function getUserPrefs(userId: string): Promise<UserPrefs> {
  await ensureUserPrefsTable();
  const r = await db.execute(sql`SELECT prefs FROM user_prefs WHERE user_id = ${userId}`);
  const row = (r as unknown as { rows: Array<{ prefs: UserPrefs }> }).rows[0];
  return row?.prefs ?? {};
}

/** Merge a loan-sizer patch into the user's stored section (fields not sent are kept). */
export async function saveLoanSizerPrefs(userId: string, patch: LoanSizerPrefs): Promise<UserPrefs> {
  await ensureUserPrefsTable();
  const cur = await getUserPrefs(userId);
  const next: UserPrefs = { ...cur, loanSizer: { ...(cur.loanSizer ?? {}), ...patch } };
  await db.execute(sql`
    INSERT INTO user_prefs (user_id, prefs, updated_at) VALUES (${userId}, ${JSON.stringify(next)}::jsonb, now())
    ON CONFLICT (user_id) DO UPDATE SET prefs = EXCLUDED.prefs, updated_at = now()
  `);
  return next;
}
