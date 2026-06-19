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
      await db.execute(sql`ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS sales_psf double precision`);
      await db.execute(sql`ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS sales_year double precision`);
      await db.execute(sql`ALTER TABLE tenant_index ADD COLUMN IF NOT EXISTS is_nap boolean`);
      // Indexes for the per-deal lookups done on every deal write/delete and on
      // analytics filters. Created here (not via a migration) because the deploy
      // can't run drizzle-kit; IF NOT EXISTS keeps it idempotent.
      await db.execute(sql`CREATE INDEX IF NOT EXISTS tenant_index_deal_id_idx ON tenant_index (deal_id)`);
      await db.execute(sql`CREATE INDEX IF NOT EXISTS comps_index_source_deal_id_idx ON comps_index (source_deal_id)`);
    })().catch((err) => { columnsReady = null; throw err; });
  }
  return columnsReady;
}

// One-time (per process) backfill of the columns added after the table's original
// creation (sales/SF, sales year, and the NAP flag) straight from the deal JSON we
// ALREADY store — so existing tenant_index rows pick these up without anyone running
// a manual "rebuild index". Idempotent: COALESCE only fills a column that's still
// null, and the casts are regex-guarded so odd values can't error the statement.
// Runs lazily before the first benchmark query; non-fatal (benchmarks just stay
// sparse if it can't run). After this, normal deal writes keep these current.
let backfillReady: Promise<void> | null = null;
export function backfillTenantIndexFields(): Promise<void> {
  if (!backfillReady) {
    backfillReady = (async () => {
      await ensureTenantIndexColumns();
      await db.execute(sql`
        UPDATE tenant_index ti SET
          sales_psf  = COALESCE(ti.sales_psf,
                         CASE WHEN (t.elem->>'salesPSF') ~ '^[0-9]+(\\.[0-9]+)?$'
                              THEN (t.elem->>'salesPSF')::double precision END),
          sales_year = COALESCE(ti.sales_year,
                         CASE WHEN (t.elem->>'salesYear') ~ '^[0-9]+(\\.[0-9]+)?$'
                              THEN (t.elem->>'salesYear')::double precision END),
          is_nap     = COALESCE(ti.is_nap,
                         CASE WHEN (t.elem->>'isNAP') IN ('true','false')
                              THEN (t.elem->>'isNAP')::boolean END)
        FROM deals d
        CROSS JOIN LATERAL jsonb_array_elements(
          CASE WHEN jsonb_typeof(d.data->'tenants') = 'array'
               THEN d.data->'tenants' ELSE '[]'::jsonb END) AS t(elem)
        WHERE ti.deal_id = d.id
          AND t.elem->>'name' = ti.raw_name
          AND (ti.sales_psf IS NULL OR ti.is_nap IS NULL)
      `);
    })().catch(() => { /* non-fatal — the admin "rebuild index" remains a fallback */ });
  }
  return backfillReady;
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

    // Soft-deleted (trashed) deals are removed from the index ENTIRELY — their rows were
    // just deleted above, and returning here means we don't re-add them. Without this,
    // trashing a deal (a PUT that sets trashedAt → rebuildTenantIndex) re-indexed it, so
    // Portfolio Analytics counted trashed deals (175 vs the 158 live) and the Owned
    // filter saw stale data. Processing/errored deals are likewise excluded.
    if (data.trashedAt || data._processing || data._processingError) return;

    const tenants = data.tenants as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(tenants) || tenants.length === 0) return;

    const dealName = typeof data.propertyName === "string" ? data.propertyName : null;
    const dealStatus = typeof data.status === "string" ? data.status : null;

    // Resolve uploaded sales (tenantSalesHistory) per tenant the same way the deal
    // page does — uploads win over OM, highest year wins — so the database benchmark
    // sees sales that were uploaded after import, not just the raw roster salesPSF
    // (which the sales-upload path never writes back). Falls back to roster salesPSF.
    const norm = (s: unknown) => String(s ?? "").trim().toLowerCase();
    type SalesHit = { year: number; psf: number | null; isUpload: boolean };
    const uploadedSales = new Map<string, SalesHit>();
    const history = data.tenantSalesHistory;
    if (Array.isArray(history)) {
      for (const snap of history as Array<Record<string, unknown>>) {
        const isUpload = snap.source !== "om";
        const year = toFloat(snap.year) ?? 0;
        const snapTenants = Array.isArray(snap.tenants) ? (snap.tenants as Array<Record<string, unknown>>) : [];
        for (const r of snapTenants) {
          const key = norm(r.name);
          if (!key) continue;
          let psf = toFloat(r.salesPSF);
          const gross = toFloat(r.annualSales);
          const sf = toFloat(r.sf);
          if (psf == null && gross != null && sf != null && sf > 0) psf = Math.round((gross / sf) * 100) / 100;
          const cur = uploadedSales.get(key);
          if (!cur || (isUpload && !cur.isUpload) || (isUpload === cur.isUpload && year > cur.year)) {
            uploadedSales.set(key, { year, psf, isUpload });
          }
        }
      }
    }

    const rows = tenants.map((t) => {
      const nameKey = norm(t.name);
      const canonKey = norm(t.canonicalName);
      const hit = uploadedSales.get(nameKey) ?? (canonKey ? uploadedSales.get(canonKey) : undefined);
      const resolvedSalesPsf = (hit && hit.psf != null) ? hit.psf : toFloat(t.salesPSF);
      const resolvedSalesYear = (hit && hit.psf != null && hit.year) ? hit.year : toFloat(t.salesYear);
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
        isNap: typeof t.isNAP === "boolean" ? t.isNAP : null,
        dealStatus,
        expenseReimbursements: toFloat(t.expenseReimbursements),
        percentageRent: toFloat(t.percentageRent),
        otherRent: toFloat(t.otherRent),
        salesPsf: resolvedSalesPsf,
        salesYear: resolvedSalesYear,
      };
    });

    await db.insert(tenantIndexTable).values(rows);
  } catch {
    // Non-fatal — the index is a mirror; don't let rebuild failures break deal writes
  }
}
