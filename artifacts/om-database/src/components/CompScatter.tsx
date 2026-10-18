import { useEffect, useMemo, useRef, useState } from "react";

// Cap rate vs sale date, colored by center type (Eric, 10/16/26: "quicker to read than
// the 329-row table when pricing a deal"). The deal being priced is drawn as a dashed
// line at its cap rate. Pure SVG, scales to its container on phones.

export interface ScatterComp {
  id?: number | string;
  name?: string | null;
  saleDate?: string | null;
  capRate?: number | null;
  propertyType?: string | null;
  market?: string | null;
  state?: string | null;
}

const GROUPS: Array<{ key: string; label: string; color: string; re: RegExp }> = [
  { key: "grocery", label: "Grocery-anchored", color: "#3e8a2f", re: /grocer|supermarket|food/i },
  { key: "power", label: "Power", color: "#2563eb", re: /power|big[- ]box|regional/i },
  { key: "lifestyle", label: "Lifestyle / mixed-use", color: "#9333ea", re: /lifestyle|mixed|town center/i },
  { key: "community", label: "Neighborhood / community", color: "#c2410c", re: /neighbo|community/i },
  { key: "strip", label: "Strip / unanchored / NNN", color: "#a16207", re: /strip|unanchored|nnn|single|net lease/i },
];
const OTHER = { key: "other", label: "Other / not stated", color: "#9ca3af" };
const groupOf = (t?: string | null) => GROUPS.find(g => g.re.test(t || "")) ?? OTHER;

export default function CompScatter({ comps, subject, height = 220 }: { comps: ScatterComp[]; subject?: { label: string; capRate: number } | null; height?: number }) {
  const [hover, setHover] = useState<ScatterComp | null>(null);
  // Draw at the container's real width so text stays readable on a phone and the chart
  // fills a wide screen (a fixed viewBox scaled it into a tiny or squeezed picture).
  const boxRef = useRef<HTMLDivElement>(null);
  const [W, setW] = useState(640);
  useEffect(() => {
    const el = boxRef.current; if (!el) return;
    const ro = new ResizeObserver(() => setW(Math.max(260, Math.round(el.clientWidth))));
    ro.observe(el); setW(Math.max(260, Math.round(el.clientWidth)));
    return () => ro.disconnect();
  }, []);
  const pts = useMemo(() => comps
    .map(c => ({ c, t: Date.parse(String(c.saleDate || "")), cap: Number(c.capRate) }))
    .filter(p => Number.isFinite(p.t) && Number.isFinite(p.cap) && p.cap >= 3 && p.cap <= 12), [comps]);
  if (pts.length < 3) return <div ref={boxRef} />;

  const H = height, L = 38, R = 10, T = 10, B = 26;
  const tMin = Math.min(...pts.map(p => p.t)), tMax = Math.max(...pts.map(p => p.t));
  const caps = pts.map(p => p.cap).concat(subject ? [subject.capRate] : []);
  const cLo = Math.floor(Math.min(...caps) * 2) / 2, cHi = Math.ceil(Math.max(...caps) * 2) / 2;
  const x = (t: number) => L + (tMax === tMin ? 0.5 : (t - tMin) / (tMax - tMin)) * (W - L - R);
  const y = (c: number) => T + (1 - (c - cLo) / (cHi - cLo || 1)) * (H - T - B);
  const years: number[] = [];
  for (let yr = new Date(tMin).getUTCFullYear(); yr <= new Date(tMax).getUTCFullYear(); yr++) years.push(yr);
  const yTicks: number[] = [];
  for (let c = cLo; c <= cHi + 1e-9; c += (cHi - cLo) > 4 ? 1 : 0.5) yTicks.push(Math.round(c * 10) / 10);
  const present = [...new Map(pts.map(p => { const g = groupOf(p.c.propertyType); return [g.key, g]; })).values()];

  return (
    <div ref={boxRef} style={{ position: "relative" }}>
      <svg width={W} height={H} role="img" aria-label="Sale comps: cap rate by sale date" style={{ display: "block" }}>
        {yTicks.map(c => (
          <g key={c}>
            <line x1={L} x2={W - R} y1={y(c)} y2={y(c)} stroke="#efeee9" />
            <text x={L - 6} y={y(c) + 3.5} fontSize="10" textAnchor="end" fill="#9b9992">{c.toFixed(1)}%</text>
          </g>
        ))}
        {years.map(yr => {
          const t = Date.UTC(yr, 0, 1);
          if (t < tMin || t > tMax) return null;
          return <text key={yr} x={x(t)} y={H - 8} fontSize="10" textAnchor="middle" fill="#9b9992">{yr}</text>;
        })}
        {subject && (
          <g>
            <line x1={L} x2={W - R} y1={y(subject.capRate)} y2={y(subject.capRate)} stroke="#232422" strokeDasharray="5 4" strokeWidth="1.5" />
            <text x={W - R} y={y(subject.capRate) - 4} fontSize="10.5" textAnchor="end" fill="#232422" fontWeight="700">{subject.label} · {subject.capRate.toFixed(2)}%</text>
          </g>
        )}
        {pts.map((p, i) => (
          <circle key={p.c.id ?? i} cx={x(p.t)} cy={y(p.cap)} r={hover === p.c ? 5.5 : 4} fill={groupOf(p.c.propertyType).color} fillOpacity={0.75} stroke="#fff" strokeWidth="1"
            onMouseEnter={() => setHover(p.c)} onMouseLeave={() => setHover(null)} onClick={() => setHover(p.c)} style={{ cursor: "pointer" }} />
        ))}
      </svg>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "4px 12px", marginTop: 4 }}>
        {present.map(g => (
          <span key={g.key} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 10.5, color: "#6b6a65" }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: g.color }} />{g.label}
          </span>
        ))}
        <span style={{ fontSize: 10.5, color: "#9b9992", marginLeft: "auto" }}>n = {pts.length}</span>
      </div>
      {hover && (
        <div style={{ position: "absolute", top: 6, left: 44, background: "#fff", border: "1px solid #dfddd6", borderRadius: 8, padding: "6px 9px", fontSize: 11.5, color: "#383a37", boxShadow: "0 4px 14px rgba(56,58,55,0.14)", pointerEvents: "none", maxWidth: 260 }}>
          <b>{hover.name || "Comp"}</b>{hover.market || hover.state ? <span style={{ color: "#6b6a65" }}> · {[hover.market, hover.state].filter(Boolean).join(", ")}</span> : null}
          <div style={{ color: "#6b6a65" }}>{String(hover.saleDate).slice(0, 7)} · {Number(hover.capRate).toFixed(2)}% cap{hover.propertyType ? ` · ${hover.propertyType}` : ""}</div>
        </div>
      )}
    </div>
  );
}
