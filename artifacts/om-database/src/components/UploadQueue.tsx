import { useRef, useState, useEffect } from "react";
import type { Deal, ImageBundle, ReviewQuestion } from "../lib/idb";
import { apiSaveSource, apiSaveImages, apiSaveDeal, apiDeleteDeal, apiIngestDeal, apiPollDealStatus, apiRefreshAnalysis, apiRecordUpload } from "../lib/api";
import { extractPdfImages, extractFlyerImages } from "../lib/pdfExtract";
import { uid, buildCorrectionsNote, tenantKey } from "../lib/utils";
import { extractAnyFile, isSpreadsheet, isSupportedUpload } from "../lib/fileExtract";
import { playUploadSuccess, playUploadError } from "../lib/sounds";
import { classifyDocument, matchDeal, hasPossibleMatch, hasOmSaleSignals, type DocType } from "../lib/docClassify";
import { extractRentRoll, extractLeaseOptions, buildRosterPatch, buildOptionsPatch } from "../lib/rentRollExtract";
import { extractSalesReport, buildSalesHistoryPatch, type SalesExtractResult } from "../lib/salesExtract";
import type { FlyerResult } from "../lib/flyerExtract";
import { extractSwap, buildSwapPatch } from "../lib/swapExtract";
import { extractLoan, buildLoanPatch, type LoanResult } from "../lib/loanExtract";
import { extractAmortSchedule } from "../lib/amortExtract";
import { currentBalanceFromRows } from "../lib/amortize";
import type { InterestRateSwap, AmortRow } from "../lib/idb";

interface QueueItem {
  id: string;
  name: string;
  file?: File;
  status: "pending" | "extracting" | "awaiting_dup" | "awaiting_match" | "done" | "error";
  msg: string;
  progress: number;
  startedAt?: number;   // ms when ACTIVE processing began (not queue/wait time)
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
  // Undo / reassign support: the target's state BEFORE this doc applied (so we can
  // restore it), whether the doc CREATED the property (undo = delete), and the id
  // it landed on. Set when an item finishes applying.
  priorDeal?: Deal | null;
  appliedDealId?: string;
  createdNew?: boolean;
  undone?: boolean;
  pendingRosterPatch?: Partial<Deal>;  // staged roster update awaiting a property choice
  pendingText2?: string;               // extracted text, kept for re-routing after manual pick
  matchHint?: { propertyName: string | null; address: string | null; fileName: string | null }; // for auto-attaching to a same-drop deal
}

interface Props {
  pendingFiles: File[];
  onFilesConsumed: () => void;
  onDealsAdded: (deals: Deal[]) => void;
  onDealUpdated?: (deal: Deal) => void;
  // Reads the freshest copy of a deal from app state. Background saves re-base their
  // changes onto this so they don't clobber edits the user made on the deal page
  // while the upload was still finishing.
  getLatestDeal?: (id: string) => Deal | undefined;
  onOpenDeal: (id: string) => void;
  existingDeals: Deal[];
  // Reports the open import panel's height (0 when hidden) so the feedback flag
  // can sit just above it instead of overlapping the queue.
  onPanelHeightChange?: (h: number) => void;
}

// Does this freshly-extracted OM match a deal we already have? Delegates to the
// shared matchDeal so a slightly-renamed OM ("Haymarket Center" vs "Haymarket
// Village Center") is still recognized — and offers Refresh — instead of quietly
// forking a second deal. A match only opens the duplicate PROMPT (Refresh vs Keep
// both), so even a fuzzy hit is user-confirmed, never silently merged.
// Format an elapsed duration (ms) compactly: "12s" under a minute, "1m 05s" over.
function fmtElapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), r = s % 60;
  return `${m}m ${r.toString().padStart(2, "0")}s`;
}

function findDuplicate(fileName: string, extracted: Record<string, unknown>, existing: Deal[]): Deal | null {
  const m = matchDeal(
    {
      propertyName: (extracted.propertyName as string) ?? null,
      address: (extracted.address as string) ?? null,
      fileName,
    },
    existing,
  );
  // Merge on a confident match (high OR a good fuzzy 'medium' — substring or
  // distinctive-token name match, or a matching address). The address guard in
  // matchDeal already blocks two different properties that merely share a name
  // (different street/city), so this stays broad without wrongly fusing distinct
  // deals. (Being HIGH-only here caused too many re-uploads to split off.)
  return m.confidence !== "none" ? m.deal : null;
}

// Content-based match for the rent-roll-stub → OM case, where names/addresses
// often differ (the stub's name came from a filename). If an incoming OM shares a
// strong majority of its tenants with an existing rent-roll-only stub (no OM
// financials yet), they're the same property — route it through the duplicate
// flow so the OM merges into the stub (keeping the newer rent-roll roster).
function findRosterStubMatch(extracted: Record<string, unknown>, existing: Deal[]): Deal | null {
  const omT = Array.isArray(extracted.tenants) ? (extracted.tenants as Array<{ name?: string }>) : [];
  const omKeys = new Set(omT.map(t => tenantKey(t?.name)).filter(Boolean));
  if (omKeys.size < 3) return null;                       // too few tenants to be confident
  for (const d of existing) {
    if (d.trashedAt) continue;
    const isStub = d.tenantsSource === "rent-roll" && d.noi == null && d.capRate == null;
    if (!isStub) continue;
    const dKeys = new Set((d.tenants || []).map(t => tenantKey(t?.name)).filter(Boolean));
    if (dKeys.size < 3) continue;
    let shared = 0;
    for (const k of dKeys) if (omKeys.has(k)) shared++;
    const smaller = Math.min(dKeys.size, omKeys.size);
    if (shared >= 3 && shared / smaller >= 0.5) return d;  // same tenants → same property
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

  // Conservative merge: KEEP everything the existing deal already has and only
  // FILL fields that are currently empty from the new extraction — a re-upload
  // never silently overwrites your data. Factual fields that genuinely CONFLICT
  // are flagged for review (with a one-click "apply the OM's value") instead of
  // being assumed correct.
  const ex = existing as unknown as Record<string, unknown>;
  const nw = extracted as Record<string, unknown>;
  const merged: Record<string, unknown> = { ...ex };
  for (const [k, v] of Object.entries(nw)) {
    if (isEmptyVal(ex[k]) && !isEmptyVal(v)) merged[k] = v; // gap-fill only
  }

  const verifiedSet = new Set(verifiedFields);
  const stamp = Date.now().toString(36);
  const flags: ReviewQuestion[] = [];
  for (const f of REFRESH_FLAG_FIELDS) {
    if (verifiedSet.has(f.key)) continue;                 // user already verified — leave alone
    const oldV = ex[f.key], newV = nw[f.key];
    if (isEmptyVal(oldV) || isEmptyVal(newV)) continue;    // a gap, not a conflict
    const conflict = f.type === "number"
      ? (() => { const a = Number(oldV), b = Number(newV); return !isNaN(a) && !isNaN(b) && !numClose(a, b); })()
      : !strClose(String(oldV), String(newV));
    if (!conflict) continue;
    const fmt = (v: unknown) => f.type === "number" ? Number(v).toLocaleString() : String(v);
    flags.push({
      id: `refresh-${f.key}-${stamp}`, source: "check", severity: f.sev, field: f.label,
      question: `The re-uploaded OM lists a different ${f.label} — keep your current value or update it?`,
      detail: `Current: ${fmt(oldV)} · OM now says: ${fmt(newV)}. Your current value was kept; apply to take the OM's.`,
      suggestedValue: String(newV),
      target: { kind: "deal", fieldKey: f.key, tenantName: null, valueType: f.type },
    });
  }

  // Tenants: keep the existing roster (often manually curated / rent-roll sourced).
  // Take the new one only if there wasn't one; flag a material size mismatch.
  const exTenants = (existing.tenants || []);
  const newTenants = Array.isArray(nw.tenants) ? (nw.tenants as unknown[]) : [];
  if (exTenants.length === 0 && newTenants.length > 0) {
    merged.tenants = newTenants;
  } else if (exTenants.length > 0 && newTenants.length > 0 && Math.abs(exTenants.length - newTenants.length) >= 1) {
    flags.push({
      id: `refresh-tenants-${stamp}`, source: "check", severity: "medium", field: "Tenant roster",
      question: `The re-uploaded OM has ${newTenants.length} tenants vs your current ${exTenants.length} — review the roster?`,
      detail: `Your current roster was kept. Use "Refresh tenants" or paste a rent roll if the OM's roster is more current.`,
      suggestedValue: null, target: null,
    });
  }

  const priorQs = (existing.reviewQuestions || []).filter(q => !(q.id || "").startsWith("refresh-"));
  return {
    ...(merged as Partial<Deal>), ...preserved, ...verifiedOverrides,
    id: existing.id, uploadedAt: existing.uploadedAt,
    refreshedAt: new Date().toISOString(),
    analysisStale: true,
    reviewQuestions: [...priorQs, ...flags],
  } as Deal;
}

// Helpers for the conservative refresh merge.
function isEmptyVal(v: unknown): boolean {
  return v == null || v === "" || (Array.isArray(v) && v.length === 0);
}
function numClose(a: number, b: number): boolean {
  const m = Math.max(Math.abs(a), Math.abs(b));
  return m === 0 ? true : Math.abs(a - b) / m <= 0.005; // within 0.5% ≈ rounding, not a real conflict
}
function strClose(a: string, b: string): boolean {
  const n = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");
  return n(a) === n(b);
}

// Factual fields where a re-uploaded OM conflicting with the saved deal should be
// FLAGGED (existing kept) rather than silently overwritten.
const REFRESH_FLAG_FIELDS: { key: string; label: string; type: "number" | "text"; sev: "high" | "medium" | "low" }[] = [
  { key: "askingPrice", label: "Asking Price", type: "number", sev: "high" },
  { key: "capRate", label: "Cap Rate", type: "number", sev: "high" },
  { key: "noi", label: "NOI", type: "number", sev: "high" },
  { key: "totalSF", label: "Total SF", type: "number", sev: "high" },
  { key: "occupancy", label: "Occupancy %", type: "number", sev: "medium" },
  { key: "grossPotentialRent", label: "Gross Potential Rent", type: "number", sev: "medium" },
  { key: "weightedAvgRentPSF", label: "Avg Rent PSF", type: "number", sev: "low" },
  { key: "walt", label: "WALT", type: "number", sev: "low" },
  { key: "yearBuilt", label: "Year Built", type: "number", sev: "low" },
  { key: "loanBalance", label: "Loan Balance", type: "number", sev: "medium" },
  { key: "loanRate", label: "Loan Rate", type: "number", sev: "medium" },
  { key: "address", label: "Address", type: "text", sev: "medium" },
  { key: "city", label: "City", type: "text", sev: "low" },
  { key: "state", label: "State", type: "text", sev: "low" },
];

const MAX_CONCURRENT = 3;

export default function UploadQueue({ pendingFiles, onFilesConsumed, onDealsAdded, onDealUpdated, getLatestDeal, onOpenDeal, existingDeals, onPanelHeightChange }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);
  // Tick once a second while anything is actively processing, to drive each
  // item's live elapsed-time readout.
  const [nowTick, setNowTick] = useState(Date.now());
  const anyProcessing = queue.some(it => it.status === "extracting");
  useEffect(() => {
    if (!anyProcessing) return;
    const iv = setInterval(() => setNowTick(Date.now()), 1000);
    return () => clearInterval(iv);
  }, [anyProcessing]);
  const panelRef = useRef<HTMLDivElement>(null);
  const pendingRef = useRef<File[]>([]);
  const activeCountRef = useRef(0);
  const waitingFilesRef = useRef<{ file: File; itemId: string }[]>([]);
  const stopRef = useRef(false);
  const pausedRef = useRef(false);
  const [paused, setPaused] = useState(false);
  // IDs the user has cancelled (individually or via Stop). In-flight processing
  // checks this at each await boundary and bails; updateItem ignores any further
  // updates so a cancelled file stays "Stopped" even if its background work
  // finishes. (We can't abort an already-sent server request, but the client
  // stops waiting on it and applies none of its results.)
  const cancelledRef = useRef<Set<string>>(new Set());
  const isCancelled = (id: string) => cancelledRef.current.has(id);
  // Deals created/refreshed by OMs during this session, so a rent roll / sales
  // report dropped alongside a NEW deal can attach to it (it isn't in
  // existingDeals yet). Plus a live mirror of the queue for async resolution.
  const createdDealsRef = useRef<Deal[]>([]);
  const queueRef = useRef<QueueItem[]>([]);
  useEffect(() => { queueRef.current = queue; }, [queue]);
  // Claims for in-flight auto-creates (nameKey → tempDealId), so two same-property
  // files in one concurrent batch don't each spawn a duplicate property: the first
  // claims the name and creates it; the rest wait for that deal and attach to it.
  const pendingCreatesRef = useRef<Map<string, string>>(new Map());

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
    // Cancel EVERYTHING still in flight — not just the not-yet-started ones. Mark
    // each non-terminal item cancelled (so its background work is ignored) and
    // flip it to "Stopped".
    setQueue(prev => prev.map(it => {
      if (it.status === "done" || it.status === "error") return it;
      cancelledRef.current.add(it.id);
      return { ...it, status: "error", msg: "Stopped", error: "Stopped by user" };
    }));
  };

  // Cancel one file (pending, processing, or awaiting input). Removes it from the
  // wait list and freezes it at "Stopped"; in-flight work bails at its next check.
  const cancelItem = (itemId: string) => {
    cancelledRef.current.add(itemId);
    waitingFilesRef.current = waitingFilesRef.current.filter(w => w.itemId !== itemId);
    setQueue(prev => prev.map(it => it.id === itemId ? { ...it, status: "error", msg: "Stopped", error: "Cancelled by user" } : it));
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
    // A cancelled file is frozen at "Stopped" — drop any late updates from its
    // still-settling background work so it can't reappear as processing/done.
    if (cancelledRef.current.has(itemId)) return;
    setQueue(q => q.map(x => x.id === itemId ? { ...x, ...patch } : x));
    if ((patch.status === "done" || patch.status === "error") && !loggedRef.current.has(itemId)) {
      loggedRef.current.add(itemId);
      // Quick notification ping: ding on success, soft low ping on failure.
      if (patch.status === "done") playUploadSuccess(); else playUploadError();
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

  // Save a deal's cover/site-plan bundle, but make a FAILURE VISIBLE instead of
  // silently swallowing it (the old `.catch(() => {})` hid why images "wouldn't
  // pull/save"). On failure we append a short warning to the file's status line and
  // log the precise HTTP status + payload size via apiSaveImages' telemetry, so the
  // cause (size limit vs server error) is diagnosable. Never throws.
  const saveImagesNoting = async (id: string, bundle: ImageBundle, itemId: string): Promise<boolean> => {
    try {
      await apiSaveImages(id, bundle);
      return true;
    } catch {
      const cur = queueRef.current.find(x => x.id === itemId);
      const base = (cur?.msg || "Saved").replace(/ · ⚠ cover\/site plan didn’t save.*$/, "");
      updateItem(itemId, { msg: `${base} · ⚠ cover/site plan didn’t save (see Help if this repeats)` });
      return false;
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
  // Persist a background change as a PATCH re-based onto the freshest deal — never a
  // full-deal overwrite from the snapshot captured when the upload started. This is
  // the fix for "I filled in the address / partial-extraction fields, came back, and
  // it was gone": a refresh-analysis or apply-roster/sales/etc. finishing in the
  // background used to PUT its stale snapshot (which lacked the user's just-saved
  // edit) over both the server record and client state. By layering only the op's
  // changed fields onto getLatestDeal(), the user's concurrent edits to other fields
  // survive. Falls back to the captured deal if app state doesn't know it yet.
  const commitPatch = async (deal: Deal, patch: Partial<Deal>): Promise<Deal> => {
    const latest = getLatestDeal?.(deal.id) ?? deal;
    const toSave = { ...latest, ...patch } as Deal;
    await apiSaveDeal(toSave).catch(() => {});
    onDealUpdated?.(toSave);
    return toSave;
  };

  const refreshAnalysisFor = async (itemId: string, deal: Deal): Promise<Deal> => {
    updateItem(itemId, { msg: `${deal.propertyName || deal.fileName || "Deal"} · refreshing analysis…` });
    // Retry on transient failures so a blip never leaves the deal stuck showing
    // the "analysis may be out of date" badge after an auto-import.
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const a = await apiRefreshAnalysis(deal.id);
        // Only the analysis fields the server actually returned — re-based onto the
        // latest deal, so a concurrent core-field edit isn't reverted.
        const patch: Partial<Deal> = { analysisStale: false };
        if (a.notes != null) patch.notes = a.notes as string;
        if (a.dealScore != null) patch.dealScore = a.dealScore as Deal["dealScore"];
        if (a.upsideItems != null) patch.upsideItems = a.upsideItems as Deal["upsideItems"];
        if (a.redFlags != null) patch.redFlags = a.redFlags as Deal["redFlags"];
        return await commitPatch(deal, patch);
      } catch {
        if (attempt < 2) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        // Gave up after retries — clear the stale flag anyway so the badge doesn't
        // linger (the roster IS current; only the AI narrative refresh failed).
        return await commitPatch(deal, { analysisStale: false });
      }
    }
    return deal;
  };

  // Apply an extracted roster to a matched deal (safe path: preserves financials).
  const applyRosterToDeal = async (
    itemId: string, deal: Deal, result: { asOf: string | null; tenants: NonNullable<Deal["tenants"]> },
  ): Promise<Deal> => {
    const patch = buildRosterPatch(deal, result);
    const updated = await commitPatch(deal, { ...patch, lastUploadAt: new Date().toISOString() });
    updateItem(itemId, {
      status: "done", progress: 100, routedType: "rent-roll",
      matchedDealName: deal.propertyName || deal.fileName || "deal", deal: updated,
      priorDeal: deal, appliedDealId: deal.id, createdNew: false, pendingExtracted: result as unknown as Record<string, unknown>,
      msg: `Rent roll → ${deal.propertyName || deal.fileName || "matched deal"} · roster updated (${result.tenants.length} tenants)`,
    });
    return updated;
  };

  // Route a rent roll: extract its tenants, match to an existing deal, and either
  // auto-update that deal's roster (high/medium confidence) or ask which property.
  const routeRentRoll = async (
    itemId: string, dealId: string, text: string, fileName: string,
    propertyName: string | null, address: string | null,
  ) => {
    updateItem(itemId, { msg: "Reading rent roll…", progress: 55, routedType: "rent-roll" });
    const result = await extractRentRoll(text);
    const hint = { propertyName, address, fileName };
    const candidates = [...existingDeals, ...createdDealsRef.current];
    const m = matchDeal(hint, candidates);
    if (m.deal && m.confidence !== "none") {
      const upd = await applyRosterToDeal(itemId, m.deal, result);
      await refreshAnalysisFor(itemId, upd);
    } else if (hasPossibleMatch(hint, candidates)) {
      // A near-miss exists (shares a name token / partial address) — ASK so we
      // don't accidentally fork a property that's already in the library.
      updateItem(itemId, {
        status: "awaiting_match", routedType: "rent-roll", matchHint: hint,
        pendingExtracted: result as unknown as Record<string, unknown>,
        tempDealId: dealId,
        msg: `Rent roll (${result.tenants.length} tenants) — could match an existing property. Match it or create a new one.`,
        progress: 100,
      });
    } else {
      // No overlap with anything in the library — just create the new property.
      await autoCreateOrAttach(itemId, "rent-roll", result as unknown as Record<string, unknown>, hint, dealId);
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
    const upd = await commitPatch(deal, { ...patch, lastUploadAt: new Date().toISOString() });
    updateItem(itemId, {
      status: "done", progress: 100, routedType: "lease-options",
      matchedDealName: deal.propertyName || deal.fileName || "deal", deal: upd,
      priorDeal: deal, appliedDealId: deal.id, createdNew: false, pendingExtracted: result as unknown as Record<string, unknown>,
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
    const candidates = [...existingDeals, ...createdDealsRef.current];
    const m = matchDeal(hint, candidates);
    if (m.deal && m.confidence !== "none") {
      const upd = await applyOptionsToDeal(itemId, m.deal, result);
      await refreshAnalysisFor(itemId, upd);
    } else if (hasPossibleMatch(hint, candidates)) {
      updateItem(itemId, {
        status: "awaiting_match", routedType: "lease-options", matchHint: hint,
        pendingExtracted: result as unknown as Record<string, unknown>,
        msg: `Lease options (${result.tenants.length} tenants) — could match an existing property. Match it or create a new one.`, progress: 100,
      });
    } else {
      await autoCreateOrAttach(itemId, "lease-options", result as unknown as Record<string, unknown>, hint, undefined);
    }
  };

  // Apply an extracted sales report to a matched deal (auto-import, suite-aware).
  const applySalesToDeal = async (itemId: string, deal: Deal, result: SalesExtractResult): Promise<Deal> => {
    const patch = buildSalesHistoryPatch(deal, result);
    const updated = await commitPatch(deal, { ...patch, lastUploadAt: new Date().toISOString() });
    updateItem(itemId, {
      status: "done", progress: 100, routedType: "sales",
      matchedDealName: deal.propertyName || deal.fileName || "deal", deal: updated,
      priorDeal: deal, appliedDealId: deal.id, createdNew: false, pendingExtracted: result as unknown as Record<string, unknown>,
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
    const candidates = [...existingDeals, ...createdDealsRef.current];
    const m = matchDeal(hint, candidates);
    if (m.deal && m.confidence !== "none") {
      const upd = await applySalesToDeal(itemId, m.deal, result);
      await refreshAnalysisFor(itemId, upd);
    } else if (hasPossibleMatch(hint, candidates)) {
      updateItem(itemId, {
        status: "awaiting_match", routedType: "sales", matchHint: hint,
        pendingExtracted: result as unknown as Record<string, unknown>,
        msg: `Sales report (${result.tenants.length} tenants) — could match an existing property. Match it or create a new one.`, progress: 100,
      });
    } else {
      await autoCreateOrAttach(itemId, "sales", result as unknown as Record<string, unknown>, hint, undefined);
    }
  };

  // Apply a leasing flyer to a matched deal — IMAGE-ONLY: attach the cover photo
  // and cropped site plan. (Flyers are used for their imagery; we skip the slow AI
  // text extraction.) Never touches the roster or financials.
  const applyFlyerToDeal = async (itemId: string, deal: Deal, _result: FlyerResult, imgs: ImageBundle | null): Promise<Deal> => {
    const imageMeta = imgs
      ? { ...(deal.imageMeta || {}), cover: !!imgs.cover || !!deal.imageMeta?.cover, sitePlan: (imgs.sitePlan?.length || 0) || deal.imageMeta?.sitePlan || 0 }
      : deal.imageMeta;
    const updated = await commitPatch(deal, { imageMeta, lastUploadAt: new Date().toISOString() });
    if (imgs) await saveImagesNoting(updated.id, imgs, itemId);
    const got = [imgs?.cover ? "cover photo" : "", imgs?.sitePlan?.length ? "site plan" : ""].filter(Boolean).join(" + ") || "no images found";
    updateItem(itemId, {
      status: "done", progress: 100, routedType: "flyer",
      matchedDealName: deal.propertyName || deal.fileName || "deal", deal: updated,
      priorDeal: deal, appliedDealId: deal.id, createdNew: false, pendingExtracted: {}, pendingImages: imgs,
      msg: `Flyer → ${deal.propertyName || deal.fileName || "matched deal"} · ${got}`,
    });
    return updated;
  };

  // Route a leasing flyer: pull its cover + cropped site plan (no AI text pass),
  // match to a deal, and attach. Auto-create when there's no possible overlap; ask
  // only on a near-miss.
  const routeFlyer = async (
    itemId: string, dealId: string, fileName: string,
    propertyName: string | null, address: string | null, imgsPromise: Promise<ImageBundle | null>,
  ) => {
    updateItem(itemId, { msg: "Extracting cover & site plan…", progress: 55, routedType: "flyer" });
    const result = {} as FlyerResult;
    const hint = { propertyName, address, fileName };
    const candidates = [...existingDeals, ...createdDealsRef.current];
    const m = matchDeal(hint, candidates);
    const imgs = await imgsPromise.catch(() => null);
    if (m.deal && m.confidence !== "none") {
      await applyFlyerToDeal(itemId, m.deal, result, imgs); // image-only — no analysis re-run needed
    } else if (hasPossibleMatch(hint, candidates)) {
      updateItem(itemId, {
        status: "awaiting_match", routedType: "flyer", matchHint: hint,
        pendingExtracted: result as unknown as Record<string, unknown>,
        pendingImages: imgs, tempDealId: dealId,
        msg: `Leasing flyer — could be an existing property. Match it or create new.`, progress: 100,
      });
    } else {
      await autoCreateOrAttach(itemId, "flyer", result as unknown as Record<string, unknown>, hint, dealId, imgs);
    }
  };

  // Apply an interest-rate swap confirmation to a matched deal (ENRICH-ONLY:
  // stores swap terms + sets the loan's all-in rate; never touches the roster).
  const applySwapToDeal = async (itemId: string, deal: Deal, swap: InterestRateSwap): Promise<Deal> => {
    const updated = await commitPatch(deal, { ...buildSwapPatch(deal, swap), lastUploadAt: new Date().toISOString() });
    updateItem(itemId, {
      status: "done", progress: 100, routedType: "swap",
      matchedDealName: deal.propertyName || deal.fileName || "deal", deal: updated,
      priorDeal: deal, appliedDealId: deal.id, createdNew: false, pendingExtracted: swap as unknown as Record<string, unknown>,
      msg: `Swap → ${deal.propertyName || deal.fileName || "matched deal"} · fixed ${swap.fixedRatePct ?? "—"}%${swap.notional ? ` on $${swap.notional.toLocaleString()}` : ""}`,
    });
    return updated;
  };

  const routeSwap = async (
    itemId: string, dealId: string, text: string, fileName: string,
    propertyName: string | null, address: string | null,
  ) => {
    updateItem(itemId, { msg: "Reading swap confirmation…", progress: 55, routedType: "swap" });
    const swap = await extractSwap(text);
    const hint = { propertyName, address, fileName };
    const candidates = [...existingDeals, ...createdDealsRef.current];
    const m = matchDeal(hint, candidates);
    if (m.deal && m.confidence !== "none") {
      const upd = await applySwapToDeal(itemId, m.deal, swap);
      await refreshAnalysisFor(itemId, upd);
    } else if (hasPossibleMatch(hint, candidates)) {
      updateItem(itemId, {
        status: "awaiting_match", routedType: "swap", matchHint: hint,
        pendingExtracted: swap as unknown as Record<string, unknown>, tempDealId: dealId,
        msg: `Swap confirmation — could match an existing property. Match it or create a new one.`, progress: 100,
      });
    } else {
      await autoCreateOrAttach(itemId, "swap", swap as unknown as Record<string, unknown>, hint, dealId);
    }
  };

  // Apply a loan document to a matched deal (ENRICH-ONLY: fills blank debt/acq
  // fields + structured prepay terms; never touches the roster or financials).
  const applyLoanToDeal = async (itemId: string, deal: Deal, result: LoanResult): Promise<Deal> => {
    const patch = buildLoanPatch(deal, result);
    const updated = await commitPatch(deal, { ...patch, lastUploadAt: new Date().toISOString() });
    const n = Object.keys(patch).filter(k => k !== "lastUploadAt").length;
    updateItem(itemId, {
      status: "done", progress: 100, routedType: "loan",
      matchedDealName: deal.propertyName || deal.fileName || "deal", deal: updated,
      priorDeal: deal, appliedDealId: deal.id, createdNew: false, pendingExtracted: result as unknown as Record<string, unknown>,
      msg: `Loan doc → ${deal.propertyName || deal.fileName || "matched deal"} · filled ${n} debt field${n === 1 ? "" : "s"}`,
    });
    return updated;
  };

  const routeLoan = async (
    itemId: string, dealId: string, text: string, fileName: string,
    propertyName: string | null, address: string | null,
  ) => {
    updateItem(itemId, { msg: "Reading loan document…", progress: 55, routedType: "loan" });
    const result = await extractLoan(text);
    const hint = { propertyName, address, fileName };
    const candidates = [...existingDeals, ...createdDealsRef.current];
    const m = matchDeal(hint, candidates);
    if (m.deal && m.confidence !== "none") {
      const upd = await applyLoanToDeal(itemId, m.deal, result);
      await refreshAnalysisFor(itemId, upd);
    } else if (hasPossibleMatch(hint, candidates)) {
      updateItem(itemId, {
        status: "awaiting_match", routedType: "loan", matchHint: hint,
        pendingExtracted: result as unknown as Record<string, unknown>, tempDealId: dealId,
        msg: `Loan document — could match an existing property. Match it or create a new one.`, progress: 100,
      });
    } else {
      await autoCreateOrAttach(itemId, "loan", result as unknown as Record<string, unknown>, hint, dealId);
    }
  };

  // Apply an amortization schedule to a matched deal (ENRICH-ONLY: stores the
  // schedule + gap-fills the current loan balance; never touches the roster).
  const applyAmortToDeal = async (itemId: string, deal: Deal, rows: AmortRow[]): Promise<Deal> => {
    const patch: Partial<Deal> = { customAmortSchedule: rows };
    const { balance } = currentBalanceFromRows(rows);
    if (deal.loanBalance == null && balance != null) patch.loanBalance = Math.round(balance);
    const updated = await commitPatch(deal, { ...patch, lastUploadAt: new Date().toISOString() });
    updateItem(itemId, {
      status: "done", progress: 100, routedType: "amort",
      matchedDealName: deal.propertyName || deal.fileName || "deal", deal: updated,
      priorDeal: deal, appliedDealId: deal.id, createdNew: false, pendingExtracted: { rows } as unknown as Record<string, unknown>,
      msg: `Amortization → ${deal.propertyName || deal.fileName || "matched deal"} · ${rows.length} periods${balance != null ? ` · balance $${Math.round(balance).toLocaleString()}` : ""}`,
    });
    return updated;
  };

  const routeAmort = async (
    itemId: string, dealId: string, text: string, fileName: string,
    propertyName: string | null, address: string | null,
  ) => {
    updateItem(itemId, { msg: "Reading amortization schedule…", progress: 55, routedType: "amort" });
    const rows = await extractAmortSchedule(text);
    const hint = { propertyName, address, fileName };
    const candidates = [...existingDeals, ...createdDealsRef.current];
    const m = matchDeal(hint, candidates);
    if (m.deal && m.confidence !== "none") {
      await applyAmortToDeal(itemId, m.deal, rows);
    } else if (hasPossibleMatch(hint, candidates)) {
      updateItem(itemId, {
        status: "awaiting_match", routedType: "amort", matchHint: hint,
        pendingExtracted: { rows } as unknown as Record<string, unknown>, tempDealId: dealId,
        msg: `Amortization schedule (${rows.length} periods) — which property's loan is this? Match it or create a new one.`, progress: 100,
      });
    } else {
      await autoCreateOrAttach(itemId, "amort", { rows } as unknown as Record<string, unknown>, hint, dealId);
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
        } else if (it.routedType === "flyer") {
          // Image-only — don't mark as the refresh trigger (a roster/sales/loan in
          // the same drop will still trigger one refresh after the merge).
          working = await applyFlyerToDeal(it.id, working, it.pendingExtracted as unknown as FlyerResult, it.pendingImages ?? null);
        } else if (it.routedType === "swap") {
          working = await applySwapToDeal(it.id, working, it.pendingExtracted as unknown as InterestRateSwap);
          lastApplied = it.id;
        } else if (it.routedType === "loan") {
          working = await applyLoanToDeal(it.id, working, it.pendingExtracted as unknown as LoanResult);
          lastApplied = it.id;
        } else if (it.routedType === "amort") {
          working = await applyAmortToDeal(it.id, working, (it.pendingExtracted as unknown as { rows: AmortRow[] }).rows);
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
    } else if (item.routedType === "flyer" && item.pendingExtracted) {
      updateItem(itemId, { status: "extracting", msg: "Attaching cover & site plan…", progress: 60 });
      try {
        // Image-only — just attach the photos; no AI analysis re-run needed.
        await applyFlyerToDeal(itemId, deal, item.pendingExtracted as unknown as FlyerResult, item.pendingImages ?? null);
      } catch (err) {
        updateItem(itemId, { status: "error", msg: "Flyer attach failed", error: err instanceof Error ? err.message : "failed" });
      }
    } else if (item.routedType === "swap" && item.pendingExtracted) {
      updateItem(itemId, { status: "extracting", msg: "Applying swap…", progress: 60 });
      try {
        const upd = await applySwapToDeal(itemId, deal, item.pendingExtracted as unknown as InterestRateSwap);
        await refreshAnalysisFor(itemId, upd);
      } catch (err) {
        updateItem(itemId, { status: "error", msg: "Swap import failed", error: err instanceof Error ? err.message : "failed" });
      }
    } else if (item.routedType === "loan" && item.pendingExtracted) {
      updateItem(itemId, { status: "extracting", msg: "Applying loan terms…", progress: 60 });
      try {
        const upd = await applyLoanToDeal(itemId, deal, item.pendingExtracted as unknown as LoanResult);
        await refreshAnalysisFor(itemId, upd);
      } catch (err) {
        updateItem(itemId, { status: "error", msg: "Loan import failed", error: err instanceof Error ? err.message : "failed" });
      }
    } else if (item.routedType === "amort" && item.pendingExtracted) {
      updateItem(itemId, { status: "extracting", msg: "Applying amortization schedule…", progress: 60 });
      try {
        await applyAmortToDeal(itemId, deal, (item.pendingExtracted as unknown as { rows: AmortRow[] }).rows);
      } catch (err) {
        updateItem(itemId, { status: "error", msg: "Schedule import failed", error: err instanceof Error ? err.message : "failed" });
      }
    }
  };

  // Create a NEW property from an attaching doc and apply its data. Used both by
  // the "create new" button and by the auto-create path (a doc with no possible
  // overlap with any existing deal). For a rent roll this seeds the roster; for
  // sales/lease-options/flyer it makes the named property and applies what the doc has.
  const createPropertyFromDoc = async (
    itemId: string,
    routedType: DocType | undefined,
    pendingExtracted: Record<string, unknown>,
    hint: QueueItem["matchHint"] | undefined,
    tempDealId: string | undefined,
    pendingImages?: ImageBundle | null,
  ) => {
    const now = new Date().toISOString();
    const base = {
      id: tempDealId || uid(),
      propertyName: hint?.propertyName || (hint?.fileName || "").replace(/\.(pdf|xlsx?|xlsm|xlsb|csv)$/i, "") || "Untitled property",
      address: hint?.address || undefined,
      fileName: hint?.fileName || undefined,
      status: "Prospect",
      uploadedAt: now,
      lastUploadAt: now,
      tenants: [],
    } as Deal;
    updateItem(itemId, { status: "extracting", msg: "Creating new property…", progress: 60 });
    try {
      if (routedType === "rent-roll") {
        const stub = { ...base, ...buildRosterPatch(base, pendingExtracted as unknown as { asOf: string | null; tenants: NonNullable<Deal["tenants"]> }) } as Deal;
        await apiSaveDeal(stub);
        onDealsAdded([stub]);
        updateItem(itemId, { status: "done", progress: 100, deal: stub, matchedDealName: stub.propertyName, msg: `Created new property “${stub.propertyName}” from the rent roll` });
        const refreshed = await refreshAnalysisFor(itemId, stub);
        await registerCreatedDeal(refreshed);
      } else if (routedType === "flyer") {
        await apiSaveDeal(base);
        onDealsAdded([base]);
        const upd = await applyFlyerToDeal(itemId, base, pendingExtracted as unknown as FlyerResult, pendingImages ?? null);
        updateItem(itemId, { matchedDealName: upd.propertyName, msg: `Created new property “${upd.propertyName}” from the leasing flyer` });
        await registerCreatedDeal(upd);
      } else {
        await apiSaveDeal(base);
        onDealsAdded([base]);
        // Register the ENRICHED deal each applyX returns — NOT the empty `base` stub.
        // Otherwise a later same-drop OM that merges into this stub re-bases on a
        // snapshot missing the sales/swap/loan we just applied and overwrites it
        // (the "sales vanished after importing the sales report together with the OM"
        // bug). The rent-roll/flyer branches above already register their enriched copy.
        let upd: Deal = base;
        if (routedType === "sales") upd = await applySalesToDeal(itemId, base, pendingExtracted as unknown as SalesExtractResult);
        else if (routedType === "swap") upd = await applySwapToDeal(itemId, base, pendingExtracted as unknown as InterestRateSwap);
        else if (routedType === "loan") upd = await applyLoanToDeal(itemId, base, pendingExtracted as unknown as LoanResult);
        else if (routedType === "amort") upd = await applyAmortToDeal(itemId, base, (pendingExtracted as unknown as { rows: AmortRow[] }).rows);
        else upd = await applyOptionsToDeal(itemId, base, pendingExtracted as unknown as { asOf: string | null; tenants: NonNullable<Deal["tenants"]> });
        await registerCreatedDeal(upd);
      }
      // Mark as a freshly-created property so Undo deletes it (overrides the
      // applyX stamp, which assumes it enriched an existing deal).
      updateItem(itemId, { createdNew: true, priorDeal: null, appliedDealId: base.id, pendingExtracted, pendingImages: pendingImages ?? null });
    } catch (err) {
      updateItem(itemId, { status: "error", msg: "Couldn't create property", error: err instanceof Error ? err.message : "failed" });
    }
  };

  // Undo a finished item: delete the property it created, or restore the property
  // it changed to its exact prior state. Lets the user reverse a bad auto-match the
  // moment the upload finishes, before any poor data sticks.
  const undoItem = async (itemId: string) => {
    const item = queueRef.current.find(q => q.id === itemId);
    if (!item || !item.appliedDealId) return;
    updateItem(itemId, { msg: "Undoing…" });
    try {
      if (item.createdNew && item.deal) {
        await apiDeleteDeal(item.appliedDealId).catch(() => {});
        createdDealsRef.current = createdDealsRef.current.filter(d => d.id !== item.appliedDealId);
        onDealUpdated?.({ ...item.deal, trashedAt: new Date().toISOString() } as Deal);
      } else if (item.priorDeal) {
        await apiSaveDeal(item.priorDeal);
        // Keep the in-memory mirror consistent for later same-batch matches.
        createdDealsRef.current = createdDealsRef.current.map(d => d.id === item.priorDeal!.id ? item.priorDeal! : d);
        onDealUpdated?.(item.priorDeal);
      }
      updateItem(itemId, { undone: true, msg: `Undone — ${item.matchedDealName || "reverted"}` });
    } catch (err) {
      updateItem(itemId, { msg: "Undo failed", error: err instanceof Error ? err.message : "failed" });
    }
  };

  // Reassign a finished attaching-doc to a different property: undo it, then drop
  // it back into the match-or-create prompt so it can be applied to the right deal.
  const reassignItem = async (itemId: string) => {
    const item = queueRef.current.find(q => q.id === itemId);
    if (!item || !item.pendingExtracted) return;
    await undoItem(itemId);
    updateItem(itemId, {
      status: "awaiting_match", undone: false, progress: 100,
      msg: "Pick the correct property for this document.",
    });
  };

  // The "create new" button on the match-or-create prompt.
  const createNewFromDoc = async (itemId: string) => {
    const item = queueRef.current.find(q => q.id === itemId);
    if (!item || !item.pendingExtracted) return;
    await createPropertyFromDoc(item.id, item.routedType, item.pendingExtracted, item.matchHint, item.tempDealId, item.pendingImages);
  };

  // Attach an already-extracted attaching-doc to a (just-created) deal, by type.
  const attachDocToDeal = async (
    itemId: string, routedType: DocType | undefined, deal: Deal,
    pendingExtracted: Record<string, unknown>, imgs?: ImageBundle | null,
  ) => {
    if (routedType === "rent-roll") {
      const u = await applyRosterToDeal(itemId, deal, pendingExtracted as unknown as { asOf: string | null; tenants: NonNullable<Deal["tenants"]> }); await refreshAnalysisFor(itemId, u);
    } else if (routedType === "sales") {
      const u = await applySalesToDeal(itemId, deal, pendingExtracted as unknown as SalesExtractResult); await refreshAnalysisFor(itemId, u);
    } else if (routedType === "lease-options") {
      const u = await applyOptionsToDeal(itemId, deal, pendingExtracted as unknown as { asOf: string | null; tenants: NonNullable<Deal["tenants"]> }); await refreshAnalysisFor(itemId, u);
    } else if (routedType === "flyer") {
      await applyFlyerToDeal(itemId, deal, pendingExtracted as unknown as FlyerResult, imgs ?? null); // image-only, no analysis re-run
    } else if (routedType === "swap") {
      const u = await applySwapToDeal(itemId, deal, pendingExtracted as unknown as InterestRateSwap); await refreshAnalysisFor(itemId, u);
    } else if (routedType === "loan") {
      const u = await applyLoanToDeal(itemId, deal, pendingExtracted as unknown as LoanResult); await refreshAnalysisFor(itemId, u);
    } else if (routedType === "amort") {
      await applyAmortToDeal(itemId, deal, (pendingExtracted as unknown as { rows: AmortRow[] }).rows);
    }
  };

  // Poll the just-created-deals mirror for a claimed dealId (used while waiting for
  // a same-batch sibling to finish creating the property).
  const waitForCreatedDeal = async (dealId: string): Promise<Deal | null> => {
    for (let i = 0; i < 30; i++) {
      const d = createdDealsRef.current.find(x => x.id === dealId);
      if (d) return d;
      await new Promise(r => setTimeout(r, 500));
    }
    return null;
  };

  // Normalized name/address key for claiming an in-flight create.
  const createKey = (hint: QueueItem["matchHint"] | undefined): string | null => {
    const np = (hint?.propertyName || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (np.length >= 4) return "n:" + np;
    const na = (hint?.address || "").toLowerCase().replace(/[^a-z0-9]/g, "");
    if (na.length >= 6) return "a:" + na;
    return null;
  };

  // No confident match AND no possible overlap → create the property automatically.
  // But if another file in this batch is already creating the SAME property, wait
  // for that deal and attach to it instead of forking a duplicate.
  const autoCreateOrAttach = async (
    itemId: string, routedType: DocType | undefined,
    pendingExtracted: Record<string, unknown>, hint: QueueItem["matchHint"] | undefined,
    tempDealId: string | undefined, imgs?: ImageBundle | null,
  ) => {
    const key = createKey(hint);
    if (key) {
      const claimedId = pendingCreatesRef.current.get(key);
      if (claimedId) {
        // Someone else is creating this property right now — wait and attach.
        // Keep status "extracting" (NOT awaiting_match) so registerCreatedDeal
        // doesn't also grab this item and double-apply it.
        updateItem(itemId, { status: "extracting", msg: "Waiting for the new property…", progress: 70, routedType, matchHint: hint, pendingExtracted, pendingImages: imgs ?? null });
        const target = await waitForCreatedDeal(claimedId);
        if (target) { await attachDocToDeal(itemId, routedType, target, pendingExtracted, imgs); return; }
        // winner never materialized — fall through and create it ourselves.
      } else {
        const id = tempDealId || uid();
        pendingCreatesRef.current.set(key, id);   // claim synchronously (no await before this)
        await createPropertyFromDoc(itemId, routedType, pendingExtracted, hint, id, imgs);
        return;
      }
    }
    await createPropertyFromDoc(itemId, routedType, pendingExtracted, hint, tempDealId, imgs);
  };

  // Attach cover/site-plan images to a deal that's ALREADY saved. Used when image
  // rendering runs long (big PDFs) so it never holds up finishing the upload. Images
  // live in their own table keyed by deal id, so saving them is clobber-free; the
  // imageMeta flag (drives the grid cover) is patched via read-modify-write so a
  // concurrent edit to the fresh deal isn't overwritten.
  const attachImagesLater = (id: string, p: Promise<ImageBundle | null>, itemId: string) => {
    p.then(async late => {
      if (!late || isCancelled(itemId)) return;
      await saveImagesNoting(id, late, itemId);
      try {
        const st = await apiPollDealStatus(id);
        if (st && !st.processing && st.deal) {
          await commitPatch(st.deal as Deal, { imageMeta: {
            ...(st.deal.imageMeta || {}),
            cover: !!late.cover,
            sitePlan: late.sitePlan ? late.sitePlan.length : 0,
            needsSitePlanPick: late.needsSitePlanPick || false,
          } });
        }
      } catch {}
    }).catch(() => {});
  };

  const processFile = async (file: File, itemId: string) => {
    const dealId = uid();
    updateItem(itemId, { tempDealId: dealId, startedAt: Date.now() });

    try {
      const xls = isSpreadsheet(file);
      const fileName = file.name.replace(/\.(pdf|xlsx?|xlsm|xlsb|csv)$/i, "");

      updateItem(itemId, { status: "extracting", msg: xls ? "Reading spreadsheet…" : "Reading PDF…", progress: 5 });

      const buf = await file.arrayBuffer();
      // Images only make sense for PDFs (OM cover / site plan).
      const imgPromise = xls ? Promise.resolve(null) : extractPdfImages(buf.slice(0)).catch(() => null);

      updateItem(itemId, { msg: "Extracting text…", progress: 18 });
      const { text, pages } = await extractAnyFile(file);
      if (isCancelled(itemId)) return;

      // ── Smart routing: what KIND of document is this? ──────────────────────
      updateItem(itemId, { msg: "Identifying document…", progress: 30 });
      const cls = await classifyDocument(text, file.name, pages);
      if (isCancelled(itemId)) return;

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
      // SAFEGUARD 5 — final routing gate. Even if classification says "flyer", never
      // ACT on it for a document that carries sale-OM signals or is long: an OM must
      // never be treated as a leasing flyer. Fall through to the full OM path instead.
      if (cls.type === "flyer" && !hasOmSaleSignals(text) && !(pages != null && pages >= 8)) {
        const flyerImgs = xls ? Promise.resolve(null) : extractFlyerImages(buf.slice(0)).then(i => i as unknown as ImageBundle).catch(() => null);
        await routeFlyer(itemId, dealId, fileName, cls.propertyName, cls.address, flyerImgs);
        return;
      }
      if (cls.type === "swap") {
        await routeSwap(itemId, dealId, text, fileName, cls.propertyName, cls.address);
        return;
      }
      if (cls.type === "loan") {
        await routeLoan(itemId, dealId, text, fileName, cls.propertyName, cls.address);
        return;
      }
      if (cls.type === "amort") {
        await routeAmort(itemId, dealId, text, fileName, cls.propertyName, cls.address);
        return;
      }
      // Otherwise treat as an OM / deal package (the original flow, unchanged).

      if (isCancelled(itemId)) return;
      updateItem(itemId, { msg: "Sending to Claude AI…", progress: 40 });
      await apiIngestDeal({ id: dealId, text, fileName, pageCount: pages, correctionsNote: buildCorrectionsNote(existingDeals) });

      updateItem(itemId, { msg: "Processing images…", progress: 55 });
      await apiSaveSource(dealId, text).catch(() => {});
      // Cover/site-plan rendering runs in the browser and can take a while for long
      // PDFs (no detectable site plan → many page thumbnails get rendered). Wait only
      // briefly; if it isn't ready, finish the deal now and attach the images in the
      // background. They're loaded independently by the deal page/grid, so deferring
      // them costs nothing but stops the upload from stalling for minutes.
      let imgs: Awaited<typeof imgPromise> = null;
      let imagesDeferred = false;
      const imgRace = await Promise.race([
        imgPromise.then(v => ({ ready: true as const, v })),
        new Promise<{ ready: false }>(r => setTimeout(() => r({ ready: false }), 8000)),
      ]);
      if (imgRace.ready) imgs = imgRace.v; else imagesDeferred = true;
      if (imgs) await saveImagesNoting(dealId, imgs, itemId);

      updateItem(itemId, { msg: "Claude is extracting deal data…", progress: 65 });

      let resolvedDeal: Deal | null = null;
      let pollError: string | null = null;
      let connLost = false;
      let consecutiveErrors = 0;
      const POLL_ITERS = 528; // 528 × 2.5s = 22 min — covers the server's progress-based budget (stalls stop server-side much sooner)
      for (let i = 0; i < POLL_ITERS; i++) {
        if (isCancelled(itemId)) return; // user stopped this file — quit waiting
        await new Promise(r => setTimeout(r, 2500));
        if (isCancelled(itemId)) return;
        let status: { processing: boolean; deal?: Deal; error?: string };
        try {
          status = await apiPollDealStatus(dealId);
          consecutiveErrors = 0;
        } catch {
          // A status check failed — almost always a transient server/network blip
          // (e.g. an instance restarting mid-extraction). The extraction is very
          // likely still running, so keep waiting instead of failing the upload.
          // Only give up after ~30s of continuous failures.
          consecutiveErrors++;
          if (consecutiveErrors >= 12) { connLost = true; break; }
          continue;
        }
        if (!status.processing) {
          if (status.error) { pollError = status.error; break; }
          resolvedDeal = (status.deal as Deal) ?? null;
          break;
        }
        const pct = Math.min(65 + Math.round((i / POLL_ITERS) * 28), 93);
        updateItem(itemId, { progress: pct });
      }

      if (connLost) {
        // Don't delete the temp deal — it may still finish on the server. It'll
        // appear after the connection recovers and the list reloads.
        updateItem(itemId, { status: "error", progress: 0, msg: "Connection lost",
          error: "Lost connection while it was processing — the deal may still finish. Refresh in a minute; if it's not there, re-upload." });
        return;
      }
      if (pollError) {
        throw new Error(pollError);
      }
      if (!resolvedDeal) {
        // We waited out the client window but the server may still be finishing a
        // large (still-progressing) OM. Don't delete the temp deal or call it a hard
        // failure — it should land shortly.
        updateItem(itemId, { status: "error", progress: 0, msg: "Still processing",
          error: "This OM is large and is still extracting on the server — it should appear shortly. Refresh in a minute; if it's not there, re-upload." });
        return;
      }

      updateItem(itemId, { msg: "Checking for duplicates…", progress: 95 });

      const imageMeta = imgs ? {
        cover: !!imgs.cover,
        sitePlan: imgs.sitePlan ? imgs.sitePlan.length : 0,
        needsSitePlanPick: imgs.needsSitePlanPick || false,
      } : undefined;

      const extracted = resolvedDeal as unknown as Record<string, unknown>;
      // Include deals created earlier in THIS drop (e.g. a stub made from a rent
      // roll that finished before this OM) so the OM merges into it via the dup
      // flow instead of creating a second deal for the same property.
      const candidates = [...existingDeals, ...createdDealsRef.current];
      const dup = findDuplicate(fileName, extracted, candidates) || findRosterStubMatch(extracted, candidates);

      if (dup) {
        // Auto-merge into the matched deal instead of pausing the queue to ask.
        // The reconcile is conservative — keeps the existing deal's data, fills
        // only its blanks from this upload, and flags any genuine conflicts for
        // review — so a batch never stops and duplicates consolidate on their own.
        await apiDeleteDeal(dealId).catch(() => {});   // drop the temp deal we were creating
        // Re-base on the LATEST version of the matched deal: it may have just had a
        // sales report / roster / swap applied earlier in this SAME drop (which the
        // slow OM extraction outran). Merging onto a stale snapshot here would
        // overwrite that data. Mirrors commitPatch's getLatestDeal re-base.
        const freshDup = getLatestDeal?.(dup.id) ?? dup;
        const refreshed = reconcileRefresh(freshDup, { ...extracted, imageMeta, fileName, pdfPages: pages });
        refreshed.lastUploadAt = new Date().toISOString();
        await apiSaveDeal(refreshed).catch(() => {});
        await apiSaveSource(refreshed.id, text).catch(() => {});
        if (imgs) await saveImagesNoting(refreshed.id, imgs, itemId);
        updateItem(itemId, {
          status: "done", progress: 100, deal: refreshed, routedType: "om",
          matchedDealName: refreshed.propertyName || refreshed.fileName,
          priorDeal: dup, appliedDealId: refreshed.id, createdNew: false,
          msg: `Merged into existing “${refreshed.propertyName || refreshed.fileName || "deal"}” · review any flagged conflicts`,
        });
        onDealUpdated?.(refreshed);
        await registerCreatedDeal(refreshed);
        if (imagesDeferred) attachImagesLater(refreshed.id, imgPromise, itemId);
        return;
      }

      const finalDeal: Deal = { ...resolvedDeal, imageMeta, lastUploadAt: new Date().toISOString() };
      await apiSaveDeal(finalDeal).catch(() => {});

      updateItem(itemId, { status: "done", msg: finalDeal.propertyName || finalDeal.fileName || "Saved", progress: 100, deal: finalDeal,
        routedType: "om", matchedDealName: finalDeal.propertyName || finalDeal.fileName, createdNew: true, priorDeal: null, appliedDealId: finalDeal.id });
      onDealsAdded([finalDeal]);
      await registerCreatedDeal(finalDeal);
      if (imagesDeferred) attachImagesLater(dealId, imgPromise, itemId);
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
    // Re-base on the latest copy of the target (same-drop sales/roster may have
    // landed since the dup was flagged) so the merge doesn't overwrite it.
    const freshDup = getLatestDeal?.(item.dupCandidate.id) ?? item.dupCandidate;
    const refreshed = reconcileRefresh(freshDup, item.pendingExtracted);
    await apiSaveDeal(refreshed).catch(() => {});
    if (item.pendingText) await apiSaveSource(refreshed.id, item.pendingText).catch(() => {});
    if (item.pendingImages) await saveImagesNoting(refreshed.id, item.pendingImages, itemId);
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
                ) : item.status === "awaiting_match" ? (
                  <div style={{ padding: "14px 28px", borderBottom: "1px solid #f4f6f7", background: "#fffbf0" }}>
                    <div style={{ fontSize: 12, fontWeight: 700, color: "#a06208", marginBottom: 4 }}>Which property is this for?</div>
                    <div style={{ fontSize: 12.5, color: "#5f5a50", marginBottom: 9, lineHeight: 1.4 }}>
                      <strong style={{ color: "#383a37" }}>{item.name}</strong> — {item.msg}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                      <select defaultValue="" onChange={e => { const d = existingDeals.find(x => x.id === e.target.value); if (d) assignMatch(item.id, d); }}
                        style={{ fontSize: 12, padding: "7px 10px", border: "1px solid #c8b89a", borderRadius: 7, background: "#fff", fontFamily: "'Inter',sans-serif", maxWidth: 240 }}>
                        <option value="" disabled>Match to existing property…</option>
                        {[...existingDeals].filter(d => !d.trashedAt).sort((a, b) => (a.propertyName || a.fileName || "").localeCompare(b.propertyName || b.fileName || "")).map(d => (
                          <option key={d.id} value={d.id}>{d.propertyName || d.fileName || "Untitled"}</option>
                        ))}
                      </select>
                      <button onClick={() => createNewFromDoc(item.id)}
                        style={{ background: "#26281f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                        + Create new property
                      </button>
                      <button onClick={() => setQueue(q => q.filter(x => x.id !== item.id))}
                        style={{ background: "transparent", color: "#a89f8f", border: "none", padding: "7px 10px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                        Dismiss
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
                          {item.status === "extracting" && item.startedAt && (
                            <span style={{ fontSize: 10, color: "#a69e91", fontVariantNumeric: "tabular-nums", minWidth: 34, textAlign: "right" }}>
                              {fmtElapsed(nowTick - item.startedAt)}
                            </span>
                          )}
                        </div>
                      )}
                      {item.error && <div style={{ fontSize: 11, color: "#c0563b", marginTop: 3, lineHeight: 1.4, wordBreak: "break-word" }}>{item.error}</div>}
                      {item.status === "done" && !item.undone && item.appliedDealId && (
                        <div style={{ display: "flex", gap: 8, marginTop: 7, flexWrap: "wrap", alignItems: "center" }}>
                          <span style={{ fontSize: 11, color: "#7d766a" }}>→ <b style={{ color: "#383a37" }}>{item.matchedDealName || "property"}</b>{item.createdNew ? " (new)" : ""}</span>
                          <button onClick={() => undoItem(item.id)}
                            style={{ background: "#fff", border: "1px solid #e0c9c0", color: "#b5503a", padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 10.5, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>
                            Undo
                          </button>
                          {item.routedType && item.routedType !== "om" && (
                            <button onClick={() => reassignItem(item.id)}
                              style={{ background: "#fff", border: "1px solid #d9d2c4", color: "#6f6a5f", padding: "3px 10px", borderRadius: 6, cursor: "pointer", fontSize: 10.5, fontWeight: 600, fontFamily: "'Inter',sans-serif" }}>
                              Reassign
                            </button>
                          )}
                        </div>
                      )}
                      {item.status === "done" && item.undone && (
                        <div style={{ fontSize: 11, color: "#a69e91", marginTop: 5 }}>↩ Reverted.</div>
                      )}
                    </div>
                    {(item.status === "extracting" || item.status === "pending") && (
                      <button
                        onClick={() => cancelItem(item.id)}
                        title="Cancel this file"
                        style={{ background: "#fff", border: "1px solid #e0c9c0", color: "#b5503a", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontWeight: 600, flexShrink: 0, fontFamily: "'Inter',sans-serif" }}>
                        ✕ Cancel
                      </button>
                    )}
                    {item.status === "done" && item.deal && !item.undone && (
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
