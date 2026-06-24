import { useEffect, useMemo, useRef, useState } from "react";
import type { Deal } from "../lib/idb";
import { isVacant, isNAPTenant } from "../lib/utils";

interface Props {
  open: boolean;
  deals: Deal[];
  onClose: () => void;
  onOpenDeal: (dealId: string) => void;
}

interface DealHit { kind: "deal"; dealId: string; title: string; sub: string; where: string }
interface TenantHit { kind: "tenant"; dealId: string; title: string; sub: string; where: string }
type Hit = DealHit | TenantHit;

function s(v: unknown): string { return typeof v === "string" ? v : v == null ? "" : String(v); }

export default function GlobalSearch({ open, deals, onClose, onOpenDeal }: Props) {
  const [q, setQ] = useState("");
  // Keyboard-highlighted row, navigable with ↑/↓ before pressing Enter.
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const selRef = useRef<HTMLButtonElement>(null);

  useEffect(() => { if (open) { setQ(""); setSel(0); setTimeout(() => inputRef.current?.focus(), 30); } }, [open]);

  const active = useMemo(() => deals.filter(d => !d.trashedAt), [deals]);

  const hits = useMemo<Hit[]>(() => {
    const needle = q.trim().toLowerCase();
    if (needle.length < 2) return [];
    const dealHits: DealHit[] = [];
    const tenantHits: TenantHit[] = [];
    for (const d of active) {
      const name = s(d.propertyName) || s(d.address) || "Untitled deal";
      const loc = [s(d.city), s(d.state)].filter(Boolean).join(", ");
      // Deal-level match across the fields an analyst would search by.
      const dealHay = [d.propertyName, d.address, d.city, d.state, d.market, d.notes, d.dealThesis, d.dealReview, d.assetType, d.centerType]
        .map(s).join(" ").toLowerCase();
      if (dealHay.includes(needle)) {
        dealHits.push({ kind: "deal", dealId: d.id, title: name, sub: [loc, d.status].filter(Boolean).join(" · "), where: "Deal" });
      }
      // Tenant matches — one row per matching tenant, pointing at its center.
      const seen = new Set<string>();
      for (const t of d.tenants || []) {
        if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
        const tn = s(t.canonicalName || t.name);
        if (!tn) continue;
        const k = tn.toLowerCase();
        if (seen.has(k) || !k.includes(needle)) continue;
        seen.add(k);
        tenantHits.push({ kind: "tenant", dealId: d.id, title: tn, sub: `in ${name}`, where: "Tenant" });
      }
    }
    return [...dealHits.slice(0, 30), ...tenantHits.slice(0, 40)];
  }, [q, active]);

  // Reset the highlight to the top whenever the result set changes, and keep it in
  // range if the list shrinks. Keep the selected row scrolled into view.
  useEffect(() => { setSel(0); }, [q]);
  useEffect(() => { if (sel > hits.length - 1) setSel(Math.max(0, hits.length - 1)); }, [hits.length, sel]);
  useEffect(() => { selRef.current?.scrollIntoView({ block: "nearest" }); }, [sel]);

  if (!open) return null;

  const go = (dealId: string) => { onOpenDeal(dealId); onClose(); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") { onClose(); return; }
    if (e.key === "ArrowDown") { e.preventDefault(); if (hits.length) setSel(s => Math.min(s + 1, hits.length - 1)); return; }
    if (e.key === "ArrowUp") { e.preventDefault(); if (hits.length) setSel(s => Math.max(s - 1, 0)); return; }
    if (e.key === "Enter") { const h = hits[sel] ?? hits[0]; if (h) go(h.dealId); return; }
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 5000, background: "rgba(38,40,31,0.34)", display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "10vh 14px 14px" }}>
      <div onClick={e => e.stopPropagation()} style={{ width: "min(640px, 100%)", maxHeight: "78vh", background: "#fff", border: "1px solid #e6dfd0", borderRadius: 14, boxShadow: "0 18px 50px rgba(38,40,31,0.3)", display: "flex", flexDirection: "column", overflow: "hidden", fontFamily: "'Inter',sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "12px 16px", borderBottom: "1px solid #f1eadc" }}>
          <span style={{ fontSize: 16, color: "#a89f8f" }}>⌕</span>
          <input
            ref={inputRef}
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search deals, tenants, markets, notes…"
            style={{ flex: 1, border: "none", outline: "none", fontSize: 15, color: "#2a2c28", background: "transparent" }}
          />
          <button onClick={onClose} style={{ border: "none", background: "transparent", color: "#a89f8f", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
        </div>

        <div style={{ overflowY: "auto" }}>
          {q.trim().length < 2 ? (
            <div style={{ padding: "22px 16px", fontSize: 12.5, color: "#a89f8f" }}>Type at least two letters. Searches property names, addresses, markets, tenants, and your notes.</div>
          ) : hits.length === 0 ? (
            <div style={{ padding: "22px 16px", fontSize: 13, color: "#a89f8f" }}>No matches for “{q.trim()}”.</div>
          ) : (
            hits.map((h, i) => (
              <button key={`${h.kind}-${h.dealId}-${i}`} onClick={() => go(h.dealId)}
                ref={i === sel ? selRef : undefined}
                onMouseEnter={() => setSel(i)}
                style={{ display: "flex", alignItems: "center", gap: 12, width: "100%", textAlign: "left", background: i === sel ? "#f4f0e8" : "transparent", border: "none", borderBottom: "1px solid #f6f1e7", borderLeft: `3px solid ${i === sel ? "#3f7a1f" : "transparent"}`, padding: "11px 16px 11px 13px", cursor: "pointer" }}>
                <span style={{ flexShrink: 0, fontSize: 9, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: h.kind === "deal" ? "#3f7a1f" : "#9a6a12", background: h.kind === "deal" ? "#eef5e6" : "#fff3df", borderRadius: 5, padding: "3px 7px", minWidth: 52, textAlign: "center" }}>
                  {h.where}
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, color: "#26281f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.title}</span>
                  {h.sub && <span style={{ display: "block", fontSize: 11.5, color: "#8b8578", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{h.sub}</span>}
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
