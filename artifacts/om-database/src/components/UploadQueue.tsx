import { useRef, useState, useEffect } from "react";
import type { Deal, ImageBundle } from "../lib/idb";
import { apiSaveSource, apiSaveImages, apiSaveDeal, apiDeleteDeal, apiIngestDeal, apiPollDealStatus, apiRefreshAnalysis, apiRecordUpload } from "../lib/api";
import { extractPdfImages } from "../lib/pdfExtract";
import { uid, buildCorrectionsNote } from "../lib/utils";
import { extractAnyFile, isSpreadsheet, isSupportedUpload } from "../lib/fileExtract";
import { classifyDocument, matchDeal, type DocType } from "../lib/docClassify";
import { extractRentRoll, extractLeaseOptions, buildRosterPatch, buildOptionsPatch } from "../lib/rentRollExtract";
import { extractSalesReport, buildSalesHistoryPatch, type SalesExtractResult } from "../lib/salesExtract";

interface QueueItem {
  id: string;
  name: string;
  file?: File;
  status: "pending" | "extracting" | "awaiting_dup" | "awaiting_match" | "done" | "error";
  msg: string;
  progress: number;
  error?: string;
  deal?: Deal;
  tempDealId?: string;
  dupCandidate?: Deal;
  pendingExtracted?: Record<string, unknown>;
  pendingImages?: ImageBundle | null;
  pendingText?: string;
  // Smart-routing (rent roll / sales)
  routedType?: DocType;
  matchedDealName?: string;            // the property we routed this doc to
  pendingRosterPatch?: Partial<Deal>;  // staged roster update awaiting a property choice
  pendingText2?: string;               // extracted text, kept for re-routing after manual pick
  matchHint?: { propertyName: string | null; address: string | null; fileName: string | null }; // for auto-attaching to a same-drop deal
}

interface Props {
  pendingFiles: File[];
  onFilesConsumed: () => void;
  onDealsAdded: (deals: Deal[]) => void;
  onDealUpdated?: (deal: Deal) => void;
  onOpenDeal: (id: string) => void;
  existingDeals: Deal[];
  // Reports the open import panel's height (0 when hidden) so the feedback flag
  // can sit just above it instead of overlapping the queue.
  onPanelHeightChange?: (h: number) => void;
}

function findDuplicate(fileName: string, extracted: Record<string, unknown>, existing: Deal[]): Deal | null {
  const normName = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const cleanFile = fileName.replace(/\.pdf$/i, "").toLowerCase();
  const byFile = existing.find(d => (d.fileName || "").toLowerCase() === cleanFile);
  if (byFile) return byFile;
  const newProp = normName((extracted.propertyName as string) || "");
  const newAddr = normName((extracted.address as string) || "");
  if (newProp.length > 4) {
    const byProp = existing.find(d => {
      const p = normName(d.propertyName || "");
      return p.length > 4 && p === newProp;
    });
    if (byProp) return byProp;
  }
  if (newAddr.length > 8) {
    const byAddr = existing.find(d => {
      const a = normName(d.address || "");
      return a.length > 8 && a === newAddr;
    });
    if (byAddr) return byAddr;
  }
  return null;
}

function reconcileRefresh(existing: Deal, extracted: Record<string, unknown>): Deal {
  const preserved: Partial<Deal> = {
    status: existing.status, userNotes: existing.userNotes, verified: existing.verified,
    propertyGroupId: existing.propertyGroupId, trashedAt: existing.trashedAt,
    txnPurchasePrice: existing.txnPurchasePrice, txnSeller: existing.txnSeller,
    txnLoiDate: existing.txnLoiDate, txnCloseDate: existing.txnCloseDate,
    txnSalePrice: existing.txnSalePrice, txnBuyer: existing.txnBuyer,
    txnSaleDate: existing.txnSaleDate, txnBroker: existing.txnBroker,
    acqCapRate: existing.acqCapRate, acqNOIAtClose: existing.acqNOIAtClose,
    acqEntity: existing.acqEntity, acqBroker: existing.acqBroker,
    acqContractDate: existing.acqContractDate, acqDDExpiration: existing.acqDDExpiration,
    acqDeposit: existing.acqDeposit, acqClosingCosts: existing.acqClosingCosts,
    acqFee: existing.acqFee, acqTitleCo: existing.acqTitleCo,
    acqCounsel: existing.acqCounsel, acqPropManager: existing.acqPropManager,
    acqStrategy: existing.acqStrategy, acqHoldPeriod: existing.acqHoldPeriod,
    acqTargetIRR: existing.acqTargetIRR, acqNotes: existing.acqNotes,
    debtLender: existing.debtLender, debtType: existing.debtType,
    debtLoanAmount: existing.debtLoanAmount, debtRate: existing.debtRate,
    debtRateType: existing.debtRateType, debtMaturityDate: existing.debtMaturityDate,
    debtNotes: existing.debtNotes, marketSale: existing.marketSale,
    marketSaleChecked: existing.marketSaleChecked,
    marketDemographics: existing.marketDemographics, demoChecked: existing.demoChecked,
  };
  const verifiedFields = Object.keys(existing.verified || {});
  const verifiedOverrides: Partial<Deal> = {};
  for (const f of verifiedFields) {
    const k = f as keyof Deal;
    if (existing[k] !== undefined) (verifiedOverrides as Record<string, unknown>)[f] = existing[k];
  }
  return {
    ...existing, ...(extracted as Partial<Deal>), ...preserved, ...verifiedOverrides,
    id: existing.id, uploadedAt: existing.uploadedAt,
    refreshedAt: new Date().toISOString(),
  } as Deal;
}

const MAX_CONCURRENT = 3;

export default function UploadQueue({ pendingFiles, onFilesConsumed, onDealsAdded, onDealUpdated, onOpenDeal, existingDeals, onPanelHeightChange }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<File[]>([]);
  const activeCountRef = useRef(0);
  const waitingFilesRef = useRef<{ file: File; itemId: string }[]>([]);
  const stopRef = useRef(false);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  // Deals created/refreshed by OMs during this session, so a rent roll / sales
  // report dropped alongside a NEW deal can attach to it (it isn't in
  // existingDeals yet). Plus a live mirror of the queue for async resolution.
  const createdDealsRef = useRef<Deal[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);

  // Report the open panel's live height so the feedback flag can lift above it.
  useEffect(() => {
    const el = panelRef.current;
    if (!queueOpen || !el || queue.length === 0) { onPanelHeightChange?.(0); return; }
    const report = () => onPanelHeightChange?.(el.offsetHeight);
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => { ro.disconnect(); onPanelHeightChange?.(0); };
  }, [queueOpen, queue.length, onPanelHeightChange]);

  const drainQueue = () => {
    while (activeCountRef.current < MAX_CONCURRENT && waitingFilesRef.current.length > 0) {
      if (stopRef.current) {
        // Mark remaining waiting items as stopped
        setQueue(prev => prev.map(it => it.status === "pending" ? { ...it, status: "error", msg: "Stopped", error: "Stopped by user" } : it));
        waitingFilesRef.current = [];
        break;
      }
      // Paused: don't start new files (in-flight ones finish on their own). The
      // waiting items stay "pending" and resume when the user unpauses.
      if (pausedRef.current) break;
      const next = waitingFilesRef.current.shift()!;
      activeCountRef.current++;
      processFile(next.file, next.itemId).finally(() => {
        activeCountRef.current--;
        drainQueue();
      });
    }
  };

  const stopAll = () => {
    stopRef.current = true;
    pausedRef.current = false;
    setPaused(false);
    waitingFilesRef.current = [];
    setQueue(prev => prev.map(it => it.status === "pending" ? { ...it, status: "error", msg: "Stopped", error: "Stopped by user" } : it));
  };

  const togglePause = () => {
    if (pausedRef.current) {
      // Resume
      pausedRef.current = false;
      setPaused(false);
      drainQueue();
    } else {
      // Pause — stop starting new files; in-flight ones finish.
      pausedRef.current = true;
      setPaused(true);
    }
  };

  const enqueueFile = (file: File) => {
    stopRef.current = false;
    const itemId = uid();
    setQueue(q => [...q, { id: itemId, name: file.name, file, status: "pending", msg: "Queued…", progress: 0 }]);
    waitingFilesRef.current.push({ file, itemId });
    drainQueue();
  };

  // Process newly added files
  useEffect(() => {
    if (!pendingFiles.length) return;
    const pdfs = pendingFiles.filter(isSupportedUpload);
    onFilesConsumed();
    if (pdfs.length) {
      setQueueOpen(true);
      pdfs.forEach(enqueueFile);
    }
  }, [pendingFiles]);

  // Record each file's FINAL outcome (success/failure) once, to the admin upload
  // log. Centralized here so every routing path (OM, rent roll, options, sales,
  // duplicate-refresh) is captured wherever it sets a terminal status.
  const loggedRef = useRef<Set<string>>(new Set());
  const updateItem = (itemId: string, patch: Partial<QueueItem>) => {
    setQueue(q => q.map(x => x.id === itemId ? { ...x, ...patch } : x));
    if ((patch.status === "done" || patch.status === "error") && !loggedRef.current.has(itemId)) {
      loggedRef.current.add(itemId);
      const it = queueRef.current.find(x => x.id === itemId);
      const detail = patch.status === "error"
        ? (patch.error || it?.error || patch.msg || it?.msg || "")
        : (patch.matchedDealName || (patch.deal as Deal | undefined)?.propertyName || it?.matchedDealName || it?.deal?.propertyName || patch.msg || it?.msg || "");
      apiRecordUpload({
        fileName: it?.name || "(file)",
        docType: patch.routedType || it?.routedType || "om",
        status: patch.status === "done" ? "success" : "failed",
        detail,
        dealId: (patch.deal as Deal | undefined)?.id || it?.deal?.id || it?.tempDealId || null,
      });
    }
  };

  // Warn before a hard page exit (refresh / close tab / browser-back) while work
  // is still in flight — a reload wipes the visible queue and its per-file status.
  // Only guards genuinely-active items; finished / awaiting-input / errored ones
  // don't trigger it. (Navigating WITHIN the app doesn't unmount this component,
  // so it isn't affected — this is purely for full-document unloads.)
  const hasActiveWork = queue.some(x => x.status === "pending" || x.status === "extracting");
  useEffect(() => {
    if (!hasActiveWork) return;
    const handler = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = ""; // required for Chrome to show the native prompt
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [hasActiveWork]);

  // After a roster/sales/options update, regenerate the AI analysis (grade,
  // narrative, strengths/risks, red flags) from the FINAL merged roster so the
  // deal page isn't left showing stale "analysis may be outdated". Best-effort —
  // never fails the import. Costs a Haiku roster pass per deal (acceptable: the
  // user asked for auto-refresh on upload).
  const refreshAnalysisFor = async (itemId: string, deal: Deal): Promise<Deal> => {
    updateItem(itemId, { msg: `${deal.propertyName || deal.fileName || "Deal"} · refreshing analysis…` });
    // Retry on transient failures so a blip never leaves the deal stuck showing
    // the "analysis may be out of date" badge after an auto-import.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const a = await apiRefreshAnalysis(deal.id);
        const upd = {
          ...deal,
          notes: (a.notes as string) ?? deal.notes,
          dealScore: (a.dealScore as Deal["dealScore"]) ?? deal.dealScore,
          upsideItems: (a.upsideItems as Deal["upsideItems"]) ?? deal.upsideItems,
          redFlags: (a.redFlags as Deal["redFlags"]) ?? deal.redFlags,
          analysisStale: false,
        } as Deal;
        await apiSaveDeal(upd).catch(() => {});
        onDealUpdated?.(upd);
        return upd;
      } catch {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        // Gave up after retries — clear the stale flag anyway so the badge doesn't
        // linger (the roster IS current; only the AI narrative refresh failed).
        const cleared = { ...deal, analysisStale: false } as Deal;
        await apiSaveDeal(cleared).catch(() => {});
        onDealUpdated?.(cleared);
        return cleared;
      }
    }
    return deal;
  };

  // Apply an extracted roster to a matched deal (safe path: preserves financials).
  const applyRosterToDeal = async (
    itemId: string, deal: Deal, result: { asOf: string | null; tenants: NonNullable<Deal["tenants"]> },
  ): Promise<Deal> => {
    const patch = buildRosterPatch(deal, result);
    const updated = { ...deal, ...patch } as Deal;
    await apiSaveDeal(updated);
    onDealUpdated?.(updated);
    updateItem(itemId, {
      status: "done", progress: 100, routedType: "rent-roll",
      matchedDealName: deal.propertyName || deal.fileName || "deal", deal: updated,
      msg: `Rent roll → ${deal.propertyName || deal.fileName || "matched deal"} · roster updated (${result.tenants.length} tenants)`,
    });
    return updated;
  };

  // Route a rent roll: extract its tenants, match to an existing deal, and either
  // auto-update that deal's roster (high/medium confidence) or ask which property.
  const routeRentRoll = async (
    itemId: string, _dealId: string, text: string, fileName: string,
    propertyName: string | null, address: string | null,
  ) => {
    updateItem(itemId, { msg: "Reading rent roll…", progress: 55, routedType: "rent-roll" });
    const result = await extractRentRoll(text);
    const hint = { propertyName, address, fileName };
    const m = matchDeal(hint, [...existingDeals, ...createdDealsRef.current]);
    if (m.deal && m.confidence !== "none") {
      const upd = await applyRosterToDeal(itemId, m.deal, result);
      await refreshAnalysisFor(itemId, upd);
    } else {
      updateItem(itemId, {
        status: "awaiting_match", routedType: "rent-roll", matchHint: hint,
        pendingExtracted: result as unknown as Record<string, unknown>,
        msg: `Rent roll (${result.tenants.length} tenants) — will attach when its deal finishes importing, or pick the property`, progress: 100,
      });
    }
  };

  // Apply a lease-OPTIONS schedule to a matched deal: ENRICH-ONLY. Updates the
  // renewal-option ladders on existing tenants; never adds or removes tenants, so
  // an options file dropped alongside an OM can't shrink the roster or re-add
  // departed tenants. Preserves SF/rent/financials entirely.
  const applyOptionsToDeal = async (
    itemId: string, deal: Deal, result: { asOf: string | null; tenants: NonNullable<Deal["tenants"]> },
  ): Promise<Deal> => {
    const { patch, updated } = buildOptionsPatch(deal, result);
    if (updated === 0) {
      updateItem(itemId, {
        status: "done", progress: 100, routedType: "lease-options",
        matchedDealName: deal.propertyName || deal.fileName || "deal", deal,
        msg: `Lease options → ${deal.propertyName || deal.fileName || "matched deal"} · no matching tenants to update`,
      });
      return deal;
    }
    const upd = { ...deal, ...patch } as Deal;
    await apiSaveDeal(upd);
    onDealUpdated?.(upd);
    updateItem(itemId, {
      status: "done", progress: 100, routedType: "lease-options",
      matchedDealName: deal.propertyName || deal.fileName || "deal", deal: upd,
      msg: `Lease options → ${deal.propertyName || deal.fileName || "matched deal"} · option schedules updated on ${updated} tenant${updated === 1 ? "" : "s"}`,
    });
    return upd;
  };

  // Route a lease-options schedule: extract it (reuses the rent-roll extractor to
  // get per-tenant renewalOptions), match to a deal, and enrich it — or wait for
  // the deal to finish importing / ask which property.
  const routeLeaseOptions = async (
    itemId: string, text: string, fileName: string,
    propertyName: string | null, address: string | null,
  ) => {
    updateItem(itemId, { msg: "Reading lease options…", progress: 55, routedType: "lease-options" });
    const result = await extractLeaseOptions(text);
    const hint = { propertyName, address, fileName };
    const m = matchDeal(hint, [...existingDeals, ...createdDealsRef.current]);
    if (m.deal && m.confidence !== "none") {
      const upd = await applyOptionsToDeal(itemId, m.deal, result);
      await refreshAnalysisFor(itemId, upd);
    } else {
      updateItem(itemId, {
        status: "awaiting_match", routedType: "lease-options", matchHint: hint,
        pendingExtracted: result as unknown as Record<string, unknown>,
        msg: `Lease options (${result.tenants.length} tenants) — will attach when its deal finishes importing, or pick the property`, progress: 100,
      });
    }
  };

  // Apply an extracted sales report to a matched deal (auto-import, suite-aware).
  const applySalesToDeal = async (itemId: string, deal: Deal, result: SalesExtractResult): Promise<Deal> => {
    const patch = buildSalesHistoryPatch(deal, result);
    const updated = { ...deal, ...patch } as Deal;
    await apiSaveDeal(updated);
    onDealUpdated?.(updated);
    updateItem(itemId, {
      status: "done", progress: 100, routedType: "sales",
      matchedDealName: deal.propertyName || deal.fileName || "deal", deal: updated,
      msg: `Sales (${result.year}) → ${deal.propertyName || deal.fileName || "matched deal"} · ${result.tenants.length} tenants applied`,
    });
    return updated;
  };

  // Route a sales report: extract it, match to a deal, and either auto-apply the
  // sales history (confident match) or ask which property it belongs to.
  const routeSales = async (
    itemId: string, text: string, fileName: string,
    propertyName: string | null, address: string | null,
  ) => {
    updateItem(itemId, { msg: "Reading sales report…", progress: 55, routedType: "sales" });
    const result = await extractSalesReport(text);
    const hint = { propertyName, address, fileName };
    const m = matchDeal(hint, [...existingDeals, ...createdDealsRef.current]);
    if (m.deal && m.confidence !== "none") {
      const upd = await applySalesToDeal(itemId, m.deal, result);
      await refreshAnalysisFor(itemId, upd);
    } else {
      updateItem(itemId, {
        status: "awaiting_match", routedType: "sales", matchHint: hint,
        pendingExtracted: result as unknown as Record<string, unknown>,
        msg: `Sales report (${result.tenants.length} tenants) — will attach when its deal finishes importing, or pick the property`, progress: 100,
      });
    }
  };

  // When an OM finishes creating/refreshing a deal, remember it and auto-attach
  // any rent roll / sales from the same drop that were waiting for their property.
  const registerCreatedDeal = async (deal: Deal) => {
    createdDealsRef.current = [deal, ...createdDealsRef.current.filter(d => d.id !== deal.id)];
    // Apply waiting docs one at a time, threading the updated deal so a rent roll
    // and a sales report for the same property don't overwrite each other.
    let working = deal;
    let lastApplied: string | null = null;
    for (const it of queueRef.current) {
      if (it.status !== "awaiting_match" || !it.matchHint || !it.pendingExtracted) continue;
      const m = matchDeal(it.matchHint, [working]);
      if (!m.deal || m.confidence === "none") continue;
      try {
        if (it.routedType === "rent-roll") {
          working = await applyRosterToDeal(it.id, working, it.pendingExtracted as unknown as { asOf: string | null; tenants: NonNullable<Deal["tenants"]> });
          lastApplied = it.id;
        } else if (it.routedType === "lease-options") {
          working = await applyOptionsToDeal(it.id, working, it.pendingExtracted as unknown as { asOf: string | null; tenants: NonNullable<Deal["tenants"]> });
          lastApplied = it.id;
        } else if (it.routedType === "sales") {
          working = await applySalesToDeal(it.id, working, it.pendingExtracted as unknown as SalesExtractResult);
          lastApplied = it.id;
        }
      } catch (err) {
        updateItem(it.id, { status: "error", msg: "Auto-attach failed", error: err instanceof Error ? err.message : "failed" });
      }
    }
    // Once every same-drop file is merged into the deal, refresh its analysis ONCE
    // from the final roster (so the grade/narrative reflect the merged result).
    if (lastApplied) await refreshAnalysisFor(lastApplied, working);
  };

  // User manually assigns an awaiting doc to a property.
  const assignMatch = async (itemId: string, deal: Deal) => {
    const item = queue.find(q => q.id === itemId);
    if (!item) return;
    if (item.routedType === "rent-roll" && item.pendingExtracted) {
      updateItem(itemId, { status: "extracting", msg: "Updating roster…", progress: 60 });
      try {
        const upd = await applyRosterToDeal(itemId, deal, item.pendingExtracted as unknown as { asOf: string | null; tenants: NonNullable<Deal["tenants"]> });
        await refreshAnalysisFor(itemId, upd);
      } catch (err) {
        updateItem(itemId, { status: "error", msg: "Roster update failed", error: err instanceof Error ? err.message : "failed" });
      }
    } else if (item.routedType === "lease-options" && item.pendingExtracted) {
      updateItem(itemId, { status: "extracting", msg: "Updating options…", progress: 60 });
      try {
        const upd = await applyOptionsToDeal(itemId, deal, item.pendingExtracted as unknown as { asOf: string | null; tenants: NonNullable<Deal["tenants"]> });
        await refreshAnalysisFor(itemId, upd);
      } catch (err) {
        updateItem(itemId, { status: "error", msg: "Options update failed", error: err instanceof Error ? err.message : "failed" });
      }
    } else if (item.routedType === "sales" && item.pendingExtracted) {
      updateItem(itemId, { status: "extracting", msg: "Importing sales…", progress: 60 });
      try {
        const upd = await applySalesToDeal(itemId, deal, item.pendingExtracted as unknown as SalesExtractResult);
        await refreshAnalysisFor(itemId, upd);
      } catch (err) {
        updateItem(itemId, { status: "error", msg: "Sales import failed", error: err instanceof Error ? err.message : "failed" });
      }
    }
  };

  const processFile = async (file: File, itemId: string) => {
    const dealId = uid();
    updateItem(itemId, { tempDealId: dealId });

    try {
      const xls = isSpreadsheet(file);
      const fileName = file.name.replace(/\.(pdf|xlsx?|xlsm|xlsb|csv)$/i, "");

      updateItem(itemId, { status: "extracting", msg: xls ? "Reading spreadsheet…" : "Reading PDF…", progress: 5 });

      const buf = await file.arrayBuffer();
      // Images only make sense for PDFs (OM cover / site plan).
      const imgPromise = xls ? Promise.resolve(null) : extractPdfImages(buf.slice(0)).catch(() => null);

      updateItem(itemId, { msg: "Extracting text…", progress: 18 });
      const { text, pages } = await extractAnyFile(file);

      // ── Smart routing: what KIND of document is this? ──────────────────────
      updateItem(itemId, { msg: "Identifying document…", progress: 30 });
      const cls = await classifyDocument(text, file.name);

      if (cls.type === "rent-roll") {
        await routeRentRoll(itemId, dealId, text, fileName, cls.propertyName, cls.address);
        return;
      }
      if (cls.type === "lease-options") {
        await routeLeaseOptions(itemId, text, fileName, cls.propertyName, cls.address);
        return;
      }
      if (cls.type === "sales") {
        await routeSales(itemId, text, fileName, cls.propertyName, cls.address);
        return;
      }
      // Otherwise treat as an OM / deal package (the original flow, unchanged).

      updateItem(itemId, { msg: "Sending to Claude AI…", progress: 40 });
      await apiIngestDeal({ id: dealId, text, fileName, pageCount: pages, correctionsNote: buildCorrectionsNote(existingDeals) });

      updateItem(itemId, { msg: "Processing images…", progress: 55 });
      const imgs = await imgPromise;
      if (imgs) await apiSaveImages(dealId, imgs).catch(() => {});
      await apiSaveSource(dealId, text).catch(() => {});

      updateItem(itemId, { msg: "Claude is extracting deal data…", progress: 65 });

      let resolvedDeal: Deal | null = null;
      let pollError: string | null = null;
      const POLL_ITERS = 240; // 240 × 2.5s = 10 min
      for (let i = 0; i < POLL_ITERS; i++) {
        await new Promise(r => setTimeout(r, 2500));
        const status = await apiPollDealStatus(dealId);
        if (!status.processing) {
          if (status.error) { pollError = status.error; break; }
          resolvedDeal = (status.deal as Deal) ?? null;
          break;
        }
        const pct = Math.min(65 + Math.round((i / POLL_ITERS) * 28), 93);
        updateItem(itemId, { progress: pct });
      }

      if (pollError || !resolvedDeal) {
        throw new Error(pollError || "Extraction timed out — please retry");
      }

      updateItem(itemId, { msg: "Checking for duplicates…", progress: 95 });

      const imageMeta = imgs ? {
        cover: !!imgs.cover,
        sitePlan: imgs.sitePlan ? imgs.sitePlan.length : 0,
        needsSitePlanPick: imgs.needsSitePlanPick || false,
      } : undefined;

      const extracted = resolvedDeal as unknown as Record<string, unknown>;
      const dup = findDuplicate(fileName, extracted, existingDeals);

      if (dup) {
        updateItem(itemId, {
          status: "awaiting_dup",
          msg: "Duplicate detected — choose action below",
          progress: 100,
          dupCandidate: dup,
          pendingExtracted: { ...extracted, imageMeta, fileName, pdfPages: pages },
          pendingImages: imgs,
          pendingText: text,
          tempDealId: dealId,
        });
        return;
      }

      const finalDeal: Deal = { ...resolvedDeal, imageMeta };
      await apiSaveDeal(finalDeal).catch(() => {});

      updateItem(itemId, { status: "done", msg: finalDeal.propertyName || finalDeal.fileName || "Saved", progress: 100, deal: finalDeal });
      onDealsAdded([finalDeal]);
      await registerCreatedDeal(finalDeal);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Extraction failed";
      updateItem(itemId, { status: "error", msg: "Failed", error: msg, progress: 0 });
      await apiDeleteDeal(dealId).catch(() => {});
    }
  };

  const handleDupUpdate = async (itemId: string) => {
    const item = queue.find(x => x.id === itemId);
    if (!item?.dupCandidate || !item.pendingExtracted) return;
    if (item.tempDealId) await apiDeleteDeal(item.tempDealId).catch(() => {});
    const refreshed = reconcileRefresh(item.dupCandidate, item.pendingExtracted);
    await apiSaveDeal(refreshed).catch(() => {});
    if (item.pendingText) await apiSaveSource(refreshed.id, item.pendingText).catch(() => {});
    if (item.pendingImages) await apiSaveImages(refreshed.id, item.pendingImages).catch(() => {});
    updateItem(itemId, { status: "done", msg: refreshed.propertyName || refreshed.fileName || "Updated", progress: 100, deal: refreshed });
    onDealUpdated?.(refreshed);
    await registerCreatedDeal(refreshed);
  };

  const handleDupKeepBoth = async (itemId: string) => {
    const item = queue.find(x => x.id === itemId);
    if (!item?.pendingExtracted || !item.tempDealId) return;
    const { imageMeta, fileName, pdfPages, ...rest } = item.pendingExtracted;
    const deal: Deal = {
      id: item.tempDealId,
      fileName: (fileName as string) || item.name.replace(/\.pdf$/i, ""),
      uploadedAt: new Date().toISOString(),
      pdfPages: pdfPages as number | undefined,
      status: "Prospect",
      imageMeta: imageMeta as Deal["imageMeta"],
      ...(rest as Partial<Deal>),
    };
    await apiSaveDeal(deal).catch(() => {});
    updateItem(itemId, { status: "done", msg: deal.propertyName || deal.fileName || "Saved", progress: 100, deal });
    onDealsAdded([deal]);
    await registerCreatedDeal(deal);
  };

  const handleDupCancel = async (itemId: string) => {
    const item = queue.find(x => x.id === itemId);
    if (item?.tempDealId) await apiDeleteDeal(item.tempDealId).catch(() => {});
    setQueue(q => q.filter(x => x.id !== itemId));
  };

  const retryFailed = () => {
    const failed = queue.filter(x => x.status === "error" && x.file);
    setQueue(q => q.filter(x => x.status !== "error"));
    for (const item of failed) {
      if (item.file) enqueueFile(item.file);
    }
  };

  if (!queue.length) return null;

  const done = queue.filter(q => q.status === "done").length;
  const failed = queue.filter(q => q.status === "error").length;
  const working = queue.filter(q => q.status === "pending" || q.status === "extracting").length;
  const waiting = queue.filter(q => q.status === "awaiting_dup").length;
  const pct = queue.length ? Math.round(((done + failed) / queue.length) * 100) : 0;

  return (
    <>
      {/* Fixed bottom queue panel */}
      {queueOpen && (
        <div ref={panelRef} style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#ffffff", borderTop: "1px solid #ebe4d6", zIndex: 200, maxHeight: "60vh", display: "flex", flexDirection: "column", boxShadow: "0 -12px 48px rgba(56,58,55,0.12)" }}>
          {/* Header */}
          <div style={{ padding: "16px 28px 12px", borderBottom: "1px solid #f1eadc" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 14 }}>
                <span style={{ fontFamily: "'Fraunces',serif", fontWeight: 600, fontSize: 17, color: "#383a37" }}>Importing OMs</span>
                <span style={{ fontSize: 12, color: "#a69e91" }}>
                  <span style={{ color: "#0f9d63", fontWeight: 600 }}>{done} done</span>
                  {failed > 0 && <> · <span style={{ color: "#dc2626", fontWeight: 600 }}>{failed} failed</span></>}
                  {waiting > 0 && <> · <span style={{ color: "#d9890c", fontWeight: 600 }}>{waiting} need review</span></>}
                  {working > 0 && <> · {working} remaining</>}
                  {paused && working > 0 && <> · <span style={{ color: "#d9890c", fontWeight: 600 }}>paused</span></>}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                {working > 0 && (
                  <button onClick={togglePause}
                    style={{ background: paused ? "#6dba43" : "#fff", border: paused ? "none" : "1px solid #d9d2c4", color: paused ? "#1f2b16" : "#5c5047", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Inter',sans-serif" }}>
                    {paused ? "▶ Resume" : "❚❚ Pause"}
                  </button>
                )}
                {working > 0 && (
                  <button onClick={stopAll}
                    style={{ background: "#dc2626", border: "none", color: "#fff", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Inter',sans-serif" }}>
                    Stop
                  </button>
                )}
                {failed > 0 && working === 0 && (
                  <button onClick={retryFailed}
                    style={{ background: "#6dba43", border: "none", color: "#1f2b16", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Inter',sans-serif" }}>
                    Retry {failed} failed
                  </button>
                )}
                {(done > 0 || failed > 0) && (
                  <button onClick={() => setQueue(q => q.filter(x => x.status === "pending" || x.status === "extracting" || x.status === "awaiting_dup"))}
                    style={{ background: "transparent", border: "1px solid #e3dccd", color: "#837c6e", padding: "6px 12px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif" }}>
                    Clear completed
                  </button>
                )}
                <button onClick={() => setQueueOpen(false)}
                  style={{ background: "transparent", border: "1px solid #e3dccd", color: "#837c6e", padding: "6px 14px", borderRadius: 7, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif" }}>
                  Hide
                </button>
              </div>
            </div>
            {/* Aggregate progress bar */}
            <div style={{ height: 6, background: "#efe8da", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ width: `${pct}%`, height: "100%", background: working > 0 ? "#6dba43" : failed > 0 ? "#dc2626" : "#0f9d63", borderRadius: 4, transition: "width 0.4s ease" }} />
            </div>
          </div>

          {/* Queue items */}
          <div style={{ overflowY: "auto", padding: "4px 0" }}>
            {queue.map(item => (
              <div key={item.id}>
                {item.status === "awaiting_dup" && item.dupCandidate ? (
                  <div style={{ padding: "14px 28px", borderBottom: "1px solid #f4f6f7", background: "#fffbf0" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#a06208", marginBottom: 4 }}>⚠ Possible duplicate detected</div>
                    <div style={{ fontSize: 13, color: "#383a37", marginBottom: 2 }}>
                      <strong>{item.name}</strong> looks like an existing deal:
                    </div>
                    <div style={{ fontSize: 12, color: "#5f5a50", marginBottom: 10 }}>
                      <strong>{item.dupCandidate.propertyName || item.dupCandidate.fileName || "Untitled"}</strong>
                      {item.dupCandidate.uploadedAt && <> — uploaded {new Date(item.dupCandidate.uploadedAt).toLocaleDateString()}</>}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <button onClick={() => handleDupUpdate(item.id)}
                        style={{ background: "#26281f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>
                        Update existing deal
                      </button>
                      <button onClick={() => handleDupKeepBoth(item.id)}
                        style={{ background: "#fff", color: "#383a37", border: "1px solid #d8d0c0", borderRadius: 7, padding: "7px 14px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                        Keep both
                      </button>
                      <button onClick={() => handleDupCancel(item.id)}
                        style={{ background: "transparent", color: "#a89f8f", border: "none", padding: "7px 10px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <div style={{ padding: "11px 28px", borderBottom: "1px solid #f4f6f7", display: "flex", gap: 14, alignItems: "flex-start" }}>
                    <div style={{
                      width: 8, height: 8, borderRadius: "50%", marginTop: 5, flexShrink: 0,
                      background: item.status === "done" ? "#0f9d63" : item.status === "error" ? "#dc2626" : item.status === "extracting" ? "#6dba43" : "#b3bac1",
                      animation: item.status === "extracting" ? "pulse 1.2s infinite" : "none",
                    }} />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: 13, color: "#383a37", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                      <div style={{ fontSize: 12, color: item.status === "done" ? "#0f9d63" : item.status === "error" ? "#dc2626" : "#a69e91", marginTop: 2 }}>{item.msg}</div>
                      {(item.status === "extracting" || item.status === "pending") && (
                        <div style={{ marginTop: 7, display: "flex", alignItems: "center", gap: 8 }}>
                          <div style={{ flex: 1, height: 5, background: "#efe8da", borderRadius: 3, overflow: "hidden" }}>
                            <div style={{ width: `${item.progress}%`, height: "100%", background: "#6dba43", borderRadius: 3, transition: "width 0.4s ease" }} />
                          </div>
                          <span style={{ fontSize: 10, color: "#a69e91", fontWeight: 600, minWidth: 30, textAlign: "right" }}>{item.progress}%</span>
                        </div>
                      )}
                      {item.error && <div style={{ fontSize: 11, color: "#c0563b", marginTop: 3, lineHeight: 1.4, wordBreak: "break-word" }}>{item.error}</div>}
                    </div>
                    {item.status === "done" && item.deal && (
                      <button
                        onClick={() => { onOpenDeal(item.deal!.id); setQueueOpen(false); }}
                        style={{ background: "#f3f5f6", border: "none", color: "#52554e", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, flexShrink: 0, fontFamily: "'Inter',sans-serif" }}>
                        View
                      </button>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
          <style>{`@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:0.3} }`}</style>
        </div>
      )}

      {/* Floating pill when queue hidden but active */}
      {!queueOpen && (working > 0 || waiting > 0) && (
        <button onClick={() => setQueueOpen(true)}
          style={{ position: "fixed", bottom: 20, right: 20, background: "#6dba43", border: "none", color: "#1f2b16", padding: "10px 16px", borderRadius: 8, cursor: "pointer", fontSize: 11, fontWeight: 700, fontFamily: "'Inter',sans-serif", zIndex: 200, boxShadow: "0 4px 16px rgba(0,0,0,0.2)" }}>
          ⏳ Processing {working + waiting}…
        </button>
      )}
    </>
  );
}
