import { useRef, useState } from "react";
import type { Deal, ImageBundle } from "../lib/idb";
import { apiSaveSource, apiSaveImages, apiSaveDeal, apiDeleteDeal, apiIngestDeal, apiPollDealStatus } from "../lib/api";
import { extractPdfText, extractPdfImages } from "../lib/pdfExtract";
import { uid } from "../lib/utils";

interface QueueItem {
  id: string;
  name: string;
  status: "pending" | "extracting" | "awaiting_dup" | "done" | "error";
  error?: string;
  deal?: Deal;
  tempDealId?: string;
  dupCandidate?: Deal;
  pendingExtracted?: Record<string, unknown>;
  pendingImages?: ImageBundle | null;
  pendingText?: string;
}

interface Props {
  onDealsAdded: (deals: Deal[]) => void;
  onDealUpdated?: (deal: Deal) => void;
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
    status: existing.status,
    userNotes: existing.userNotes,
    verified: existing.verified,
    propertyGroupId: existing.propertyGroupId,
    trashedAt: existing.trashedAt,
    txnPurchasePrice: existing.txnPurchasePrice,
    txnSeller: existing.txnSeller,
    txnLoiDate: existing.txnLoiDate,
    txnCloseDate: existing.txnCloseDate,
    txnSalePrice: existing.txnSalePrice,
    txnBuyer: existing.txnBuyer,
    txnSaleDate: existing.txnSaleDate,
    txnBroker: existing.txnBroker,
    acqCapRate: existing.acqCapRate,
    acqNOIAtClose: existing.acqNOIAtClose,
    acqEntity: existing.acqEntity,
    acqBroker: existing.acqBroker,
    acqContractDate: existing.acqContractDate,
    acqDDExpiration: existing.acqDDExpiration,
    acqDeposit: existing.acqDeposit,
    acqClosingCosts: existing.acqClosingCosts,
    acqFee: existing.acqFee,
    acqTitleCo: existing.acqTitleCo,
    acqCounsel: existing.acqCounsel,
    acqPropManager: existing.acqPropManager,
    acqStrategy: existing.acqStrategy,
    acqHoldPeriod: existing.acqHoldPeriod,
    acqTargetIRR: existing.acqTargetIRR,
    acqNotes: existing.acqNotes,
    debtLender: existing.debtLender,
    debtType: existing.debtType,
    debtLoanAmount: existing.debtLoanAmount,
    debtRate: existing.debtRate,
    debtRateType: existing.debtRateType,
    debtMaturityDate: existing.debtMaturityDate,
    debtNotes: existing.debtNotes,
    marketSale: existing.marketSale,
    marketSaleChecked: existing.marketSaleChecked,
    marketDemographics: existing.marketDemographics,
    demoChecked: existing.demoChecked,
  };

  const verifiedFields = Object.keys(existing.verified || {});
  const verifiedOverrides: Partial<Deal> = {};
  for (const f of verifiedFields) {
    const k = f as keyof Deal;
    if (existing[k] !== undefined) {
      (verifiedOverrides as Record<string, unknown>)[f] = existing[k];
    }
  }

  return {
    ...existing,
    ...(extracted as Partial<Deal>),
    ...preserved,
    ...verifiedOverrides,
    id: existing.id,
    uploadedAt: existing.uploadedAt,
    refreshedAt: new Date().toISOString(),
  } as Deal;
}

export default function UploadQueue({ onDealsAdded, onDealUpdated, existingDeals }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file: File) => {
    const itemId = uid();
    const dealId = uid();
    setQueue(q => [...q, { id: itemId, name: file.name, status: "pending", tempDealId: dealId }]);

    try {
      setQueue(q => q.map(x => x.id === itemId ? { ...x, status: "extracting" } : x));

      const buf = await file.arrayBuffer();
      // Give each PDF.js consumer its own copy — the worker transfers (detaches) the buffer
      const imgPromise = extractPdfImages(buf.slice(0)).catch(() => null);
      const { text, pages } = await extractPdfText(buf.slice(0));

      const fileName = file.name.replace(/\.pdf$/i, "");

      // Send text to server — returns immediately, extraction runs in background
      await apiIngestDeal({ id: dealId, text, fileName, pageCount: pages });

      // Save images + source right away (don't need Claude for these)
      const imgs = await imgPromise;
      if (imgs) await apiSaveImages(dealId, imgs).catch(() => {});
      await apiSaveSource(dealId, text).catch(() => {});

      // Poll until server-side Claude extraction completes (up to 5 min)
      let resolvedDeal: Deal | null = null;
      let pollError: string | null = null;
      for (let i = 0; i < 120; i++) {
        await new Promise(r => setTimeout(r, 2500));
        const status = await apiPollDealStatus(dealId);
        if (!status.processing) {
          if (status.error) { pollError = status.error; break; }
          resolvedDeal = (status.deal as Deal) ?? null;
          break;
        }
      }

      if (pollError || !resolvedDeal) {
        throw new Error(pollError || "Extraction timed out — please retry");
      }

      const imageMeta = imgs ? {
        cover: !!imgs.cover,
        sitePlan: imgs.sitePlan ? imgs.sitePlan.length : 0,
        needsSitePlanPick: imgs.needsSitePlanPick || false,
      } : undefined;

      // Dup check using the now-resolved AI data
      const extracted = resolvedDeal as unknown as Record<string, unknown>;
      const dup = findDuplicate(fileName, extracted, existingDeals);

      if (dup) {
        setQueue(q => q.map(x => x.id === itemId ? {
          ...x,
          status: "awaiting_dup",
          dupCandidate: dup,
          pendingExtracted: { ...extracted, imageMeta, fileName, pdfPages: pages },
          pendingImages: imgs,
          pendingText: text,
          tempDealId: dealId,
        } : x));
        return;
      }

      // No dup — finalize the already-created deal with imageMeta
      const finalDeal: Deal = { ...resolvedDeal, imageMeta };
      await apiSaveDeal(finalDeal).catch(() => {});

      setQueue(q => q.map(x => x.id === itemId ? { ...x, status: "done", deal: finalDeal } : x));
      onDealsAdded([finalDeal]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Extraction failed";
      setQueue(q => q.map(x => x.id === itemId ? { ...x, status: "error", error: msg } : x));
      // Clean up the orphaned processing deal on error
      await apiDeleteDeal(dealId).catch(() => {});
    }
  };

  const handleDupUpdate = async (itemId: string) => {
    const item = queue.find(x => x.id === itemId);
    if (!item?.dupCandidate || !item.pendingExtracted) return;

    // Delete the temp deal created during ingest
    if (item.tempDealId) await apiDeleteDeal(item.tempDealId).catch(() => {});

    const refreshed = reconcileRefresh(item.dupCandidate, item.pendingExtracted);
    await apiSaveDeal(refreshed).catch(() => {});
    if (item.pendingText) await apiSaveSource(refreshed.id, item.pendingText).catch(() => {});
    if (item.pendingImages) await apiSaveImages(refreshed.id, item.pendingImages).catch(() => {});

    setQueue(q => q.map(x => x.id === itemId ? { ...x, status: "done", deal: refreshed } : x));
    onDealUpdated?.(refreshed);
  };

  const handleDupKeepBoth = async (itemId: string) => {
    const item = queue.find(x => x.id === itemId);
    if (!item?.pendingExtracted || !item.tempDealId) return;

    // The temp deal already exists in DB with extracted data + images + source already saved.
    // Just update it with the imageMeta field and show it as a completed deal.
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

    setQueue(q => q.map(x => x.id === itemId ? { ...x, status: "done", deal } : x));
    onDealsAdded([deal]);
  };

  const handleDupCancel = async (itemId: string) => {
    const item = queue.find(x => x.id === itemId);
    if (item?.tempDealId) await apiDeleteDeal(item.tempDealId).catch(() => {});
    setQueue(q => q.filter(x => x.id !== itemId));
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    Array.from(files).filter(f => f.name.toLowerCase().endsWith(".pdf")).forEach(processFile);
  };

  const busy = queue.some(q => q.status === "extracting" || q.status === "pending");

  return (
    <div style={{ padding: "28px 28px 0" }}>
      {/* Drop zone */}
      <div
        onDragEnter={e => { e.preventDefault(); setDragging(true); }}
        onDragOver={e => e.preventDefault()}
        onDragLeave={() => setDragging(false)}
        onDrop={e => { e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files); }}
        onClick={() => inputRef.current?.click()}
        style={{
          border: `2px dashed ${dragging ? "#6dba43" : "#d8d0c0"}`,
          borderRadius: 14,
          padding: "28px 24px",
          textAlign: "center",
          cursor: "pointer",
          background: dragging ? "#6dba4309" : "#faf7f0",
          transition: "all .2s ease",
          marginBottom: 20,
        }}
      >
        <input ref={inputRef} type="file" accept=".pdf" multiple style={{ display: "none" }} onChange={e => handleFiles(e.target.files)} />
        <div style={{ fontSize: 28, marginBottom: 8 }}>📄</div>
        <div style={{ fontFamily: "'Fraunces', serif", fontSize: 18, color: "#383a37", fontWeight: 500, marginBottom: 4 }}>
          Drop Offering Memorandums here
        </div>
        <div style={{ fontSize: 12, color: "#a89f8f" }}>
          PDF files only · Claude AI extracts the deal data automatically
        </div>
      </div>

      {/* Queue list */}
      {queue.length > 0 && (
        <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 8 }}>
          {queue.map(item => (
            <div key={item.id}>
              {item.status === "awaiting_dup" && item.dupCandidate ? (
                <div style={{ background: "#fffbf0", border: "1.5px solid #d9890c", borderRadius: 12, padding: "16px 18px" }}>
                  <div style={{ fontSize: 12, fontWeight: 600, color: "#a06208", marginBottom: 4 }}>Possible duplicate detected</div>
                  <div style={{ fontSize: 13, color: "#383a37", marginBottom: 2 }}>
                    <strong>{item.name}</strong> looks like an existing deal:
                  </div>
                  <div style={{ fontSize: 12, color: "#5f5a50", marginBottom: 12 }}>
                    <strong>{item.dupCandidate.propertyName || item.dupCandidate.fileName || "Untitled"}</strong>
                    {item.dupCandidate.uploadedAt && <> — uploaded {new Date(item.dupCandidate.uploadedAt).toLocaleDateString()}</>}
                  </div>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button onClick={() => handleDupUpdate(item.id)} style={{ background: "#26281f", color: "#fff", border: "none", borderRadius: 7, padding: "7px 14px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter',sans-serif", fontWeight: 600 }}>
                      Update existing deal
                    </button>
                    <button onClick={() => handleDupKeepBoth(item.id)} style={{ background: "#fff", color: "#383a37", border: "1px solid #d8d0c0", borderRadius: 7, padding: "7px 14px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                      Keep both
                    </button>
                    <button onClick={() => handleDupCancel(item.id)} style={{ background: "transparent", color: "#a89f8f", border: "none", padding: "7px 10px", fontSize: 12, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 10, padding: "10px 14px", display: "flex", alignItems: "center", gap: 12 }}>
                  <div style={{
                    width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
                    background: item.status === "done" ? "#6dba43"
                      : item.status === "error" ? "#dc2626"
                      : item.status === "extracting" ? "#d9890c"
                      : "#e3dccd",
                    animation: item.status === "extracting" ? "pulse 1.2s ease infinite" : undefined,
                  }}/>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 12, color: "#383a37", fontWeight: 500, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.name}</div>
                    {item.status === "error" && <div style={{ fontSize: 11, color: "#dc2626" }}>{item.error}</div>}
                    {item.status === "extracting" && <div style={{ fontSize: 11, color: "#d9890c" }}>Extracting with Claude AI…</div>}
                    {item.status === "done" && <div style={{ fontSize: 11, color: "#6dba43" }}>Done — {item.deal?.propertyName || item.deal?.fileName || "saved"}</div>}
                  </div>
                </div>
              )}
            </div>
          ))}
          {!busy && queue.every(x => x.status !== "awaiting_dup") && (
            <button onClick={() => setQueue([])}
              style={{ alignSelf: "flex-end", background: "transparent", border: "1px solid #e7e0d2", color: "#a89f8f", padding: "4px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "'Inter', sans-serif" }}>
              Clear
            </button>
          )}
        </div>
      )}
    </div>
  );
}
