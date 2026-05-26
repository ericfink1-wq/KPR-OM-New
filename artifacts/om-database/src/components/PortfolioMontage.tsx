import { useState, useEffect } from "react";
import type { Deal } from "../lib/idb";
import { apiLoadImages } from "../lib/api";

interface Props { deals: Deal[]; onOpen: (id: string) => void; }

export default function PortfolioMontage({ deals, onOpen }: Props) {
  const withCover = deals.filter(d => d.imageMeta?.cover).slice(0, 8);
  const [covers, setCovers] = useState<{ id: string; name: string; market?: string; src: string }[]>([]);
  const key = withCover.map(d => d.id).join(",");

  useEffect(() => {
    let alive = true;
    Promise.all(withCover.map(d =>
      apiLoadImages(d.id).then(r => (r && r.cover) ? { id: d.id, name: d.propertyName || d.fileName || "", market: d.market || undefined, src: r.cover! } : null).catch(() => null)
    )).then(list => { if (alive) setCovers(list.filter(Boolean) as typeof covers); });
    return () => { alive = false; };
  }, [key]);

  if (covers.length < 2) return null;
  return (
    <div style={{ marginTop: 36 }}>
      <div style={{ fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 13 }}>From your portfolio</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: 12 }}>
        {covers.map(c => (
          <div key={c.id} onClick={() => onOpen(c.id)}
            style={{ position: "relative", height: 112, borderRadius: 12, overflow: "hidden", cursor: "pointer", border: "1px solid #ece5d7", boxShadow: "0 10px 24px -20px rgba(56,58,55,0.6)", transition: "transform .25s ease, box-shadow .25s ease" }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 18px 34px -20px rgba(56,58,55,0.65)"; const img = e.currentTarget.querySelector("img"); if (img) (img as HTMLImageElement).style.transform = "scale(1.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 10px 24px -20px rgba(56,58,55,0.6)"; const img = e.currentTarget.querySelector("img"); if (img) (img as HTMLImageElement).style.transform = "none"; }}>
            <img src={c.src} alt={c.name} style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform .45s ease" }} />
            <div style={{ position: "absolute", inset: 0, background: "linear-gradient(180deg, rgba(38,40,31,0) 38%, rgba(38,40,31,0.66) 100%)" }} />
            <div style={{ position: "absolute", left: 11, right: 11, bottom: 9, color: "#fff" }}>
              <div style={{ fontSize: 11.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.name}</div>
              {c.market && <div style={{ fontSize: 9, opacity: 0.82, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{c.market}</div>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
