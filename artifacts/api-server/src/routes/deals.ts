import { Router } from "express";
import { db } from "@workspace/db";
import { dealsTable, dealImagesTable, dealSourcesTable, tenantAliasesTable, tenantIndexTable, compsIndexTable } from "@workspace/db";
import { eq, isNotNull } from "drizzle-orm";
import { runOmExtraction, runRosterAnalysis } from "../lib/extract";
import { rebuildTenantIndex } from "../lib/tenantIndex";
import { augmentScoringWithBenchmarks, getTotalDealCount, rescoreDeal } from "../lib/tenantBenchmarks";
import { rebuildCompsIndex, syncOwnTransactionComps } from "../lib/compsIndex";
import { fetchCensusDemographics } from "../lib/demographics";
import { ANALYSIS_VERSION } from "../lib/analysisVersion";
import { requireAuth } from "../middleware/auth";
import type { Logger } from "pino";

// Run the deterministic portfolio-comparison analytics (rescoreDeal) for an
// imported deal and merge the result back. The JSON's self-contained grade is
// the baseline (so we only rescore when one exists); benchmarks then adjust it
// and layer in benchmark red flags. Fully non-fatal — errors are swallowed.
async function autoRescoreOnImport(id: string, clean: Record<string, unknown>, log: Logger): Promise<void> {
  try {
    if (!clean.dealScore) return; // no baseline grade to augment — skip
    const patch = await rescoreDeal(id, clean, log);
    if (patch && Object.keys(patch).length > 0) {
      const [row] = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
      if (!row) return;
      const cur = row.data as Record<string, unknown>;
      await db.update(dealsTable)
        .set({ data: { ...cur, ...patch }, updatedAt: new Date() })
        .where(eq(dealsTable.id, id));
    }
  } catch {
    /* non-fatal — swallow silently */
  }
}

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

// Fields entered by humans — preserved across re-analysis so user data is never overwritten
const USER_PRESERVED_KEYS = new Set([
  "status", "statusSince", "autoPassed",
  "userNotes", "dealThesis",
  "txnPurchasePrice", "txnSeller", "txnLoiDate", "txnCloseDate",
  "txnSalePrice", "txnBuyer", "txnSaleDate", "txnBroker",
  "acqCapRate", "acqNOIAtClose", "acqEntity", "acqBroker", "acqContractDate", "acqDDExpiration",
  "acqDeposit", "acqClosingCosts", "acqFee", "acqTitleCo", "acqCounsel", "acqPropManager",
  "acqStrategy", "acqHoldPeriod", "acqTargetIRR", "acqNotes",
  "debtLender", "debtType", "debtLoanAmount", "debtRate", "debtMaturityDate", "debtNotes",
  "prepayTerms", "interestRateSwap",
  "marketSale", "marketSaleChecked",
  "marketDemographics", "demoChecked",
  "verified", "propertyGroupId", "editHistory",
  "trashedAt", "uploadedAt", "fileName", "pdfPages", "imageMeta", "dealScore",
  "prefLender", "prefAmount", "prefRateCurrent", "prefRateAllIn", "prefReturnType", "prefOriginationDate", "prefMaturityDate", "prefTermYears", "prefRecourse", "prefNotes",
  "tenantSalesHistory",
  "ownershipStructure",
]);

// Known Deal fields that must be arrays. A malformed extraction can return one as
// an object/string; coerce those to [] so the bad value can never persist and
// later crash the UI with ".map is not a function". Null/undefined left as-is.
const DEAL_ARRAY_FIELDS = ["tenants", "cashFlowProjection", "redFlags", "upsideItems", "keyAssumptions", "shadowAnchors", "comparableSales", "tenantSalesHistory", "reviewQuestions"];
function coerceDealArrays(data: Record<string, unknown>): Record<string, unknown> {
  let out = data;
  for (const f of DEAL_ARRAY_FIELDS) {
    if (data[f] != null && !Array.isArray(data[f])) {
      if (out === data) out = { ...data };
      out[f] = [];
    }
  }
  return out;
}

// Title-case an ALL-CAPS name (OM covers are often all-caps) for display, leaving
// any name that already has lowercase letters untouched. Small connector words
// stay lowercase except as the first word. Does not change stored data.
const TITLE_SMALL_WORDS = new Set(["of", "the", "and", "at", "in", "on", "to", "for", "a", "an", "by", "vs"]);
function prettyName(name: unknown): unknown {
  if (typeof name !== "string" || name.trim().length < 2 || /[a-z]/.test(name)) return name;
  let wi = 0;
  return name.toLowerCase().split(/(\s+)/).map(tok => {
    if (/^\s*$/.test(tok)) return tok;
    const first = wi++ === 0;
    if (!first && TITLE_SMALL_WORDS.has(tok)) return tok;
    return tok.charAt(0).toUpperCase() + tok.slice(1);
  }).join("");
}

// GET /api/deals — list all deals (excludes in-progress ingests)
router.get("/deals", requireAuth, async (req, res) => {
  try {
    const [rows, aliasMap, coverIdRows, thumbIdRows] = await Promise.all([
      db.select().from(dealsTable).orderBy(dealsTable.createdAt),
      loadAliasMap(),
      // Which deals actually have a stored cover image (cheap — ids only). Lets us
      // keep imageMeta.cover accurate so the Deal Library tile always shows the
      // photo, even if the flag on the deal record was never set.
      db.select({ id: dealImagesTable.id }).from(dealImagesTable).where(isNotNull(dealImagesTable.cover)),
      // …and which have a small thumbnail, so the client can backfill the ones
      // that don't (those would otherwise serve the full-size cover).
      db.select({ id: dealImagesTable.id }).from(dealImagesTable).where(isNotNull(dealImagesTable.coverThumb)),
    ]);
    const coverSet = new Set(coverIdRows.map(c => c.id));
    const thumbSet = new Set(thumbIdRows.map(c => c.id));
    const deals = rows
      .filter(r => !r.data._processing)
      .map(r => {
        const { _processing: _p, _processingError: _e, ...rest } = r.data;
        const out = { ...enrichTenants(rest, aliasMap), id: r.id, updatedAt: r.updatedAt } as Record<string, unknown>;
        out.propertyName = prettyName(out.propertyName);   // tidy ALL-CAPS names for display/exports (stored value unchanged)
        if (coverSet.has(r.id)) {
          out.imageMeta = { ...((out.imageMeta as Record<string, unknown>) || {}), cover: true, thumb: thumbSet.has(r.id) };
        }
        return out;
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
        return coerceDealArrays(JSON.parse(JSON.stringify(obj)) as Record<string, unknown>);
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
        void (async () => {
          try { await rebuildTenantIndex(id, clean); } catch { /* non-fatal */ }
          try { await rebuildCompsIndex(id, clean); } catch { /* non-fatal */ }
          await autoRescoreOnImport(id, clean, req.log);
        })();
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
        void (async () => {
          try { await rebuildTenantIndex(id, clean); } catch { /* non-fatal */ }
          try { await rebuildCompsIndex(id, clean); } catch { /* non-fatal */ }
          await autoRescoreOnImport(id, clean, req.log);
          if (!clean.marketDemographics && !clean.demoChecked) {
            const composed = composeAddressForGeocoder(clean as { address?: string | null; city?: string | null; state?: string | null });
            if (composed) {
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
            }
          }
        })();
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
    const { id, ...rest0 } = req.body as Record<string, unknown>;
    if (!id || typeof id !== "string") {
      res.status(400).json({ error: "id is required" });
      return;
    }
    const rest = coerceDealArrays(rest0);
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
    const { id: _bodyId, ...rest0 } = req.body as Record<string, unknown>;
    const rest = coerceDealArrays(rest0);
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

// DELETE /api/deals/:id — permanently delete a deal and its images/source/index
// (any signed-in user; the UI confirms before calling this).
router.delete("/deals/:id", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    await db.delete(dealImagesTable).where(eq(dealImagesTable.id, id));
    await db.delete(dealSourcesTable).where(eq(dealSourcesTable.id, id));
    await db.delete(tenantIndexTable).where(eq(tenantIndexTable.dealId, id));
    await db.delete(compsIndexTable).where(eq(compsIndexTable.sourceDealId, id));
    await db.delete(dealsTable).where(eq(dealsTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to delete deal");
    res.status(500).json({ error: "Failed to delete deal" });
  }
});

// GET /api/deals/:id/cover-thumb — the cover as a cacheable BINARY image, so the
// Deal Library can lazy-load covers via <img> (browser-cached, only visible rows)
// instead of fetching the full image bundle per tile. Prefers the small thumb.
router.get("/deals/:id/cover-thumb", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const rows = await db.select({ cover: dealImagesTable.cover, coverThumb: dealImagesTable.coverThumb })
      .from(dealImagesTable).where(eq(dealImagesTable.id, id));
    // ?full=1 forces the full cover (used by the thumbnail backfill to regenerate
    // a crisp thumb); otherwise prefer the small thumb.
    const src = req.query.full ? (rows[0]?.cover || rows[0]?.coverThumb) : (rows[0]?.coverThumb || rows[0]?.cover);
    const m = src ? /^data:([^;]+);base64,([\s\S]*)$/.exec(src) : null;
    if (!m) { res.status(404).end(); return; }
    res.set("Content-Type", m[1]);
    // Versioned by ?v=updatedAt on the client, so this can cache hard and still
    // refresh when the cover changes.
    res.set("Cache-Control", "private, max-age=86400");
    res.send(Buffer.from(m[2], "base64"));
  } catch (err) {
    req.log.error({ err }, "Failed to load cover thumb");
    res.status(500).end();
  }
});

// PUT /api/deals/:id/cover-thumb — update ONLY the coverThumb column (used by the
// thumbnail backfill to upgrade small/legacy thumbs without rewriting the bundle).
router.put("/deals/:id/cover-thumb", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const thumb = (req.body as { coverThumb?: string }).coverThumb;
    if (typeof thumb !== "string" || !thumb) { res.status(400).json({ error: "coverThumb required" }); return; }
    await db.update(dealImagesTable).set({ coverThumb: thumb }).where(eq(dealImagesTable.id, id));
    res.json({ ok: true });
  } catch (err) {
    req.log.error({ err }, "Failed to update cover thumb");
    res.status(500).json({ error: "Failed to update cover thumb" });
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

    // Guard: if the roster was manually updated, refuse to overwrite unless explicitly confirmed.
    const overwriteRoster = (req.body as Record<string, unknown> | undefined)?.overwriteRoster === true;
    if (existing.tenantsManual === true && !overwriteRoster) {
      res.status(409).json({
        error: "roster_manual",
        message: "This deal's roster was manually updated (as of " + String(existing.tenantsAsOf ?? "recent") + "). Re-analyzing from the stored OM would replace it with the OM's older tenants. Use 'Refresh Analysis (current roster)' instead, or confirm to overwrite.",
        tenantsAsOf: existing.tenantsAsOf ?? null,
      });
      return;
    }

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
            analysisVersion: ANALYSIS_VERSION,
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

// POST /api/deals/:id/refresh-analysis
// Regenerate the narrative (summary, grade, strengths/risks, upside, red flags) from the
// CURRENT roster + financials — NOT the stored OM. Preserves tenants and every other field,
// then layers the deterministic portfolio-benchmark pass and clears the stale flag.
router.post("/deals/:id/refresh-analysis", requireAuth, async (req, res) => {
  const id = req.params.id as string;
  try {
    const rows = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
    if (!rows.length) { res.status(404).json({ error: "Deal not found" }); return; }
    const current = rows[0].data as Record<string, unknown>;
    const tenantCount = Array.isArray(current.tenants) ? (current.tenants as unknown[]).length : 0;
    if (tenantCount === 0) {
      res.status(422).json({ error: "This deal has no roster to analyze. Add tenants first." });
      return;
    }

    // 1) Regenerate narrative from the live roster
    const analysis = await runRosterAnalysis(current);
    const updated: Record<string, unknown> = { ...current, ...analysis, analysisStale: false, analysisVersion: ANALYSIS_VERSION };

    // 2) Layer the portfolio-benchmark pass (augments dealScore + red flags; keeps qualitative flags)
    try {
      const patch = await rescoreDeal(id, updated, req.log);
      if (patch.dealScore !== undefined) updated.dealScore = patch.dealScore;
      if (patch.redFlags !== undefined) updated.redFlags = patch.redFlags;
      updated.lastScoredAt = patch.lastScoredAt;
      updated.lastScoredDealCount = patch.lastScoredDealCount;
    } catch (e) {
      req.log.warn({ err: e, id }, "rescore after refresh-analysis failed (non-fatal)");
    }

    const clean = JSON.parse(JSON.stringify(updated)) as Record<string, unknown>;
    await db.update(dealsTable).set({ data: clean, updatedAt: new Date() }).where(eq(dealsTable.id, id));
    setImmediate(() => { rebuildTenantIndex(id, clean).catch(() => {}); });
    req.log.info({ id }, "Analysis refreshed from current roster");
    res.json({
      ok: true,
      notes: clean.notes, dealScore: clean.dealScore,
      upsideItems: clean.upsideItems, redFlags: clean.redFlags,
      analysisStale: false,
    });
  } catch (err) {
    req.log.error({ err, id }, "refresh-analysis failed");
    res.status(500).json({ error: err instanceof Error ? err.message : "Refresh analysis failed" });
  }
});

// POST /api/deals/score-unscored — generate a grade for every deal that has no
// dealScore yet (e.g. imported via JSON without a self-contained grade), using
// the same roster analysis the per-deal "Refresh Analysis" action runs.
router.post("/deals/score-unscored", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(dealsTable);
    const targets = rows.filter((r) => {
      const d = r.data as Record<string, unknown>;
      return !d.trashedAt && !d._processing && !d.dealScore;
    });
    let scored = 0, failed = 0;
    for (const r of targets) {
      const data = r.data as Record<string, unknown>;
      try {
        const analysis = await runRosterAnalysis(data);
        await db.update(dealsTable)
          .set({ data: { ...data, ...analysis, analysisVersion: ANALYSIS_VERSION }, updatedAt: new Date() })
          .where(eq(dealsTable.id, r.id));
        scored++;
      } catch (err) {
        req.log.error({ err, id: r.id }, "score-unscored: failed for deal");
        failed++;
      }
    }
    res.json({ ok: true, scored, failed, total: targets.length });
  } catch (err) {
    req.log.error({ err }, "Failed to score unscored deals");
    res.status(500).json({ error: "Failed to score unscored deals" });
  }
});

// GET /api/deals/stale-analysis-count — how many active, scored deals are behind
// the current ANALYSIS_VERSION (i.e. their saved narrative predates the latest
// scoring logic). Cheap, no tokens. Used to show/size the refresh badge + button.
router.get("/deals/stale-analysis-count", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(dealsTable);
    const stale = rows.filter((r) => {
      const d = r.data as Record<string, unknown>;
      if (d.trashedAt || d._processing || d._processingError) return false;
      if (!d.dealScore) return false; // nothing to refresh yet
      const v = typeof d.analysisVersion === "number" ? d.analysisVersion : 0;
      return v < ANALYSIS_VERSION;
    });
    res.json({ count: stale.length, currentVersion: ANALYSIS_VERSION });
  } catch (err) {
    req.log.error({ err }, "Failed to count stale analysis");
    res.status(500).json({ error: "Failed to count stale analysis" });
  }
});

// POST /api/deals/refresh-stale-analysis — bulk-refresh the AI narrative for every
// active, scored deal whose analysisVersion is behind the current logic. Idempotent:
// deals already at the current version are skipped, so re-running spends tokens only
// on what's actually stale. Uses the cheap roster-analysis (Haiku) pass per deal.
router.post("/deals/refresh-stale-analysis", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(dealsTable);
    const targets = rows.filter((r) => {
      const d = r.data as Record<string, unknown>;
      if (d.trashedAt || d._processing || d._processingError) return false;
      if (!d.dealScore) return false;
      const tenantCount = Array.isArray(d.tenants) ? (d.tenants as unknown[]).length : 0;
      if (tenantCount === 0) return false; // nothing to analyze from
      const v = typeof d.analysisVersion === "number" ? d.analysisVersion : 0;
      return v < ANALYSIS_VERSION;
    });

    let refreshed = 0, failed = 0;
    for (const r of targets) {
      const data = r.data as Record<string, unknown>;
      try {
        const analysis = await runRosterAnalysis(data);
        const updated: Record<string, unknown> = { ...data, ...analysis, analysisStale: false, analysisVersion: ANALYSIS_VERSION };
        try {
          const patch = await rescoreDeal(r.id, updated, req.log);
          if (patch.dealScore !== undefined) updated.dealScore = patch.dealScore;
          if (patch.redFlags !== undefined) updated.redFlags = patch.redFlags;
          updated.lastScoredAt = patch.lastScoredAt;
          updated.lastScoredDealCount = patch.lastScoredDealCount;
        } catch { /* benchmark layer non-fatal */ }
        const clean = JSON.parse(JSON.stringify(updated)) as Record<string, unknown>;
        await db.update(dealsTable).set({ data: clean, updatedAt: new Date() }).where(eq(dealsTable.id, r.id));
        rebuildTenantIndex(r.id, clean).catch(() => {});
        refreshed++;
      } catch (err) {
        req.log.error({ err, id: r.id }, "refresh-stale-analysis: failed for deal");
        failed++;
      }
    }
    req.log.info({ refreshed, failed, total: targets.length }, "Bulk stale-analysis refresh complete");
    res.json({ ok: true, refreshed, failed, total: targets.length });
  } catch (err) {
    req.log.error({ err }, "Failed to refresh stale analysis");
    res.status(500).json({ error: "Failed to refresh stale analysis" });
  }
});

export default router;
