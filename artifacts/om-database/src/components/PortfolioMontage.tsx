import type { Deal } from "../lib/idb";

interface Props { deals: Deal[]; onOpen: (id: string) => void; }

export default function PortfolioMontage({ deals, onOpen }: Props) {
  const withCover = deals.filter(d => d.imageMeta?.cover).slice(0, 8);
  // Small cacheable thumbnails as lazy <img>s — not each deal's full image bundle.
  const covers = withCover.map(d => ({
    id: d.id, name: d.propertyName || d.fileName || "", market: d.market || undefined,
    src: `/api/deals/${d.id}/cover-thumb?v=${encodeURIComponent(d.updatedAt || d.uploadedAt || "")}`,
  }));

  if (covers.length < 2) return null;
  return (
    <div style={{ marginTop: 36 }}>
      <div style={{ fontSize: 10.5, letterSpacing: "0.16em", textTransform: "uppercase", color: "#9b9992", fontWeight: 700, marginBottom: 13 }}>From your portfolio</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(148px, 1fr))", gap: 12 }}>
        {covers.map(c => (
          <div key={c.id} onClick={() => onOpen(c.id)}
            style={{ position: "relative", height: 112, borderRadius: 12, overflow: "hidden", cursor: "pointer", border: "1px solid #ebeae5", boxShadow: "0 10px 24px -20px rgba(56,58,55,0.6)", transition: "transform .25s ease, box-shadow .25s ease" }}
            onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-3px)"; e.currentTarget.style.boxShadow = "0 18px 34px -20px rgba(56,58,55,0.65)"; const img = e.currentTarget.querySelector("img"); if (img) (img as HTMLImageElement).style.transform = "scale(1.06)"; }}
            onMouseLeave={e => { e.currentTarget.style.transform = "none"; e.currentTarget.style.boxShadow = "0 10px 24px -20px rgba(56,58,55,0.6)"; const img = e.currentTarget.querySelector("img"); if (img) (img as HTMLImageElement).style.transform = "none"; }}>
            <img src={c.src} alt={c.name} loading="lazy" decoding="async" style={{ width: "100%", height: "100%", objectFit: "cover", display: "block", transition: "transform .45s ease" }} />
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
