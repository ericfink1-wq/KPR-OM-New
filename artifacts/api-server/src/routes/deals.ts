import express, { Router } from "express";
import { db, pool } from "@workspace/db";
import { dealsTable, dealImagesTable, dealSourcesTable, tenantAliasesTable, tenantIndexTable, compsIndexTable, leaseAbstractsTable } from "@workspace/db";
import { eq, isNotNull, sql } from "drizzle-orm";
import { runOmExtraction, runRosterAnalysis, loadLeaseRiskSummary, autoUpdateHouseViewOnReview } from "../lib/extract";
import { rebuildTenantIndex } from "../lib/tenantIndex";
import { augmentScoringWithBenchmarks, getTotalDealCount, rescoreDeal } from "../lib/tenantBenchmarks";
import { rebuildCompsIndex, syncOwnTransactionComps } from "../lib/compsIndex";
import { fetchCensusDemographics, fetchAddressMarket, MARKET_GEO_VERSION } from "../lib/demographics";
import { ANALYSIS_VERSION } from "../lib/analysisVersion";
import { auditExtraction, AUDIT_ID_PREFIX, auditCheckKey, AUDIT_CHECK_LABELS } from "../lib/extractionAudit";
import { createSnapshot } from "./snapshots";
import { requireAuth, requireAdmin } from "../middleware/auth";
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

// US state names → abbreviations, for confidently detecting the "CITY, ST ZIP"
// tail of an address string (so a suite/route line isn't mistaken for a state).
const US_STATES: Record<string, string> = {
  alabama: "AL", alaska: "AK", arizona: "AZ", arkansas: "AR", california: "CA",
  colorado: "CO", connecticut: "CT", delaware: "DE", "district of columbia": "DC",
  florida: "FL", georgia: "GA", hawaii: "HI", idaho: "ID", illinois: "IL", indiana: "IN",
  iowa: "IA", kansas: "KS", kentucky: "KY", louisiana: "LA", maine: "ME", maryland: "MD",
  massachusetts: "MA", michigan: "MI", minnesota: "MN", mississippi: "MS", missouri: "MO",
  montana: "MT", nebraska: "NE", nevada: "NV", "new hampshire": "NH", "new jersey": "NJ",
  "new mexico": "NM", "new york": "NY", "north carolina": "NC", "north dakota": "ND",
  ohio: "OH", oklahoma: "OK", oregon: "OR", pennsylvania: "PA", "rhode island": "RI",
  "south carolina": "SC", "south dakota": "SD", tennessee: "TN", texas: "TX", utah: "UT",
  vermont: "VT", virginia: "VA", washington: "WA", "west virginia": "WV", wisconsin: "WI",
  wyoming: "WY", "puerto rico": "PR",
};
const US_STATE_ABBRS = new Set(Object.values(US_STATES));

// Split a free-text US address ("248 Flanders Road, East Lyme, CT 06357") into its
// parts, working right-to-left. Returns null unless a real state or ZIP is found,
// so a plain street ("248 Flanders Road") or a suite/route line is left untouched.
function parseUsAddress(full: string): { street: string; city: string | null; state: string | null; zip: string | null } | null {
  let s = full.trim().replace(/\s+/g, " ");
  let zip: string | null = null;
  let state: string | null = null;

  const zipM = s.match(/[, ]\s*(\d{5}(?:-\d{4})?)\s*$/);
  if (zipM && zipM.index !== undefined) { zip = zipM[1]; s = s.slice(0, zipM.index).trim().replace(/,\s*$/, ""); }

  // Trailing state: 2-letter abbreviation or a full state name. Only commit the
  // strip when a ZIP was already found or a comma (i.e. a city) still precedes it —
  // otherwise a city that happens to look like a state ("…, Washington") is safe.
  const abbrM = s.match(/[, ]\s*([A-Za-z]{2})\s*$/);
  const nameM = s.match(/[,]\s*([A-Za-z][A-Za-z .]+?)\s*$/);
  if (abbrM && abbrM.index !== undefined && US_STATE_ABBRS.has(abbrM[1].toUpperCase())) {
    const after = s.slice(0, abbrM.index).trim().replace(/,\s*$/, "");
    if (zip !== null || after.includes(",")) { state = abbrM[1].toUpperCase(); s = after; }
  } else if (nameM && nameM.index !== undefined && US_STATES[nameM[1].trim().toLowerCase()]) {
    const after = s.slice(0, nameM.index).trim().replace(/,\s*$/, "");
    if (zip !== null || after.includes(",")) { state = US_STATES[nameM[1].trim().toLowerCase()]; s = after; }
  }

  if (!state && !zip) return null;  // not confidently a combined address

  // Whatever remains is "STREET, CITY" (city = last comma segment) or just "STREET".
  let city: string | null = null;
  let street = s;
  const ci = s.lastIndexOf(",");
  if (ci !== -1) { city = s.slice(ci + 1).trim() || null; street = s.slice(0, ci).trim(); }
  return { street, city, state, zip };
}

// When the street field actually holds a full "street, city, state zip" string,
// reduce it to just the street and backfill any blank city/state/zip. Only rewrites
// the street when a city was positively identified (so a street we're unsure about
// is never destroyed), and never overwrites a city/state/zip already populated.
function normalizeDealAddress(data: Record<string, unknown>): void {
  const raw = typeof data.address === "string" ? data.address.trim() : "";
  if (!raw) return;
  const parsed = parseUsAddress(raw);
  if (!parsed) return;
  const blank = (v: unknown) => !(typeof v === "string" && v.trim());
  if (parsed.city && parsed.street && parsed.street !== raw) data.address = parsed.street;
  if (parsed.city && blank(data.city)) data.city = parsed.city;
  if (parsed.state && blank(data.state)) data.state = parsed.state;
  if (parsed.zip && blank(data.zip)) data.zip = parsed.zip;
}

// Auto-derive Market / Submarket from the address when the OM didn't state them.
// Fills ONLY blank fields (an OM-stated or hand-entered market always wins), reuses
// a prior derivation when present (so the free geocoder is hit at most once), and
// stamps marketGeoChecked so a blank result isn't retried on every save. Mirrors the
// auto-demographics pattern; safe to call in the background (re-reads the row before
// writing so it never clobbers a concurrent update).
async function maybeFillMarketFromAddress(id: string, data: Record<string, unknown>): Promise<void> {
  const market = typeof data.market === "string" ? data.market.trim() : "";
  const submarket = typeof data.submarket === "string" ? data.submarket.trim() : "";
  if (market && submarket) return;                       // nothing blank to fill
  const composed = composeAddressForGeocoder(data as { address?: string | null; city?: string | null; state?: string | null });
  if (!composed) return;                                 // no address yet

  // Only hit the geocoder when we haven't already derived with the CURRENT logic.
  // `marketGeoVersion` is stamped on every attempt (even one that found nothing), so
  // an unresolvable address isn't re-fetched on every save — but a cache from older
  // logic (e.g. before layers=all) IS re-fetched, so deals saved earlier backfill
  // their market. A current-but-blank cache is final: nothing more to find here.
  const cached = (data.marketGeo ?? null) as { market?: string | null; submarket?: string | null } | null;
  const alreadyCurrent = data.marketGeoVersion === MARKET_GEO_VERSION;
  const geo = alreadyCurrent ? cached : await fetchAddressMarket(composed);
  if (alreadyCurrent && !geo) return;                    // already tried, nothing to apply

  const rows = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
  if (!rows.length) return;
  const current = rows[0].data as Record<string, unknown>;
  const curMarket = typeof current.market === "string" ? current.market.trim() : "";
  const curSub = typeof current.submarket === "string" ? current.submarket.trim() : "";

  const patch: Record<string, unknown> = {
    marketGeoChecked: new Date().toISOString(),
    marketGeoVersion: MARKET_GEO_VERSION,
  };
  if (geo) {
    patch.marketGeo = geo;
    if (!curMarket && geo.market) patch.market = geo.market;
    if (!curSub && geo.submarket) patch.submarket = geo.submarket;
  }
  await db.update(dealsTable)
    .set({ data: { ...current, ...patch }, updatedAt: new Date() })
    .where(eq(dealsTable.id, id));
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
  "userNotes", "dealThesis", "dealReview",
  "txnPurchasePrice", "txnSeller", "txnLoiDate", "txnCloseDate",
  "txnSalePrice", "txnBuyer", "txnSaleDate", "txnBroker",
  "acqCapRate", "acqNOIAtClose", "acqEntity", "acqBroker", "acqContractDate", "acqDDExpiration",
  "acqDeposit", "acqClosingCosts", "acqFee", "acqTitleCo", "acqCounsel", "acqPropManager",
  "acqStrategy", "acqHoldPeriod", "acqTargetIRR", "acqNotes",
  "debtLender", "debtType", "debtLoanAmount", "debtRate", "debtMaturityDate", "debtNotes",
  // Full loan record (term sheet / loan doc) — a staler OM must never wipe these.
  "debtRateType", "debtIndex", "debtSpread", "debtOriginationDate", "debtTermYears",
  "debtAmortYears", "debtIOPeriod", "debtLTV", "debtDSCR", "debtRecourse", "debtPrepay",
  "debtExtensions", "debtEscrows", "debtAssumable", "debtLoanNumber", "debtContact", "loanBalance",
  "prepayTerms", "interestRateSwap", "customAmortSchedule", "prefSchedule",
  // Tenant roster + roster-derived metrics: post-closing rent rolls are authoritative,
  // so re-running the OM keeps them (rent-roll/manual roster wins over the OM's tenants).
  "tenants", "tenantsAsOf", "tenantsManual", "tenantsSource", "occupancy", "walt", "weightedAvgRentPSF",
  "marketSale", "marketSaleChecked",
  "marketDemographics", "demoChecked",
  "marketGeo", "marketGeoChecked",
  "verified", "propertyGroupId", "editHistory", "aka",
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
      normalizeDealAddress(clean);   // street-only address + backfill blank city/state/zip
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
      normalizeDealAddress(clean);   // street-only address + backfill blank city/state/zip
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
          await maybeFillMarketFromAddress(id, clean).catch(() => {});
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
    normalizeDealAddress(rest);   // street-only address + backfill blank city/state/zip
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
    normalizeDealAddress(rest);   // street-only address + backfill blank city/state/zip
    // Capture the prior "Our Take" so we only re-learn the House View when it changes.
    const prevRows = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
    const prevReview = typeof (prevRows[0]?.data as Record<string, unknown> | undefined)?.dealReview === "string"
      ? ((prevRows[0]!.data as Record<string, unknown>).dealReview as string).trim() : "";
    await db.insert(dealsTable)
      .values({ id, data: rest })
      .onConflictDoUpdate({ target: dealsTable.id, set: { data: rest, updatedAt: new Date() } });
    res.json({ ok: true, id });
    setImmediate(() => {
      rebuildTenantIndex(id, rest).catch(() => {});
      rebuildCompsIndex(id, rest).catch(() => {});
      // When the deal's "Our Take" changed, auto-update the House View in the
      // background (re-distills unless the House View was hand-edited).
      const newReview = typeof rest.dealReview === "string" ? rest.dealReview.trim() : "";
      if (newReview !== prevReview) autoUpdateHouseViewOnReview(req.session.userEmail || null).catch(() => {});
      // Auto-fetch demographics for new deals that have an address but no demo data yet,
      // then auto-derive Market/Submarket from the address (free Census geocoder) when
      // those are blank — runs on edit too (this is the upsert path), so adding an
      // address later backfills the market.
      (async () => {
        if (!rest.marketDemographics && !rest.demoChecked) {
          const composed = composeAddressForGeocoder(rest as { address?: string | null; city?: string | null; state?: string | null });
          if (composed) {
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
          }
        }
        await maybeFillMarketFromAddress(id, rest).catch(() => {});
      })();
    });
  } catch (err) {
    req.log.error({ err }, "Failed to upsert deal");
    res.status(500).json({ error: "Failed to upsert deal" });
  }
});

// DELETE /api/deals/:id — permanently delete a deal and everything that references
// it. Admin-only on the server too (the UI already gates the button behind isAdmin)
// so a non-admin can't wipe a deal by calling the API directly.
router.delete("/deals/:id", requireAdmin, async (req, res) => {
  try {
    const id = req.params.id as string;
    await db.delete(dealImagesTable).where(eq(dealImagesTable.id, id));
    await db.delete(dealSourcesTable).where(eq(dealSourcesTable.id, id));
    await db.delete(tenantIndexTable).where(eq(tenantIndexTable.dealId, id));
    await db.delete(compsIndexTable).where(eq(compsIndexTable.sourceDealId, id));
    // Lease abstracts reference the deal too — delete them so a re-import under a
    // new id can't collide with orphaned rows (and the DB doesn't slowly bloat).
    await db.delete(leaseAbstractsTable).where(eq(leaseAbstractsTable.dealId, id));
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

// Persist a compact trace of each image-save attempt to the DB (NOT in-memory), so
// it's reliable across Autoscale instances — the only way to know whether the real
// (large) request actually reached the server. Best-effort; never blocks the save.
async function logImgSave(e: { id: string; reqBytes: number; ms: number; outcome: string; code?: string }): Promise<void> {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS img_trace (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL)`);
    await pool.query(`INSERT INTO img_trace(data) VALUES ($1::jsonb)`, [JSON.stringify(e)]);
    await pool.query(`DELETE FROM img_trace WHERE id <= (SELECT max(id) FROM img_trace) - 50`);
  } catch { /* tracing must never break a save */ }
}

// Record a per-OM-upload extraction timing breakdown to the DB (so it's visible
// across Autoscale instances). Best-effort; never affects the upload.
async function logUploadTiming(e: Record<string, unknown>): Promise<void> {
  try {
    await pool.query(`CREATE TABLE IF NOT EXISTS upload_trace (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL)`);
    await pool.query(`INSERT INTO upload_trace(data) VALUES ($1::jsonb)`, [JSON.stringify({ ...e, ts: new Date().toISOString() })]);
    await pool.query(`DELETE FROM upload_trace WHERE id <= (SELECT max(id) FROM upload_trace) - 30`);
  } catch { /* tracing must never break an upload */ }
}

// GET /api/upload-timing — open in the browser (while logged in) to see where recent
// OM uploads spent their time: first AI pass, roster-continuation rounds, gap-fill
// rounds, and scoring. Pinpoints why a given OM was slow.
router.get("/upload-timing", requireAuth, async (_req, res) => {
  try {
    // Create-if-missing so the endpoint works before the first OM is uploaded
    // (the table is otherwise created lazily on the first ingest).
    await pool.query(`CREATE TABLE IF NOT EXISTS upload_trace (id bigserial PRIMARY KEY, at timestamptz NOT NULL DEFAULT now(), data jsonb NOT NULL)`);
    const r = await pool.query(`SELECT at, data FROM upload_trace ORDER BY id DESC LIMIT 20`);
    res.json({ recentUploads: r.rows, note: r.rows.length ? undefined : "No OM uploaded yet on this deployment — upload one, then refresh." });
  } catch (e) {
    res.json({ recentUploads: [], error: String(e) });
  }
});

// GET /api/image-save-diag — open this URL in the browser (while logged in) to see
// EXACTLY why image saves hang: pool stats, what's running/stuck in the DB, locks on
// deal_images, and a real probe write (same shape as a cover save) with its timing
// and exact error code. Read-only except the probe, which cleans up after itself.
router.get("/image-save-diag", requireAuth, async (_req, res) => {
  // version marker — bump when image-save code changes, so we can confirm from the
  // diagnostic output EXACTLY which build is live (deploys have been unreliable).
  const out: Record<string, unknown> = { ts: new Date().toISOString(), version: "imgcap-5-siteplan-raw" };
  const p = pool as unknown as { totalCount?: number; idleCount?: number; waitingCount?: number };
  out.pool = { total: p.totalCount ?? null, idle: p.idleCount ?? null, waiting: p.waitingCount ?? null };

  try {
    const act = await pool.query(
      `SELECT pid, state, wait_event_type, wait_event,
              round(extract(epoch from (now()-query_start)))::int AS query_age_s,
              round(extract(epoch from (now()-state_change)))::int AS state_age_s,
              left(regexp_replace(query, '\\s+', ' ', 'g'), 90) AS query
         FROM pg_stat_activity
        WHERE datname = current_database() AND pid <> pg_backend_pid()
        ORDER BY query_start NULLS LAST LIMIT 30`);
    out.activity = act.rows;
  } catch (e) { out.activityError = String(e); }

  try {
    const locks = await pool.query(
      `SELECT l.pid, l.mode, l.granted, a.state,
              round(extract(epoch from (now()-a.query_start)))::int AS age_s,
              left(regexp_replace(a.query, '\\s+', ' ', 'g'), 90) AS query
         FROM pg_locks l
         JOIN pg_class c ON c.oid = l.relation
         LEFT JOIN pg_stat_activity a ON a.pid = l.pid
        WHERE c.relname = 'deal_images'`);
    out.dealImagesLocks = locks.rows;
  } catch (e) { out.locksError = String(e); }

  try {
    const t = Date.now();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '3s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '8s'`);
      await tx.execute(sql`INSERT INTO deal_images (id, cover) VALUES ('__diag_probe__', 'x') ON CONFLICT (id) DO UPDATE SET cover = 'x'`);
      await tx.execute(sql`DELETE FROM deal_images WHERE id = '__diag_probe__'`);
    });
    out.probeWrite = "OK";
    out.probeWriteMs = Date.now() - t;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    out.probeWrite = "FAILED";
    out.probeError = { code: err?.code ?? null, message: String(err?.message ?? e).slice(0, 300) };
  }

  // LARGE probe — write a ~400KB cover value (like a real photo) to see if a big
  // write through the pooler is the slow part (the tiny probe above can't reveal that).
  try {
    const big = "x".repeat(400_000);
    const t = Date.now();
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '18s'`);
      await tx.execute(sql`INSERT INTO deal_images (id, cover) VALUES ('__diag_probe_big__', ${big}) ON CONFLICT (id) DO UPDATE SET cover = ${big}`);
      await tx.execute(sql`DELETE FROM deal_images WHERE id = '__diag_probe_big__'`);
    });
    out.largeProbeWrite = "OK";
    out.largeProbeWriteMs = Date.now() - t;
  } catch (e) {
    const err = e as { code?: string; message?: string };
    out.largeProbeWrite = "FAILED";
    out.largeProbeError = { code: err?.code ?? null, message: String(err?.message ?? e).slice(0, 300) };
  }

  // The most recent REAL save attempts (did the big request reach the server at all?).
  // Read from the DB so it's consistent across all Autoscale instances.
  try {
    const tr = await pool.query(`SELECT at, data FROM img_trace ORDER BY id DESC LIMIT 15`);
    out.recentImageSaves = tr.rows;
  } catch (e) { out.recentImageSaves = []; out.traceError = String(e); }
  res.json(out);
});

// PUT /api/deals/:id/image-raw/:field — accept the image as RAW BINARY bytes (not
// base64-in-JSON). The platform's WAF was 403-ing the JSON body because of the long
// base64 blob; raw JPEG bytes pass straight through. Server converts to a data URL
// for storage (so display is unchanged) and partial-updates just that column.
const rawImageBody = express.raw({ type: () => true, limit: "12mb" });
router.put("/deals/:id/image-raw/:field", requireAuth, rawImageBody, async (req, res) => {
  const id = req.params.id as string;
  const field = req.params.field as string;
  const t0 = Date.now();
  const buf = req.body as Buffer;
  const reqBytes = Buffer.isBuffer(buf) ? buf.length : 0;
  try {
    const ALLOWED = ["cover", "coverThumb", "sitePlanSet", "sitePlanAdd"];
    if (!ALLOWED.includes(field)) { res.status(400).json({ error: "bad field" }); return; }
    const dataUrl = reqBytes > 0 ? `data:image/jpeg;base64,${buf.toString("base64")}` : null;
    await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '6s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
      if (field === "cover") {
        await tx.execute(sql`INSERT INTO deal_images (id, cover) VALUES (${id}, ${dataUrl}) ON CONFLICT (id) DO UPDATE SET cover = ${dataUrl}`);
      } else if (field === "coverThumb") {
        await tx.execute(sql`INSERT INTO deal_images (id, cover_thumb) VALUES (${id}, ${dataUrl}) ON CONFLICT (id) DO UPDATE SET cover_thumb = ${dataUrl}`);
      } else if (field === "sitePlanSet") {
        // First image of an upload — replace the whole array and clear the picker flag.
        await tx.execute(sql`INSERT INTO deal_images (id, site_plan, needs_site_plan_pick) VALUES (${id}, to_jsonb(ARRAY[${dataUrl}]::text[]), false) ON CONFLICT (id) DO UPDATE SET site_plan = to_jsonb(ARRAY[${dataUrl}]::text[]), needs_site_plan_pick = false`);
      } else {
        // sitePlanAdd — append to the existing array.
        await tx.execute(sql`INSERT INTO deal_images (id, site_plan) VALUES (${id}, to_jsonb(ARRAY[${dataUrl}]::text[])) ON CONFLICT (id) DO UPDATE SET site_plan = COALESCE(deal_images.site_plan, '[]'::jsonb) || to_jsonb(${dataUrl}::text)`);
      }
    });
    void logImgSave({ id, reqBytes, ms: Date.now() - t0, outcome: `ok-raw-${field}` });
    res.json({ ok: true });
  } catch (err) {
    void logImgSave({ id, reqBytes, ms: Date.now() - t0, outcome: `error-raw-${field}`, code: (err as { code?: string })?.code });
    req.log.error({ err }, "Failed to save raw image");
    res.status(500).json({ error: "Failed to save image" });
  }
});

// PUT /api/deals/:id/images
router.put("/deals/:id/images", requireAuth, async (req, res) => {
  const t0 = Date.now();
  const reqBytes = Number(req.headers["content-length"] || 0);
  const id = req.params.id as string;
  try {
    const body = req.body as {
      cover?: string | null;
      coverThumb?: string | null;
      sitePlan?: string[] | null;
      pagePicks?: { page: number; img: string }[] | null;
      needsSitePlanPick?: boolean;
    };
    // PARTIAL update: only touch the columns actually present in the request.
    // This lets a small targeted save (e.g. just the cover) avoid re-sending the
    // whole bundle — important because the bundle can carry a multi-MB pagePicks
    // array that pushes the request past the platform's body-size limit. A field
    // that's present-but-null clears that column; an ABSENT field is left alone.
    const set: Record<string, unknown> = {};
    if ("cover" in body) set.cover = body.cover ?? null;
    if ("coverThumb" in body) set.coverThumb = body.coverThumb ?? null;
    if ("sitePlan" in body) set.sitePlan = body.sitePlan ?? null;
    if ("pagePicks" in body) set.pagePicks = body.pagePicks ?? null;
    if ("needsSitePlanPick" in body) set.needsSitePlanPick = body.needsSitePlanPick ?? false;
    if (Object.keys(set).length === 0) { res.json({ ok: true }); return; }

    // Do the upsert inside a transaction that sets a SHORT lock_timeout via SET
    // LOCAL. Unlike pool/session-level params, SET LOCAL is honored even through a
    // transaction-mode connection pooler — so the write can NEVER hang: if a stuck
    // connection is holding the row lock, this fails fast (code 55P03) instead of
    // the client waiting 20–45s. The actual write is milliseconds.
    const writeOnce = () => db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '6s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
      await tx.insert(dealImagesTable)
        .values({
          id,
          cover: (set.cover as string | null) ?? null,
          coverThumb: (set.coverThumb as string | null) ?? null,
          sitePlan: (set.sitePlan as string[] | null) ?? null,
          pagePicks: (set.pagePicks as { page: number; img: string }[] | null) ?? null,
          needsSitePlanPick: (set.needsSitePlanPick as boolean | undefined) ?? false,
        })
        .onConflictDoUpdate({ target: dealImagesTable.id, set });
    });

    try {
      await writeOnce();
    } catch (err: unknown) {
      const e = err as { code?: string; cause?: { code?: string }; message?: string };
      // 55P03 = lock_not_available: a zombie/stuck connection is holding the
      // deal_images lock (the root cause of image saves "timing out"). Kill the
      // blocker(s) and retry ONCE so the save self-heals with no user action.
      const isLock = e?.code === "55P03" || e?.cause?.code === "55P03" || /lock timeout/i.test(e?.message || "");
      if (isLock) {
        const killed = await db.execute(sql`
          SELECT pg_terminate_backend(pid) FROM pg_stat_activity
          WHERE pid <> pg_backend_pid() AND datname = current_database()
            AND ( (state = 'active' AND query ILIKE '%deal_images%' AND now() - query_start > interval '5 seconds')
               OR (state = 'idle in transaction' AND now() - state_change > interval '10 seconds') )
        `).catch(() => null);
        req.log.warn({ killed: (killed as { rowCount?: number } | null)?.rowCount ?? 0 }, "Image save blocked on lock — terminated blockers, retrying");
        await writeOnce(); // if this still fails, fall through to the catch below
      } else {
        throw err;
      }
    }
    void logImgSave({ id, reqBytes, ms: Date.now() - t0, outcome: "ok" });
    res.json({ ok: true });
  } catch (err) {
    void logImgSave({ id, reqBytes, ms: Date.now() - t0, outcome: "error", code: (err as { code?: string })?.code });
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

// POST /api/deals/:id/refresh-market — derive Market/Submarket from the address
// (free Census geocoder). Manual re-pull; overwrites both with the derived values
// (these fields aren't hand-edited in the UI) and stamps marketGeo for provenance.
router.post("/deals/:id/refresh-market", requireAuth, async (req, res) => {
  try {
    const id = req.params.id as string;
    const rows = await db.select().from(dealsTable).where(eq(dealsTable.id, id));
    if (!rows.length) { res.status(404).json({ error: "Deal not found" }); return; }
    const current = rows[0].data as Record<string, unknown>;
    const composed = composeAddressForGeocoder(current as { address?: string | null; city?: string | null; state?: string | null });
    if (!composed) { res.status(400).json({ error: "Deal has no address" }); return; }
    const geo = await fetchAddressMarket(composed);
    // Fill blanks only — never overwrite a Market/Submarket the OM already set.
    const curMarket = typeof current.market === "string" ? current.market.trim() : "";
    const curSub = typeof current.submarket === "string" ? current.submarket.trim() : "";
    const patch: Record<string, unknown> = { marketGeo: geo, marketGeoChecked: new Date().toISOString(), marketGeoVersion: MARKET_GEO_VERSION };
    if (!curMarket && geo?.market) patch.market = geo.market;
    if (!curSub && geo?.submarket) patch.submarket = geo.submarket;
    await db.update(dealsTable)
      .set({ data: { ...current, ...patch }, updatedAt: new Date() })
      .where(eq(dealsTable.id, id));
    res.json({ ok: true, marketGeo: geo, market: (patch.market ?? current.market ?? null) as string | null, submarket: (patch.submarket ?? current.submarket ?? null) as string | null });
  } catch (err) {
    req.log.error({ err }, "Failed to refresh market");
    res.status(500).json({ error: "Failed to refresh market" });
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
          const { data: rawExtracted, timings } = await runOmExtraction(sourceText);
          const _scoreStart = Date.now();
          const [augmented, totalCount] = await Promise.all([
            augmentScoringWithBenchmarks(id, rawExtracted, req.log),
            getTotalDealCount(),
          ]);
          const scoreMs = Date.now() - _scoreStart;
          // Record a per-upload timing breakdown (measurement only) so it's visible
          // at /api/upload-timing — shows where a slow OM spends its minutes.
          void logUploadTiming({ id, fileName: existing.fileName || "Unknown", scoreMs, ...timings });
          req.log.info({ id, timings, scoreMs }, "OM extraction timing");
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

    // 1) Regenerate narrative from the live roster (incl. resolved co-tenancy exposure)
    const leaseRiskSummary = await loadLeaseRiskSummary(id, current);
    const analysis = await runRosterAnalysis(current, leaseRiskSummary);
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
        const analysis = await runRosterAnalysis(data, await loadLeaseRiskSummary(r.id, data));
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
        const analysis = await runRosterAnalysis(data, await loadLeaseRiskSummary(r.id, data));
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

// GET /api/deals/audit-stats — run the deterministic integrity audit over EVERY active
// deal (no model, no tokens) and report how many have arithmetic contradictions. This
// audits data ALREADY in the site (deals imported before the audit existed), live.
router.get("/deals/audit-stats", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(dealsTable);
    let deals = 0, issues = 0, high = 0;
    const byCheck = new Map<string, number>();
    for (const r of rows) {
      const d = r.data as Record<string, unknown>;
      if (d.trashedAt || d._processing || d._processingError) continue;
      const f = auditExtraction(d);
      if (f.length) {
        deals++; issues += f.length; high += f.filter(q => q.severity === "high").length;
        for (const q of f) { const k = auditCheckKey(q.id); byCheck.set(k, (byCheck.get(k) || 0) + 1); }
      }
    }
    const breakdown = [...byCheck.entries()]
      .map(([key, count]) => ({ key, label: AUDIT_CHECK_LABELS[key] || key, count }))
      .sort((a, b) => b.count - a.count);
    res.json({ deals, issues, high, breakdown });
  } catch (err) {
    req.log.error({ err }, "Failed to compute audit stats");
    res.status(500).json({ error: "Failed to compute audit stats" });
  }
});

// GET /api/deals/audit-list — the ACTUAL issues, per deal, so the audit is an
// actionable worklist (click a deal → open it → fix in Import Review). Live + token-free.
router.get("/deals/audit-list", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(dealsTable);
    const out: Array<{ dealId: string; dealName: string; high: number; issues: Array<{ key: string; label: string; severity: string; question: string }> }> = [];
    for (const r of rows) {
      const d = r.data as Record<string, unknown>;
      if (d.trashedAt || d._processing || d._processingError) continue;
      const f = auditExtraction(d);
      if (!f.length) continue;
      out.push({
        dealId: r.id,
        dealName: String(d.propertyName || d.fileName || "Untitled"),
        high: f.filter(q => q.severity === "high").length,
        issues: f.map(q => ({ key: auditCheckKey(q.id), label: AUDIT_CHECK_LABELS[auditCheckKey(q.id)] || q.field, severity: q.severity, question: q.question })),
      });
    }
    // Worst first: most high-severity, then most issues.
    out.sort((a, b) => b.high - a.high || b.issues.length - a.issues.length || a.dealName.localeCompare(b.dealName));
    res.json({ deals: out, totalDeals: out.length, totalIssues: out.reduce((s, x) => s + x.issues.length, 0) });
  } catch (err) {
    req.log.error({ err }, "Failed to build audit list");
    res.status(500).json({ error: "Failed to build audit list" });
  }
});

// POST /api/deals/reaudit — re-run the integrity audit over every active deal and merge
// the results into each deal's Import-Review questions. SELF-HEALING and token-free:
//   • audit-* questions that no longer fail are removed,
//   • audit-* questions you already resolved/dismissed are left alone (no re-nag),
//   • AI questions and lease-risk validators are never touched,
//   • new contradictions are added.
router.post("/deals/reaudit", requireAuth, async (req, res) => {
  try {
    const rows = await db.select().from(dealsTable);
    let scanned = 0, flagged = 0, added = 0, cleared = 0, changedDeals = 0;
    for (const r of rows) {
      const data = r.data as Record<string, unknown>;
      if (data.trashedAt || data._processing || data._processingError) continue;
      scanned++;
      const fresh = auditExtraction(data);
      const freshIds = new Set(fresh.map(q => q.id));
      const existing = Array.isArray(data.reviewQuestions) ? (data.reviewQuestions as Array<Record<string, unknown>>) : [];
      const kept = existing.filter(q => {
        const id = String(q?.id || "");
        if (!id.startsWith(AUDIT_ID_PREFIX)) return true;   // AI / lease-risk — keep
        if (q?.resolvedAt) return true;                      // already resolved — keep, don't re-nag
        return freshIds.has(id);                             // unresolved audit q: keep only if still failing
      });
      const keptIds = new Set(kept.map(q => String(q?.id || "")));
      const newOnes = fresh.filter(q => !keptIds.has(q.id));
      const next = [...kept, ...newOnes];
      const clearedHere = existing.length - kept.length;     // unresolved audit qs that now pass
      if (newOnes.length || clearedHere) {
        added += newOnes.length;
        cleared += clearedHere;
        changedDeals++;
        const updated = { ...data, reviewQuestions: next };
        await db.update(dealsTable).set({ data: updated, updatedAt: new Date() }).where(eq(dealsTable.id, r.id));
      }
      const openAudit = next.filter(q => { const r = q as Record<string, unknown>; const id = String(r?.id || ""); return id.startsWith(AUDIT_ID_PREFIX) && !r?.resolvedAt; });
      if (openAudit.length) flagged++;
    }
    req.log.info({ scanned, flagged, added, cleared, changedDeals }, "Bulk re-audit complete");
    res.json({ ok: true, scanned, flagged, added, cleared });
  } catch (err) {
    req.log.error({ err }, "Failed to re-audit deals");
    res.status(500).json({ error: "Failed to re-audit deals" });
  }
});

// POST /api/deals/autofix — deterministic, token-free AUTO-CORRECTION sweep. Fixes only
// the issues with a single right answer (no judgement): occupancy cost stored as a 0.NN
// fraction (×100), a rentPerSF that doesn't reconcile to a RELIABLE annual rent
// (recompute from annual), and stale roster-derived metrics (occupancy / WALT / wtd-avg
// rent, honoring verified locks). Then self-heals the audit questions that now pass.
// Snapshots first so it is fully reversible. Verified against the live portfolio to
// clear ~21 flags and create ZERO new ones; it deliberately LEAVES anything ambiguous
// (e.g. an annual rent that implies an absurd $/SF, or occupancy that can't be computed)
// for human judgement.
router.post("/deals/autofix", requireAuth, async (req, res) => {
  const nA = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const isVacA = (name: unknown): boolean => {
    const s = String(name ?? "").trim().toLowerCase();
    return !s || s === "-" || /^(vacant|available|avail|spec(ulative)?|white\s*box|tbd|to\s+be\s+leased)\b/.test(s);
  };
  const isNAPA = (t: Record<string, unknown>): boolean => {
    if (t.isNAP === true) return true;
    if (isVacA(t.name)) return false;
    const hasLease = !!((typeof t.leaseStart === "string" && t.leaseStart.trim()) || (typeof t.leaseExpiry === "string" && t.leaseExpiry.trim()) || (typeof t.rentSchedule === "string" && t.rentSchedule.trim()));
    if (hasLease) return false;
    const sf = nA(t.sf), r = nA(t.annualRent), rp = nA(t.rentPerSF);
    return sf != null && sf > 0 && (r == null || r === 0) && (rp == null || rp === 0);
  };
  const parseD = (s: unknown): Date | null => {
    const str = String(s ?? "").trim(); if (!str) return null;
    const d = new Date(str + (/^\d{4}-\d{2}-\d{2}$/.test(str) ? "T12:00:00" : ""));
    return isNaN(d.getTime()) ? null : d;
  };
  // Faithful port of recomputeRosterMetrics (om-database/src/lib/utils.ts) — keep in sync.
  const recompute = (tenants: Record<string, unknown>[], asOf: unknown, deal: Record<string, unknown>) => {
    const ver = (deal.verified || {}) as Record<string, unknown>;
    const out: { occupancy?: number; walt?: number; weightedAvgRentPSF?: number } = {};
    const ref = parseD(asOf) ?? new Date();
    const occ = tenants.filter(t => !isVacA(t.name) && !isNAPA(t));
    const totalSF = nA(deal.totalSF);
    if (!ver.occupancy && totalSF && totalSF > 0) {
      const o = Math.round(occ.reduce((s, t) => s + (nA(t.sf) ?? 0), 0) / totalSF * 1000) / 10;
      if (o > 0 && o <= 100) out.occupancy = o;
    }
    if (!ver.walt) {
      let sf = 0, w = 0;
      for (const t of occ) { const s = nA(t.sf); if (!s) continue; const e = parseD(t.leaseExpiry); const yr = e ? Math.max(0, (e.getTime() - ref.getTime()) / (365.25 * 86_400_000)) : nA(t.remainingTermYears); if (yr == null) continue; sf += s; w += s * yr; }
      if (w > 0 && sf > 0) out.walt = Math.round(w / sf * 10) / 10;
    }
    if (!ver.weightedAvgRentPSF) {
      let sf = 0, w = 0;
      for (const t of occ) { const s = nA(t.sf), r = nA(t.rentPerSF); if (s && s > 0 && r && r > 0) { sf += s; w += s * r; } }
      if (sf > 0) out.weightedAvgRentPSF = Math.round(w / sf * 100) / 100;
    }
    return out;
  };

  try {
    const snap = await createSnapshot("before-autofix");
    const rows = await db.select().from(dealsTable);
    let scanned = 0, occCostFixed = 0, rentFixed = 0, metricFixes = 0, changedDeals = 0, cleared = 0;
    for (const r of rows) {
      const data = r.data as Record<string, unknown>;
      if (data.trashedAt || data._processing || data._processingError) continue;
      scanned++;
      let changed = false;
      // 1. Per-tenant deterministic fixes
      const tenants = (Array.isArray(data.tenants) ? data.tenants : []).map((raw) => {
        const t = { ...(raw as Record<string, unknown>) };
        const oc = nA(t.occupancyCost);
        if (oc != null && oc > 0 && oc < 1) { t.occupancyCost = Math.round(oc * 100 * 100) / 100; occCostFixed++; changed = true; }
        const sf = nA(t.sf), psf = nA(t.rentPerSF), ann = nA(t.annualRent);
        if (sf && psf && ann && ann > 1000 && !isVacA(t.name) && !isNAPA(t)) {
          const implied = psf * sf, rel = Math.abs(implied - ann) / ann, realPSF = ann / sf;
          // Only when the annual is RELIABLE (implies a sane $2–$80/SF) and the stored
          // per-SF is clearly off — leave absurd-annual cases (e.g. $780/SF) for judgement.
          if (rel > 0.15 && Math.abs(implied - ann) > 10000 && realPSF >= 2 && realPSF <= 80 && Math.abs(psf - realPSF) / realPSF > 0.3) {
            t.rentPerSF = Math.round(realPSF * 100) / 100; rentFixed++; changed = true;
          }
        }
        return t;
      });
      const updated: Record<string, unknown> = { ...data, tenants };
      // 2. Recompute roster-derived metrics (honors verified locks)
      const m = recompute(tenants, updated.tenantsAsOf, updated);
      for (const k of ["occupancy", "walt", "weightedAvgRentPSF"] as const) {
        if (m[k] != null && nA(updated[k]) !== m[k]) { updated[k] = m[k]; metricFixes++; changed = true; }
      }
      // 3. Self-heal audit questions (same rules as reaudit)
      const fresh = auditExtraction(updated);
      const freshIds = new Set(fresh.map(q => q.id));
      const existing = Array.isArray(updated.reviewQuestions) ? (updated.reviewQuestions as Array<Record<string, unknown>>) : [];
      const kept = existing.filter(q => { const id = String(q?.id || ""); if (!id.startsWith(AUDIT_ID_PREFIX)) return true; if (q?.resolvedAt) return true; return freshIds.has(id); });
      const keptIds = new Set(kept.map(q => String(q?.id || "")));
      const next = [...kept, ...fresh.filter(q => !keptIds.has(q.id))];
      const clearedHere = existing.length - kept.length;
      if (clearedHere || next.length !== existing.length) { updated.reviewQuestions = next; cleared += clearedHere; changed = changed || clearedHere > 0; }
      if (changed) { changedDeals++; await db.update(dealsTable).set({ data: updated, updatedAt: new Date() }).where(eq(dealsTable.id, r.id)); }
    }
    req.log.info({ scanned, occCostFixed, rentFixed, metricFixes, changedDeals, cleared }, "Auto-fix sweep complete");
    res.json({ ok: true, scanned, occCostFixed, rentFixed, metricFixes, changedDeals, cleared, snapshot: snap });
  } catch (err) {
    req.log.error({ err }, "Auto-fix failed");
    res.status(500).json({ error: "Auto-fix failed" });
  }
});

export default router;
