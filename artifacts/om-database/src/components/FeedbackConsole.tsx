import { useEffect, useMemo, useState } from "react";
import { apiIssuesSummary, apiAddExtractionLesson, type IssueGroup } from "../lib/api";

// FEEDBACK CONSOLE — one centralized place to see every open data/extraction issue across
// the whole portfolio, GROUPED BY TYPE (so a recurring problem reads as a trend), and to
// answer in plain English. Each answer is saved as a high-priority extraction rule (a
// "guardrail") that guides every future OM read — the operator-taught learning loop, made
// portfolio-wide. Deterministic-check requests are captured the same way and flagged for
// a code-level guardrail. Token-free to load (the summary is computed deterministically).

const C = {
  ink: "#383a37", sub: "#6f6a5f", faint: "#a69e91", line: "#efe8da", panel: "#faf7f0", panelBd: "#e7e0d2",
  green: "#3f7a1f", greenBg: "#eef3e6", greenBd: "#b8d49a", gold: "#9a6a1e", goldBg: "#fbf7ee", goldBd: "#e7d9bd",
  amber: "#c97a18", amberBg: "#fbf1e4", amberBd: "#e0c9a8", red: "#b3261e", redBg: "#fdecec", redBd: "#f3c0c0",
};
const sevTone = (s: string) => s === "high" ? { fg: C.red, bg: C.redBg, bd: C.redBd } : s === "medium" ? { fg: C.amber, bg: C.amberBg, bd: C.amberBd } : { fg: C.sub, bg: "#fff", bd: C.line };
const kindLabel: Record<IssueGroup["kind"], string> = { audit: "Arithmetic / tie-out", ai: "AI capture", arithmetic: "Arithmetic", other: "Completeness" };

// A field/issue-aware draft guardrail, so teaching is one edit. Mirrors ImportReview's
// drafts but keyed off the group.
function draftGuardrail(g: IssueGroup): string {
  const k = g.key;
  if (k === "audit-occcost-fraction" || k === "audit-occ-stated-vs-computed") return "Occupancy cost is a PERCENT (e.g. 11.8 = 11.8%). Never store it as a 0.NN fraction, and compute the health ratio as (base + recoveries + % rent + other) ÷ gross sales.";
  if (k === "audit-sf-gla-short" || k === "audit-sf-gla-over") return "Building GLA must equal the sum of ALL suite SF (occupied + vacant) and tie to the rent-roll total — don't trust a cover-page GLA that conflicts with the roster.";
  if (k === "audit-noi-cap-price") return "NOI, cap rate and price must tie out (price = NOI ÷ cap). If the headline cap is on PRO-FORMA NOI, capture in-place NOI separately and never let the three contradict.";
  if (k === "audit-rent-impossible" || k === "audit-rent-tie") return "On a rent roll, each tenant's rent PSF × SF must reconcile to annual BASE rent; a normal-size space never pays $175+/SF base (that's a sales figure, a gross rate, or a decimal slip).";
  if (k === "audit-sales-below-rent") return "Sales PSF should comfortably exceed rent PSF (occupancy cost ~2–15%). Sales below rent means a units slip — e.g. sales captured in $000s or a monthly figure read as annual.";
  if (k.startsWith("ai:")) return `When reading an OM, double-check "${g.label.replace(/^AI capture — /, "")}" — this is a value the model is repeatedly unsure about. State how it should be read.`;
  return `Guardrail for "${g.label}": describe the rule the analyst should follow so this stops recurring.`;
}

export default function FeedbackConsole({ onOpenDeal }: { onOpenDeal: (id: string) => void }) {
  const [data, setData] = useState<{ groups: IssueGroup[]; totalOpen: number; dealsWithIssues: number; scanned: number } | null>(null);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [teachFor, setTeachFor] = useState<string | null>(null);
  const [teachText, setTeachText] = useState("");
  const [needsCheck, setNeedsCheck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [taught, setTaught] = useState<Record<string, string>>({});

  const load = () => { setLoading(true); apiIssuesSummary().then(d => { setData(d); setLoading(false); }).catch(() => setLoading(false)); };
  useEffect(load, []);

  const openTeach = (g: IssueGroup) => { setTeachFor(g.key); setTeachText(draftGuardrail(g)); setNeedsCheck(false); };
  const saveTeach = async (g: IssueGroup) => {
    const text = teachText.trim(); if (!text) return;
    setSaving(true);
    // The plain-English rule becomes a high-priority extraction guardrail immediately.
    // When the operator flags it as needing a hard CHECK, we tag it so it's easy to find
    // for a code-level guardrail (still saved as a lesson so the prompt improves now).
    const body = needsCheck ? `${text}\n\n[REQUESTED: a deterministic check/guardrail for "${g.label}" — flag both for review.]` : text;
    const r = await apiAddExtractionLesson("om", body).catch(() => ({ ok: false }));
    setSaving(false);
    if (r.ok) { setTaught(t => ({ ...t, [g.key]: needsCheck ? "rule + check requested" : "rule saved" })); setTeachFor(null); setTeachText(""); }
  };

  const counts = useMemo(() => {
    const g = data?.groups || [];
    return { high: g.filter(x => x.severity === "high").reduce((s, x) => s + x.count, 0), groups: g.length };
  }, [data]);

  return (
    <div style={{ maxWidth: 920, margin: "0 auto", padding: "4px 2px 40px", fontFamily: "'Inter',sans-serif", color: C.ink }}>
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, flexWrap: "wrap", marginBottom: 6 }}>
        <div>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 21, fontWeight: 600, color: "#26281f" }}>Feedback &amp; Trends</div>
          <div style={{ fontSize: 12.5, color: C.sub, marginTop: 3, lineHeight: 1.5, maxWidth: 640 }}>
            Every open data issue across the portfolio, grouped by type so recurring problems show up as trends. Answer one in plain English and it becomes a guardrail that guides every future OM read.
          </div>
        </div>
        <button onClick={load} disabled={loading} style={{ background: "#fff", border: `1px solid ${C.panelBd}`, color: C.sub, padding: "6px 12px", borderRadius: 7, cursor: loading ? "default" : "pointer", fontSize: 11.5, fontWeight: 600 }}>{loading ? "Loading…" : "↻ Refresh"}</button>
      </div>

      {/* Stat strip */}
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", margin: "12px 0 16px" }}>
        {[{ n: data?.totalOpen ?? 0, l: "open issues", t: "amber" as const },
          { n: counts.high, l: "high-severity", t: "red" as const },
          { n: counts.groups, l: "distinct issue types", t: "green" as const },
          { n: data?.dealsWithIssues ?? 0, l: "deals affected", t: "amber" as const }].map((s, i) => {
          const c = s.t === "red" ? { fg: C.red, bg: C.redBg, bd: C.redBd } : s.t === "amber" ? { fg: C.amber, bg: C.amberBg, bd: C.amberBd } : { fg: C.green, bg: C.greenBg, bd: C.greenBd };
          return (
            <div key={i} style={{ flex: "1 1 150px", background: c.bg, border: `1px solid ${c.bd}`, borderRadius: 10, padding: "12px 14px", minWidth: 0 }}>
              <div style={{ fontSize: 26, fontWeight: 800, color: c.fg, lineHeight: 1 }}>{s.n}</div>
              <div style={{ fontSize: 11, color: C.sub, marginTop: 4 }}>{s.l}</div>
            </div>
          );
        })}
      </div>

      {loading && !data ? <div style={{ color: C.faint, fontSize: 13, padding: "20px 0" }}>Scanning the portfolio…</div> : null}
      {data && data.groups.length === 0 ? (
        <div style={{ background: C.greenBg, border: `1px solid ${C.greenBd}`, borderRadius: 10, padding: "18px 16px", color: C.green, fontSize: 13, fontWeight: 600 }}>✓ No open issues across the portfolio. The machine is clean.</div>
      ) : null}

      {/* Issue groups (trends) */}
      {(data?.groups || []).map(g => {
        const tone = sevTone(g.severity);
        const isOpen = expanded === g.key;
        return (
          <div key={g.key} style={{ border: `1px solid ${tone.bd}`, background: tone.bg, borderRadius: 11, padding: "12px 14px", marginBottom: 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <span style={{ fontSize: 8.5, fontWeight: 800, letterSpacing: "0.07em", textTransform: "uppercase", color: tone.fg, background: "#fff", border: `1px solid ${tone.bd}`, borderRadius: 4, padding: "1px 6px" }}>{g.severity}</span>
              <span style={{ fontWeight: 700, fontSize: 14, color: C.ink }}>{g.label}</span>
              <span style={{ fontSize: 10.5, color: C.faint }}>{kindLabel[g.kind]}</span>
              <span style={{ marginLeft: "auto", fontSize: 12.5, fontWeight: 700, color: tone.fg }}>{g.count}× · {g.dealCount} deal{g.dealCount === 1 ? "" : "s"}</span>
            </div>
            {g.sample ? <div style={{ fontSize: 12, color: C.sub, marginTop: 5, lineHeight: 1.45 }}>{g.sample}</div> : null}

            <div style={{ display: "flex", gap: 12, marginTop: 9, alignItems: "center", flexWrap: "wrap" }}>
              <button onClick={() => setExpanded(isOpen ? null : g.key)} style={{ background: "none", border: "none", color: C.sub, cursor: "pointer", fontSize: 11.5, fontWeight: 600, padding: 0 }}>
                {isOpen ? "▾ hide deals" : `▸ show ${g.dealCount} affected deal${g.dealCount === 1 ? "" : "s"}`}
              </button>
              {taught[g.key]
                ? <span style={{ fontSize: 11.5, color: C.green, fontWeight: 700 }}>📚 ✓ {taught[g.key]}</span>
                : <button onClick={() => (teachFor === g.key ? setTeachFor(null) : openTeach(g))} style={{ background: "none", border: "none", color: C.gold, cursor: "pointer", fontSize: 11.5, fontWeight: 700, padding: 0 }}>📚 {teachFor === g.key ? "Cancel" : "Answer / create guardrail"}</button>}
            </div>

            {isOpen ? (
              <div style={{ marginTop: 8, display: "flex", flexWrap: "wrap", gap: 6 }}>
                {g.deals.map(d => (
                  <button key={d.id} onClick={() => onOpenDeal(d.id)} title="Open this deal" style={{ fontSize: 11, color: C.ink, background: "#fff", border: `1px solid ${C.panelBd}`, borderRadius: 14, padding: "3px 10px", cursor: "pointer" }}>{d.name} ›</button>
                ))}
              </div>
            ) : null}

            {teachFor === g.key && !taught[g.key] ? (
              <div style={{ marginTop: 9, background: C.goldBg, border: `1px solid ${C.goldBd}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 10.5, color: C.gold, fontWeight: 700, marginBottom: 5 }}>📚 Answer in plain English — this becomes a guardrail for EVERY future OM read</div>
                <textarea value={teachText} onChange={e => setTeachText(e.target.value)} rows={3}
                  style={{ width: "100%", boxSizing: "border-box", border: `1px solid ${C.goldBd}`, borderRadius: 6, padding: "7px 9px", fontSize: 12, fontFamily: "'Inter',sans-serif", color: C.ink, resize: "vertical", background: "#fff", lineHeight: 1.4 }} />
                <label style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 7, fontSize: 11.5, color: C.sub, cursor: "pointer" }}>
                  <input type="checkbox" checked={needsCheck} onChange={e => setNeedsCheck(e.target.checked)} />
                  Also flag this for a hard automated check (a code-level guardrail)
                </label>
                <div style={{ display: "flex", gap: 8, marginTop: 8, alignItems: "center", flexWrap: "wrap" }}>
                  <button onClick={() => saveTeach(g)} disabled={saving || !teachText.trim()} style={{ background: C.green, border: "none", color: "#fff", padding: "6px 14px", borderRadius: 6, cursor: (saving || !teachText.trim()) ? "default" : "pointer", fontSize: 11.5, fontWeight: 600, opacity: (saving || !teachText.trim()) ? 0.6 : 1 }}>{saving ? "Saving…" : "Save guardrail"}</button>
                  <button onClick={() => setTeachFor(null)} style={{ background: "none", border: "none", color: C.faint, cursor: "pointer", fontSize: 11.5 }}>Cancel</button>
                  <span style={{ fontSize: 10, color: C.faint }}>Applied at top priority to all future extractions.</span>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
