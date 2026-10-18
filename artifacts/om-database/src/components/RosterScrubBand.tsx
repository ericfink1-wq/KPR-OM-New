import { useState } from "react";
import type { Deal } from "../lib/idb";
import type { ScrubRow, ScrubSummary } from "../lib/rosterScrub";
import PdfDownloadButton, { safeFileName } from "./PdfDownloadButton";

// ROSTER SCRUB band — the top of every deal's Tenants tab (Eric, 10/18/26). The same KPIs,
// in the same order, for every OM; and the two standard exports built from the same scrub.
const K = { ink: "#232422", char: "#383A37", gray: "#676767", green: "#5BBA47", greenDk: "#3e8a2f", red: "#b3403f", amber: "#a8640f", line: "#ecebe6" };
const $m = (v: number | null | undefined) => v == null ? "—" : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3).toLocaleString()}K` : `$${Math.round(v)}`;
const pct = (v: number | null | undefined, d = 1) => v == null ? "—" : `${v.toFixed(d)}%`;

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" }) {
  const c = tone === "good" ? K.greenDk : tone === "bad" ? K.red : tone === "warn" ? K.amber : K.ink;
  return (
    <div style={{ padding: "10px 12px", borderRight: `1px solid ${K.line}`, borderBottom: `1px solid ${K.line}`, minWidth: 0 }}>
      <div style={{ fontFamily: "'Roboto',sans-serif", fontVariantNumeric: "tabular-nums", fontSize: 17, fontWeight: 500, color: c, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{value}</div>
      <div style={{ fontFamily: "'Montserrat',sans-serif", fontSize: 9.5, fontWeight: 700, letterSpacing: ".07em", textTransform: "uppercase", color: K.char, marginTop: 3 }}>{label}</div>
      {sub && <div style={{ fontSize: 11, color: K.gray, marginTop: 1, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }} title={sub}>{sub}</div>}
    </div>
  );
}

export default function RosterScrubBand({ deal, scrub, includeProposed, onToggleProposed }: { deal: Deal; scrub: { rows: ScrubRow[]; summary: ScrubSummary }; includeProposed: boolean; onToggleProposed: () => void }) {
  const S = scrub.summary;
  const [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  if (!scrub.rows.length) return null;
  const excel = async () => { setBusy(true); setErr(null); try { const m = await import("../lib/kprStandardExport"); await m.exportKprStandardRentRoll(deal, scrub); } catch { setErr("Couldn't build the Excel file — try again."); } finally { setBusy(false); } };
  const btn: React.CSSProperties = { background: "#fff", color: K.char, border: "1px solid #d9d8d2", borderRadius: 8, padding: "7px 12px", minHeight: 34, fontSize: 12, fontWeight: 700, cursor: "pointer", fontFamily: "'Montserrat',sans-serif", whiteSpace: "nowrap" };
  return (
    <section id="section-roster-scrub" style={{ background: "#fff", border: `1px solid ${K.line}`, borderRadius: 12, marginBottom: 14, boxShadow: "0 1px 2px rgba(35,36,34,.04)", overflow: "hidden" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap", padding: "12px 14px", borderBottom: `1px solid ${K.line}` }}>
        <div>
          <h2 style={{ margin: 0, fontFamily: "'Montserrat',sans-serif", fontSize: 12, fontWeight: 800, letterSpacing: ".12em", textTransform: "uppercase", color: K.char }}>Roster scrub</h2>
          <div style={{ fontSize: 11.5, color: K.gray, marginTop: 2 }}>Standardized for every OM · market rent = library median for the brand (else category / state + size band){S.proposed.n ? ` · ${includeProposed ? "including" : "excluding"} ${S.proposed.n} proposed / unsigned` : ""}</div>
        </div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {S.proposed.n > 0 && <button style={{ ...btn, borderStyle: "dashed", color: K.amber }} onClick={onToggleProposed} aria-pressed={includeProposed}>{includeProposed ? "Exclude" : "Include"} proposed</button>}
          <button style={btn} onClick={excel} disabled={busy}>{busy ? "Building…" : "⬇ KPR Standard Rent Roll"}</button>
          <PdfDownloadButton fileName={`KPR_OM_Summary_${safeFileName(deal.propertyName || "deal")}.pdf`} onError={setErr}
            makeDoc={async () => { const { default: OmSummaryPDF } = await import("./OmSummaryPDF"); return <OmSummaryPDF deal={deal} scrub={scrub} />; }}
            render={b => <button style={{ ...btn, background: K.char, color: "#fff", borderColor: K.char }}>{b ? "Building…" : "📄 KPR OM Summary"}</button>} />
        </div>
      </div>
      {err && <div style={{ color: K.red, fontSize: 12, padding: "6px 14px" }}>{err}</div>}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(150px, 1fr))", marginRight: -1, marginBottom: -1 }}>
        <Tile label="Leased" value={pct(S.leasedPct)} sub={`open ${pct(S.openPct)} · ${S.leasedSF.toLocaleString()} SF`} />
        <Tile label="In-place base rent" value={$m(S.inPlaceRent)} sub={`${S.tenantCount} tenants${S.leasedSF ? ` · $${(S.inPlaceRent / S.leasedSF).toFixed(2)}/SF` : ""}`} />
        <Tile label="IG share of rent" value={pct(S.igRentPct)} />
        <Tile label="Top-5 concentration" value={pct(S.top5Pct)} sub={S.top5.slice(0, 2).map(t => t.name).join(", ")} tone={(S.top5Pct ?? 0) > 60 ? "warn" : undefined} />
        <Tile label="WALT" value={S.walt != null ? `${S.walt} yrs` : "—"} />
        <Tile label="Rolling 12 / 24 / 36 mo" value={`${pct(S.roll12Pct, 0)} · ${pct(S.roll24Pct, 0)} · ${pct(S.roll36Pct, 0)}`} sub="% of base rent" tone={(S.roll24Pct ?? 0) > 30 ? "warn" : undefined} />
        <Tile label="Below market" value={`${S.belowN} · ${$m(S.belowAnnual)}`} sub="gap to market /yr — capturable only at expiry" tone={S.belowN ? "good" : undefined} />
        <Tile label="Above market" value={`${S.aboveN} · ${$m(-S.aboveAnnual)}`} sub="premium /yr at risk at renewal" tone={S.aboveN ? "bad" : undefined} />
        <Tile label="Sales reporting" value={`${S.salesReporting}`} sub={`wtd occ cost ${pct(S.wtdOccCost)}`} />
        <Tile label="No options left" value={`${S.noOptionsN}`} sub={`${S.optionsUnknownN} not stated`} />
        <Tile label="Kickout / co-tenancy" value={`${S.kickoutN} / ${S.cotenancyN}`} tone={S.kickoutN + S.cotenancyN ? "warn" : undefined} />
        <Tile label="NNN vs gross" value={`${pct(S.mix.nnn, 0)} · ${pct(S.mix.gross, 0)}`} sub={`MG ${pct(S.mix.mg, 0)} · not stated ${pct(S.mix.unknown, 0)}`} />
        {S.proposed.n > 0 && Number(deal.noi) > 0 && <Tile label="NOI ex-proposed" value={$m(Number(deal.noi) - S.proposed.rent)} sub={`OM NOI ${$m(Number(deal.noi))} less ${$m(S.proposed.rent)} proposed base rent`} tone="warn" />}
        {S.proposed.n > 0 && <Tile label="Proposed (pipeline)" value={`${S.proposed.n} · ${$m(S.proposed.rent)}`} sub={`${S.proposed.sf.toLocaleString()} SF ${includeProposed ? "counted above" : "not counted"}`} tone="warn" />}
      </div>
    </section>
  );
}
