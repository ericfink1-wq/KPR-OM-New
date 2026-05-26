import { useRef, useState, useEffect } from "react";
import type { Deal, ImageBundle } from "../lib/idb";
import { apiSaveSource, apiSaveImages, apiSaveDeal, apiDeleteDeal, apiIngestDeal, apiPollDealStatus } from "../lib/api";
import { extractPdfText, extractPdfImages } from "../lib/pdfExtract";
import { uid, buildCorrectionsNote } from "../lib/utils";

interface QueueItem {
  id: string;
  name: string;
  file?: File;
  status: "pending" | "extracting" | "awaiting_dup" | "done" | "error";
  msg: string;
  progress: number;
  error?: string;
  deal?: Deal;
  tempDealId?: string;
  dupCandidate?: Deal;
  pendingExtracted?: Record<string, unknown>;
  pendingImages?: ImageBundle | null;
  pendingText?: string;
}

interface Props {
  pendingFiles: File[];
  onFilesConsumed: () => void;
  onDealsAdded: (deals: Deal[]) => void;
  onDealUpdated?: (deal: Deal) => void;
  onOpenDeal: (id: string) => void;
  existingDeals: Deal[];
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

export default function UploadQueue({ pendingFiles, onFilesConsumed, onDealsAdded, onDealUpdated, onOpenDeal, existingDeals }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [queueOpen, setQueueOpen] = useState(true);
  const pendingRef = useRef<File[]>([]);
  const activeCountRef = useRef(0);
  const waitingFilesRef = useRef<{ file: File; itemId: string }[]>([]);
  const stopRef = useRef(false);

  const drainQueue = () => {
    while (activeCountRef.current < MAX_CONCURRENT && waitingFilesRef.current.length > 0) {
      if (stopRef.current) {
        // Mark remaining waiting items as stopped
        setQueue(prev => prev.map(it => it.status === "pending" ? { ...it, status: "error", msg: "Stopped", error: "Stopped by user" } : it));
        waitingFilesRef.current = [];
        break;
      }
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
    waitingFilesRef.current = [];
    setQueue(prev => prev.map(it => it.status === "pending" ? { ...it, status: "error", msg: "Stopped", error: "Stopped by user" } : it));
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
    const pdfs = pendingFiles.filter(f => f.name.toLowerCase().endsWith(".pdf"));
    onFilesConsumed();
    if (pdfs.length) {
      setQueueOpen(true);
      pdfs.forEach(enqueueFile);
    }
  }, [pendingFiles]);

  const updateItem = (itemId: string, patch: Partial<QueueItem>) => {
    setQueue(q => q.map(x => x.id === itemId ? { ...x, ...patch } : x));
  };

  const processFile = async (file: File, itemId: string) => {
    const dealId = uid();
    updateItem(itemId, { tempDealId: dealId });

    try {
      updateItem(itemId, { status: "extracting", msg: "Reading PDF…", progress: 5 });

      const buf = await file.arrayBuffer();
      const imgPromise = extractPdfImages(buf.slice(0)).catch(() => null);

      updateItem(itemId, { msg: "Extracting text…", progress: 20 });
      const { text, pages } = await extractPdfText(buf.slice(0));

      const fileName = file.name.replace(/\.pdf$/i, "");

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
        <div style={{ position: "fixed", bottom: 0, left: 0, right: 0, background: "#ffffff", borderTop: "1px solid #ebe4d6", zIndex: 200, maxHeight: "60vh", display: "flex", flexDirection: "column", boxShadow: "0 -12px 48px rgba(56,58,55,0.12)" }}>
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
                </span>
              </div>
              <div style={{ display: "flex", gap: 8 }}>
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
