import { useState } from "react";
import { apiLocalIntelScan, apiLocalIntelDismiss, type LocalIntelResponse, type IntelFinding } from "../lib/api";
import { INTEL_CATEGORY_LABEL, intelMeta, safeHref, groupByCategory } from "../lib/localIntel";

// Local Intel box (Eric, 10/19/26) — a standalone, RAW view on the Summary tab: EVERY finding
// the web scan returned (low-severity and positive items too), grouped by category, each with
// its date and source links. Admins / the owner can Refresh and mark an item "Not relevant"
// (sticks across re-scans). The important items are separately woven into Red Flags, Upside
// and the AI grade; this box is where all of it can be read as found.
const IMPACT: Record<IntelFinding["impact"], { label: string; color: string; bg: string }> = {
  negative: { label: "Negative", color: "#a1361f", bg: "#fbece8" },
  positive: { label: "Positive", color: "#2f6b1c", bg: "#ecf6e5" },
  watch: { label: "Watch", color: "#6b5a1c", bg: "#f6f1e0" },
};
const SEV: Record<IntelFinding["severity"], string> = { high: "#dc2626", medium: "#ea6000", low: "#8a8983" };
const btn = { background: "#fff", border: "1px solid #d7d5ce", color: "#383a37", borderRadius: 7, padding: "8px 13px", minHeight: 36, fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Roboto',sans-serif" } as const;

export default function LocalIntelCard({ dealId, data, onChange }: { dealId: string; data: LocalIntelResponse | null; onChange: (d: LocalIntelResponse) => void }) {
  const [scanning, setScanning] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [showDismissed, setShowDismissed] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  if (!data) return null;
  const rec = data.record;
  const findings = rec?.findings ?? [];
  const active = findings.filter(f => !f.dismissed);
  const dismissed = findings.filter(f => f.dismissed);
  const shown = showDismissed ? findings : active;

  const refresh = async () => {
    setScanning(true); setErr(null);
    try { onChange(await apiLocalIntelScan(dealId)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Scan failed"); }
    finally { setScanning(false); }
  };
  const toggle = async (f: IntelFinding) => {
    setBusy(f.id);
    try { onChange(await apiLocalIntelDismiss(dealId, f.id, !f.dismissed)); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); }
    finally { setBusy(null); }
  };

  return (
    <div id="section-localintel" style={{ background: "#fff", border: "1px solid #dfddd6", borderRadius: 12, padding: "14px 16px", marginBottom: 12 }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ fontFamily: "'Lora',Georgia,serif", fontSize: 16, fontWeight: 600, color: "#232422" }}>Local Intel — what the internet found</div>
          <div style={{ fontSize: 11.5, color: "#8a8983", marginTop: 3 }}>
            {rec?.scannedAt
              ? <>Last scanned {new Date(rec.scannedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}{rec.trigger === "monthly" ? " (monthly re-scan)" : rec.trigger === "new-om" ? " (after upload)" : ""} · local news within ~{rec.radiusMiles} mi · {rec.searchesUsed} searches</>
              : "Not scanned yet — local news, competing stores, tenant closures, road and zoning changes near the site."}
          </div>
          {rec?.scannedAt && <div style={{ fontSize: 11.5, color: "#8a8983", marginTop: 2 }}>Everything the scan returned, as found. The important items also appear in Red Flags, Upside and the AI grade.</div>}
        </div>
        {data.canScan && data.configured && (
          <button onClick={refresh} disabled={scanning} style={{ ...btn, opacity: scanning ? 0.6 : 1, cursor: scanning ? "default" : "pointer" }}
            title="Search the web for local news about this property and its area (takes about a minute)">
            {scanning ? "Searching local news…" : rec?.scannedAt ? "↻ Refresh" : "Scan now"}
          </button>
        )}
      </div>
      {scanning && <div style={{ fontSize: 12, color: "#676767", marginTop: 8 }}>Running about 10 searches — usually a minute or two. You can keep working; this card fills in when it's done.</div>}
      {(err || rec?.error) && <div style={{ fontSize: 12, color: "#b5503a", marginTop: 8 }}>{err || `Last background scan didn't finish: ${rec?.error}`}</div>}
      {!data.configured && <div style={{ fontSize: 12, color: "#8a8983", marginTop: 8 }}>Web research isn't configured on this server.</div>}

      {rec?.scannedAt && !active.length && !scanning && (
        <div style={{ fontSize: 12.5, color: "#676767", marginTop: 10 }}>Nothing material found in the last 24 months{dismissed.length ? " (other than items marked not relevant)" : ""}.</div>
      )}

      {shown.length > 0 && groupByCategory(shown).map(([cat, items]) => (
        <div key={cat} style={{ marginTop: 12 }}>
          <div style={{ fontSize: 10.5, fontWeight: 800, letterSpacing: "0.08em", textTransform: "uppercase", color: "#383a37", paddingBottom: 4, borderBottom: "1.5px solid #e6e4de" }}>
            {INTEL_CATEGORY_LABEL[cat]} <span style={{ color: "#8a8983", fontWeight: 600 }}>· {items.length}</span>
          </div>
          {items.map(f => {
            const imp = IMPACT[f.impact];
            const meta = intelMeta(f);
            return (
              <div key={f.id} style={{ padding: "10px 0", borderTop: "1px solid #f1efe9", opacity: f.dismissed ? 0.55 : 1 }}>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center", marginBottom: 4 }}>
                  <span style={{ fontSize: 9.5, fontWeight: 700, color: SEV[f.severity], border: `1px solid ${SEV[f.severity]}55`, padding: "1px 6px", borderRadius: 3, textTransform: "uppercase" }}>{f.severity}</span>
                  <span style={{ fontSize: 10.5, fontWeight: 700, color: imp.color, background: imp.bg, padding: "2px 7px", borderRadius: 4 }}>{imp.label}</span>
                  {f.isNew && !f.dismissed && <span style={{ fontSize: 9.5, fontWeight: 800, color: "#fff", background: "#5bba47", padding: "2px 6px", borderRadius: 3 }}>NEW</span>}
                  {f.dismissed && <span style={{ fontSize: 10.5, color: "#8a8983" }}>marked not relevant</span>}
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: "#232422", lineHeight: 1.4, overflowWrap: "break-word" }}>{f.headline}</div>
                {f.whyItMatters && <div style={{ fontSize: 12.5, color: "#55584f", lineHeight: 1.5, marginTop: 2 }}>{f.whyItMatters}</div>}
                <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", alignItems: "center", marginTop: 5, fontSize: 11.5, color: "#8a8983" }}>
                  {!f.date && <span>Undated</span>}
                  {meta && <span title={f.distanceBasis === "geocoded" ? "Distance measured from both addresses" : f.distanceBasis === "reported" ? "Distance as the source states it" : f.distanceMiles != null ? "Approximate distance" : ""}>{meta}</span>}
                  {f.sources.map((s, i) => { const h = safeHref(s.url); return h ? (
                    <a key={i} href={h} target="_blank" rel="noopener noreferrer nofollow" style={{ color: "#2c6e9b", textDecoration: "none", overflowWrap: "anywhere" }}>{s.title || new URL(h).hostname} ↗</a>
                  ) : null; })}
                  {data.canScan && (
                    <button onClick={() => toggle(f)} disabled={busy === f.id}
                      style={{ marginLeft: "auto", background: "transparent", border: "none", color: "#8a8983", fontSize: 11.5, cursor: "pointer", padding: "6px 0", minHeight: 30, fontFamily: "'Roboto',sans-serif" }}>
                      {f.dismissed ? "Restore" : "Not relevant"}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ))}
      {dismissed.length > 0 && (
        <button onClick={() => setShowDismissed(s => !s)} style={{ marginTop: 4, background: "transparent", border: "none", padding: "6px 0", color: "#2c6e9b", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Roboto',sans-serif" }}>
          {showDismissed ? "Hide items marked not relevant" : `Show ${dismissed.length} marked not relevant`}
        </button>
      )}
      {rec?.scannedAt && <div style={{ fontSize: 10.5, color: "#b8b5ad", marginTop: 6 }}>From a web search of local news — each item links its source. Reported news, not verified fact.</div>}
    </div>
  );
}
