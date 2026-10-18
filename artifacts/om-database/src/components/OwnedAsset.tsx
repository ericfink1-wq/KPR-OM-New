import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Deal } from "../lib/idb";
import {
  buildDebtRows, buildCriticalDates, buildCovenantRows, planVsActual, sinceAcquisition, actualNoi, annualDebtService, liveTenants, driveLinks,
  type AmRecord, type CovenantRow, type DebtRow,
} from "../lib/assetMgmt";
import { apiAmDetectCovenants, apiAmQuarterlyComment, apiAmDeleteRecord, apiAmSaveRecord, type CovenantProposal } from "../lib/api";
import {
  useAmData, OwnedDealPanel, RecordEditor, Modal, Kpi, Src, Pill, daysPill,
  K, card, th, td, num, btn, miniBtn, fmtM, fmtPct, fmtDate,
} from "./AssetMgmt";

// OWNED DEAL PAGE (Eric, 10/18/26). The Asset tab, the owned Financing view and the
// acquisition card all read Asset Mgmt's records — ONE source of truth for loans, swaps,
// covenants and the acquisition — and Datex for what the property is doing today.

const mine = (records: AmRecord[] | null, dealId: string) => (records ?? []).filter(r => r.dealId === dealId);
const head = (t: string) => <div style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: K.charcoal }}>{t}</div>;
const statusPill = (st: CovenantRow["status"]) => st === "breach" ? <Pill flag="red">below covenant</Pill> : st === "watch" ? <Pill flag="amber">under 10% headroom</Pill> : st === "ok" ? <Pill flag="green">passing</Pill> : <Pill flag="gray">monitor</Pill>;

function useDealAm(deal: Deal) {
  const { records, rates, abstracts, reload } = useAmData(deal.status === "Owned");
  const today = useMemo(() => new Date(), []);
  const recs = useMemo(() => mine(records, deal.id), [records, deal.id]);
  const debt = useMemo(() => buildDebtRows(recs, [deal], rates, today).filter(r => !r.superseded), [recs, deal, rates, today]);
  const covenants = useMemo(() => buildCovenantRows(deal, recs, debt, today), [deal, recs, debt, today]);
  const acq = recs.find(r => r.kind === "acquisition") ?? null;
  return { loaded: records != null, recs, rates, abstracts: abstracts.filter(a => a.dealId === deal.id), debt, covenants, acq, today, reload };
}

// ── Asset tab ────────────────────────────────────────────────────────────────
export function OwnedAssetTab({ deal, isAdmin }: { deal: Deal; isAdmin: boolean }) {
  const { loaded, recs, abstracts, debt, covenants, acq, today, reload } = useDealAm(deal);
  const dx = (deal as unknown as { datexLive?: Record<string, unknown> }).datexLive;
  const fin = dx?.financials as Record<string, number | string> | undefined;
  const lt = liveTenants(deal);
  const noi = actualNoi(deal, acq?.data ?? null);
  const bal = debt.reduce((t, r) => t + (r.balance ?? 0), 0);
  const priced = debt.filter(r => r.balance && r.allInPct != null);
  const wRate = priced.length ? priced.reduce((t, r) => t + r.balance! * r.allInPct!, 0) / priced.reduce((t, r) => t + r.balance!, 0) : null;
  const ds = debt.map(r => annualDebtService(r.balance, r.allInPct, r.record.data, today).amount);
  const totalDs = ds.every(v => v != null) && ds.length ? ds.reduce((a, b) => a! + b!, 0)! : null;
  const dscrActual = totalDs && noi.value != null ? noi.value / totalDs : null;
  const dscrCov = covenants.find(c => c.type === "DSCR");
  const nextDate = useMemo(() => buildCriticalDates([deal], recs, abstracts, today, 3650).items.find(i => i.days >= 0) ?? null, [deal, recs, abstracts, today]);
  const plan = planVsActual(deal, recs);
  const timeline = sinceAcquisition(deal, recs, today);
  const dxRent = lt.source === "Datex" ? lt.tenants.reduce((t, x) => t + (x.annualRent ?? 0), 0) : null;
  const ytdVar = fin?.noiYtdActual != null && fin?.noiYtdBudget ? (Number(fin.noiYtdActual) / Number(fin.noiYtdBudget) - 1) * 100 : null;

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }}>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(160px,1fr))", gap: 10 }}>
        <Kpi label="Occupancy" value={dx?.occupancyPct != null ? fmtPct(Number(dx.occupancyPct), 1) : deal.occupancy != null ? fmtPct(Number(deal.occupancy), 1) : "—"} sub={dx?.occupancyPct != null ? `Datex ${fmtDate(String(dx.asOf))}` : "underwriting — no Datex snapshot"} />
        <Kpi label="In-place base rent" value={fmtM(dxRent ?? ((deal.tenants ?? []).reduce((t, x) => t + (Number(x.annualRent) || 0), 0) || null))} sub={dxRent != null ? `Datex rent roll ${fmtDate(lt.asOf)}` : "underwriting roll"} />
        <Kpi label="NOI YTD vs budget" value={fin?.noiYtdActual != null ? fmtM(Number(fin.noiYtdActual)) : "—"} sub={fin?.noiYtdActual != null ? `${ytdVar != null ? `${ytdVar >= 0 ? "+" : ""}${ytdVar.toFixed(1)}% vs ` : "budget "}${fmtM(fin.noiYtdBudget != null ? Number(fin.noiYtdBudget) : null)} · to ${fin.period}` : "needs the Datex v2 snapshot"} />
        <Kpi label="Debt" value={bal ? fmtM(bal) : "—"} sub={bal ? `${wRate != null ? `${wRate.toFixed(3)}% all-in` : "rate not on file"} · ${debt.length} loan${debt.length === 1 ? "" : "s"}` : loaded ? "no loan on file" : "loading…"} />
        <Kpi label="DSCR" value={dscrActual != null ? `${dscrActual.toFixed(2)}x` : "—"} sub={dscrActual != null ? `${dscrCov?.threshold != null ? `covenant ${dscrCov.threshold.toFixed(2)}x · ` : ""}${noi.source}` : "needs NOI, balance and rate"} />
        <Kpi label="Debt yield" value={bal && noi.value != null ? fmtPct((noi.value / bal) * 100, 1) : "—"} sub={bal && noi.value != null ? noi.source : "needs NOI and a balance"} />
        <Kpi label="Next critical date" value={nextDate ? fmtDate(nextDate.date) : "—"} sub={nextDate ? `${nextDate.type}${nextDate.tenant ? ` · ${nextDate.tenant}` : ""} · ${nextDate.days}d` : "none on file"} />
      </div>

      <CovenantMonitor deal={deal} rows={covenants} debt={debt} isAdmin={isAdmin} reload={reload} />

      <div style={{ ...card, padding: 14 }}>
        {head("Plan vs actual")}
        <Src>Underwriting (OM / acquisition record) against what Datex shows today. Variance = actual − plan.</Src>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={{ width: "100%", minWidth: 620, borderCollapse: "collapse" }}>
            <thead><tr>{["", "Plan", "Actual", "Variance"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{plan.map(r => {
              const f = (v: number | null) => v == null ? "—" : r.unit === "pct" ? fmtPct(v, 1) : fmtM(v);
              const bad = r.variance != null && r.variance < 0;
              return (
                <tr key={r.label}>
                  <td style={td}>{r.label}</td>
                  <td style={num}>{f(r.plan)}<Src>{r.planSource}</Src></td>
                  <td style={num}>{f(r.actual)}<Src>{r.actualSource}</Src></td>
                  <td style={{ ...num, color: r.variance == null ? K.gray : bad ? K.red : "#3e8a2f", fontWeight: 700 }}>{r.variance == null ? "—" : r.unit === "pct" ? `${r.variance >= 0 ? "+" : ""}${r.variance.toFixed(1)} pts` : `${r.variance >= 0 ? "+" : "−"}${fmtM(Math.abs(r.variance))}`}{r.variancePct != null && r.unit !== "pct" ? <Src>{`${r.variancePct >= 0 ? "+" : ""}${r.variancePct}%`}</Src> : null}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>

      <OwnedDealPanel deal={deal} onOpenDeal={() => {}} />

      <div style={{ ...card, padding: 14 }}>
        {head("Since acquisition")}
        {!timeline.length ? <Src>Nothing recorded yet. The close date comes from the acquisition record, leasing from the Datex snapshot, tenant changes from new rent rolls.</Src> : (
          <div style={{ marginTop: 8, borderLeft: `2px solid ${K.line}`, paddingLeft: 12, display: "flex", flexDirection: "column", gap: 9 }}>
            {timeline.slice(0, 30).map((t, i) => (
              <div key={i} style={{ position: "relative" }}>
                <span style={{ position: "absolute", left: -18, top: 4, width: 10, height: 10, borderRadius: "50%", background: t.kind === "close" ? K.green : t.kind === "leasing" ? K.charcoal : t.kind === "debt" ? "#8a7f6a" : "#c9c4b8" }} />
                <div style={{ fontSize: 12, color: K.gray }}>{fmtDate(t.date)}</div>
                <div style={{ fontSize: 13.5, color: K.ink }}>{t.text}</div>
                <Src>{t.source}</Src>
              </div>
            ))}
          </div>
        )}
      </div>

      <QuarterlyComment deal={deal} recs={recs} debt={debt} plan={plan} timeline={timeline} />
    </div>
  );
}

// ── Covenant monitor ─────────────────────────────────────────────────────────
function CovenantMonitor({ deal, rows, debt, isAdmin, reload }: { deal: Deal; rows: CovenantRow[]; debt: DebtRow[]; isAdmin: boolean; reload: () => void }) {
  const [edit, setEdit] = useState<{ rec: AmRecord | null } | null>(null);
  const [detect, setDetect] = useState(false);
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {head("Covenant monitor")}
        {isAdmin && <span style={{ display: "flex", gap: 6 }}><button style={btn()} onClick={() => setDetect(true)}>Detect from loan docs</button><button style={btn()} onClick={() => setEdit({ rec: null })}>Add covenant</button></span>}
      </div>
      <Src>Headroom uses actual NOI (Datex trailing 12 months when loaded) over debt service that is interest-only during an IO period and amortizing after — or on the covenant's own test amortization when it names one. Tenant-triggered items also appear on the Dates calendar.</Src>
      {!rows.length ? <div style={{ fontSize: 13.5, color: K.gray, marginTop: 8 }}>No covenants on file.{isAdmin ? " Use “Detect from loan docs” to read them from the loan rows." : ""}</div> : (
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
            <thead><tr>{["Covenant", "Actual", "Headroom", "Next test", "Trigger", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.record.id}>
                <td style={td}><b>{r.label}</b>{r.loanLabel && <Src>{r.loanLabel}</Src>}<div style={{ marginTop: 3 }}>{statusPill(r.status)}</div></td>
                <td style={num}>{r.actual == null ? "—" : r.type === "DY" ? fmtPct(r.actual, 1) : `${r.actual.toFixed(2)}x`}<Src>{r.actualBasis}</Src></td>
                <td style={num}>{r.headroomPct == null ? "—" : `${r.headroomPct >= 0 ? "+" : ""}${r.headroomPct}%`}{r.noiCushionPct != null && r.noiCushionPct > 0 ? <Src>NOI can fall {r.noiCushionPct}% before a breach</Src> : null}</td>
                <td style={td}>{fmtDate(r.nextTest)}</td>
                <td style={{ ...td, maxWidth: 300 }}>{r.trigger ? <div style={{ fontSize: 12.5 }}>{r.trigger}</div> : "—"}{r.triggerDate && <div style={{ marginTop: 3 }}>{fmtDate(r.triggerDate)} {daysPill(r.daysToTrigger)}</div>}<Src>{r.record.sourceNote ?? "no source noted"}</Src></td>
                <td style={td}>{isAdmin && <span style={{ display: "flex", gap: 6 }}><button style={miniBtn} onClick={() => setEdit({ rec: r.record })}>Edit</button><button style={miniBtn} onClick={async () => { if (window.confirm("Delete this covenant?")) { await apiAmDeleteRecord(r.record.id); reload(); } }}>Delete</button></span>}</td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {edit && <RecordEditor kind="covenant" deals={[deal]} initial={edit.rec} preset={!edit.rec && debt.length === 1 ? { loanId: debt[0].record.id, loanLabel: debt[0].loanLabel ?? undefined } : undefined} onClose={() => setEdit(null)} onSaved={reload} />}
      {detect && <DetectCovenants dealId={deal.id} dealName={deal.propertyName} onClose={() => setDetect(false)} onSaved={reload} />}
    </div>
  );
}

function DetectCovenants({ dealId, dealName, onClose, onSaved }: { dealId?: string; dealName?: string; onClose: () => void; onSaved: () => void }) {
  const [rows, setRows] = useState<CovenantProposal[] | null>(null), [notes, setNotes] = useState<string[]>([]);
  const [pick, setPick] = useState<Set<string>>(new Set()), [err, setErr] = useState<string | null>(null), [busy, setBusy] = useState(false);
  useEffect(() => { apiAmDetectCovenants(false).then(r => { const mineRows = dealId ? r.rows.filter(x => x.dealId === dealId) : r.rows; setRows(mineRows); setNotes(r.notes); setPick(new Set(mineRows.map(x => x.id))); }).catch(e => setErr(e.message)); }, [dealId]);
  const save = async () => { setBusy(true); try { await apiAmDetectCovenants(true, [...pick]); onSaved(); onClose(); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); } finally { setBusy(false); } };
  return (
    <Modal title="Covenants found" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: K.gray }}>From KPR's covenant brief and the covenant text on each loan row. Nothing is saved until you tick and save; every row stays editable.</div>
      {err && <div style={{ color: K.red, fontSize: 12.5 }}>{err}</div>}
      {rows == null ? <div style={{ color: K.gray }}>Reading…</div> : !rows.length ? <div style={{ color: K.gray, fontSize: 13 }}>Nothing new to add — every covenant found is already on file.</div> : rows.map(r => (
        <label key={r.id} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, borderTop: `1px solid ${K.line}`, paddingTop: 8 }}>
          <input type="checkbox" checked={pick.has(r.id)} onChange={e => setPick(p => { const n = new Set(p); if (e.target.checked) n.add(r.id); else n.delete(r.id); return n; })} style={{ marginTop: 3 }} />
          <span><b>{r.property}</b> · {String(r.data.type)}{r.data.threshold != null ? ` ${r.data.threshold}` : ""}{r.data.testFrequency ? ` · ${r.data.testFrequency}` : ""}{r.data.linkedTenant ? ` · ${r.data.linkedTenant}` : ""}{r.data.triggerDate ? ` · ${fmtDate(String(r.data.triggerDate))}` : ""}
            {!!r.data.trigger && <Src>{String(r.data.trigger)}</Src>}<Src>{r.from === "seed" ? "KPR brief" : "parsed from loan text"} · {r.loanId ? "linked to its loan" : "not linked to a loan — link it after saving"}</Src></span>
        </label>
      ))}
      {notes.filter(n => !dealName || n.startsWith(dealName)).slice(0, 6).map((n, i) => <Src key={i}>{n}</Src>)}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btn()}>Cancel</button>
        {!!rows?.length && <button onClick={save} disabled={busy || !pick.size} style={btn(true)}>{busy ? "Saving…" : `Save ${pick.size}`}</button>}
      </div>
    </Modal>
  );
}

// ── Quarterly comment (one AI call, on click) ────────────────────────────────
function QuarterlyComment({ deal, recs, debt, plan, timeline }: { deal: Deal; recs: AmRecord[]; debt: DebtRow[]; plan: ReturnType<typeof planVsActual>; timeline: ReturnType<typeof sinceAcquisition> }) {
  const [draft, setDraft] = useState<string | null>(null), [busy, setBusy] = useState(false), [err, setErr] = useState<string | null>(null);
  const dx = (deal as unknown as { datexLive?: Record<string, unknown> }).datexLive;
  const quarter = useMemo(() => { const p = String((dx?.financials as Record<string, unknown> | undefined)?.period ?? ""); const y = p ? Number(p.slice(0, 4)) : new Date().getFullYear(), m = p ? Number(p.slice(4, 6)) : new Date().getMonth(); return `Q${Math.max(1, Math.ceil(m / 3))} ${y}`; }, [dx]);
  const run = async () => {
    setBusy(true); setErr(null);
    const yearAgo = new Date(Date.now() - 365 * 86_400_000).toISOString().slice(0, 10);
    const facts = {
      property: deal.propertyName, city: deal.city, state: deal.state, gla: dx?.totalGLA ?? deal.totalSF,
      occupancy: { today: dx?.occupancyPct ?? null, asOf: dx?.asOf ?? null, atUnderwriting: deal.occupancy ?? null },
      planVsActual: plan.map(r => ({ item: r.label, plan: r.plan, actual: r.actual, variancePct: r.variancePct, unit: r.unit })),
      leasingPipelineApplicationsLast12Months_notExecutedUnlessExecutedDateSet: ((dx?.leasing as Array<Record<string, unknown>> | undefined) ?? []).filter(l => String(l.executed ?? l.submitted ?? "") >= yearAgo).map(l => ({ tenant: l.tenant, sf: l.gla, rentPSF: l.rentPSF, stage: l.stage, executed: l.executed })),
      tenantChangesLast12Months: timeline.filter(t => t.kind === "change" && t.date >= yearAgo).map(t => t.text),
      debt: debt.map(r => ({ lender: r.lender, loan: r.loanLabel, balance: r.balance, allInRatePct: r.allInPct, rateType: r.rateType, hedged: r.swaps.some(w => !w.termsPending), maturity: r.maturity })),
      noi: (dx?.financials as Record<string, unknown> | undefined) ?? null,
      kpOwnershipPct: recs.find(r => r.kind === "acquisition")?.data.kpPct ?? null,
    };
    try { setDraft(await apiAmQuarterlyComment(deal.id, facts, quarter)); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't draft it"); } finally { setBusy(false); }
  };
  return (
    <div style={{ ...card, padding: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
        {head(`Quarterly comment — ${quarter}`)}
        <button style={btn(true)} onClick={run} disabled={busy}>{busy ? "Drafting…" : draft ? "Redraft" : "Draft investor-letter paragraph"}</button>
      </div>
      <Src>One AI call, only when you click. It writes from the figures on this page (Datex occupancy, leasing, NOI vs budget, debt) and is told never to add a number that isn't there — still, check every figure before it goes out.</Src>
      {err && <div style={{ color: K.red, fontSize: 12.5, marginTop: 6 }}>{err}</div>}
      {draft != null && (
        <>
          <textarea value={draft} onChange={e => setDraft(e.target.value)} rows={7} style={{ width: "100%", boxSizing: "border-box", marginTop: 8, border: "1px solid #d9d8d2", borderRadius: 8, padding: 10, fontSize: 14, lineHeight: 1.5, fontFamily: "'Lora',serif", color: K.ink }} />
          <button style={{ ...btn(), marginTop: 6 }} onClick={() => navigator.clipboard?.writeText(draft)}>Copy</button>
        </>
      )}
    </div>
  );
}

// ── Financing tab for an owned deal (Asset Mgmt records are the single source) ──
export function OwnedFinancing({ deal }: { deal: Deal }) {
  const { loaded, debt, covenants, acq, today } = useDealAm(deal);
  const noi = actualNoi(deal, acq?.data ?? null);
  if (!loaded) return <div style={{ ...card, padding: 16, color: K.gray, marginBottom: 14 }}>Loading the loan records…</div>;
  if (!debt.length) return <div style={{ ...card, padding: 16, fontSize: 13.5, color: K.gray, marginBottom: 14 }}>No loan on file for this property in Asset Mgmt → Debt. Loans and swaps are entered (or imported) there; this tab reads them.</div>;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, marginBottom: 14 }} id="section-senior-loan">
      {debt.map(r => {
        const d = r.record.data;
        const ds = annualDebtService(r.balance, r.allInPct, d, today);
        const dscr = ds.amount && noi.value != null ? noi.value / ds.amount : null;
        const mine = covenants.filter(c => !c.record.data.loanId || c.record.data.loanId === r.record.id);
        const docs = driveLinks(r.record);
        const Line = ({ l, v, sub }: { l: string; v: ReactNode; sub?: ReactNode }) => (
          <div style={{ display: "flex", justifyContent: "space-between", gap: 12, padding: "7px 0", borderBottom: `1px solid #f3f2ee` }}>
            <span style={{ fontSize: 12, color: K.gray }}>{l}</span><span style={{ textAlign: "right", fontSize: 13.5, color: K.ink, fontVariantNumeric: "tabular-nums" }}>{v}{sub && <Src>{sub}</Src>}</span>
          </div>
        );
        return (
          <div key={r.record.id} style={{ ...card, padding: 16 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "baseline" }}>
              <div style={{ fontFamily: "'Lora',serif", fontSize: 19, color: K.ink }}>{r.lender ?? "Loan"}{r.loanLabel ? ` · ${r.loanLabel}` : ""}</div>
              <div>{fmtDate(r.maturity)} {daysPill(r.daysToMaturity, r.flag)}</div>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(260px,1fr))", gap: "0 22px", marginTop: 6 }}>
              <div>
                <Line l="Balance" v={fmtM(r.balance)} sub={r.balanceIsOriginal ? "original balance" : d.balanceAsOf ? `as of ${fmtDate(String(d.balanceAsOf))}` : undefined} />
                <Line l="Rate" v={`${fmtPct(r.allInPct, 3)} ${r.rateType ?? ""}`} sub={`${r.allInSource}${r.index ? ` · ${r.index}` : ""}${r.spreadBps != null ? ` + ${r.spreadBps} bps` : ""}`} />
                <Line l="Annual debt service" v={fmtM(ds.amount)} sub={ds.basis} />
                <Line l="DSCR (actual)" v={dscr != null ? `${dscr.toFixed(2)}x` : "—"} sub={noi.source} />
                <Line l="Debt yield" v={r.balance && noi.value != null ? fmtPct((noi.value / r.balance) * 100, 1) : "—"} />
              </div>
              <div>
                <Line l="Maturity" v={fmtDate(r.maturity)} sub={r.daysToMaturity != null ? `${r.daysToMaturity} days` : undefined} />
                <Line l="Extensions" v={String(d.extensionOptions ?? "—")} sub={d.extensionNoticeDate ? `notice by ${fmtDate(String(d.extensionNoticeDate))}` : undefined} />
                <Line l="Amortization" v={String(d.amortizationText ?? d.amortization ?? "—")} sub={d.ioUntil ? `IO until ${fmtDate(String(d.ioUntil))}` : undefined} />
                <Line l="Prepayment" v={<span style={{ fontSize: 12.5 }}>{String(d.prepayment ?? "—")}</span>} />
                <Line l="Recourse / guarantor" v={[d.recourse, d.guarantor].filter(Boolean).map(String).join(" · ") || "—"} />
              </div>
            </div>
            {r.swaps.map(w => (
              <div key={w.record.id} style={{ marginTop: 10, background: K.page, borderRadius: 10, padding: "10px 12px" }}>
                <b style={{ fontSize: 13 }}>Swap{w.counterparty ? ` · ${w.counterparty}` : ""}</b>
                {w.termsPending ? <div style={{ fontSize: 13, color: K.gray }}>Terms pending — notional, rate or maturity not documented, so it isn't priced.</div> : (
                  <div style={{ fontSize: 13, marginTop: 2 }}>{fmtM(w.notional)} fixed at {fmtPct(w.fixedSwapRatePct, 4)} to {fmtDate(w.maturity)} · market {fmtPct(w.marketRatePct, 3)} ({w.curve}) · <b style={{ color: w.mtm == null ? K.gray : w.mtm >= 0 ? "#3e8a2f" : K.red }}>MTM {w.mtm == null ? "—" : `${w.mtm >= 0 ? "+" : "−"}${fmtM(Math.abs(w.mtm))}`}</b> <span style={{ color: K.gray }}>({w.mtmLabel})</span></div>
                )}
                <Src>Indicative breakage on the same curve as Asset Mgmt; the bank's mark governs. {w.record.sourceNote ?? ""}</Src>
              </div>
            ))}
            {mine.length > 0 && (
              <div style={{ marginTop: 10 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: K.gray, marginBottom: 4 }}>Covenants</div>
                {mine.map(c => <div key={c.record.id} style={{ fontSize: 13, marginTop: 4 }}>{statusPill(c.status)} {c.label}{c.actual != null ? ` — actual ${c.type === "DY" ? fmtPct(c.actual, 1) : `${c.actual.toFixed(2)}x`}${c.headroomPct != null ? ` (${c.headroomPct >= 0 ? "+" : ""}${c.headroomPct}% headroom)` : ""}` : ""}{c.triggerDate ? ` · trigger ${fmtDate(c.triggerDate)}` : ""}</div>)}
              </div>
            )}
            <div style={{ marginTop: 10, display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
              {docs.map(x => <a key={x.url} href={x.url} target="_blank" rel="noreferrer" style={{ ...miniBtn, textDecoration: "none", padding: "5px 10px" }}>📄 {x.name}</a>)}
              <Src>{r.record.sourceNote ?? "no source noted"} · edit in Asset Mgmt → Debt</Src>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── Acquisition card (Transaction tab, owned) ────────────────────────────────
export const ACQ_TO_DEAL: Array<[string, keyof Deal]> = [["purchasePrice", "txnPurchasePrice"], ["closeDate", "txnCloseDate"], ["seller", "txnSeller"], ["goingInCapPct", "acqCapRate"], ["noiAtPurchase", "acqNOIAtClose"]];
export function AcquisitionCard({ deal, isAdmin, onUpdate }: { deal: Deal; isAdmin: boolean; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  const { loaded, acq, reload } = useDealAm(deal);
  const [edit, setEdit] = useState(false);
  if (!loaded) return null;
  const a = acq?.data ?? null;
  const blanks = a ? ACQ_TO_DEAL.filter(([k, f]) => a[k] != null && (deal[f] == null || deal[f] === "")) : [];
  const v = (k: string, kind: "usd" | "pct" | "date" | "text") => { const x = a?.[k]; if (x == null || x === "") return "—"; return kind === "usd" ? fmtM(Number(x)) : kind === "pct" ? fmtPct(Number(x), 2) : kind === "date" ? fmtDate(String(x)) : String(x); };
  return (
    <div style={{ ...card, padding: 16, marginBottom: 14 }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {head("Acquisition")}
        <span style={{ display: "flex", gap: 6 }}>
          {isAdmin && blanks.length > 0 && <button style={btn()} onClick={() => onUpdate(deal.id, Object.fromEntries(blanks.map(([k, f]) => [f, a![k]])) as Partial<Deal>)}>Fill {blanks.length} blank deal field{blanks.length === 1 ? "" : "s"}</button>}
          {isAdmin && <button style={btn()} onClick={() => setEdit(true)}>{a ? "Edit" : "Add"}</button>}
        </span>
      </div>
      {!a ? <Src>No acquisition record yet. An admin imports these from the KPR Corporate Overview (Asset Mgmt → Debt → Import, key "acquisitions").</Src> : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 10, marginTop: 10 }}>
            {([["Purchase price", "purchasePrice", "usd"], ["Close date", "closeDate", "date"], ["Seller", "seller", "text"], ["KP %", "kpPct", "pct"], ["JV partner", "jvPartner", "text"], ["MZL equity", "mzlEquity", "usd"],
              ["KP member equity", "kpMemberEquity", "usd"], ["Total equity", "totalEquity", "usd"], ["NOI at purchase", "noiAtPurchase", "usd"], ["Going-in cap", "goingInCapPct", "pct"], [`${a.budgetYear ?? ""} budget NOI`.trim(), "budgetNoi", "usd"]] as const)
              .filter(([, k]) => a[k] != null).map(([l, k, kind]) => (
                <div key={k}><div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: K.gray }}>{l}</div><div style={{ fontSize: 15, color: K.ink, fontVariantNumeric: "tabular-nums" }}>{v(k, kind)}</div></div>
              ))}
          </div>
          <Src>Source: {acq?.sourceNote ?? "acquisition record"}. These fill the deal's blank transaction fields only when an admin clicks "Fill" — figures already entered on the deal are never overwritten.</Src>
        </>
      )}
      {edit && <RecordEditor kind="acquisition" deals={[deal]} initial={acq} onClose={() => setEdit(false)} onSaved={reload} />}
    </div>
  );
}

/** Price, cap and price/SF for an owned deal's Key Financials: purchase price (deal → acquisition
 *  record → asking), cap = stated, else going-in, else NOI ÷ price. */
export function useOwnedPricing(deal: Deal): { price: number | null; priceSource: string; cap: number | null; capSource: string; psf: number | null } {
  const { acq } = useDealAm(deal);
  const a = acq?.data ?? null;
  const price = Number(deal.txnPurchasePrice) || Number(a?.purchasePrice) || Number(deal.askingPrice) || null;
  const priceSource = deal.txnPurchasePrice ? "acquisition price" : a?.purchasePrice ? "acquisition record" : deal.askingPrice ? "OM asking price" : "";
  const statedCap = Number(deal.acqCapRate) || Number(a?.goingInCapPct) || null;
  const noi = Number(a?.noiAtPurchase) || Number(deal.acqNOIAtClose) || Number(deal.noi) || null;
  const cap = statedCap ?? (price && noi ? Math.round((noi / price) * 10000) / 100 : null);
  const capSource = statedCap ? "going-in cap" : cap != null ? "NOI ÷ acquisition price" : "";
  const psf = price && deal.totalSF ? Math.round(price / Number(deal.totalSF)) : null;
  return { price, priceSource, cap, capSource, psf };
}

/** Recorded status of passed option-notice dates on an owned deal (key "tenant|noticeDate"),
 *  with an admin-only setter that saves an Asset Mgmt record. */
export function useOptionStatus(deal: Deal, isAdmin: boolean): { map: Map<string, string>; set?: (tenant: string, option: string, noticeDate: string, status: string) => void } {
  const { recs, reload } = useDealAm(deal);
  const map = useMemo(() => new Map(recs.filter(r => r.kind === "optstatus" && r.data.status).map(r => [`${String(r.data.tenant ?? "").trim().toLowerCase()}|${String(r.data.noticeDate ?? "")}`, String(r.data.status)])), [recs]);
  if (deal.status !== "Owned") return { map: new Map() };
  return { map, set: isAdmin ? (tenant, option, noticeDate, status) => { apiAmSaveRecord({ kind: "optstatus", dealId: deal.id, data: { tenant, option, noticeDate, status }, sourceNote: "Set on the deal page" }).then(reload).catch(e => alert(e instanceof Error ? e.message : "Couldn't save")); } : undefined };
}
