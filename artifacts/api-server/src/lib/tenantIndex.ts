import { db } from "@workspace/db";
import { tenantIndexTable, tenantAliasesTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";
import { toFloat } from "./parsers";

// Self-provision tenant_index columns on databases created before they existed,
// so Eric never has to run a manual migration (he pulls + restarts). Idempotent;
// runs once per process. Must list EVERY column added to the schema after the
// table's original creation — otherwise `db.select().from(tenantIndexTable)`
// (which selects all schema columns) throws on the missing column, surfacing as
// e.g. a 500 on the analytics route. Keep this in sync with schema/tenantIndex.ts.
let columnsReady: Promise<void> | null = null;
export function ensureTenantIndexColumns(): Promise<void> {
  if (!columnsReady) {
    columnsReady = (async () => {
      await db.execute(sql`ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS lease_start text`);
      await db.execute(sql`ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS lease_start_date date`);
      await db.execute(sql`ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS expense_reimbursements double precision`);
      await db.execute(sql`ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS percentage_rent double precision`);
      await db.execute(sql`ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS other_rent double precision`);
      await db.execute(sql`ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS deal_status text`);
    })().catch((err) => { columnsReady = null; throw err; });
  }
  return columnsReady;
}

// ---------------------------------------------------------------------------
// Lease date parser — returns "YYYY-MM-DD" for storage, null if unparseable
// Handles: ISO YYYY-MM-DD, YYYY-MM, MM/DD/YYYY, M/D/YY, M/YYYY,
//          and formatted strings like "Sept-2027" / "Sep 2027"
// ---------------------------------------------------------------------------

const MONTH_ABBR_MAP: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

export function parseLeaseDate(raw: unknown): string | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;

  // YYYY-MM
  const ym = s.match(/^(\d{4})-(\d{2})$/);
  if (ym) return `${ym[1]}-${ym[2]}-01`;

  // MM/DD/YYYY  or  M/D/YY
  const slash = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (slash) {
    const m = parseInt(slash[1], 10);
    let y = parseInt(slash[3], 10);
    if (y < 100) y += 2000;
    if (m >= 1 && m <= 12) return `${y}-${String(m).padStart(2, "0")}-01`;
  }

  // M/YYYY
  const my = s.match(/^(\d{1,2})\/(\d{4})$/);
  if (my) {
    const m = parseInt(my[1], 10);
    if (m >= 1 && m <= 12) return `${my[2]}-${String(m).padStart(2, "0")}-01`;
  }

  // "Sept-2027" / "Sep 2027" / "September-2027"
  const named = s.match(/^([A-Za-z]{3,9})[\-\s](\d{4})$/);
  if (named) {
    const key = named[1].slice(0, 3).toLowerCase();
    const mo = MONTH_ABBR_MAP[key];
    if (mo) return `${named[2]}-${mo}-01`;
  }

  return null;
}

// ---------------------------------------------------------------------------
// Rebuild all tenant_index rows for one deal.
// Loads the current alias map itself so callers don't need to pass it.
// Safe to call fire-and-forget (errors are caught internally).
// ---------------------------------------------------------------------------

export async function rebuildTenantIndex(
  dealId: string,
  data: Record<string, unknown>,
): Promise<void> {
  try {
    await ensureTenantIndexColumns();
    const [, aliasRows] = await Promise.all([
      db.delete(tenantIndexTable).where(eq(tenantIndexTable.dealId, dealId)),
      db.select().from(tenantAliasesTable),
    ]);

    const aliasMap: Record<string, string> = {};
    for (const r of aliasRows) aliasMap[r.rawName] = r.canonicalName;

    const tenants = data.tenants as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(tenants) || tenants.length === 0) return;

    const dealName = typeof data.propertyName === "string" ? data.propertyName : null;
    const dealStatus = typeof data.status === "string" ? data.status : null;

    const rows = tenants.map((t) => {
      const rawName = typeof t.name === "string" ? t.name.trim() || null : null;
      const canonicalName = rawName ? (aliasMap[rawName] ?? rawName) : null;
      const leaseExpiry = typeof t.leaseExpiry === "string" && t.leaseExpiry ? t.leaseExpiry : null;
      const leaseStart = typeof t.leaseStart === "string" && t.leaseStart ? t.leaseStart : null;
      return {
        dealId,
        dealName,
        rawName,
        canonicalName,
        sf: toFloat(t.sf),
        rentPerSf: toFloat(t.rentPerSF),
        annualRent: toFloat(t.annualRent),
        leaseStart,
        leaseStartDate: parseLeaseDate(leaseStart),
        leaseExpiry,
        leaseExpiryDate: parseLeaseDate(leaseExpiry),
        leaseType: typeof t.leaseType === "string" ? t.leaseType : null,
        creditRating: typeof t.creditRating === "string" ? t.creditRating : null,
        isAnchor: typeof t.isAnchor === "boolean" ? t.isAnchor : null,
        dealStatus,
        expenseReimbursements: toFloat(t.expenseReimbursements),
        percentageRent: toFloat(t.percentageRent),
        otherRent: toFloat(t.otherRent),
      };
    });

    await db.insert(tenantIndexTable).values(rows);
  } catch {
    // Non-fatal — the index is a mirror; don't let rebuild failures break deal writes
  }
}
