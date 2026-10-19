import { fmtMoney, fmtCompact } from "../lib/money";
import type { Deal } from "../lib/idb";
import { STATUS_COLORS } from "../lib/constants";
import { cityState } from "../lib/utils";

interface Props {
  deals: Deal[];
  onOpen: (id: string) => void;
}

export default function DealTiles({ deals, onOpen }: Props) {
  const recency = (d: Deal) => new Date(d.uploadedAt || 0).getTime();
  const uc = deals.filter(d => d.status === "Under Contract").sort((a, b) => recency(b) - recency(a));
  const prospects = deals.filter(d => d.status === "Prospect").sort((a, b) => recency(b) - recency(a));
  const tiles = [...uc, ...prospects].slice(0, 8);
  // Covers come from the small cacheable thumbnail endpoint as plain lazy <img>s.
  // (They used to pull each deal's FULL image bundle — cover + site plans + page
  // images, up to ~800 KB apiece — just to paint a tile; ~5 MB on the home page.)
  const coverSrc = (d: Deal) => d.imageMeta?.cover
    ? `/api/deals/${d.id}/cover-thumb?v=${encodeURIComponent(d.updatedAt || d.uploadedAt || "")}`
    : null;

  if (!tiles.length) return null;

  return (
    <div>
      <style>{`.deal-tiles-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:16px}.deal-tile{height:228px}@media(max-width:640px){.deal-tile{height:190px}.deal-tiles-grid{grid-template-columns:repeat(2,1fr);gap:10px}.deal-tile-pill{font-size:9px !important;letter-spacing:0.01em !important}.deal-tile-pillbox{left:8px !important;top:8px !important;padding:3px 7px !important;max-width:calc(100% - 46px) !important}.deal-tile-grade{min-width:26px !important;height:26px !important;font-size:12px !important;right:8px !important;top:8px !important}}@media(min-width:1024px){.deal-tiles-grid{grid-template-columns:repeat(4,1fr)}}`}</style>
      <div className="deal-tiles-grid">
        {tiles.map((d, i) => {
          const sc = STATUS_COLORS[d.status || ""] || "#6b6a65";
          const loc = cityState(d);
          const src = coverSrc(d);
          const noiN = Number(d.noi), sfN = Number(d.totalSF), occN = Number(d.occupancy);
          const metrics = [
            d.noi != null && Number.isFinite(noiN) && noiN > 0 ? `${fmtMoney(noiN)} NOI` : null,
            d.totalSF != null && Number.isFinite(sfN) && sfN > 0 ? `${fmtCompact(sfN)} SF` : null,
            d.occupancy != null && Number.isFinite(occN) && occN > 0 ? `${Math.round(occN <= 1 ? occN * 100 : occN)}% occ` : null,
          ].filter(Boolean).join(" · ");
          const uc = d.status === "Under Contract";
          const grade = d.dealScore?.grade?.trim() || null;
          return (
            <button key={d.id} onClick={() => onOpen(d.id)} className={`deal-tile${i >= 6 ? " hidden lg:block" : ""}`}
              style={{ position: "relative", borderRadius: 14, overflow: "hidden", cursor: "pointer", border: "1px solid #ecebe6", textAlign: "left", padding: 0, boxShadow: "0 1px 2px rgba(35,36,34,0.05), 0 14px 30px -22px rgba(35,36,34,0.6)", background: src ? "#232422" : "linear-gradient(135deg,#4a4c48,#232422)", transition: "transform .2s ease" }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; const img = e.currentTarget.querySelector("img"); if (img) (img as HTMLImageElement).style.transform = "scale(1.06)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "none"; const img = e.currentTarget.querySelector("img"); if (img) (img as HTMLImageElement).style.transform = "none"; }}>
              {src && <img src={src} alt={d.propertyName || d.fileName || "Property photo"} loading="lazy" decoding="async" onError={e => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transition: "transform .45s ease" }} />}
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(35,36,34,0.05) 0%, rgba(35,36,34,0.35) 40%, rgba(35,36,34,0.93) 100%)" }} />
              <div className="deal-tile-pillbox" style={{ position: "absolute", top: 10, left: 10, display: "flex", alignItems: "center", gap: 5, background: uc ? "#C9A227" : "rgba(255,255,255,0.94)", padding: "3px 8px", borderRadius: 20, maxWidth: grade ? "calc(100% - 60px)" : "calc(100% - 20px)", overflow: "hidden" }}>
                {!uc && <span style={{ width: 6, height: 6, borderRadius: "50%", background: sc }} />}
                <span className="deal-tile-pill" style={{ fontFamily: "'Montserrat',sans-serif", fontSize: 10, letterSpacing: "0.06em", textTransform: "uppercase", color: uc ? "#232422" : "#383A37", fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{d.status || "—"}</span>
              </div>
              {grade && (
                <div title="AI deal grade" className="deal-tile-grade" style={{ position: "absolute", top: 9, right: 10, minWidth: 30, height: 30, padding: "0 6px", borderRadius: 8, background: "rgba(35,36,34,0.82)", border: "1.5px solid #5BBA47", color: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 13 }}>{grade}</div>
              )}
              <div style={{ position: "absolute", left: 13, right: 13, bottom: 11, color: "#fff" }}>
                <div style={{ fontFamily: "'Lora',Georgia,serif", fontSize: 18.5, fontWeight: 600, lineHeight: 1.2, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>{d.propertyName || d.fileName || "Untitled deal"}</div>
                {loc && <div style={{ fontSize: 12, opacity: 0.82, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{loc}</div>}
                {metrics && <div style={{ fontFamily: "'Roboto',sans-serif", fontVariantNumeric: "tabular-nums", fontSize: 12.5, color: "#fff", fontWeight: 500, marginTop: 8, paddingTop: 7, borderTop: "1px solid rgba(255,255,255,0.18)", lineHeight: 1.3, display: "flex", gap: 10, flexWrap: "wrap" }}>{metrics.split(" · ").map(m => <span key={m}><b style={{ color: "#a6e295", fontWeight: 600 }}>{m.split(" ")[0]}</b> {m.split(" ").slice(1).join(" ")}</span>)}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
