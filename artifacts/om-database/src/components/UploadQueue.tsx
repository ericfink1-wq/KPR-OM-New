import { useRef, useState } from "react";
import type { Deal } from "../lib/idb";
import { idbSaveDeals, idbSaveSource, idbSaveImages } from "../lib/idb";
import { extractPdfText, extractPdfImages } from "../lib/pdfExtract";
import { uid } from "../lib/utils";
import { useExtractOmData } from "@workspace/api-client-react";

interface QueueItem {
  id: string;
  name: string;
  status: "pending" | "extracting" | "done" | "error";
  error?: string;
  deal?: Deal;
}

interface Props {
  onDealsAdded: (deals: Deal[]) => void;
  existingDeals: Deal[];
}

export default function UploadQueue({ onDealsAdded, existingDeals }: Props) {
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const { mutateAsync: extractOm } = useExtractOmData();

  const processFile = async (file: File) => {
    const itemId = uid();
    setQueue(q => [...q, { id: itemId, name: file.name, status: "pending" }]);

    try {
      setQueue(q => q.map(x => x.id === itemId ? { ...x, status: "extracting" } : x));

      const buf = await file.arrayBuffer();
      const { text, pages } = await extractPdfText(buf);

      // Save text to IndexedDB
      const dealId = uid();
      await idbSaveSource(dealId, text);

      // Extract images in background
      const imgPromise = extractPdfImages(buf.slice(0)).then(async imgs => {
        await idbSaveImages(dealId, imgs);
        return imgs;
      }).catch(() => null);

      // Call AI extraction endpoint (backend proxies to Claude)
      const truncated = text.slice(0, 90000);
      const resp = await extractOm({ data: { text: truncated } });
      const extracted = resp as unknown as Record<string, unknown>;

      const imgs = await imgPromise;
      const imageMeta = imgs ? {
        cover: !!imgs.cover,
        sitePlan: imgs.sitePlan ? imgs.sitePlan.length : 0,
        needsSitePlanPick: imgs.needsSitePlanPick || false,
      } : undefined;

      const deal: Deal = {
        id: dealId,
        fileName: file.name.replace(/\.pdf$/i, ""),
        uploadedAt: new Date().toISOString(),
        pdfPages: pages,
        status: "Prospect",
        imageMeta,
        ...extracted,
      };

      await idbSaveDeals([deal]);

      setQueue(q => q.map(x => x.id === itemId ? { ...x, status: "done", deal } : x));
      onDealsAdded([deal]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Extraction failed";
      setQueue(q => q.map(x => x.id === itemId ? { ...x, status: "error", error: msg } : x));
    }
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
        <div style={{ marginBottom: 20, display: "flex", flexDirection: "column", gap: 6 }}>
          {queue.map(item => (
            <div key={item.id} style={{
              background: "#fff",
              border: "1px solid #ece5d7",
              borderRadius: 10,
              padding: "10px 14px",
              display: "flex",
              alignItems: "center",
              gap: 12,
            }}>
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
          ))}
          {!busy && queue.length > 0 && (
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
