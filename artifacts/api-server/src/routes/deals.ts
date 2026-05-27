import { Router } from "express";
import { db } from "@workspace/db";
import { dealsTable, dealImagesTable, dealSourcesTable, tenantAliasesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runOmExtraction } from "../lib/extract";
import { rebuildTenantIndex } from "../lib/tenantIndex";
import { rebuildCompsIndex } from "../lib/compsIndex";

async function loadAliasMap(): Promise<Record<string, string>> {
  try {
    const rows = await db.select().from(tenantAliasesTable);
    const map: Record<string, string> = {};
    for (const r of rows) map[r.rawName] = r.canonicalName;
    return map;
  } catch {
    return {};
  }
}

function enrichTenants(
  data: Record<string, unknown>,
  aliasMap: Record<string, string>
): Record<string, unknown> {
  const tenants = data.tenants as Array<Record<string, unknown>> | undefined;
  if (!Array.isArray(tenants)) return data;
  const enriched = tenants.map((t) => {
    const raw = typeof t.name === "string" ? t.name : "";
    const canonical = aliasMap[raw] ?? raw ?? null;
    if (!canonical || canonical === t.canonicalName) return t;
    return { ...t, canonicalName: canonical };
  });
  return { ...data, tenants: enriched };
}

const router = Router();

function requireAuth(req: Parameters<Router>[0], res: Parameters<Router>[1], next: Parameters<Router>[2]) {
  if (!req.session.authenticated) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  next();
}

// Fields entered by humans — preserved across re-analysis so user data is never overwritten
const USER_PRESERVED_KEYS = new Set([
  "status", "statusSince", "autoPassed",
  "userNotes",
  "txnPurchasePrice", "txnSeller", "txnLoiDate", "txnCloseDate",
  "txnSalePrice", "txnBuyer", "txnSaleDate", "txnBroker",
  "acqCapRate", "acqNOIAtClose", "acqEntity", "acqBroker", "acqContractDate", "acqDDExpiration",
  "acqDeposit", "acqClosingCosts", "acqFee", "acqTitleCo", "acqCounsel", "acqPropManager",
  "acqStrategy", "acqHoldPeriod", "acqTargetIRR", "acqNotes",
  "debtLender", "debtType", "debtLoanAmount", "debtRate", "debtMaturityDate", "debtNotes",
  "marketSale", "marketSaleChecked",
  "marketDemographics", "demoChecked",
  "verified", "propertyGroupId", "editHistory",
  "trashedAt", "uploadedAt", "fileName", "pdfPages", "imageMeta", "dealScore",
]);

// GET /api/deals — list all deals (excludes in-progress ingests)
router.get("/deals", requireAuth, async (req, res) => {
  try {
    const [rows, aliasMap] = await Promise.all([
      db.select().from(dealsTable).orderBy(dealsTable.createdAt),
      loadAliasMap(),
    ]);
    const deals = rows
      .filter(r => !r.data._processing)
      .map(r => {
        const { _processing: _p, _processingError: _e, ...rest } = r.data;
        return { ...enrichTenants(rest, aliasMap), id: r.id };
      });
    res.json(deals);
  } catch (err) {
    req.log.error({ err }, "Failed to load deals");
    res.status(500).json({ error: "Failed to load deals" });
  }
});

// POST /api/deals — create a deal
router.post("/deals", requireAuth, async (req, res) => {
  try {
    const { id, ...rest } = req.body as Record<string, unknown>;
    if (!id || typeof id !== "string") {
      res.status(400).json({ error: "id is required" });
      return;
    }
    await db.insert(dealsTable).values({ id, data: rest });
    res.status(201).json({ ok: true, id });
  } catch (err) {
    req.log.error({ err }, "Failed to create deal");
    res.status(500).json({ error: "Failed to create deal" });
  }
});

// PUT /api/deals/:id — upsert a deal
router.put("/deals/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const { id: _bodyId, ...rest } = req.body as Record<string, unknown>;
    await db.insert(dealsTable)
      .values({ id, data: rest })
      .onConflictDoUpdate({ target: dealsTable.id, set: { data: rest, updatedAt: new Date() } });
    res.json({ ok: true, id });
    setImmediate(() => {
      rebuildTenantIndex(id, rest).catch(() => {});
      rebuildCompsIndex(id, rest).catch(() => {});
    });
  } catch (err) {
    req.log.error({ err }, "Failed to upsert deal");
    res.status(500).json({ error: "Failed to upsert deal" });
  }
});

// DELETE /api/deals/:id — delete a deal and its images/source
router.delete("/deals/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    await db.delete(dealImagesTable).where(eq(dealImagesTable.id, id));
    await db.delete(dealSourcesTable).where(eq(dealSourcesTable.id, id));
    await db.delete(dealsTable).where(eq(dealsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete deal");
    res.status(500).json({ error: "Failed to delete deal" });
  }
});

// GET /api/deals/:id/images
router.get("/deals/:id/images", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const rows = await db.select().from(dealImagesTable).where(eq(dealImagesTable.id, id));
    if (!rows.length) { res.json(null); return; }
    const r = rows[0];
    res.json({
      cover: r.cover ?? null,
      coverThumb: r.coverThumb ?? null,
      sitePlan: r.sitePlan ?? null,
      pagePicks: r.pagePicks ?? null,
      needsSitePlanPick: r.needsSitePlanPick ?? false,
    });
  } catch (err) {
    req.log.error({ err }, "Failed to load images");
    res.status(500).json({ error: "Failed to load images" });
  }
});

// PUT /api/deals/:id/images
router.put("/deals/:id/images", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const body = req.body as {
      cover?: string | null;
      coverThumb?: string | null;
      sitePlan?: string[] | null;
      pagePicks?: { page: number; img: string }[] | null;
      needsSitePlanPick?: boolean;
    };
    const { cover, coverThumb, sitePlan, pagePicks, needsSitePlanPick } = body;
    await db.insert(dealImagesTable)
      .values({ id, cover: cover ?? null, coverThumb: coverThumb ?? null, sitePlan: sitePlan ?? null, pagePicks: pagePicks ?? null, needsSitePlanPick: needsSitePlanPick ?? false })
      .onConflictDoUpdate({
        target: dealImagesTable.id,
        set: { cover: cover ?? null, coverThumb: coverThumb ?? null, sitePlan: sitePlan ?? null, pagePicks: pagePicks ?? null, needsSitePlanPick: needsSitePlanPick ?? false },
      });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save images");
    res.status(500).json({ error: "Failed to save images" });
  }
});

// GET /api/deals/:id/status — poll whether an async extraction is still in progress
router.get("/deals/:id/status", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const [rows, aliasMap] = await Promise.all([
      db.select().from(dealsTable).where(eq(dealsTable.id, id)),
      loadAliasMap(),
    ]);
    if (!rows.length) { res.status(404).json({ error: "Deal not found" }); return; }
    const data = rows[0].data;
    if (data._processing) {
      res.json({ processing: true });
    } else if (data._processingError) {
      res.json({ processing: false, error: data._processingError });
    } else {
      const { _processing: _p, _processingError: _e, ...rest } = data;
      res.json({ processing: false, deal: { ...enrichTenants(rest, aliasMap), id } });
    }
  } catch (err) {
    req.log.error({ err }, "Failed to check deal status");
    res.status(500).json({ error: "Failed to check status" });
  }
});

// GET /api/deals/:id/source
router.get("/deals/:id/source", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const rows = await db.select().from(dealSourcesTable).where(eq(dealSourcesTable.id, id));
    res.json({ text: rows[0]?.sourceText ?? null });
  } catch (err) {
    req.log.error({ err }, "Failed to load source");
    res.status(500).json({ error: "Failed to load source" });
  }
});

// PUT /api/deals/:id/source
router.put("/deals/:id/source", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const { text } = req.body as { text?: string };
    await db.insert(dealSourcesTable)
      .values({ id, sourceText: text ?? null })
      .onConflictDoUpdate({ target: dealSourcesTable.id, set: { sourceText: text ?? null } });
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to save source");
    res.status(500).json({ error: "Failed to save source" });
  }
});

// POST /api/deals/:id/reanalyze
// Re-runs AI extraction from the stored source text, preserving all user-entered fields.
router.post("/deals/:id/reanalyze", requireAuth, async (req, res) => {
  const id = req.params.id as string;

  try {
    // Load existing deal data + source text
    const [dealRows, srcRows] = await Promise.all([
      db.select().from(dealsTable).where(eq(dealsTable.id, id)),
      db.select().from(dealSourcesTable).where(eq(dealSourcesTable.id, id)),
    ]);

    if (!dealRows.length) {
      res.status(404).json({ error: "Deal not found" });
      return;
    }
    const existing = dealRows[0].data as Record<string, unknown>;
    const sourceText = srcRows[0]?.sourceText ?? null;

    if (!sourceText) {
      res.status(422).json({ error: "No stored source text for this deal — upload the PDF again to re-extract." });
      return;
    }

    // Build processing snapshot preserving all user fields
    const userFields: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(existing)) {
      if (USER_PRESERVED_KEYS.has(k)) userFields[k] = v;
    }
    const processingData: Record<string, unknown> = {
      ...userFields,
      _processing: true,
      fileName: existing.fileName || "Unknown",
    };

    await db.update(dealsTable)
      .set({ data: processingData, updatedAt: new Date() })
      .where(eq(dealsTable.id, id));

    // Return immediately — extraction runs in background
    res.json({ id, processing: true });

    // Fire background re-analysis
    setImmediate(() => {
      (async () => {
        try {
          const { data: extracted } = await runOmExtraction(sourceText);
          const dealData: Record<string, unknown> = {
            ...extracted,
            ...userFields,
            _processing: false,
            fileName: existing.fileName || "Unknown",
          };
          await db.update(dealsTable)
            .set({ data: dealData, updatedAt: new Date() })
            .where(eq(dealsTable.id, id));
          await rebuildTenantIndex(id, dealData);
          req.log.info({ id }, "Re-analysis complete");
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : "Re-analysis failed";
          req.log.error({ err, id }, "Re-analysis failed");
          await db.update(dealsTable)
            .set({ data: { ...userFields, _processing: false, _processingError: errorMsg, fileName: existing.fileName || "Unknown" }, updatedAt: new Date() })
            .where(eq(dealsTable.id, id));
        }
      })().catch(() => {});
    });
  } catch (err) {
    req.log.error({ err }, "Failed to start re-analysis");
    res.status(500).json({ error: "Failed to start re-analysis" });
  }
});

export default router;
