import { useState, useEffect } from "react";
import type { Deal } from "../lib/idb";
import { idbLoadImages } from "../lib/idb";
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
  const [covers, setCovers] = useState<Record<string, string>>({});
  const key = tiles.map(d => d.id).join(",");

  useEffect(() => {
    let alive = true;
    Promise.all(tiles.map(d =>
      idbLoadImages(d.id).then(r => ({ id: d.id, src: r && (r.cover || r.coverThumb) })).catch(() => ({ id: d.id, src: null }))
    )).then(list => {
      if (alive) {
        const m: Record<string, string> = {};
        list.forEach(x => { if (x.src) m[x.id] = x.src; });
        setCovers(m);
      }
    });
    return () => { alive = false; };
  }, [key]);

  if (!tiles.length) return null;

  return (
    <div style={{ marginBottom: 26 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: 13 }}>
        {tiles.map(d => {
          const sc = STATUS_COLORS[d.status || ""] || "#7d766a";
          const loc = cityState(d);
          const src = covers[d.id];
          const noi = d.noi != null ? `$${(Number(d.noi) / 1e6).toFixed(1)}M NOI` : null;
          return (
            <button key={d.id} onClick={() => onOpen(d.id)}
              style={{ position: "relative", height: 150, borderRadius: 14, overflow: "hidden", cursor: "pointer", border: "1px solid #ece5d7", textAlign: "left", padding: 0, boxShadow: "0 1px 2px rgba(56,58,55,0.05), 0 14px 30px -24px rgba(56,58,55,0.6)", background: src ? "#26281f" : "linear-gradient(135deg,#43463b,#26281f)", transition: "transform .2s ease" }}
              onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; const img = e.currentTarget.querySelector("img"); if (img) (img as HTMLImageElement).style.transform = "scale(1.06)"; }}
              onMouseLeave={e => { e.currentTarget.style.transform = "none"; const img = e.currentTarget.querySelector("img"); if (img) (img as HTMLImageElement).style.transform = "none"; }}>
              {src && <img src={src} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", transition: "transform .45s ease" }} />}
              <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(38,40,31,0.1) 0%, rgba(38,40,31,0.32) 42%, rgba(38,40,31,0.84) 100%)" }} />
              <div style={{ position: "absolute", top: 11, left: 12, display: "flex", alignItems: "center", gap: 5, background: "rgba(255,255,255,0.93)", padding: "3px 9px", borderRadius: 20 }}>
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: sc }} />
                <span style={{ fontSize: 9, letterSpacing: "0.05em", textTransform: "uppercase", color: sc, fontWeight: 700 }}>{d.status || "—"}</span>
                {d.autoPassed && <span style={{ fontSize: 8, color: "#9a7b5a", fontWeight: 700 }}>AUTO</span>}
              </div>
              <div style={{ position: "absolute", left: 13, right: 13, bottom: 11, color: "#fff" }}>
                <div style={{ fontFamily: "'Fraunces',serif", fontSize: 16.5, fontWeight: 600, lineHeight: 1.18, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" as const }}>{d.propertyName || d.fileName || "Untitled deal"}</div>
                {loc && <div style={{ fontSize: 11, opacity: 0.86, marginTop: 2, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{loc}</div>}
                {noi && <div style={{ fontSize: 11, color: "#9fe08a", fontWeight: 600, marginTop: 3 }}>{noi}</div>}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
