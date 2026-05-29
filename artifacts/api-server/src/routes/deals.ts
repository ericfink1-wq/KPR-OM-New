import { Router } from "express";
import { db } from "@workspace/db";
import { dealsTable, dealImagesTable, dealSourcesTable, tenantAliasesTable, tenantIndexTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { runOmExtraction } from "../lib/extract";
import { rebuildTenantIndex } from "../lib/tenantIndex";
import { augmentScoringWithBenchmarks, getTotalDealCount, rescoreDeal } from "../lib/tenantBenchmarks";
import { rebuildCompsIndex, syncOwnTransactionComps } from "../lib/compsIndex";
import { fetchCensusDemographics } from "../lib/demographics";

function composeAddressForGeocoder(deal: {
  address?: string | null;
  city?: string | null;
  state?: string | null;
}): string | null {
  const parts = [deal.address, deal.city, deal.state]
    .map(s => (typeof s === "string" ? s.trim() : ""))
    .filter(Boolean);
  if (parts.length === 0) return null;
  const street = parts[0];
  if (parts.length === 1 && /,.*\b[A-Z]{2}\b/.test(street)) return street;
  return parts.join(", ");
}

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

function requireAdmin(req: Parameters<Router>[0], res: Parameters<Router>[1], next: Parameters<Router>[2]) {
  if (!req.session.authenticated) {
    res.status(401).json({ error: "Not authenticated" });
    return;
  }
  if (!req.session.isAdmin) {
    res.status(403).json({ error: "Admin access required" });
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
  "prefLender", "prefAmount", "prefRateCurrent", "prefRateAllIn", "prefReturnType", "prefOriginationDate", "prefMaturityDate", "prefTermYears", "prefRecourse", "prefNotes",
  "tenantSalesHistory",
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

// POST /api/deals/import — smart merge/upsert for JSON deal uploads
// Matches on propertyName + address (case-insensitive); preserves USER_PRESERVED_KEYS on merge.
// All deal fields are stored in the `data` jsonb column — no per-field schema constraints.
// JSON-roundtrip sanitization strips any undefined/non-serializable values before every DB write.
router.post("/deals/import", requireAuth, async (req, res) => {
  try {
    // Sanitize helper — strips undefined and any non-JSON-safe values
    function sanitize(obj: Record<string, unknown>): Record<string, unknown> {
      try {
        return JSON.parse(JSON.stringify(obj)) as Record<string, unknown>;
      } catch (e) {
        console.error("[import] sanitize failed:", e);
        throw e;
      }
    }

    const body = req.body as Record<string, unknown>;
    req.log.info({ propertyName: body.propertyName, keys: Object.keys(body).length }, "import deal request");

    const { id: uploadedId, ...uploadedData } = body;

    const normName = typeof uploadedData.propertyName === "string"
      ? uploadedData.propertyName.trim().toLowerCase() : null;

    // Normalize an address string for fuzzy matching (abbreviates common suffixes)
    function normalizeAddr(a: unknown): string | null {
      if (typeof a !== "string") return null;
      return a.trim().toLowerCase()
        .replace(/[.,]/g, "")
        .replace(/\broad\b/g, "rd").replace(/\bstreet\b/g, "st")
        .replace(/\bavenue\b/g, "ave").replace(/\bboulevard\b/g, "blvd")
        .replace(/\bdrive\b/g, "dr").replace(/\blane\b/g, "ln")
        .replace(/\bparkway\b/g, "pkwy").replace(/\bsuite\b.*$/g, "")
        .replace(/\s+/g, " ").trim() || null;
    }

    const normAddr = normalizeAddr(uploadedData.address);

    // Scan for an existing deal with matching propertyName (required) + address (when both sides have one)
    let existingRow: { id: string; data: Record<string, unknown> } | null = null;
    if (normName) {
      const allRows = await db.select().from(dealsTable);
      for (const row of allRows) {
        const d = row.data as Record<string, unknown>;
        const eName = typeof d.propertyName === "string" ? d.propertyName.trim().toLowerCase() : null;
        if (eName !== normName) continue;
        const eAddr = normalizeAddr(d.address);
        // Address must match when both sides have one; ignored when either is absent
        if (normAddr && eAddr && normAddr !== eAddr) continue;
        existingRow = { id: row.id, data: d };
        break;
      }
    }

    if (existingRow) {
      // MERGE — overlay extracted fields from upload, keep user-entered fields from DB
      const merged: Record<string, unknown> = { ...uploadedData };
      for (const [k, v] of Object.entries(existingRow.data)) {
        if (USER_PRESERVED_KEYS.has(k) || k.startsWith("user_") || k.startsWith("custom_")) {
          merged[k] = v;
        }
      }
      // Always keep identity fields from the existing record
      merged.propertyName = existingRow.data.propertyName ?? uploadedData.propertyName;
      merged.address = existingRow.data.address ?? uploadedData.address;

      const id = existingRow.id;
      const clean = sanitize(merged);
      req.log.info({ id, fieldCount: Object.keys(clean).length }, "import merge: updating existing deal");
      try {
        await db.update(dealsTable)
          .set({ data: clean, updatedAt: new Date() })
          .where(eq(dealsTable.id, id));
      } catch (dbErr) {
        console.error("[import] DB update failed, id=", id, dbErr);
        req.log.error({ err: dbErr, id }, "import DB update failed");
        throw dbErr;
      }
      setImmediate(() => {
        rebuildTenantIndex(id, clean).catch(() => {});
        rebuildCompsIndex(id, clean).catch(() => {});
      });
      res.json({ ok: true, id, merged: true, propertyName: String(clean.propertyName ?? "") });
    } else {
      // NEW — insert as a fresh deal
      const id = typeof uploadedId === "string" && uploadedId
        ? uploadedId
        : `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
      const clean = sanitize(uploadedData);
      req.log.info({ id, fieldCount: Object.keys(clean).length }, "import new: inserting deal");
      try {
        await db.insert(dealsTable).values({ id, data: clean });
      } catch (dbErr) {
        console.error("[import] DB insert failed, id=", id, dbErr);
        req.log.error({ err: dbErr, id }, "import DB insert failed");
        throw dbErr;
      }
      setImmediate(() => {
        rebuildTenantIndex(id, clean).catch(() => {});
        rebuildCompsIndex(id, clean).catch(() => {});
        if (!clean.marketDemographics && !clean.demoChecked) {
          (async () => {
            const composed = composeAddressForGeocoder(clean as { address?: string | null; city?: string | null; state?: string | null });
            if (!composed) return;
            try {
              const demo = await fetchCensusDemographics(composed);
              if (demo) {
                const rows = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
                if (rows.length) {
                  const current = rows[0].data as Record<string, unknown>;
                  await db.update(dealsTable)
                    .set({ data: { ...current, marketDemographics: demo, demoChecked: new Date().toISOString() }, updatedAt: new Date() })
                    .where(eq(dealsTable.id, id));
                }
              }
            } catch {}
          })();
        }
      });
      res.status(201).json({ ok: true, id, merged: false, propertyName: String(clean.propertyName ?? "") });
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[import] top-level error:", err);
    req.log.error({ err }, "Failed to import deal");
    res.status(500).json({ error: msg });
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
    setImmediate(() => { syncOwnTransactionComps(id, rest).catch(() => {}); });
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
      // Auto-fetch demographics for new deals that have an address but no demo data yet
      if (!rest.marketDemographics && !rest.demoChecked) {
        (async () => {
          const composed = composeAddressForGeocoder(rest as { address?: string | null; city?: string | null; state?: string | null });
          if (!composed) return;
          try {
            const demo = await fetchCensusDemographics(composed);
            if (demo) {
              const rows = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
              if (rows.length) {
                const current = rows[0].data as Record<string, unknown>;
                await db.update(dealsTable)
                  .set({
                    data: { ...current, marketDemographics: demo, demoChecked: new Date().toISOString() },
                    updatedAt: new Date(),
                  })
                  .where(eq(dealsTable.id, id));
              }
            }
          } catch {}
        })();
      }
    });
  } catch (err) {
    req.log.error({ err }, "Failed to upsert deal");
    res.status(500).json({ error: "Failed to upsert deal" });
  }
});

// DELETE /api/deals/:id — delete a deal and its images/source (admin only)
router.delete("/deals/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id as string;
    await db.delete(dealImagesTable).where(eq(dealImagesTable.id, id));
    await db.delete(dealSourcesTable).where(eq(dealSourcesTable.id, id));
    await db.delete(tenantIndexTable).where(eq(tenantIndexTable.dealId, id));
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

// POST /api/deals/:id/rescore — re-run benchmark scoring against latest tenant_index, no PDF needed
router.post("/deals/:id/rescore", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  try {
    const rows = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
    if (!rows.length) { res.status(404).json({ error: "Deal not found" }); return; }

    const currentData = rows[0].data as Record<string, unknown>;
    const patch = await rescoreDeal(id, currentData, req.log);

    const updated: Record<string, unknown> = {
      ...currentData,
      ...(patch.dealScore !== undefined ? { dealScore: patch.dealScore } : {}),
      ...(patch.redFlags !== undefined ? { redFlags: patch.redFlags } : {}),
      lastScoredAt: patch.lastScoredAt,
      lastScoredDealCount: patch.lastScoredDealCount,
    };
    await db.update(dealsTable)
      .set({ data: updated, updatedAt: new Date() })
      .where(eq(dealsTable.id, id));

    req.log.info({ id, lastScoredDealCount: patch.lastScoredDealCount }, "Deal rescored");
    res.json(patch);
  } catch (err) {
    req.log.error({ err, id }, "Rescore failed");
    res.status(500).json({ error: "Rescore failed" });
  }
});

// POST /api/deals/:id/refresh-demographics
router.post("/deals/:id/refresh-demographics", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const rows = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
    if (!rows.length) { res.status(404).json({ error: "Deal not found" }); return; }
    const current = rows[0].data as Record<string, unknown>;
    const composed = composeAddressForGeocoder(current as { address?: string | null; city?: string | null; state?: string | null });
    if (!composed) {
      res.status(400).json({ error: "Deal has no address" });
      return;
    }
    const demo = await fetchCensusDemographics(composed);
    await db.update(dealsTable)
      .set({
        data: { ...current, marketDemographics: demo, demoChecked: new Date().toISOString() },
        updatedAt: new Date(),
      })
      .where(eq(dealsTable.id, id));
    res.json({ ok: true, marketDemographics: demo });
  } catch (err) {
    req.log.error({ err }, "Failed to refresh demographics");
    res.status(500).json({ error: "Failed to refresh demographics" });
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
          const { data: rawExtracted } = await runOmExtraction(sourceText);
          const [augmented, totalCount] = await Promise.all([
            augmentScoringWithBenchmarks(id, rawExtracted, req.log),
            getTotalDealCount(),
          ]);
          const dealData: Record<string, unknown> = {
            ...augmented,
            ...userFields,
            _processing: false,
            fileName: existing.fileName || "Unknown",
            lastScoredAt: new Date().toISOString(),
            lastScoredDealCount: totalCount,
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
