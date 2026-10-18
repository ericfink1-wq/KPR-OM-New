import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Deal, LeaseAbstract } from "../lib/idb";
import { getOwnedProperties } from "../lib/ownedPortfolio";
import {
  apiAmRecords, apiAmSaveRecord, apiAmDeleteRecord, apiAmImport, apiAmDatexMap, apiAmSaveDatexMap, apiAmCreditNews, apiAmSummarizeNews,
  apiGetRates, apiListAllLeaseAbstracts, apiLoadTenantBenchmarks, type RatesPayload, type AmImportResult, type DatexMapRow, type AnalystTenantBenchmark,
} from "../lib/api";
import {
  buildDebtRows, buildSwapRows, debtTotals, buildCriticalDates, buildCreditWatch, buildSalesRows, omVsToday, liveTenants,
  type AmRecord, type DebtRow, type SwapRow, type CriticalDate, type CreditRow, type NewsSignal, type DateType,
} from "../lib/assetMgmt";
import { useWatchlist } from "../lib/useWatchlist";
import { useIsMobile } from "../hooks/use-mobile";

// ASSET MGMT (Eric, 10/18/26) — owned properties only. Debt · Dates · Properties · Credit Watch.
// Every number says where it came from and as of when; edit controls are admin-only.

export type AmTab = "debt" | "dates" | "properties" | "credit";
const TABS: Array<[AmTab, string]> = [["debt", "Debt"], ["dates", "Dates"], ["properties", "Properties"], ["credit", "Credit Watch"]];
const K = { green: "#5BBA47", charcoal: "#383A37", ink: "#232422", gray: "#676767", page: "#FAF9F5", line: "#ecebe6", red: "#b3403f", amber: "#b3711a" };

export const fmtM = (v: number | null | undefined) => v == null ? "—" : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3).toLocaleString()}K` : `$${Math.round(v).toLocaleString()}`;
const fmtPct = (v: number | null | undefined, d = 2) => v == null ? "—" : `${v.toFixed(d)}%`;
const fmtDate = (iso: string | null | undefined) => iso ? new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
const card: React.CSSProperties = { background: "#fff", border: `1px solid ${K.line}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(35,36,34,.04)" };
const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", fontFamily: "'Montserrat',sans-serif", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: K.gray, borderBottom: `1px solid ${K.line}`, whiteSpace: "nowrap", position: "sticky", top: 0, background: "#fff" };
const td: React.CSSProperties = { padding: "8px 10px", borderBottom: `1px solid #f3f2ee`, fontSize: 13, color: K.ink, verticalAlign: "top" };
const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
const btn = (primary = false): React.CSSProperties => ({ background: primary ? K.charcoal : "#fff", color: primary ? "#fff" : K.charcoal, border: `1px solid ${primary ? K.charcoal : "#d9d8d2"}`, borderRadius: 8, padding: "7px 12px", minHeight: 34, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Montserrat',sans-serif" });

function Pill({ flag, children }: { flag: "red" | "amber" | "green" | "gray"; children: ReactNode }) {
  const c = { red: ["#fdecec", K.red], amber: ["#fff2e0", K.amber], green: ["#eef7eb", "#3e8a2f"], gray: ["#f1f0ec", K.gray] }[flag];
  return <span style={{ display: "inline-block", background: c[0], color: c[1], borderRadius: 20, padding: "1px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</span>;
}
const daysPill = (days: number | null, flag?: "red" | "amber" | null) => days == null ? null : <Pill flag={flag ?? (days < 0 ? "gray" : days < 90 ? "red" : days < 180 ? "amber" : "gray")}>{days < 0 ? `${-days}d ago` : `${days}d`}</Pill>;
function Src({ children }: { children: ReactNode }) { return <div style={{ fontSize: 11, color: K.gray, marginTop: 3, lineHeight: 1.35 }}>{children}</div>; }
function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...card, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontFamily: "'Roboto',sans-serif", fontVariantNumeric: "tabular-nums", fontSize: 22, fontWeight: 500, color: K.ink, whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontFamily: "'Montserrat',sans-serif", fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: K.charcoal, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: K.gray, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Table({ children, minWidth = 900 }: { children: ReactNode; minWidth?: number }) {
  return <div style={{ ...card, overflow: "auto", maxHeight: "70vh" }}><table style={{ width: "100%", minWidth, borderCollapse: "collapse" }}>{children}</table></div>;
}
function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, flexWrap: "wrap", margin: "22px 0 10px" }}>
      <h2 style={{ margin: 0, fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase", color: K.charcoal }}>{children}</h2>
      {right}
    </div>
  );
}

// ── shared data hook ──────────────────────────────────────────────────────────
export function useAmData(enabled = true) {
  const [records, setRecords] = useState<AmRecord[] | null>(null);
  const [rates, setRates] = useState<RatesPayload | null>(null);
  const [abstracts, setAbstracts] = useState<LeaseAbstract[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    apiAmRecords().then(r => alive && setRecords(r)).catch(e => alive && (setRecords([]), setError(e.message)));
    apiGetRates().then(r => alive && setRates(r)).catch(() => {});
    apiListAllLeaseAbstracts().then(a => alive && setAbstracts(a)).catch(() => {});
    return () => { alive = false; };
  }, [enabled, nonce]);
  return { records, rates, abstracts, error, reload: () => setNonce(n => n + 1) };
}

// ── record editor (admin) ─────────────────────────────────────────────────────
const FIELDS: Record<"loan" | "swap" | "date", Array<[string, string, "text" | "number" | "date"]>> = {
  loan: [["lender", "Lender", "text"], ["originalBalance", "Original balance ($)", "number"], ["currentBalance", "Current balance ($)", "number"], ["balanceAsOf", "Balance as of", "date"],
    ["rateType", "Rate type (fixed / floating / swapped)", "text"], ["index", "Index (1M CME Term SOFR / Daily Simple SOFR)", "text"], ["spreadBps", "Spread (bps)", "number"], ["fixedRatePct", "Fixed rate (%) — fixed loans", "number"],
    ["allInRatePct", "All-in rate (%) — if stated", "number"], ["maturityDate", "Maturity", "date"], ["extensionOptions", "Extension options", "text"], ["extensionNoticeDate", "Extension notice deadline", "date"],
    ["amortization", "Amortization (IO / amortizing)", "text"], ["amortYears", "Amortization (years)", "number"], ["dscrCovenant", "DSCR covenant (x)", "number"], ["debtYieldCovenantPct", "Debt-yield covenant (%)", "number"],
    ["recourse", "Recourse", "text"], ["guarantor", "Guarantor", "text"], ["notes", "Notes", "text"]],
  swap: [["counterparty", "Counterparty", "text"], ["notional", "Notional ($)", "number"], ["fixedSwapRatePct", "Fixed swap rate (%)", "number"], ["spreadBps", "Loan spread (bps)", "number"],
    ["allInFixedPct", "All-in fixed (%) — if stated", "number"], ["effectiveDate", "Effective", "date"], ["maturityDate", "Maturity", "date"], ["index", "Index", "text"], ["notes", "Notes", "text"]],
  date: [["date", "Date", "date"], ["type", "Type (Option notice / Kick-out / Co-tenancy / Termination / Other)", "text"], ["tenant", "Tenant", "text"], ["description", "What it is", "text"], ["owner", "Owner", "text"]],
};
function RecordEditor({ kind, deals, initial, onClose, onSaved }: { kind: "loan" | "swap" | "date"; deals: Deal[]; initial?: AmRecord | null; onClose: () => void; onSaved: () => void }) {
  const [dealId, setDealId] = useState(initial?.dealId ?? deals[0]?.id ?? "");
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS[kind].map(([k]) => [k, initial?.data[k] != null ? String(initial.data[k]) : ""])));
  const [note, setNote] = useState(initial?.sourceNote ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const data: Record<string, unknown> = {};
      for (const [k, , t] of FIELDS[kind]) if (vals[k]?.trim()) data[k] = t === "number" ? Number(vals[k].replace(/[$,%\s]/g, "")) : vals[k].trim();
      await apiAmSaveRecord({ id: initial?.id, kind, dealId, data, sourceNote: note || null });
      onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${initial ? "Edit" : "Add"} ${kind === "date" ? "critical date" : kind}`} onClose={onClose}>
      <label style={lbl}>Property
        <select value={dealId} onChange={e => setDealId(e.target.value)} style={inp}>{deals.map(d => <option key={d.id} value={d.id}>{d.propertyName}</option>)}</select>
      </label>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(200px,1fr))", gap: 10 }}>
        {FIELDS[kind].map(([k, label, t]) => (
          <label key={k} style={lbl}>{label}
            <input value={vals[k]} onChange={e => setVals(v => ({ ...v, [k]: e.target.value }))} type={t === "date" ? "date" : "text"} inputMode={t === "number" ? "decimal" : undefined} style={inp} />
          </label>
        ))}
      </div>
      <label style={lbl}>Source (where this came from)
        <input value={note} onChange={e => setNote(e.target.value)} placeholder="e.g. Loan summary in Drive, Derivative Advisors MTM 6/9/26" style={inp} />
      </label>
      {err && <div style={{ color: K.red, fontSize: 12.5 }}>{err}</div>}
      <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
        <button onClick={onClose} style={btn()}>Cancel</button>
        <button onClick={save} disabled={busy} style={btn(true)}>{busy ? "Saving…" : "Save"}</button>
      </div>
    </Modal>
  );
}
const lbl: React.CSSProperties = { display: "flex", flexDirection: "column", gap: 4, fontSize: 11.5, fontWeight: 600, color: K.gray };
const inp: React.CSSProperties = { border: "1px solid #d9d8d2", borderRadius: 8, padding: "8px 10px", fontSize: 14, color: K.ink, background: "#fff", minHeight: 36, fontFamily: "inherit" };
function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(35,36,34,.42)" }} />
      <div role="dialog" aria-label={title} style={{ position: "fixed", zIndex: 9501, left: "50%", top: "50%", transform: "translate(-50%,-50%)", width: "min(760px, 94vw)", maxHeight: "88vh", overflowY: "auto", background: "#fff", borderRadius: 14, padding: 18, display: "flex", flexDirection: "column", gap: 12, boxShadow: "0 20px 60px rgba(35,36,34,.3)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontFamily: "'Lora',serif", fontSize: 19, fontWeight: 600, color: K.ink }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ ...btn(), padding: "4px 10px" }}>✕</button>
        </div>
        {children}
      </div>
    </>
  );
}
function ImportBox({ onDone, onClose }: { onDone: () => void; onClose: () => void }) {
  const [text, setText] = useState("");
  const [plan, setPlan] = useState<AmImportResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const run = async (apply: boolean) => {
    setBusy(true); setErr(null);
    try { const r = await apiAmImport(text, apply); setPlan(r); if (apply) { onDone(); } } catch (e) { setErr(e instanceof Error ? e.message : "Import failed"); } finally { setBusy(false); }
  };
  return (
    <Modal title="Import loans, swaps and dates" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: K.gray, lineHeight: 1.5 }}>Paste JSON — <code>{`{"loans":[…],"swaps":[…],"dates":[…]}`}</code> — or CSV with a <code>kind</code> column (loan, swap, date). Each row names its property by <code>dealId</code>, Datex <code>bldgId</code>, or the exact property name, and can carry a <code>source</code>. Nothing is saved until you check the preview; re-importing the same file updates rows instead of duplicating them.</div>
      <textarea value={text} onChange={e => { setText(e.target.value); setPlan(null); }} rows={8} aria-label="Import data" style={{ ...inp, fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12.5, resize: "vertical" }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => run(false)} disabled={busy || text.trim().length < 5} style={btn()}>Preview</button>
        {plan && !plan.applied && plan.rows.length > 0 && <button onClick={() => run(true)} disabled={busy} style={btn(true)}>Save {plan.rows.length} row{plan.rows.length === 1 ? "" : "s"}</button>}
      </div>
      {err && <div style={{ color: K.red, fontSize: 12.5 }}>{err}</div>}
      {plan && (
        <div style={{ fontSize: 12.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{plan.applied ? "Saved." : "Preview:"} {plan.rows.filter(r => r.action === "create").length} new, {plan.rows.filter(r => r.action === "update").length} updated, {plan.rejected.length} rejected</div>
          {plan.rows.slice(0, 40).map(r => <div key={r.id} style={{ color: K.ink }}>{r.action === "create" ? "＋" : "↻"} {r.kind} · {r.property} · {String(r.data.lender ?? r.data.counterparty ?? r.data.type ?? "")} {r.data.maturityDate || r.data.date ? `· ${r.data.maturityDate ?? r.data.date}` : ""}</div>)}
          {plan.rejected.map(r => <div key={r.row} style={{ color: K.red }}>Row {r.row}: {r.problem}</div>)}
        </div>
      )}
    </Modal>
  );
}

// ── Debt tab ──────────────────────────────────────────────────────────────────
function DebtTab({ deals, records, rates, isAdmin, reload, onOpenDeal }: { deals: Deal[]; records: AmRecord[]; rates: RatesPayload | null; isAdmin: boolean; reload: () => void; onOpenDeal: (id: string) => void }) {
  const today = useMemo(() => new Date(), []);
  const rows = useMemo(() => buildDebtRows(records, deals, rates, today), [records, deals, rates, today]);
  const swaps = useMemo(() => buildSwapRows(records, new Map(deals.map(d => [d.id, d.propertyName || "—"])), rates, today), [records, deals, rates, today]);
  const tot = useMemo(() => debtTotals(rows, swaps), [rows, swaps]);
  const [edit, setEdit] = useState<{ kind: "loan" | "swap"; rec: AmRecord | null } | null>(null);
  const [imp, setImp] = useState(false);
  const maxWall = Math.max(1, ...tot.wall.map(w => w.amount));
  const curveAsOf = rates?.termSwapCurve?.asOf ?? null;
  const del = async (id: string) => { if (window.confirm("Delete this record?")) { await apiAmDeleteRecord(id); reload(); } };
  return (
    <>
      {isAdmin && (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
          <button style={btn(true)} onClick={() => setImp(true)}>Import loans & swaps</button>
          <button style={btn()} onClick={() => setEdit({ kind: "loan", rec: null })}>Add loan</button>
          <button style={btn()} onClick={() => setEdit({ kind: "swap", rec: null })}>Add swap</button>
        </div>
      )}
      {!rows.length ? (
        <div style={{ ...card, padding: 18, marginTop: 14, fontSize: 14, color: K.gray }}>No loans loaded yet. {isAdmin ? "Use “Import loans & swaps” to paste the seed JSON (or CSV)." : "An admin loads them from the loan summaries."} Datex's Loans table returns no rows through the connector today, so it can't seed this on its own.</div>
      ) : (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginTop: 14 }}>
            <Kpi label="Total debt" value={fmtM(tot.totalDebt)} sub={`${tot.loans} loan${tot.loans === 1 ? "" : "s"} · current balance, else original`} />
            <Kpi label="Weighted avg rate" value={fmtPct(tot.weightedRatePct, 3)} sub={`all-in · covers ${tot.rateCoveragePct}% of the debt`} />
            <Kpi label="Fixed or hedged" value={tot.pctFixedOrHedged == null ? "—" : `${tot.pctFixedOrHedged}%`} sub="of debt with a rate type" />
            <Kpi label="Swap mark-to-market" value={fmtM(tot.totalMtm)} sub={`indicative · 1M Term curve${curveAsOf ? ` ${fmtDate(curveAsOf)}` : ""}`} />
          </div>
          <SectionTitle>Maturity wall</SectionTitle>
          <div style={{ ...card, padding: "14px 14px 10px", display: "flex", alignItems: "flex-end", gap: 10, overflowX: "auto", minHeight: 150 }}>
            {tot.wall.map(w => (
              <div key={w.year} style={{ flex: "1 0 56px", textAlign: "center" }}>
                <div style={{ fontSize: 11.5, color: K.ink, fontVariantNumeric: "tabular-nums", marginBottom: 4 }}>{fmtM(w.amount)}</div>
                <div style={{ height: Math.max(6, Math.round((w.amount / maxWall) * 100)), background: w.year <= today.getFullYear() + 1 ? K.amber : K.charcoal, borderRadius: "4px 4px 0 0" }} />
                <div style={{ fontSize: 12, fontWeight: 700, color: K.charcoal, marginTop: 4 }}>{w.year}</div>
              </div>
            ))}
          </div>
          <SectionTitle>Loans</SectionTitle>
          <Table minWidth={1300}>
            <thead><tr>{["Property", "Lender", "Balance", "Type", "Index", "Spread", "All-in", "Maturity", "Extension", "Amort.", "Covenants", "Recourse / guarantor", "Source", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{rows.map((r: DebtRow) => (
              <tr key={r.record.id} style={{ opacity: r.superseded ? 0.5 : 1 }}>
                <td style={td}><button onClick={() => onOpenDeal(r.dealId)} style={linkBtn}>{r.property}</button>{r.superseded && <Src>Datex row — an entered loan covers this property</Src>}</td>
                <td style={td}>{r.lender ?? "—"}</td>
                <td style={num}>{fmtM(r.balance)}{r.balanceIsOriginal && <Src>original</Src>}</td>
                <td style={td}>{r.rateType ?? "—"}</td>
                <td style={td}>{r.index ?? "—"}</td>
                <td style={num}>{r.spreadBps != null ? `${r.spreadBps} bps` : "—"}</td>
                <td style={num}>{fmtPct(r.allInPct, 3)}<Src>{r.allInSource}</Src></td>
                <td style={td}>{fmtDate(r.maturity)} {daysPill(r.daysToMaturity, r.flag)}</td>
                <td style={td}>{String(r.record.data.extensionOptions ?? "—")}{r.record.data.extensionNoticeDate ? <Src>notice by {fmtDate(String(r.record.data.extensionNoticeDate))}</Src> : null}</td>
                <td style={td}>{String(r.record.data.amortization ?? "—")}{r.record.data.amortYears ? ` · ${r.record.data.amortYears}y` : ""}</td>
                <td style={td}>{[r.record.data.dscrCovenant ? `DSCR ${r.record.data.dscrCovenant}x` : null, r.record.data.debtYieldCovenantPct ? `DY ${r.record.data.debtYieldCovenantPct}%` : null].filter(Boolean).join(" · ") || "—"}</td>
                <td style={td}>{[r.record.data.recourse, r.record.data.guarantor].filter(Boolean).map(String).join(" · ") || "—"}</td>
                <td style={{ ...td, fontSize: 11.5, color: K.gray, maxWidth: 220 }}>{r.record.sourceNote ?? "—"}</td>
                <td style={td}>{isAdmin && <span style={{ display: "flex", gap: 6 }}><button style={miniBtn} onClick={() => setEdit({ kind: "loan", rec: r.record })}>Edit</button><button style={miniBtn} onClick={() => del(r.record.id)}>Delete</button></span>}</td>
              </tr>
            ))}</tbody>
          </Table>
        </>
      )}
      {swaps.length > 0 && (
        <>
          <SectionTitle>Swaps</SectionTitle>
          <Table minWidth={1150}>
            <thead><tr>{["Property", "Counterparty", "Notional", "Fixed swap", "All-in fixed", "Effective", "Maturity", "Market (remaining term)", "Mark-to-market", "Source", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{swaps.map((w: SwapRow) => (
              <tr key={w.record.id}>
                <td style={td}><button onClick={() => onOpenDeal(w.dealId)} style={linkBtn}>{w.property}</button></td>
                <td style={td}>{w.counterparty ?? "—"}</td>
                <td style={num}>{fmtM(w.notional)}</td>
                <td style={num}>{fmtPct(w.fixedSwapRatePct, 4)}</td>
                <td style={num}>{fmtPct(w.allInFixedPct, 4)}</td>
                <td style={td}>{fmtDate(w.effective)}</td>
                <td style={td}>{fmtDate(w.maturity)} {daysPill(w.daysToMaturity, w.flag)}</td>
                <td style={num}>{fmtPct(w.marketRatePct, 3)}<Src>{w.curve ?? "no curve"}{w.remainingYears != null ? ` · ${w.remainingYears}y left` : ""}</Src></td>
                <td style={{ ...num, color: w.mtm == null ? K.gray : w.mtm >= 0 ? "#3e8a2f" : K.red, fontWeight: 700 }}>{w.mtm == null ? "—" : `${w.mtm >= 0 ? "+" : "−"}${fmtM(Math.abs(w.mtm))}`}<Src>{w.mtmLabel}</Src></td>
                <td style={{ ...td, fontSize: 11.5, color: K.gray, maxWidth: 220 }}>{w.record.sourceNote ?? "—"}</td>
                <td style={td}>{isAdmin && <span style={{ display: "flex", gap: 6 }}><button style={miniBtn} onClick={() => setEdit({ kind: "swap", rec: w.record })}>Edit</button><button style={miniBtn} onClick={() => del(w.record.id)}>Delete</button></span>}</td>
              </tr>
            ))}</tbody>
          </Table>
          <Src>Mark-to-market is indicative: the fixed swap rate vs today's 1M Term SOFR swap rate for the remaining term (SOFR annual/annual for a Daily Simple SOFR swap), on the notional — the same engine as the deal page's breakage estimate. The bank's mark governs. Red = maturity under 12 months, amber = under 18.</Src>
        </>
      )}
      {edit && <RecordEditor kind={edit.kind} deals={deals} initial={edit.rec} onClose={() => setEdit(null)} onSaved={reload} />}
      {imp && <ImportBox onClose={() => setImp(false)} onDone={reload} />}
    </>
  );
}
const linkBtn: React.CSSProperties = { background: "none", border: "none", padding: 0, color: K.ink, fontWeight: 600, cursor: "pointer", textAlign: "left", fontSize: 13, fontFamily: "inherit", textDecoration: "underline", textDecorationColor: "#d9d8d2", textUnderlineOffset: 3 };
const miniBtn: React.CSSProperties = { background: "#fff", border: "1px solid #d9d8d2", borderRadius: 6, padding: "3px 8px", fontSize: 11.5, cursor: "pointer", color: K.charcoal };

// ── Dates tab ─────────────────────────────────────────────────────────────────
const TYPES: DateType[] = ["Lease expiry", "Option notice", "Termination / kick-out", "Co-tenancy", "Loan maturity", "Extension notice", "Swap maturity", "Other"];
export function DatesList({ items, onOpenDeal, compact = false }: { items: CriticalDate[]; onOpenDeal: (id: string) => void; compact?: boolean }) {
  const isMobile = useIsMobile();
  if (!items.length) return <div style={{ ...card, padding: 16, fontSize: 13.5, color: K.gray }}>Nothing in this window.</div>;
  return (
    <div style={{ ...card, overflow: "hidden" }}>
      {items.map((i, k) => (
        <div key={`${i.type}-${i.dealId}-${i.date}-${k}`} style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr auto" : compact ? "96px 64px 1fr auto" : "110px 70px 150px 1fr 200px", gap: 10, padding: "10px 14px", borderTop: k ? `1px solid #f3f2ee` : "none", alignItems: "start" }}>
          {!isMobile && <div style={{ fontVariantNumeric: "tabular-nums", fontSize: 13, color: K.ink }}>{fmtDate(i.date)}</div>}
          {!isMobile && <div>{daysPill(i.days)}</div>}
          {!isMobile && !compact && <div><Pill flag="gray">{i.type}</Pill></div>}
          <div style={{ minWidth: 0 }}>
            {isMobile && <div style={{ fontSize: 12, color: K.gray }}>{fmtDate(i.date)} · {i.type}</div>}
            <div style={{ fontSize: 13.5, color: K.ink }}><button onClick={() => onOpenDeal(i.dealId)} style={linkBtn}>{i.property}</button>{i.tenant ? ` · ${i.tenant}` : ""}{compact && !isMobile ? ` · ${i.type}` : ""}</div>
            {i.description && <div style={{ fontSize: 12.5, color: K.gray }}>{i.description}</div>}
            {!compact && <Src>{i.source}</Src>}
          </div>
          {isMobile ? <div>{daysPill(i.days)}</div> : !compact ? <div style={{ fontSize: 12.5, color: K.gray }}>{i.owner ?? "no owner on file"}</div> : null}
        </div>
      ))}
    </div>
  );
}
function DatesTab({ deals, records, abstracts, isAdmin, reload, onOpenDeal }: { deals: Deal[]; records: AmRecord[]; abstracts: LeaseAbstract[]; isAdmin: boolean; reload: () => void; onOpenDeal: (id: string) => void }) {
  const today = useMemo(() => new Date(), []);
  const { items, undatedRights } = useMemo(() => buildCriticalDates(deals, records, abstracts, today), [deals, records, abstracts, today]);
  const [prop, setProp] = useState("all"), [type, setType] = useState("all"), [hz, setHz] = useState(90);
  const [add, setAdd] = useState(false);
  const shown = items.filter(i => (prop === "all" || i.dealId === prop) && (type === "all" || i.type === type) && i.days <= hz && i.days >= 0);
  const undated = [...undatedRights.entries()].filter(([id]) => prop === "all" || id === prop);
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginTop: 6 }}>
        <select value={prop} onChange={e => setProp(e.target.value)} aria-label="Property" style={inp}><option value="all">All owned properties</option>{deals.map(d => <option key={d.id} value={d.id}>{d.propertyName}</option>)}</select>
        <select value={type} onChange={e => setType(e.target.value)} aria-label="Type" style={inp}><option value="all">All types</option>{TYPES.map(t => <option key={t}>{t}</option>)}</select>
        <div role="radiogroup" aria-label="Window" style={{ display: "inline-flex", border: "1px solid #d9d8d2", borderRadius: 8, overflow: "hidden" }}>
          {[30, 90, 180, 365].map(d => <button key={d} role="radio" aria-checked={hz === d} onClick={() => setHz(d)} style={{ padding: "7px 12px", minHeight: 34, border: "none", background: hz === d ? K.charcoal : "#fff", color: hz === d ? "#fff" : K.charcoal, fontSize: 12.5, fontWeight: 700, cursor: "pointer" }}>{d}d</button>)}
        </div>
        {isAdmin && <button style={btn()} onClick={() => setAdd(true)}>Add date</button>}
      </div>
      <SectionTitle>{shown.length} date{shown.length === 1 ? "" : "s"} in the next {hz} days</SectionTitle>
      <DatesList items={shown} onOpenDeal={onOpenDeal} />
      <Src>Lease expiries come from Datex (Tenants) where a snapshot is loaded, else the OM roster. Option notice dates come from the lease abstracts — Datex's option table is empty through the connector. Loan, extension and swap dates come from the Debt records.</Src>
      {undated.length > 0 && (
        <div style={{ ...card, padding: "10px 14px", marginTop: 12, fontSize: 12.5, color: K.ink }}>
          <b>Kick-out / co-tenancy rights without a calendar date:</b> {undated.map(([id, k]) => `${deals.find(d => d.id === id)?.propertyName ?? id} (${k})`).join(", ")}. These clauses carry thresholds and measurement periods, not dates — add the relevant dates by hand so they show up here.
        </div>
      )}
      {add && <RecordEditor kind="date" deals={deals} onClose={() => setAdd(false)} onSaved={reload} />}
    </>
  );
}

// ── Properties tab ────────────────────────────────────────────────────────────
function PropertiesTab({ deals, isAdmin, onOpenDeal }: { deals: Deal[]; isAdmin: boolean; onOpenDeal: (id: string) => void }) {
  const [map, setMap] = useState<DatexMapRow[] | null>(null);
  const [editMap, setEditMap] = useState(false);
  useEffect(() => { apiAmDatexMap().then(setMap).catch(() => setMap([])); }, []);
  const rows = deals.map(d => {
    const dx = (d as unknown as { datexLive?: Record<string, unknown> }).datexLive;
    const lt = liveTenants(d);
    const tie = dx?.glaTieOut as { ties: boolean | null; diffPct: number | null; rosterGLA: number } | undefined;
    const fin = dx?.financials as Record<string, number | string> | undefined;
    const ar = dx?.arAging as Record<string, number> | undefined;
    const rent = lt.source === "Datex" ? lt.tenants.reduce((t, x) => t + (x.annualRent ?? 0), 0) : null;
    return { d, dx, tie, fin, ar, rent, bldgs: map?.find(m => m.dealId === d.id)?.bldgIds ?? [] };
  });
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>{isAdmin && <button style={btn()} onClick={() => setEditMap(true)}>Datex building map</button>}</div>
      <SectionTitle>Today from Datex</SectionTitle>
      <Table minWidth={1050}>
        <thead><tr>{["Property", "Datex as of", "Occupancy", "In-place base rent", "NOI YTD vs budget", "A/R > 60 / > 90", "Asset manager"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(({ d, dx, tie, fin, ar, rent, bldgs }) => (
          <tr key={d.id}>
            <td style={td}><button onClick={() => onOpenDeal(d.id)} style={linkBtn}>{d.propertyName}</button><Src>{bldgs.length ? bldgs.join(", ") : "not mapped to Datex"}</Src></td>
            <td style={td}>{dx ? fmtDate(String(dx.asOf)) : <span style={{ color: K.gray }}>no snapshot</span>}</td>
            <td style={num}>{dx?.occupancyPct != null ? fmtPct(Number(dx.occupancyPct), 1) : "—"}{tie && tie.ties === false && <Src><span style={{ color: K.red }}>⚠ roster GLA {tie.rosterGLA.toLocaleString()} SF is {tie.diffPct}% off Occupancy's</span></Src>}</td>
            <td style={num}>{fmtM(rent)}</td>
            <td style={num}>{fin?.noiYtdActual != null ? fmtM(Number(fin.noiYtdActual)) : "—"}{fin?.noiYtdBudget != null && <Src>budget {fmtM(Number(fin.noiYtdBudget))} · {fin.noiYtdActual != null ? `${(((Number(fin.noiYtdActual) - Number(fin.noiYtdBudget)) / Math.abs(Number(fin.noiYtdBudget))) * 100).toFixed(1)}%` : ""} · to {String(fin.period ?? "")}</Src>}</td>
            <td style={num}>{ar ? `${fmtM(ar.over60 ?? null)} / ${fmtM(ar.over90 ?? null)}` : "—"}</td>
            <td style={td}>{String(dx?.assetManager ?? "—")}</td>
          </tr>
        ))}</tbody>
      </Table>
      <Src>Each owned deal page has the full live panel: rent roll, Underwritten vs Today, leasing activity, and tenant sales & occupancy cost. Datex can't be read by the server directly — a snapshot is generated in a Claude session and imported (Portfolio Analytics → Maintenance → Import Datex snapshot).</Src>
      {editMap && map && <DatexMapEditor deals={deals} rows={map} onClose={() => setEditMap(false)} onSaved={() => apiAmDatexMap().then(setMap)} />}
    </>
  );
}
function DatexMapEditor({ deals, rows, onClose, onSaved }: { deals: Deal[]; rows: DatexMapRow[]; onClose: () => void; onSaved: () => void }) {
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(deals.map(d => [d.id, (rows.find(r => r.dealId === d.id)?.bldgIds ?? []).join(", ")])));
  const [msg, setMsg] = useState<Record<string, string>>({});
  const save = async (d: Deal) => {
    try { await apiAmSaveDatexMap(d.id, vals[d.id].split(/[,\s]+/).filter(Boolean), rows.find(r => r.dealId === d.id)?.note ?? null); setMsg(m => ({ ...m, [d.id]: "saved" })); onSaved(); }
    catch (e) { setMsg(m => ({ ...m, [d.id]: e instanceof Error ? e.message : "failed" })); }
  };
  return (
    <Modal title="Datex building map" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: K.gray }}>Datex building ids are city-based (voorhees = Eagle Plaza, brunswic = Cooks Corner…), so the match is set here by hand — never by name. Leave blank for a property not in Datex yet. One property can have several buildings (Rockaway = rockcom, rockcrt, rockplz).</div>
      {deals.map(d => {
        const note = rows.find(r => r.dealId === d.id)?.note;
        return (
          <div key={d.id} style={{ display: "grid", gridTemplateColumns: "minmax(0,1fr) minmax(0,1fr) auto", gap: 8, alignItems: "center" }}>
            <div style={{ fontSize: 13 }}>{d.propertyName}{note && <Src>{note}</Src>}</div>
            <input value={vals[d.id] ?? ""} onChange={e => setVals(v => ({ ...v, [d.id]: e.target.value }))} aria-label={`Datex ids for ${d.propertyName}`} style={inp} />
            <span style={{ display: "flex", gap: 6, alignItems: "center" }}><button style={miniBtn} onClick={() => save(d)}>Save</button><span style={{ fontSize: 11, color: msg[d.id] === "saved" ? "#3e8a2f" : K.red }}>{msg[d.id]}</span></span>
          </div>
        );
      })}
    </Modal>
  );
}

// ── Credit Watch tab ──────────────────────────────────────────────────────────
function CreditTab({ deals, abstracts, onOpenDeal }: { deals: Deal[]; abstracts: LeaseAbstract[]; onOpenDeal: (id: string) => void }) {
  const wl = useWatchlist();
  const [news, setNews] = useState<NewsSignal[]>([]);
  const [scanning, setScanning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const [summary, setSummary] = useState<Record<string, string>>({});
  const base = useMemo(() => buildCreditWatch(deals, abstracts, [...wl.values()], []), [deals, abstracts, wl]);
  const top = useMemo(() => base.rows.slice(0, 60).map(r => r.brand), [base]);
  useEffect(() => {
    let alive = true, tries = 0;
    const go = async () => {
      if (!top.length) return;
      setScanning(true);
      try {
        let r = await apiAmCreditNews(top);
        // The server scans what fits in one request; keep asking (a few times) until done.
        while (alive && r.remaining > 0 && tries++ < 6) { setNews(r.signals); r = await apiAmCreditNews(top); }
        if (alive) setNews(r.signals);
      } catch { /* news is optional */ } finally { if (alive) setScanning(false); }
    };
    go();
    return () => { alive = false; };
  }, [top]);
  const { rows, totalRent, source } = useMemo(() => buildCreditWatch(deals, abstracts, [...wl.values()], news), [deals, abstracts, wl, news]);
  const flag = (s: CreditRow["status"]): "red" | "amber" | "green" | "gray" => s === "Bankruptcy" ? "red" : s === "Store closures announced" || s === "Watch" ? "amber" : "green";
  const summarize = async (brand: string) => { setSummary(m => ({ ...m, [brand]: "…" })); try { const s = await apiAmSummarizeNews(brand); setSummary(m => ({ ...m, [brand]: s })); } catch (e) { setSummary(m => ({ ...m, [brand]: e instanceof Error ? e.message : "failed" })); } };
  return (
    <>
      <SectionTitle right={<span style={{ fontSize: 12, color: K.gray }}>{scanning ? "checking headlines…" : `headlines checked daily for the top ${top.length} brands`}</span>}>{rows.length} brands · {fmtM(totalRent)} base rent</SectionTitle>
      <Table minWidth={900}>
        <thead><tr>{["Brand", "Our locations", "Annual base rent", "% of rent", "IG", "Status", "Latest distress headline", ""].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(r => (
          <>
            <tr key={r.key}>
              <td style={td}><button onClick={() => setOpen(o => o === r.key ? null : r.key)} style={linkBtn} aria-expanded={open === r.key}>{r.brand}</button></td>
              <td style={num}>{r.locations.length}</td>
              <td style={num}>{fmtM(r.rent)}</td>
              <td style={num}>{r.pctOfRent.toFixed(2)}%</td>
              <td style={td}>{r.ig ? <Pill flag="green">IG</Pill> : "—"}</td>
              <td style={td}><Pill flag={flag(r.status)}>{r.status}</Pill><Src>{r.statusSource}</Src></td>
              <td style={{ ...td, maxWidth: 320, fontSize: 12.5 }}>{r.news?.headline ? <a href={r.news.url ?? "#"} target="_blank" rel="noreferrer" style={{ color: K.ink }}>{r.news.headline}</a> : <span style={{ color: K.gray }}>{r.news?.scannedAt ? "none in the last 5 months" : "not checked yet"}</span>}{summary[r.brand] && <div style={{ marginTop: 4, color: K.charcoal }}>{summary[r.brand]}</div>}</td>
              <td style={td}>{r.news?.scannedAt && <button style={miniBtn} onClick={() => summarize(r.brand)}>Summarize</button>}</td>
            </tr>
            {open === r.key && (
              <tr key={r.key + "-x"}><td colSpan={8} style={{ ...td, background: "#fafaf7" }}>
                {r.locations.map(l => (
                  <div key={l.dealId + l.tenant} style={{ display: "flex", gap: 10, flexWrap: "wrap", padding: "4px 0", fontSize: 12.5 }}>
                    <button onClick={() => onOpenDeal(l.dealId)} style={linkBtn}>{l.property}</button>
                    <span>{l.tenant}{l.sf ? ` · ${Math.round(l.sf).toLocaleString()} SF` : ""}</span>
                    <span>rent at risk {fmtM(l.rent)}</span>
                    {l.isAnchor && <Pill flag="amber">anchor</Pill>}
                    {l.coTenancyTenants > 0 && <Pill flag="red">closure trips co-tenancy for {l.coTenancyTenants} tenant{l.coTenancyTenants === 1 ? "" : "s"} · {fmtM(l.coTenancyRentAtRisk)}</Pill>}
                  </div>
                ))}
              </td></tr>
            )}
          </>
        ))}</tbody>
      </Table>
      <Src>{source}. Status: the retailer watchlist first, then a free daily headline check (Google News: bankruptcy, Chapter 11, store closures, downgrades) — a headline is a prompt to confirm, never a verdict. "Summarize" makes one AI call for that brand only. Co-tenancy exposure uses each deal's lease-risk read: rent that trips if this anchor alone goes dark.</Src>
    </>
  );
}

// ── page ──────────────────────────────────────────────────────────────────────
export default function AssetMgmt({ deals, isAdmin, onOpenDeal, tab, onTab }: { deals: Deal[]; isAdmin: boolean; onOpenDeal: (id: string) => void; tab: AmTab; onTab: (t: AmTab) => void }) {
  const owned = useMemo(() => getOwnedProperties(deals).sort((a, b) => (a.propertyName || "").localeCompare(b.propertyName || "")), [deals]);
  const setTab = onTab;
  const { records, rates, abstracts, error, reload } = useAmData();
  return (
    <div style={{ maxWidth: 1320, margin: "0 auto", padding: "18px 28px 90px", boxSizing: "border-box", width: "100%" }} className="am-page">
      <style>{`@media (max-width: 640px) { .am-page { padding: 14px 16px 90px !important; } }`}</style>
      <h1 style={{ margin: 0, fontFamily: "'Lora',serif", fontWeight: 500, fontSize: 28, color: K.ink }}>Asset Management</h1>
      <div style={{ fontSize: 13.5, color: K.gray, marginTop: 4 }}>{owned.length} owned properties · KPR-owned only (Sold deals are excluded)</div>
      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${K.line}`, marginTop: 14, overflowX: "auto" }}>
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ background: "none", border: "none", padding: "10px 12px", minHeight: 40, fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 13, color: tab === id ? K.ink : K.gray, boxShadow: tab === id ? `inset 0 -3px 0 ${K.green}` : "none", cursor: "pointer", whiteSpace: "nowrap" }}>{label}</button>
        ))}
      </div>
      {error && <div style={{ color: K.red, fontSize: 13, marginTop: 10 }}>{error}</div>}
      {records == null ? <div style={{ color: K.gray, padding: 24 }}>Loading…</div> : (
        <>
          {tab === "debt" && <DebtTab deals={owned} records={records} rates={rates} isAdmin={isAdmin} reload={reload} onOpenDeal={onOpenDeal} />}
          {tab === "dates" && <DatesTab deals={owned} records={records} abstracts={abstracts} isAdmin={isAdmin} reload={reload} onOpenDeal={onOpenDeal} />}
          {tab === "properties" && <PropertiesTab deals={owned} isAdmin={isAdmin} onOpenDeal={onOpenDeal} />}
          {tab === "credit" && <CreditTab deals={owned} abstracts={abstracts} onOpenDeal={onOpenDeal} />}
        </>
      )}
    </div>
  );
}

// ── Deal-page panel (owned deals) ─────────────────────────────────────────────
export function OwnedDealPanel({ deal, onOpenDeal }: { deal: Deal; onOpenDeal: (id: string) => void }) {
  const { records, rates, abstracts } = useAmData(deal.status === "Owned");
  const [bench, setBench] = useState<AnalystTenantBenchmark[]>([]);
  useEffect(() => { apiLoadTenantBenchmarks().then(setBench).catch(() => {}); }, []);
  const today = useMemo(() => new Date(), []);
  if (deal.status !== "Owned") return null;
  const mine = (records ?? []).filter(r => r.dealId === deal.id);
  const debt = buildDebtRows(mine, [deal], rates, today);
  const dates = buildCriticalDates([deal], mine, abstracts.filter(a => a.dealId === deal.id), today, 365).items.filter(i => i.days >= 0).slice(0, 8);
  const cmp = omVsToday(deal);
  const sales = buildSalesRows(deal, bench);
  const dx = (deal as unknown as { datexLive?: Record<string, unknown> }).datexLive;
  const ar = dx?.arAging as { over60?: number; over90?: number; totalOpen?: number; byTenant?: Array<{ name: string; over60?: number; over90?: number }> } | undefined;
  const fin = dx?.financials as Record<string, number | string> | undefined;
  const leasing = (dx?.leasing as Array<Record<string, unknown>> | undefined) ?? [];
  const tie = dx?.glaTieOut as { ties: boolean | null; diffPct: number | null; rosterGLA: number; occupancyGLA: number | null } | undefined;
  const fmt = (v: number | null, u: string) => v == null ? "—" : u === "pct" ? `${v.toFixed(1)}%` : u === "sf" ? `${Math.round(v).toLocaleString()} SF` : fmtM(v);
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div style={{ ...card, padding: 14 }}>
        <div style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: K.charcoal }}>Underwritten (OM) vs Today (Datex)</div>
        {!dx ? <Src>No Datex snapshot loaded for this property yet.</Src> : (
          <>
            <Src>Datex as of {fmtDate(String(dx.asOf))}{dx.assetManager ? ` · asset manager ${dx.assetManager}` : ""}</Src>
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(150px,1fr))", gap: 8, marginTop: 8 }}>
              {cmp.map(c => (
                <div key={c.label} style={{ border: `1px solid ${K.line}`, borderRadius: 10, padding: "8px 10px" }}>
                  <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: ".05em", textTransform: "uppercase", color: K.gray }}>{c.label}</div>
                  <div style={{ fontSize: 16, fontVariantNumeric: "tabular-nums", color: K.ink, marginTop: 2 }}>{fmt(c.today, c.unit)}</div>
                  <div style={{ fontSize: 12, color: K.gray }}>OM {fmt(c.om, c.unit)}</div>
                  <Src>{c.todaySource}</Src>
                </div>
              ))}
            </div>
            {tie && tie.ties === false && <div style={{ color: K.red, fontSize: 12.5, marginTop: 8 }}>⚠ The Datex rent roll adds up to {tie.rosterGLA.toLocaleString()} SF but Occupancy reports {tie.occupancyGLA?.toLocaleString()} SF ({tie.diffPct}% apart) — check for missing or duplicate suites before trusting occupancy.</div>}
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10, fontSize: 13 }}>
              {fin?.noiYtdActual != null && <span><b>NOI YTD</b> {fmtM(Number(fin.noiYtdActual))} vs budget {fmtM(fin.noiYtdBudget != null ? Number(fin.noiYtdBudget) : null)} <span style={{ color: K.gray }}>(to {String(fin.period)})</span></span>}
              {ar && <span><b>A/R</b> over 60 days {fmtM(ar.over60 ?? null)} · over 90 {fmtM(ar.over90 ?? null)}{ar.byTenant?.length ? <span style={{ color: K.gray }}> · largest: {ar.byTenant.slice(0, 3).map(t => `${t.name} ${fmtM(t.over60 ?? null)}`).join(", ")}</span> : null}</span>}
            </div>
          </>
        )}
      </div>
      {dx && sales.rows.length > 0 && (
        <div style={{ ...card, padding: 14 }}>
          <div style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: K.charcoal }}>Tenant sales & occupancy cost</div>
          <Src>{sales.source}. Occupancy cost = base rent + recoveries + other ÷ 12-month sales; at risk over 12% (anchors) / 15% (shops). Benchmark = library median sales PSF for the brand.</Src>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
              <thead><tr>{["Tenant", "SF", "12-mo sales", "Sales PSF", "Period", "Occ. cost", "vs library", "Flags"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{sales.rows.map(r => (
                <tr key={r.tenant}>
                  <td style={td}>{r.tenant}{r.isAnchor && <Src>anchor</Src>}</td>
                  <td style={num}>{r.sf ? Math.round(r.sf).toLocaleString() : "—"}</td>
                  <td style={num}>{fmtM(r.sales12)}</td>
                  <td style={num}>{r.salesPSF != null ? `$${r.salesPSF.toFixed(0)}` : "—"}</td>
                  <td style={td}>{r.period ?? "—"}</td>
                  <td style={{ ...num, color: r.atRisk ? K.red : K.ink, fontWeight: r.atRisk ? 700 : 400 }}>{r.occCostPct != null ? `${r.occCostPct.toFixed(1)}%` : "—"}<Src>{r.occCostBasis}</Src></td>
                  <td style={num}>{r.vsBenchmarkPct != null ? `${r.vsBenchmarkPct > 0 ? "+" : ""}${r.vsBenchmarkPct.toFixed(0)}%` : "—"}{r.benchmarkN ? <Src>n={r.benchmarkN}</Src> : null}</td>
                  <td style={{ ...td, fontSize: 12, color: K.amber }}>{r.flags.join(" · ")}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        </div>
      )}
      {(debt.length > 0 || dates.length > 0 || leasing.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14 }}>
          {debt.length > 0 && (
            <div style={{ ...card, padding: 14 }}>
              <div style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: K.charcoal }}>Debt & swaps</div>
              {debt.filter(r => !r.superseded).map(r => (
                <div key={r.record.id} style={{ fontSize: 13, marginTop: 8 }}>
                  <b>{r.lender ?? "Loan"}</b> · {fmtM(r.balance)} · {fmtPct(r.allInPct, 3)} {r.rateType ?? ""} · matures {fmtDate(r.maturity)} {daysPill(r.daysToMaturity, r.flag)}
                  {r.swaps.map(w => <div key={w.record.id} style={{ fontSize: 12.5, color: K.gray }}>Swap {fmtM(w.notional)} at {fmtPct(w.fixedSwapRatePct, 4)} to {fmtDate(w.maturity)} · MTM {w.mtm == null ? "—" : `${w.mtm >= 0 ? "+" : "−"}${fmtM(Math.abs(w.mtm))}`} ({w.curve})</div>)}
                  <Src>{r.record.sourceNote ?? "no source noted"}</Src>
                </div>
              ))}
            </div>
          )}
          {dates.length > 0 && (
            <div style={{ ...card, padding: 14 }}>
              <div style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: K.charcoal, marginBottom: 8 }}>Next critical dates</div>
              <DatesList items={dates} onOpenDeal={onOpenDeal} compact />
            </div>
          )}
          {leasing.length > 0 && (
            <div style={{ ...card, padding: 14 }}>
              <div style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: K.charcoal }}>Recent leasing activity</div>
              <Src>Datex lease applications</Src>
              {leasing.slice(0, 8).map((l, i) => <div key={i} style={{ fontSize: 13, marginTop: 6 }}><b>{String(l.tenant)}</b>{l.suite ? ` · ${l.suite}` : ""}{l.gla ? ` · ${Number(l.gla).toLocaleString()} SF` : ""}{l.rentPSF ? ` · $${Number(l.rentPSF).toFixed(2)}/SF` : ""}<div style={{ fontSize: 12, color: K.gray }}>{String(l.stage ?? "")}{l.executed ? ` · executed ${fmtDate(String(l.executed))}` : l.submitted ? ` · submitted ${fmtDate(String(l.submitted))}` : ""}</div></div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Home "This week" card — the weekly digest (the app has no email system, so the Monday
//    digest lives on the home page). Next 90 days of owned-property critical dates, this
//    week's first. Owned deals only; nothing renders without any. ──
export function ThisWeekCard({ deals, onOpenDeal, onSeeAll }: { deals: Deal[]; onOpenDeal: (id: string) => void; onSeeAll: () => void }) {
  const owned = useMemo(() => getOwnedProperties(deals), [deals]);
  const { records, abstracts } = useAmData(owned.length > 0);
  const today = useMemo(() => new Date(), []);
  const monday = useMemo(() => { const m = new Date(today); m.setDate(m.getDate() - ((m.getDay() + 6) % 7)); return m; }, [today]);
  const items = useMemo(() => records == null ? [] : buildCriticalDates(owned, records, abstracts, today, 90).items.filter(i => i.days >= 0), [owned, records, abstracts, today]);
  if (!owned.length || records == null) return null;
  const thisWeek = items.filter(i => i.days <= 7).length;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 8 }}>
        <div style={{ fontSize: 13, color: K.gray }}>Week of {monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · {thisWeek} this week · {items.length} in the next 90 days</div>
        <button onClick={onSeeAll} style={{ ...miniBtn, padding: "5px 10px", minHeight: 30 }}>All critical dates →</button>
      </div>
      <DatesList items={items.slice(0, 8)} onOpenDeal={onOpenDeal} compact />
    </div>
  );
}
