import { useMemo, useState } from "react";
import { fmtMoney } from "../lib/money";
import type { RatesPayload } from "../lib/api";
import { computePayoff, PREPAY_KIND_LABEL, type LoanInput, type PayoffResult } from "../lib/payoffEngine";

// PREPAY / PAYOFF PANEL (Eric, 11/6/26) — what it costs (or earns) to pay off one of our loans on a
// chosen date: defeasance, yield maintenance, step-down, fees and any swap unwind, netted vs par.
// Used in Asset Mgmt → Debt (loan drawer), an owned deal's Financing tab and the deal-page
// prepayment calculator. Own palette (not imported from AssetMgmt) so it has no import cycle.
const C = { ink: "#232422", charcoal: "#383A37", gray: "#676767", line: "#ecebe6", page: "#FAF9F5", red: "#b3403f", green: "#3e8a2f", amber: "#b3711a" };
const todayIso = () => new Date().toISOString().slice(0, 10);
const fmtDate = (iso: string | null | undefined) => iso ? new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
/** Cost positive, gain negative: "$1.31M" / "−$0.24M (gain)". */
export const fmtSigned = (v: number | null | undefined) => v == null ? "—" : v < 0 ? `−${fmtMoney(-v)}` : fmtMoney(v);

/** Short label for a table cell: "$1.46M cost", "+$0.31M gain", "Locked → Nov 2027", "Par", "—". */
export function payoffCell(r: PayoffResult | null | undefined): { text: string; tone: "cost" | "gain" | "muted" | "amber"; title: string } {
  if (!r) return { text: "—", tone: "muted", title: "Not priced" };
  const why = `${r.method} · terms ${r.termsSource}`;
  if (r.status === "locked") {
    const at = r.atEarliest?.net;
    return { text: `Locked → ${fmtDate(r.earliestDate).replace(/ \d+,/, "")}`, tone: "amber", title: `${r.method}${at != null ? ` — on that date ≈ ${fmtSigned(at)} net` : ""}. Terms ${r.termsSource}.` };
  }
  if (r.net == null) return { text: "—", tone: "muted", title: r.needs.length ? `Needs ${r.needs.join(", ")}` : why };
  if (r.net === 0) return { text: "Par", tone: "muted", title: why };
  return r.net > 0 ? { text: `${fmtMoney(r.net)} cost`, tone: "cost", title: why } : { text: `+${fmtMoney(-r.net)} gain`, tone: "gain", title: why };
}
export const toneColor = (t: "cost" | "gain" | "muted" | "amber") => t === "cost" ? C.charcoal : t === "gain" ? C.green : t === "amber" ? C.amber : C.gray;

export function LoanPayoffPanel({ input, rates, onEditTerms, editHint, date: dateProp, onDate, hideDate }: {
  input: LoanInput; rates: RatesPayload | null; onEditTerms?: () => void; editHint?: string;
  date?: string; onDate?: (d: string) => void; hideDate?: boolean;
}) {
  const [dateLocal, setDateLocal] = useState(todayIso());
  const date = dateProp ?? dateLocal;
  const setDate = (d: string) => { if (onDate) onDate(d); else setDateLocal(d); };
  const [feeTxt, setFeeTxt] = useState("");
  const feeOverride = feeTxt.trim() && Number.isFinite(Number(feeTxt.replace(/[$,\s]/g, ""))) ? Number(feeTxt.replace(/[$,\s]/g, "")) : null;
  const L = useMemo(() => feeOverride != null ? { ...input, fees: feeOverride } : input, [input, feeOverride]);
  const res = useMemo(() => ISOok(date) ? computePayoff(L, rates, date) : null, [L, rates, date]);
  const shown = res?.status === "locked" ? res.atEarliest : res;
  const T = input.terms;
  const presets: Array<[string, string]> = [["Today", todayIso()]];
  if (T.lockoutEnd && T.lockoutEnd > todayIso()) presets.push(["First allowed", T.lockoutEnd]);
  if (T.openDate && T.openDate > todayIso()) presets.push(["Open at par", T.openDate]);
  const tAsOf = rates?.treasuries?.asOf;
  const pill = (txt: string, color: string) => <span style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".04em", color, border: `1px solid ${color}55`, borderRadius: 10, padding: "1px 7px", whiteSpace: "nowrap" }}>{txt}</span>;

  return (
    <div style={{ border: `1px solid ${C.line}`, borderRadius: 12, padding: "12px 14px", background: "#fff", minWidth: 0 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        <div style={{ fontFamily: "'Montserrat',sans-serif", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: C.charcoal }}>Prepay / payoff — cost or gain</div>
        {pill(PREPAY_KIND_LABEL[T.kind] + (T.altKind ? ` or ${PREPAY_KIND_LABEL[T.altKind].toLowerCase()}` : ""), T.kind === "unknown" ? C.amber : C.gray)}
      </div>

      {!hideDate && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "flex-end", marginTop: 10 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 3, fontSize: 11, fontWeight: 600, color: C.gray }}>Payoff date
            <input type="date" value={date} onChange={e => setDate(e.target.value)} style={inp} />
          </label>
          {presets.map(([l, d]) => <button key={l} onClick={() => setDate(d)} style={{ ...chip, ...(date === d ? { background: C.charcoal, color: "#fff", borderColor: C.charcoal } : {}) }}>{l}</button>)}
        </div>
      )}

      {res?.status === "locked" && (
        <div style={{ marginTop: 10, background: "#fff6e8", border: "1px solid #f0d9b0", borderRadius: 8, padding: "8px 10px", fontSize: 12.5, color: C.ink, lineHeight: 1.45 }}>
          <b>Locked out on {fmtDate(date)}</b> — the earliest it can be {T.kind === "defeasance" ? "defeased" : "prepaid"} is <b>{fmtDate(res.earliestDate)}</b>{T.lockoutNote ? ` (${T.lockoutNote})` : ""}. The figures below are for that date.
        </div>
      )}

      {shown && (
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginTop: 10 }}>
            <span style={{ fontSize: 12.5, color: C.gray }}>{shown.status === "open" || shown.status === "matured" ? shown.method : shown.net == null ? "Can't price yet" : shown.net < 0 ? "Net GAIN vs paying the balance at par" : "Net COST vs paying the balance at par"}</span>
            <span style={{ fontFamily: "'Lora',Georgia,serif", fontSize: 24, fontWeight: 600, color: shown.net == null ? C.gray : shown.net < 0 ? C.green : shown.net === 0 ? C.charcoal : C.red, fontVariantNumeric: "tabular-nums" }}>
              {shown.net == null ? "—" : shown.net < 0 ? `+${fmtMoney(-shown.net)}` : fmtMoney(shown.net)}
            </span>
          </div>
          {shown.lines.some(l => l.amount != null) && (
            <div style={{ marginTop: 6 }}>
              {shown.lines.map((l, i) => (
                <div key={i} style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "5px 0", borderBottom: "1px solid #f3f2ee", fontSize: 12.5 }}>
                  <span style={{ color: C.ink, minWidth: 0, overflowWrap: "anywhere" }}>{l.label}{l.note && <span style={{ display: "block", fontSize: 11, color: C.gray }}>{l.note}</span>}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap", color: i > 0 && l.amount != null && l.amount < 0 ? C.green : C.ink }}>{i === 0 ? fmtMoney(l.amount) : fmtSigned(l.amount)}</span>
                </div>
              ))}
              {shown.cashToRetire != null && (
                <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "6px 0", fontSize: 12.5, fontWeight: 700 }}>
                  <span>Cash to retire the loan{shown.runsTo && T.kind === "defeasance" ? ` (bonds to ${fmtDate(shown.runsTo)})` : ""}</span>
                  <span style={{ fontVariantNumeric: "tabular-nums" }}>{fmtMoney(shown.cashToRetire)}</span>
                </div>
              )}
            </div>
          )}
          {shown.sensitivity && (shown.sensitivity.up25 != null || shown.sensitivity.down25 != null) && (
            <div style={{ fontSize: 12, color: C.gray, marginTop: 4 }}>If rates move: +25 bp → <b style={{ color: C.ink }}>{fmtSigned(shown.sensitivity.up25)}</b> · −25 bp → <b style={{ color: C.ink }}>{fmtSigned(shown.sensitivity.down25)}</b> (net; negative = gain)</div>
          )}
          {shown.needs.length > 0 && <div style={{ fontSize: 12, color: C.amber, marginTop: 6 }}>To price this it needs: {[...new Set(shown.needs)].join("; ")}.</div>}
        </>
      )}

      {(T.kind === "defeasance" || T.altKind === "defeasance" || L.fees != null || feeTxt) && (
        <label style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginTop: 8, fontSize: 11.5, color: C.gray }}>
          What-if fees ($)
          <input value={feeTxt} onChange={e => setFeeTxt(e.target.value)} inputMode="decimal" placeholder={input.fees != null ? String(input.fees) : "e.g. 125000"} style={{ ...inp, width: 130, minHeight: 30, padding: "4px 8px" }} />
          <span style={{ fontSize: 11 }}>not saved — {onEditTerms ? "use Set prepay terms to save a quote" : "an admin saves quotes in Asset Mgmt → Debt"}</span>
        </label>
      )}

      <div style={{ marginTop: 10, fontSize: 11.5, color: C.gray, lineHeight: 1.45 }}>
        <div><b style={{ color: C.charcoal }}>Terms:</b> {PREPAY_KIND_LABEL[T.kind]}{T.lockoutEnd ? ` · locked out until ${fmtDate(T.lockoutEnd)}` : ""}{T.openDate ? ` · open at par from ${fmtDate(T.openDate)}` : ""}{T.floorPct != null ? ` · minimum ${T.floorPct}%` : ""}{T.ymSpreadBps ? ` · Treasury + ${T.ymSpreadBps} bps` : ""}{T.exitFeePct != null ? ` · exit fee ${T.exitFeePct}%` : ""} — {T.source}.</div>
        {T.lockoutNote && T.lockoutNote !== "lockout end entered" && <div style={{ color: /EARLIER|enter/.test(T.lockoutNote) ? C.amber : C.gray }}>Lockout: {T.lockoutNote}.</div>}
        {(shown?.assumptions ?? []).map((a, i) => <div key={i}>• {a}</div>)}
        <div style={{ marginTop: 4 }}>Estimate on the US Treasury curve{tAsOf ? ` of ${fmtDate(tAsOf)}` : ""} — the defeasance consultant's / servicer's / bank's quote governs. Positive = a cost; a defeasance below par or an in-the-money swap shows as a gain.</div>
      </div>
      {(onEditTerms || editHint) && (
        <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
          {onEditTerms && <button onClick={onEditTerms} style={chip}>Set prepay terms</button>}
          {editHint && <span style={{ fontSize: 11, color: C.gray }}>{editHint}</span>}
        </div>
      )}
    </div>
  );
}
const ISOok = (d: string) => /^\d{4}-\d{2}-\d{2}$/.test(d);
const inp: React.CSSProperties = { border: "1px solid #d9d8d2", borderRadius: 8, padding: "6px 9px", fontSize: 14, color: C.ink, background: "#fff", minHeight: 36, fontFamily: "inherit" };
const chip: React.CSSProperties = { background: "#fff", border: "1px solid #d9d8d2", borderRadius: 8, padding: "6px 11px", minHeight: 34, fontSize: 12, fontWeight: 600, cursor: "pointer", color: C.charcoal, fontFamily: "inherit" };
