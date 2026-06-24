import { useState } from "react";
import type { Deal } from "../lib/idb";
import { parseDealIntel, buildIntelPatch, type IntelProposal } from "../lib/intelExtract";

interface Props {
  deal: Deal;
  onApply: (patch: Partial<Deal>) => void;
}

const chip = (bg: string, border: string, color: string): React.CSSProperties => ({
  fontSize: 9, fontWeight: 700, letterSpacing: "0.04em", textTransform: "uppercase",
  background: bg, border: `1px solid ${border}`, color, borderRadius: 5, padding: "1px 6px",
});

function fmtSales(annual: number | null, psf: number | null): string {
  if (annual != null) return annual >= 1_000_000 ? `$${(annual / 1_000_000).toFixed(1)}M` : `$${Math.round(annual).toLocaleString()}`;
  if (psf != null) return `$${Math.round(psf)}/SF`;
  return "—";
}

export default function AddIntelBox({ deal, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [proposal, setProposal] = useState<IntelProposal | null>(null);
  const [justApplied, setJustApplied] = useState<string | null>(null);

  const reset = () => { setText(""); setProposal(null); setError(null); };

  const review = async () => {
    if (!text.trim()) return;
    setBusy(true); setError(null);
    try { setProposal(await parseDealIntel(deal, text)); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't read that — try again."); }
    finally { setBusy(false); }
  };

  const setInc = (kind: "sales" | "leases" | "notes", id: string, v: boolean) => {
    setProposal(p => {
      if (!p) return p;
      if (kind === "sales") return { ...p, sales: p.sales.map(x => x.id === id ? { ...x, include: v } : x) };
      if (kind === "leases") return { ...p, leases: p.leases.map(x => x.id === id ? { ...x, include: v } : x) };
      return { ...p, notes: p.notes.map(x => x.id === id ? { ...x, include: v } : x) };
    });
  };
  const setAnecdotal = (id: string, v: boolean) => {
    setProposal(p => p ? { ...p, sales: p.sales.map(s => s.id === id ? { ...s, anecdotal: v } : s) } : p);
  };

  const apply = () => {
    if (!proposal) return;
    const patch = buildIntelPatch(deal, proposal);
    const n = (proposal.sales.filter(s => s.include).length) + (proposal.leases.filter(l => l.include).length);
    onApply(patch);
    setJustApplied(`Added ${n} change${n === 1 ? "" : "s"} to the deal.`);
    reset(); setOpen(false);
    setTimeout(() => setJustApplied(null), 6000);
  };

  const hasAnything = !!proposal && (proposal.sales.length + proposal.leases.length + proposal.notes.length) > 0;

  if (!open) {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <button onClick={() => setOpen(true)}
          style={{ background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
          ✎ Add intel
        </button>
        {justApplied && <span style={{ fontSize: 12, color: "#3f7a1f", fontWeight: 600 }}>{justApplied}</span>}
      </div>
    );
  }

  return (
    <div style={{ background: "#fbfaf6", border: "1px solid #e6dfd0", borderRadius: 12, padding: "16px 18px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
        <div style={{ fontSize: 13, fontWeight: 700, color: "#383a37" }}>Add intel</div>
        <button onClick={() => { reset(); setOpen(false); }} style={{ border: "none", background: "transparent", color: "#a89f8f", cursor: "pointer", fontSize: 18, lineHeight: 1 }}>×</button>
      </div>
      <div style={{ fontSize: 11.5, color: "#8b8578", marginBottom: 10, lineHeight: 1.5 }}>
        Type anything you know — sales figures, lease extensions, market color. I&rsquo;ll show you exactly what I&rsquo;ll add before saving. e.g. <i>&ldquo;Whole Foods is doing $40M here; Best Buy is extending early for 5 years; tenant says the nail salon is roughly $600k.&rdquo;</i>
      </div>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="What did you learn about this deal?"
        rows={3}
        style={{ width: "100%", boxSizing: "border-box", fontSize: 13, padding: "9px 11px", border: "1px solid #e3dccd", borderRadius: 8, color: "#2a2c28", background: "#fff", fontFamily: "'Inter',sans-serif", resize: "vertical" }}
      />
      <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
        <button onClick={review} disabled={busy || !text.trim()}
          style={{ background: busy || !text.trim() ? "#cdd6c2" : "#3f7a1f", color: "#fff", border: "none", borderRadius: 8, padding: "7px 14px", fontSize: 12.5, fontWeight: 600, cursor: busy || !text.trim() ? "default" : "pointer", fontFamily: "'Inter',sans-serif" }}>
          {busy ? "Reading…" : proposal ? "Re-read" : "Review changes"}
        </button>
        {error && <span style={{ fontSize: 12, color: "#c0392b" }}>{error}</span>}
      </div>

      {proposal && (
        <div style={{ marginTop: 14 }}>
          <div style={{ fontSize: 11.5, color: "#6b6157", marginBottom: 10, fontStyle: "italic" }}>{proposal.summary}</div>
          {!hasAnything && <div style={{ fontSize: 12.5, color: "#8b8578" }}>I couldn&rsquo;t find a concrete change to apply — it&rsquo;ll still be saved as a note.</div>}

          {proposal.sales.length > 0 && (
            <Section title="Sales → tenant sales chart">
              {proposal.sales.map(s => (
                <Row key={s.id} include={s.include} onInc={v => setInc("sales", s.id, v)}>
                  <span style={{ fontWeight: 600, color: "#26281f" }}>{s.rosterMatch || s.tenantName}</span>
                  {!s.rosterMatch && <span style={{ ...chip("#fff3df", "#f0d9a8", "#9a6a12"), marginLeft: 6 }} title="Not matched to a roster tenant — its sales won't attach until the name matches the roster">unmatched</span>}
                  <span style={{ color: "#5c5850", marginLeft: 8 }}>{s.year} · {fmtSales(s.annualSales, s.salesPSF)}</span>
                  <label style={{ marginLeft: 10, fontSize: 11, color: "#8b8578", display: "inline-flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                    <input type="checkbox" checked={s.anecdotal} onChange={e => setAnecdotal(s.id, e.target.checked)} style={{ accentColor: "#9a6a12" }} />
                    anecdotal
                  </label>
                </Row>
              ))}
            </Section>
          )}

          {proposal.leases.length > 0 && (
            <Section title="Lease changes → roster + analysis">
              {proposal.leases.map(l => (
                <Row key={l.id} include={l.include} onInc={v => setInc("leases", l.id, v)} disabled={!l.rosterMatch}>
                  <span style={{ fontWeight: 600, color: "#26281f" }}>{l.rosterMatch || l.tenantName}</span>
                  {!l.rosterMatch && <span style={{ ...chip("#fbeaea", "#e6bcbc", "#b03a2e"), marginLeft: 6 }} title="No roster match — can't apply this lease change">no match</span>}
                  <span style={{ color: "#5c5850", marginLeft: 8 }}>{l.change}</span>
                  {l.reported && <span style={{ ...chip("#eef1f7", "#cdd6e6", "#5a6b8c"), marginLeft: 6 }} title="Treated as expected but not yet executed">reported</span>}
                </Row>
              ))}
            </Section>
          )}

          {proposal.notes.length > 0 && (
            <Section title="Saved as deal intel (feeds the AI analysis)">
              {proposal.notes.map(n => (
                <Row key={n.id} include={n.include} onInc={v => setInc("notes", n.id, v)}>
                  <span style={{ color: "#5c5850" }}>{n.text}</span>
                  <span style={{ ...chip("#f1eadc", "#ddd5c8", "#8b8578"), marginLeft: 6 }}>{n.category}</span>
                </Row>
              ))}
            </Section>
          )}

          <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
            <button onClick={apply}
              style={{ background: "#3f7a1f", color: "#fff", border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
              Apply to deal
            </button>
            <button onClick={() => setProposal(null)}
              style={{ background: "transparent", color: "#8b8578", border: "1px solid #d8cfbd", borderRadius: 8, padding: "8px 14px", fontSize: 13, cursor: "pointer", fontFamily: "'Inter',sans-serif" }}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ fontSize: 10, letterSpacing: "0.08em", textTransform: "uppercase", color: "#a89f8f", fontWeight: 700, marginBottom: 6 }}>{title}</div>
      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>{children}</div>
    </div>
  );
}

function Row({ include, onInc, disabled, children }: { include: boolean; onInc: (v: boolean) => void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12.5, padding: "5px 8px", background: include && !disabled ? "#fff" : "transparent", border: "1px solid #f0eadd", borderRadius: 7, cursor: disabled ? "default" : "pointer", opacity: disabled ? 0.55 : 1, flexWrap: "wrap" }}>
      <input type="checkbox" checked={include && !disabled} disabled={disabled} onChange={e => onInc(e.target.checked)} style={{ accentColor: "#3f7a1f", flexShrink: 0 }} />
      <span style={{ minWidth: 0 }}>{children}</span>
    </label>
  );
}
