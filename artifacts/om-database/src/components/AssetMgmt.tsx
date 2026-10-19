import { useEffect, useMemo, useState, type ReactNode } from "react";
import type { Deal, LeaseAbstract } from "../lib/idb";
import { getOwnedProperties } from "../lib/ownedPortfolio";
import {
  apiAmRecords, apiAmSaveRecord, apiAmDeleteRecord, apiAmImport, apiAmDatexMap, apiAmSaveDatexMap, apiAmCreditNews, apiAmSummarizeNews,
  apiGetRates, apiListAllLeaseAbstracts, apiLoadTenantBenchmarks, type RatesPayload, type AmImportResult, type DatexMapRow, type AnalystTenantBenchmark,
  apiDatexAutoTokens, apiDatexAutoCreateToken, apiDatexAutoRevokeToken, apiDatexAutoStatus, apiDatexAutoSetEnabled, type IngestTokenView, type IngestLogView, type AutoRefreshSettingView, type IngestAuditView,
} from "../lib/api";
import {
  buildDebtRows, buildSwapRows, debtTotals, buildPrefRows, prefTotals, buildCriticalDates, buildCreditWatch, buildSalesRows, omVsToday, liveTenants,
  type AmRecord, type DebtRow, type SwapRow, type PrefRow, type CriticalDate, type CreditRow, type NewsSignal, type DateType,
  datexGlaTieOut, splitArAging, noiVsBudget, propertyOwner, collapsePortfolioCovenants, keyDebtDeadlines,
} from "../lib/assetMgmt";
import { useWatchlist } from "../lib/useWatchlist";
import { useIsMobile } from "../hooks/use-mobile";

// ASSET MGMT (Eric, 10/18/26) — owned properties only. Debt · Dates · Properties · Credit Watch.
// Every number says where it came from and as of when; edit controls are admin-only.

export type AmTab = "debt" | "dates" | "properties" | "credit";
const TABS: Array<[AmTab, string]> = [["debt", "Debt"], ["dates", "Dates"], ["properties", "Properties"], ["credit", "Credit Watch"]];
export const K = { green: "#5BBA47", charcoal: "#383A37", ink: "#232422", gray: "#676767", page: "#FAF9F5", line: "#ecebe6", red: "#b3403f", amber: "#b3711a" };

export const fmtM = (v: number | null | undefined) => v == null ? "—" : Math.abs(v) >= 1e6 ? `$${(v / 1e6).toFixed(2)}M` : Math.abs(v) >= 1e3 ? `$${Math.round(v / 1e3).toLocaleString()}K` : `$${Math.round(v).toLocaleString()}`;
export const fmtPct = (v: number | null | undefined, d = 2) => v == null ? "—" : `${v.toFixed(d)}%`;
export const fmtDate = (iso: string | null | undefined) => iso ? new Date(iso.slice(0, 10) + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—";
export const card: React.CSSProperties = { background: "#fff", border: `1px solid ${K.line}`, borderRadius: 12, boxShadow: "0 1px 2px rgba(35,36,34,.04)" };
export const th: React.CSSProperties = { textAlign: "left", padding: "8px 10px", fontFamily: "'Montserrat',sans-serif", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: K.gray, borderBottom: `1px solid ${K.line}`, whiteSpace: "nowrap", position: "sticky", top: 0, background: "#fff" };
export const td: React.CSSProperties = { padding: "8px 10px", borderBottom: `1px solid #f3f2ee`, fontSize: 13, color: K.ink, verticalAlign: "top" };
export const num: React.CSSProperties = { ...td, textAlign: "right", fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };
export const btn = (primary = false): React.CSSProperties => ({ background: primary ? K.charcoal : "#fff", color: primary ? "#fff" : K.charcoal, border: `1px solid ${primary ? K.charcoal : "#d9d8d2"}`, borderRadius: 8, padding: "7px 12px", minHeight: 34, fontSize: 12.5, fontWeight: 700, cursor: "pointer", fontFamily: "'Montserrat',sans-serif" });

export function Pill({ flag, children }: { flag: "red" | "amber" | "green" | "gray"; children: ReactNode }) {
  const c = { red: ["#fdecec", K.red], amber: ["#fff2e0", K.amber], green: ["#eef7eb", "#3e8a2f"], gray: ["#f1f0ec", K.gray] }[flag];
  return <span style={{ display: "inline-block", background: c[0], color: c[1], borderRadius: 20, padding: "1px 8px", fontSize: 11, fontWeight: 700, whiteSpace: "nowrap" }}>{children}</span>;
}
export const daysPill = (days: number | null, flag?: "red" | "amber" | null) => days == null ? null : <Pill flag={flag ?? (days < 0 ? "gray" : days < 90 ? "red" : days < 180 ? "amber" : "gray")}>{days < 0 ? `${-days}d ago` : `${days}d`}</Pill>;
export function Src({ children }: { children: ReactNode }) { return <div style={{ fontSize: 11, color: K.gray, marginTop: 3, lineHeight: 1.35 }}>{children}</div>; }
export function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ ...card, padding: "12px 14px", minWidth: 0 }}>
      <div style={{ fontFamily: "'Roboto',sans-serif", fontVariantNumeric: "tabular-nums", fontSize: 22, fontWeight: 500, color: K.ink, whiteSpace: "nowrap" }}>{value}</div>
      <div style={{ fontFamily: "'Montserrat',sans-serif", fontSize: 11.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: K.charcoal, marginTop: 4 }}>{label}</div>
      {sub && <div style={{ fontSize: 12, color: K.gray, marginTop: 2 }}>{sub}</div>}
    </div>
  );
}
function Table({ children, minWidth = 900 }: { children: ReactNode; minWidth?: number }) {
  return <div style={{ ...card, overflowX: "auto" }}><table className="kpr-table" style={{ width: "100%", minWidth, borderCollapse: "collapse" }}>{children}</table></div>;
}
export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 10, flexWrap: "wrap", margin: "22px 0 10px" }}>
      <h2 style={{ margin: 0, fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 13, letterSpacing: ".12em", textTransform: "uppercase", color: K.charcoal }}>{children}</h2>
      {right}
    </div>
  );
}

// ── shared data hook ──────────────────────────────────────────────────────────
// One shared fetch for the whole app: the Asset Mgmt page, the owned deal page's Asset,
// Financing and Transaction tabs and the home card all read the same records, so they share
// a promise (kept 60 s) instead of each calling the server. reload() refreshes it for all.
type AmBundle = { records: AmRecord[]; rates: RatesPayload | null; abstracts: LeaseAbstract[]; error: string | null };
let amCache: { at: number; p: Promise<AmBundle> } | null = null;
const amListeners = new Set<() => void>();
function loadAm(force = false): Promise<AmBundle> {
  if (!force && amCache && Date.now() - amCache.at < 60_000) return amCache.p;
  const p = (async () => {
    const [rec, rates, abs] = await Promise.allSettled([apiAmRecords(), apiGetRates(), apiListAllLeaseAbstracts()]);
    return { records: rec.status === "fulfilled" ? rec.value : [], error: rec.status === "rejected" ? String((rec.reason as Error)?.message ?? rec.reason) : null,
      rates: rates.status === "fulfilled" ? rates.value : null, abstracts: abs.status === "fulfilled" ? abs.value : [] };
  })();
  amCache = { at: Date.now(), p };
  return p;
}
export function reloadAm() { amCache = null; amListeners.forEach(f => f()); }
export function useAmData(enabled = true) {
  const [b, setB] = useState<AmBundle | null>(null);
  const [nonce, setNonce] = useState(0);
  useEffect(() => { const f = () => setNonce(n => n + 1); amListeners.add(f); return () => { amListeners.delete(f); }; }, []);
  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    loadAm().then(x => alive && setB(x));
    return () => { alive = false; };
  }, [enabled, nonce]);
  return { records: b?.records ?? null, rates: b?.rates ?? null, abstracts: b?.abstracts ?? [], error: b?.error ?? null, reload: reloadAm };
}

// ── record editor (admin) ─────────────────────────────────────────────────────
const FIELDS: Record<"loan" | "swap" | "date" | "pref" | "covenant" | "acquisition", Array<[string, string, "text" | "number" | "date"]>> = {
  loan: [["lender", "Lender", "text"], ["originalBalance", "Original balance ($)", "number"], ["currentBalance", "Current balance ($)", "number"], ["balanceAsOf", "Balance as of", "date"],
    ["rateType", "Rate type (fixed / floating / swapped)", "text"], ["index", "Index (1M CME Term SOFR / Daily Simple SOFR)", "text"], ["spreadBps", "Spread (bps)", "number"], ["fixedRatePct", "Fixed rate (%) — fixed loans", "number"],
    ["allInRatePct", "All-in rate (%) — if stated", "number"], ["maturityDate", "Maturity", "date"], ["extensionOptions", "Extension options", "text"], ["extensionNoticeDate", "Extension notice deadline", "date"],
    ["amortization", "Amortization (IO / amortizing)", "text"], ["amortYears", "Amortization (years)", "number"], ["dscrCovenant", "DSCR covenant (x)", "number"], ["debtYieldCovenantPct", "Debt-yield covenant (%)", "number"],
    ["recourse", "Recourse", "text"], ["guarantor", "Guarantor", "text"], ["loanLabel", "Loan label (e.g. Town Court)", "text"],
    ["covenants", "Covenants", "text"], ["prepayment", "Prepayment", "text"], ["notes", "Notes", "text"], ["openQuestions", "Open questions", "text"], ["confidence", "Confidence", "text"]],
  swap: [["counterparty", "Counterparty", "text"], ["notional", "Notional ($)", "number"], ["fixedSwapRatePct", "Fixed swap rate (%)", "number"], ["spreadBps", "Loan spread (bps)", "number"],
    ["allInFixedPct", "All-in fixed (%) — if stated", "number"], ["effectiveDate", "Effective", "date"], ["maturityDate", "Maturity", "date"], ["index", "Index", "text"], ["loanLabel", "Loan label", "text"],
    ["notes", "Notes", "text"], ["openQuestions", "Open questions", "text"], ["confidence", "Confidence", "text"]],
  pref: [["investor", "Investor", "text"], ["loanLabel", "Label (e.g. Town Plaza)", "text"], ["amount", "Amount ($)", "number"], ["ratePct", "Pref rate (%)", "number"],
    ["currentPayPct", "Current pay (%)", "number"], ["accrualPct", "Accrual (%)", "number"], ["fundingDate", "Funded", "date"], ["maturityDate", "Maturity / redemption date", "date"],
    ["redemption", "Redemption terms", "text"], ["notes", "Notes", "text"], ["openQuestions", "Open questions", "text"], ["confidence", "Confidence", "text"]],
  covenant: [["type", "Type (DSCR / DY / LTV / cash sweep / cash trap / other)", "text"], ["threshold", "Threshold (x for DSCR, % for DY/LTV)", "number"], ["sweepBelow", "Cash sweep below (x)", "number"],
    ["testFrequency", "Test frequency (quarterly / annual)", "text"], ["firstTestDate", "First test date", "date"], ["testMonthDay", "Annual test day (MM-DD)", "text"], ["amortYears", "Test amortization (years)", "number"],
    ["testRatePct", "Test rate (%) — if not the loan rate", "number"], ["linkedTenant", "Linked tenant", "text"], ["triggerDate", "Trigger date", "date"], ["trigger", "Trigger / remedy", "text"], ["loanLabel", "Loan label", "text"], ["notes", "Notes", "text"]],
  acquisition: [["purchasePrice", "Purchase price ($)", "number"], ["closeDate", "Close date", "date"], ["seller", "Seller", "text"], ["kpPct", "KP ownership (%)", "number"], ["jvPartner", "JV partner", "text"],
    ["mzlEquity", "MZL equity ($)", "number"], ["kpMemberEquity", "KP member equity ($)", "number"], ["totalEquity", "Total equity ($)", "number"], ["noiAtPurchase", "NOI at purchase ($)", "number"],
    ["goingInCapPct", "Going-in cap (%)", "number"], ["budgetNoi", "Budget NOI ($)", "number"], ["budgetYear", "Budget year", "number"], ["assetManager", "Asset manager", "text"], ["notes", "Notes", "text"]],
  date: [["date", "Date", "date"], ["type", "Type (Option notice / Kick-out / Co-tenancy / Termination / Other)", "text"], ["tenant", "Tenant", "text"], ["description", "What it is", "text"], ["owner", "Owner", "text"]],
};
export function RecordEditor({ kind, deals, initial, onClose, onSaved, preset }: { kind: "loan" | "swap" | "date" | "pref" | "covenant" | "acquisition"; preset?: Record<string, unknown>; deals: Deal[]; initial?: AmRecord | null; onClose: () => void; onSaved: () => void }) {
  const [dealId, setDealId] = useState(initial?.dealId ?? deals[0]?.id ?? "");
  const [vals, setVals] = useState<Record<string, string>>(() => Object.fromEntries(FIELDS[kind].map(([k]) => { const v = initial?.data[k] ?? preset?.[k]; return [k, v != null ? String(v) : ""]; })));
  const [note, setNote] = useState(initial?.sourceNote ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      // Start from the stored record so keys the form doesn't show (Datex loan id…) survive an edit.
      const data: Record<string, unknown> = { ...(preset ?? {}), ...(initial?.data ?? {}) };
      delete data.termsPending;   // the server re-derives it from the terms
      for (const [k, , t] of FIELDS[kind]) { if (vals[k]?.trim()) data[k] = t === "number" ? Number(vals[k].replace(/[$,%\s]/g, "")) : vals[k].trim(); else delete data[k]; }
      await apiAmSaveRecord({ id: initial?.id, kind, dealId, data, sourceNote: note || null });
      onSaved(); onClose();
    } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save"); } finally { setBusy(false); }
  };
  return (
    <Modal title={`${initial ? "Edit" : "Add"} ${kind === "date" ? "critical date" : kind === "pref" ? "preferred equity" : kind === "acquisition" ? "acquisition details" : kind}`} onClose={onClose}>
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
export function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
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
/** Right-hand detail drawer (full screen on a phone). Escape or the backdrop closes it. */
export function SideDrawer({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  useEffect(() => { const f = (e: KeyboardEvent) => e.key === "Escape" && onClose(); window.addEventListener("keydown", f); return () => window.removeEventListener("keydown", f); }, [onClose]);
  return (
    <>
      <div onClick={onClose} style={{ position: "fixed", inset: 0, zIndex: 9500, background: "rgba(35,36,34,.32)" }} />
      <aside role="dialog" aria-label={title} style={{ position: "fixed", zIndex: 9501, top: 0, right: 0, bottom: 0, width: "min(520px, 100vw)", overflowY: "auto", background: "#fff", padding: "16px 18px 28px", boxShadow: "-12px 0 40px rgba(35,36,34,.22)", boxSizing: "border-box" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 10, marginBottom: 10 }}>
          <div style={{ fontFamily: "'Lora',serif", fontSize: 19, fontWeight: 600, color: K.ink, minWidth: 0, overflowWrap: "anywhere" }}>{title}</div>
          <button onClick={onClose} aria-label="Close" style={{ ...btn(), padding: "4px 10px", flex: "none" }}>✕</button>
        </div>
        {children}
      </aside>
    </>
  );
}
function Field({ k, v }: { k: string; v: ReactNode }) {
  if (v == null || v === "" || v === "—") return null;
  return <div style={{ padding: "7px 0", borderBottom: `1px solid #f3f2ee` }}><div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: K.gray }}>{k}</div><div style={{ fontSize: 13.5, color: K.ink, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{v}</div></div>;
}
const RATE_CLASS_LABEL = { fixed: "Fixed", swapped: "Swapped", capped: "Floating · capped", floating: "Floating" } as const;
const ell: React.CSSProperties = { ...td, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", verticalAlign: "middle" };
function LoanDrawer({ r, isAdmin, onClose, onEdit, onDelete, onOpenDeal }: { r: DebtRow; isAdmin: boolean; onClose: () => void; onEdit: () => void; onDelete: () => void; onOpenDeal: (id: string) => void }) {
  const d = r.record.data;
  const known = new Set(["lender", "loanName", "loanLabel", "originalBalance", "currentBalance", "balanceAsOf", "rateType", "index", "spreadBps", "fixedRatePct", "allInRatePct", "originationDate", "maturityDate", "extensionOptions", "extensionNoticeDate", "amortization", "amortYears", "ioUntil", "amortizationText", "dscrCovenant", "debtYieldCovenantPct", "recourse", "guarantor", "covenants", "prepayment", "notes", "openQuestions", "confidence", "datexLoanId"]);
  const extras = Object.entries(d).filter(([k, v]) => !known.has(k) && v != null && typeof v !== "object" && String(v).trim() !== "");
  return (
    <SideDrawer title={`${r.property}${r.loanLabel ? ` · ${r.loanLabel}` : ""}`} onClose={onClose}>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 6 }}>
        <button style={btn()} onClick={() => onOpenDeal(r.dealId)}>Open deal</button>
        {isAdmin && <><button style={btn()} onClick={onEdit}>Edit</button><button style={btn()} onClick={onDelete}>Delete</button></>}
      </div>
      <Field k="Lender" v={r.lender} />
      <Field k="Loan name" v={s(d.loanName)} />
      <Field k="Balance" v={`${fmtM(r.balance)}${r.balanceIsOriginal ? " (original)" : ""}${d.balanceAsOf ? ` as of ${fmtDate(String(d.balanceAsOf))}` : ""}`} />
      <Field k="Original balance" v={d.originalBalance != null ? fmtM(Number(d.originalBalance)) : null} />
      <Field k="Rate" v={r.rateClass ? RATE_CLASS_LABEL[r.rateClass] : r.rateType} />
      <Field k="Index" v={r.index} />
      <Field k="Spread" v={r.spreadBps != null ? `${r.spreadBps} bps` : null} />
      <Field k="Index floor" v={r.floorPct != null ? `${r.floorPct.toFixed(2)}%` : null} />
      <Field k="All-in" v={r.allInPct != null ? `${fmtPct(r.allInPct, 3)} — ${r.allInSource}` : r.allInSource} />
      <Field k="Rate caps" v={r.caps.length ? r.caps.map(c => `${c.notional ? fmtM(c.notional) + " " : ""}@ ${c.strikePct.toFixed(2)}%${c.expiry ? ` to ${fmtDate(c.expiry)}` : ""}${c.expiry && c.expiry < new Date().toISOString().slice(0, 10) ? " (expired)" : ""}`).join("\n") + (r.cappedMaxPct != null ? `\nCapped max all-in ${fmtPct(r.cappedMaxPct, 3)}` : "") : null} />
      <Field k="Fixed rate" v={d.fixedRatePct != null ? fmtPct(Number(d.fixedRatePct), 3) : null} />
      <Field k="Swaps" v={r.swaps.length ? r.swaps.map(w => w.termsPending ? `Swap${w.counterparty ? ` with ${w.counterparty}` : ""} — terms pending` : `${fmtM(w.notional)} at ${fmtPct(w.fixedSwapRatePct, 4)} to ${fmtDate(w.maturity)}`).join("\n") : null} />
      <Field k="Originated" v={d.originationDate ? fmtDate(String(d.originationDate)) : null} />
      <Field k="Maturity" v={r.maturity ? `${fmtDate(r.maturity)}${r.daysToMaturity != null ? ` (${r.daysToMaturity < 0 ? `${-r.daysToMaturity} days ago` : `${r.daysToMaturity} days`})` : ""}` : null} />
      <Field k="Extension options" v={s(d.extensionOptions)} />
      <Field k="Extension notice" v={d.extensionNoticeDate ? fmtDate(String(d.extensionNoticeDate)) : null} />
      <Field k="Amortization" v={[s(d.amortization), d.amortYears ? `${d.amortYears}-yr` : null, d.ioUntil ? `IO to ${fmtDate(String(d.ioUntil))}` : null].filter(Boolean).join(" · ") || null} />
      <Field k="Amortization terms" v={s(d.amortizationText)} />
      <Field k="Covenants" v={[s(d.covenants), d.dscrCovenant ? `DSCR ${d.dscrCovenant}x` : null, d.debtYieldCovenantPct ? `Debt yield ${d.debtYieldCovenantPct}%` : null].filter(Boolean).join("\n") || null} />
      <Field k="Prepayment" v={s(d.prepayment)} />
      <Field k="Recourse" v={s(d.recourse)} />
      <Field k="Guarantor" v={s(d.guarantor)} />
      <Field k="Notes" v={s(d.notes)} />
      <Field k="Open questions" v={s(d.openQuestions)} />
      <Field k="Confidence" v={s(d.confidence)} />
      {extras.map(([k, v]) => <Field key={k} k={k.replace(/([a-z])([A-Z])/g, "$1 $2")} v={String(v)} />)}
      <Src>Source: {r.record.sourceNote ?? "none noted"}{r.record.updatedBy ? ` · last saved by ${r.record.updatedBy}` : ""}{r.record.updatedAt ? ` ${fmtDate(r.record.updatedAt)}` : ""}</Src>
    </SideDrawer>
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
      <div style={{ fontSize: 12.5, color: K.gray, lineHeight: 1.5 }}>Paste JSON — <code>{`{"loans":[…],"swaps":[…],"dates":[…],"preferredEquity":[…]}`}</code> — or CSV with a <code>kind</code> column (loan, swap, date, pref). A swap without notional or maturity saves as "terms pending". Each row names its property by <code>dealId</code>, Datex <code>bldgId</code>, or the exact property name, and can carry a <code>source</code>. Nothing is saved until you check the preview; re-importing the same file updates rows instead of duplicating them.</div>
      <textarea value={text} onChange={e => { setText(e.target.value); setPlan(null); }} rows={8} aria-label="Import data" style={{ ...inp, fontFamily: "ui-monospace,Menlo,monospace", fontSize: 12.5, resize: "vertical" }} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button onClick={() => run(false)} disabled={busy || text.trim().length < 5} style={btn()}>Preview</button>
        {plan && !plan.applied && plan.rows.length > 0 && <button onClick={() => run(true)} disabled={busy} style={btn(true)}>Save {plan.rows.length} row{plan.rows.length === 1 ? "" : "s"}</button>}
      </div>
      {err && <div style={{ color: K.red, fontSize: 12.5 }}>{err}</div>}
      {plan && (
        <div style={{ fontSize: 12.5 }}>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>{plan.applied ? "Saved." : "Preview:"} {plan.rows.filter(r => r.action === "create").length} new, {plan.rows.filter(r => r.action === "update").length} updated, {plan.rejected.length} rejected</div>
          {plan.rows.slice(0, 40).map(r => (
            <div key={r.id} style={{ color: K.ink, padding: "3px 0", borderTop: `1px solid ${K.line}` }}>
              <div>{r.action === "create" ? "＋ new" : "↻ update"} · {r.kind === "pref" ? "preferred equity" : r.kind}{r.data.termsPending ? " (terms pending)" : ""} · {r.property}{r.data.swapLabel ? ` · ${r.data.swapLabel}` : r.data.loanLabel ? ` · ${r.data.loanLabel}` : ""} · {String(r.data.lender ?? r.data.counterparty ?? r.data.investor ?? r.data.type ?? "")} {r.data.maturityDate || r.data.date ? `· ${r.data.maturityDate ?? r.data.date}` : ""}</div>
              {r.action === "update" && (r.changes?.length
                ? <div style={{ paddingLeft: 14, color: K.gray, fontVariantNumeric: "tabular-nums" }}>{r.changes.map(c => (
                    <span key={c.field} style={{ display: "inline-block", marginRight: 12 }}>{c.label}: <s>{fmtChange(c.field, c.from)}</s> → <b style={{ color: K.ink }}>{fmtChange(c.field, c.to)}</b></span>))}</div>
                : <div style={{ paddingLeft: 14, color: K.gray }}>no field changes</div>)}
              {r.matchNote && <div style={{ paddingLeft: 14, color: K.amber }}>{r.matchNote}</div>}
            </div>
          ))}
          {plan.rejected.map(r => <div key={r.row} style={{ color: K.red }}>Row {r.row}: {r.problem}</div>)}
        </div>
      )}
    </Modal>
  );
}

// ── Debt tab ──────────────────────────────────────────────────────────────────
const LOAN_COLS = ["Property", "Lender", "Balance", "Rate", "All-in", "Maturity", "Extension", "Recourse"];
const SWAP_COLS = ["Property", "Counterparty", "Notional", "Fixed swap", "All-in fixed", "Effective", "Maturity", "Market (remaining term)", "Mark-to-market", "Source", ""];
const PREF_COLS = ["Property", "Investor", "Amount", "Pref rate", "Maturity", "Source", ""];
const s = (v: unknown): string | null => (v == null || String(v).trim() === "" ? null : String(v));
export function Clamp({ children }: { children: ReactNode }) {
  return <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden", fontSize: 12.5 }}>{children}</div>;
}
export function RowActions({ isOpen, onToggle, isAdmin, onEdit, onDelete }: { isOpen: boolean; onToggle: () => void; isAdmin: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <span style={{ display: "flex", gap: 6 }}>
      <button style={miniBtn} onClick={onToggle} aria-expanded={isOpen}>{isOpen ? "Hide" : "Details"}</button>
      {isAdmin && <><button style={miniBtn} onClick={onEdit}>Edit</button><button style={miniBtn} onClick={onDelete}>Delete</button></>}
    </span>
  );
}
export function DetailRow({ cols, rec, items }: { cols: number; rec: AmRecord; items: Array<[string, string | null]> }) {
  const shown = items.filter(([, v]) => v);
  return (
    <tr><td colSpan={cols} style={{ ...td, background: "#faf9f5" }}>
      <div style={{ position: "sticky", left: 0, paddingLeft: 4, maxWidth: "min(1100px, 82vw)", boxSizing: "border-box" }}>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(240px,1fr))", gap: "8px 18px" }}>
          {shown.length ? shown.map(([k, v]) => (
            <div key={k}><div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: K.gray }}>{k}</div><div style={{ fontSize: 13, color: K.ink, whiteSpace: "pre-wrap" }}>{v}</div></div>
          )) : <div style={{ fontSize: 13, color: K.gray }}>No notes, open questions or confidence recorded.</div>}
        </div>
        <Src>Source: {rec.sourceNote ?? "none noted"}{rec.updatedBy ? ` · last saved by ${rec.updatedBy}` : ""}{rec.updatedAt ? ` ${fmtDate(rec.updatedAt)}` : ""}</Src>
      </div>
    </td></tr>
  );
}
function DebtTab({ deals, records, rates, isAdmin, reload, onOpenDeal }: { deals: Deal[]; records: AmRecord[]; rates: RatesPayload | null; isAdmin: boolean; reload: () => void; onOpenDeal: (id: string) => void }) {
  const today = useMemo(() => new Date(), []);
  const rows = useMemo(() => buildDebtRows(records, deals, rates, today), [records, deals, rates, today]);
  const swaps = useMemo(() => buildSwapRows(records, new Map(deals.map(d => [d.id, d.propertyName || "—"])), rates, today), [records, deals, rates, today]);
  const tot = useMemo(() => debtTotals(rows, swaps), [rows, swaps]);
  const prefs = useMemo(() => buildPrefRows(records, deals, today), [records, deals, today]);
  const pt = useMemo(() => prefTotals(prefs), [prefs]);
  const [open, setOpen] = useState<Set<string>>(() => new Set());
  const toggle = (id: string) => setOpen(o => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const [edit, setEdit] = useState<{ kind: "loan" | "swap" | "pref"; rec: AmRecord | null } | null>(null);
  const [imp, setImp] = useState(false);
  const [drawer, setDrawer] = useState<string | null>(null);
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
            <Kpi label="Weighted avg rate" value={fmtPct(tot.weightedRatePct, 3)} sub={`all-in · covers ${tot.rateCoveragePct}% of the debt${tot.byClass.estimatedLoans ? ` · ${tot.byClass.estimatedLoans} floating loan${tot.byClass.estimatedLoans === 1 ? "" : "s"} est. from today's curve` : ""}`} />
            <Kpi label="Fixed / swapped · capped · floating" value={tot.byClass.fixedOrSwappedPct == null ? "—" : `${tot.byClass.fixedOrSwappedPct}% · ${tot.byClass.cappedPct ?? 0}% · ${tot.byClass.floatingPct ?? 0}%`} sub={tot.pctFixedOrHedged == null ? "of debt with a rate type" : `${tot.pctFixedOrHedged}% fixed or hedged (a live rate cap counts as hedged)`} />
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
          <div style={{ ...card, overflowX: "auto" }}>
            <table className="kpr-table" style={{ width: "100%", minWidth: 860, borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup><col style={{ width: "22%" }} /><col style={{ width: "13%" }} /><col style={{ width: 92 }} /><col style={{ width: "12%" }} /><col style={{ width: 82 }} /><col style={{ width: 150 }} /><col style={{ width: "12%" }} /><col style={{ width: "14%" }} /></colgroup>
              <thead><tr>{LOAN_COLS.map(h => <th key={h} style={{ ...th, position: "static" }}>{h}</th>)}</tr></thead>
              <tbody>{rows.map((r: DebtRow) => {
                const d = r.record.data;
                const recourse = [d.recourse, d.guarantor].filter(Boolean).map(String).join(" · ") || "—";
                return (
                  <tr key={r.record.id} onClick={() => setDrawer(r.record.id)} tabIndex={0} onKeyDown={e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setDrawer(r.record.id); } }} style={{ opacity: r.superseded ? 0.5 : 1, cursor: "pointer", height: 42 }} title="Click for every field">
                    <td style={ell}><span style={{ fontWeight: 600 }}>{r.property}</span>{r.loanLabel && <span style={{ color: K.gray }}> · {r.loanLabel}</span>}{r.superseded && <span style={{ color: K.gray }}> · Datex row (superseded)</span>}</td>
                    <td style={ell} title={r.lender ?? undefined}>{r.lender ?? "—"}</td>
                    <td style={{ ...num, verticalAlign: "middle" }}>{fmtM(r.balance)}{r.balanceIsOriginal ? "*" : ""}</td>
                    <td style={ell}>{r.rateClass ? RATE_CLASS_LABEL[r.rateClass] : r.rateType ?? "—"}{r.spreadBps != null && r.rateClass !== "fixed" ? <span style={{ color: K.gray }}> +{r.spreadBps}</span> : null}</td>
                    <td style={{ ...num, verticalAlign: "middle" }} title={r.allInSource}>{fmtPct(r.allInPct, 2)}{r.estimated ? <span style={{ color: K.amber }} aria-label="estimated from today's curve">~</span> : null}</td>
                    <td style={ell}>{fmtDate(r.maturity)} {daysPill(r.daysToMaturity, r.flag)}</td>
                    <td style={ell} title={s(d.extensionOptions) ?? undefined}>{String(d.extensionOptions ?? "—")}</td>
                    <td style={ell} title={recourse}>{recourse}</td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
          <Src>One line per loan — tap a row for every field (covenants, prepayment, caps, notes, source). <span style={{ color: K.amber }}>~</span> = floating all-in estimated from today's 1M Term SOFR (max of the curve and the loan's index floor, plus spread; a live rate cap limits it). * = original balance (no current balance on file).</Src>
          {(() => { const r = rows.find(x => x.record.id === drawer); return r ? <LoanDrawer r={r} isAdmin={isAdmin} onClose={() => setDrawer(null)} onEdit={() => { setDrawer(null); setEdit({ kind: "loan", rec: r.record }); }} onDelete={() => { setDrawer(null); void del(r.record.id); }} onOpenDeal={onOpenDeal} /> : null; })()}
        </>
      )}
      {swaps.length > 0 && (
        <>
          <SectionTitle>Swaps</SectionTitle>
          <Table minWidth={1150}>
            <thead><tr>{SWAP_COLS.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
            <tbody>{swaps.map((w: SwapRow) => {
              const d = w.record.data, isOpen = open.has(w.record.id);
              return [
                <tr key={w.record.id}>
                  <td style={td}><button onClick={() => onOpenDeal(w.dealId)} style={linkBtn}>{w.property}</button>{w.loanLabel && <span style={{ color: K.charcoal, fontWeight: 600 }}> · {w.loanLabel}</span>}{w.termsPending && <div style={{ marginTop: 3 }}><Pill flag="amber">terms pending</Pill></div>}</td>
                  <td style={td}>{w.counterparty ?? "—"}</td>
                  <td style={num}>{fmtM(w.notional)}</td>
                  <td style={num}>{fmtPct(w.fixedSwapRatePct, 4)}</td>
                  <td style={num}>{fmtPct(w.allInFixedPct, 4)}</td>
                  <td style={td}>{fmtDate(w.effective)}</td>
                  <td style={td}>{fmtDate(w.maturity)} {daysPill(w.daysToMaturity, w.flag)}</td>
                  <td style={num}>{fmtPct(w.marketRatePct, 3)}<Src>{w.termsPending ? "not priced" : `${w.curve ?? "no curve"}${w.remainingYears != null ? ` · ${w.remainingYears}y left` : ""}`}</Src></td>
                  <td style={{ ...num, color: w.mtm == null ? K.gray : w.mtm >= 0 ? "#3e8a2f" : K.red, fontWeight: 700 }}>{w.mtm == null ? "—" : `${w.mtm >= 0 ? "+" : "−"}${fmtM(Math.abs(w.mtm))}`}<Src>{w.mtmLabel}</Src></td>
                  <td style={{ ...td, fontSize: 11.5, color: K.gray, maxWidth: 220 }}>{w.record.sourceNote ?? "—"}</td>
                  <td style={td}><RowActions isOpen={isOpen} onToggle={() => toggle(w.record.id)} isAdmin={isAdmin} onEdit={() => setEdit({ kind: "swap", rec: w.record })} onDelete={() => del(w.record.id)} /></td>
                </tr>,
                isOpen && <DetailRow key={w.record.id + ":d"} cols={SWAP_COLS.length} rec={w.record} items={[["Notes", s(d.notes)], ["Open questions", s(d.openQuestions)], ["Confidence", s(d.confidence)], ["Index", s(d.index)], ["Trade date", d.tradeDate ? fmtDate(String(d.tradeDate)) : null]]} />,
              ];
            })}</tbody>
          </Table>
          <Src>Mark-to-market is indicative: the fixed swap rate vs today's 1M Term SOFR swap rate for the remaining term (SOFR annual/annual for a Daily Simple SOFR swap), on the notional — the same engine as the deal page's breakage estimate. The bank's mark governs. "Terms pending" = the hedge exists but its notional, rate or maturity isn't documented yet, so it is shown but left out of the mark-to-market. Red = maturity under 12 months, amber = under 18.</Src>
        </>
      )}
      {(prefs.length > 0 || isAdmin) && (
        <>
          <SectionTitle right={isAdmin ? <button style={btn()} onClick={() => setEdit({ kind: "pref", rec: null })}>Add preferred equity</button> : undefined}>Preferred equity</SectionTitle>
          {!prefs.length ? <div style={{ ...card, padding: 14, fontSize: 13.5, color: K.gray }}>None entered. Preferred equity is capital, not debt, so it is kept out of total debt and the weighted rate above.</div> : (
            <>
              <div style={{ fontSize: 13, color: K.gray, marginBottom: 8 }}>{fmtM(pt.total)} across {pt.count} position{pt.count === 1 ? "" : "s"}{pt.weightedRatePct != null ? ` · weighted pref rate ${fmtPct(pt.weightedRatePct, 2)}` : ""} — kept out of total debt and the weighted rate above.</div>
              <Table minWidth={900}>
                <thead><tr>{PREF_COLS.map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
                <tbody>{prefs.map((p: PrefRow) => {
                  const d = p.record.data, isOpen = open.has(p.record.id);
                  return [
                    <tr key={p.record.id}>
                      <td style={td}><button onClick={() => onOpenDeal(p.dealId)} style={linkBtn}>{p.property}</button>{p.loanLabel && <span style={{ color: K.charcoal, fontWeight: 600 }}> · {p.loanLabel}</span>}</td>
                      <td style={td}>{p.investor ?? "—"}</td>
                      <td style={num}>{fmtM(p.amount)}</td>
                      <td style={num}>{fmtPct(p.ratePct, 2)}{d.currentPayPct != null || d.accrualPct != null ? <Src>{[d.currentPayPct != null ? `${d.currentPayPct}% current` : null, d.accrualPct != null ? `${d.accrualPct}% accrues` : null].filter(Boolean).join(" · ")}</Src> : null}</td>
                      <td style={td}>{fmtDate(p.maturity)} {daysPill(p.daysToMaturity)}</td>
                      <td style={{ ...td, fontSize: 11.5, color: K.gray, maxWidth: 220 }}>{p.record.sourceNote ?? "—"}</td>
                      <td style={td}><RowActions isOpen={isOpen} onToggle={() => toggle(p.record.id)} isAdmin={isAdmin} onEdit={() => setEdit({ kind: "pref", rec: p.record })} onDelete={() => del(p.record.id)} /></td>
                    </tr>,
                    isOpen && <DetailRow key={p.record.id + ":d"} cols={PREF_COLS.length} rec={p.record} items={[["Redemption", s(d.redemption)], ["Funded", d.fundingDate ? fmtDate(String(d.fundingDate)) : null], ["Notes", s(d.notes)], ["Open questions", s(d.openQuestions)], ["Confidence", s(d.confidence)]]} />,
                  ];
                })}</tbody>
              </Table>
            </>
          )}
        </>
      )}
      {edit && <RecordEditor kind={edit.kind} deals={deals} initial={edit.rec} onClose={() => setEdit(null)} onSaved={reload} />}
      {imp && <ImportBox onClose={() => setImp(false)} onDone={reload} />}
    </>
  );
}
export const linkBtn: React.CSSProperties = { background: "none", border: "none", padding: 0, color: K.ink, fontWeight: 600, cursor: "pointer", textAlign: "left", fontSize: 13, fontFamily: "inherit", textDecoration: "underline", textDecorationColor: "#d9d8d2", textUnderlineOffset: 3 };
export const miniBtn: React.CSSProperties = { background: "#fff", border: "1px solid #d9d8d2", borderRadius: 6, padding: "3px 8px", fontSize: 11.5, cursor: "pointer", color: K.charcoal };

// ── Dates tab ─────────────────────────────────────────────────────────────────
const TYPES: DateType[] = ["Lease expiry", "Option notice", "Termination / kick-out", "Co-tenancy", "Covenant test", "Covenant trigger", "Loan maturity", "Extension notice", "Swap maturity", "Other"];
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
            <div style={{ fontSize: 13.5, color: K.ink }}><button onClick={() => onOpenDeal(i.dealId)} style={linkBtn} title={(i as { properties?: string[] }).properties?.join(", ")}>{i.property}</button>{i.tenant ? ` · ${i.tenant}` : ""}{compact && !isMobile ? ` · ${i.type}` : ""}</div>
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
  const shown = collapsePortfolioCovenants(items.filter(i => (prop === "all" || i.dealId === prop) && (type === "all" || i.type === type) && i.days <= hz && i.days >= 0), records, deals);
  const keyDebt = useMemo(() => keyDebtDeadlines(deals, records, today).filter(x => prop === "all" || x.dealIds.includes(prop)), [deals, records, today, prop]);
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
      {keyDebt.length > 0 && (
        <>
          <SectionTitle>Key debt deadlines</SectionTitle>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(250px,1fr))", gap: 10 }}>
            {keyDebt.map((x, k) => (
              <div key={k} style={{ ...card, padding: "10px 12px", borderLeft: `4px solid ${x.days < 90 ? K.red : x.days < 180 ? K.amber : "#d9d8d2"}`, minWidth: 0 }}>
                <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "baseline" }}>
                  <span style={{ fontFamily: "'Montserrat',sans-serif", fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", textTransform: "uppercase", color: K.gray }}>{x.kind}</span>
                  {daysPill(x.days)}
                </div>
                <div style={{ fontSize: 13.5, fontWeight: 600, color: K.ink, marginTop: 3, overflowWrap: "anywhere" }}>
                  {x.dealIds.length === 1 ? <button onClick={() => onOpenDeal(x.dealIds[0])} style={linkBtn}>{x.title}</button> : <span title={x.properties.join(", ")}>{x.title}</span>}
                </div>
                <div style={{ fontSize: 12.5, color: K.gray, marginTop: 2 }}>{x.endDate ? x.detail : `${fmtDate(x.date)} · ${x.detail}`}</div>
              </div>
            ))}
          </div>
          <Src>Always shown, whatever the window: rate-cap expirations, extension-notice windows and loans maturing within 12 months — read from the Debt records (loan fields and their covenant / notes text).</Src>
        </>
      )}
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

const BASIS_TIP = "Datex books NOI on the property's ledger basis. On a CASH basis, timing — a CAM/tax reconciliation, a tax bill or a prepaid rent landing in a different month than budgeted — can swing year-to-date vs budget by a lot even when the full year is on plan.";
const basisLabel = (fin: Record<string, unknown>) => { const b = String(fin.basis ?? "").trim().toLowerCase(); return b === "c" || b.startsWith("cash") ? "Cash basis" : b === "a" || b.startsWith("accr") ? "Accrual basis" : b === "mixed" ? "mixed cash/accrual" : "basis not stated"; };
function ArCell({ ar }: { ar: NonNullable<ReturnType<typeof splitArAging>> }) {
  return (
    <>
      {`${fmtM(ar.current60)} / ${fmtM(ar.current90)}`}
      {ar.former.length > 0
        ? <Src><span title={ar.former.map(t => `${t.name}: over 90 ${fmtM(t.over90)}`).join("\n")}>+ former tenants {fmtM(ar.former90)} over 90 ({ar.former.slice(0, 2).map(t => t.name).join(", ")}{ar.former.length > 2 ? "…" : ""})</span></Src>
        : <Src>current tenants</Src>}
    </>
  );
}

/** Old → new values in the import preview: money as $, dates as written, else plain. */
function fmtChange(field: string, v: unknown): string {
  if (v == null || v === "") return "—";
  if (typeof v === "number" && /balance|amount|notional/i.test(field)) return `$${Math.round(v).toLocaleString()}`;
  if (typeof v === "boolean") return v ? "yes" : "no";
  return typeof v === "object" ? JSON.stringify(v).slice(0, 60) : String(v);
}

// ── Properties tab ────────────────────────────────────────────────────────────
function PropertiesTab({ deals, isAdmin, onOpenDeal }: { deals: Deal[]; isAdmin: boolean; onOpenDeal: (id: string) => void }) {
  const [map, setMap] = useState<DatexMapRow[] | null>(null);
  const [editMap, setEditMap] = useState(false);
  const [autoOpen, setAutoOpen] = useState(false);
  useEffect(() => { apiAmDatexMap().then(setMap).catch(() => setMap([])); }, []);
  const { records, reload } = useAmData();
  const recs = records ?? [];
  const saveOwner = async (d: Deal) => {
    const acq = recs.find(r => r.kind === "acquisition" && r.dealId === d.id);
    const cur = propertyOwner(d, recs) ?? "";
    const v = window.prompt(`Asset manager for ${d.propertyName}`, cur);
    if (v == null || v.trim() === cur) return;
    await apiAmSaveRecord({ id: acq?.id, kind: "acquisition", dealId: d.id, data: { ...(acq?.data ?? {}), assetManager: v.trim() || null } }).catch(e => window.alert((e as Error).message));
    reload();
  };
  const rows = deals.map(d => {
    const dx = (d as unknown as { datexLive?: Record<string, unknown> }).datexLive;
    const lt = liveTenants(d);
    const tie = datexGlaTieOut(dx);
    const fin = dx?.financials as Record<string, number | string> | undefined;
    const ar = splitArAging(dx);
    const rent = lt.source === "Datex" ? lt.tenants.reduce((t, x) => t + (x.annualRent ?? 0), 0) : null;
    const mrow = map?.find(m => m.dealId === d.id);
    const acq = recs.find(r => r.kind === "acquisition" && r.dealId === d.id);
    const close = s(acq?.data.closeDate) ?? s((d as unknown as { txnCloseDate?: string }).txnCloseDate);
    return { d, dx, tie, fin, ar, rent, bldgs: mrow?.bldgIds ?? [], mapNote: mrow?.note ?? null, nvb: noiVsBudget(fin as Record<string, unknown> | undefined, close), owner: propertyOwner(d, recs), ownerEntered: !!s(acq?.data.assetManager) };
  });
  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 6 }}>
        {isAdmin && <button style={btn()} onClick={() => setEditMap(true)}>Datex building map</button>}
        {isAdmin && <button style={btn()} onClick={() => setAutoOpen(true)}>Datex auto-refresh</button>}
      </div>
      <AutoRefreshStatus />
      <SectionTitle>Today from Datex</SectionTitle>
      {(() => { const bases = rows.map(r => r.nvb?.basis).filter(Boolean); const cash = bases.filter(b => b === "Cash").length, accr = bases.filter(b => b === "Accrual").length;
        return cash && accr ? <div style={{ fontSize: 12.5, color: K.gray, margin: "0 0 8px" }}>Mixed ledger basis: {cash} propert{cash === 1 ? "y" : "ies"} on cash, {accr} on accrual — NOI-vs-budget variances aren't directly comparable across the two. Partial-year budgets (a property bought mid-year) are shown but not coloured.</div> : null; })()}
      <Table minWidth={1050}>
        <thead><tr>{["Property", "Datex as of", "Occupancy", "In-place base rent", "NOI YTD vs budget", "A/R > 60 / > 90", "Asset manager"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
        <tbody>{rows.map(({ d, dx, tie, ar, rent, bldgs, mapNote, nvb, owner, ownerEntered }) => (
          <tr key={d.id}>
            <td style={td}><button onClick={() => onOpenDeal(d.id)} style={linkBtn}>{d.propertyName}</button><Src>{bldgs.length ? bldgs.join(", ") : mapNote ? <span title={mapNote}>{/single-tenant/i.test(mapNote) ? "single-tenant · not in Datex" : /not (set up|in) datex/i.test(mapNote) ? "not in Datex yet" : "not mapped to Datex"}</span> : "not mapped to Datex"}</Src></td>
            <td style={td}>{dx ? fmtDate(String(dx.asOf)) : <span style={{ color: K.gray }}>no snapshot</span>}</td>
            <td style={num}>{dx?.occupancyPct != null ? fmtPct(Number(dx.occupancyPct), 1) : "—"}{tie?.level === "warn" && <Src><span style={{ color: K.red }} title={tie.adjustments.length ? `After: ${tie.adjustments.join("; ")}` : undefined}>⚠ roster GLA {tie.rosterGLA.toLocaleString()} SF is {tie.diffPct}% off Occupancy's</span></Src>}</td>
            <td style={num}>{fmtM(rent)}</td>
            <td style={num}>{nvb?.actual != null ? fmtM(nvb.actual) : "—"}{nvb?.budget != null && <Src><span title={nvb.partialNote ?? BASIS_TIP}>budget {fmtM(nvb.budget)}{nvb.partial
              ? <> · <span style={{ color: K.gray, fontStyle: "italic" }}>{/mis-entered/.test(nvb.partialNote ?? "") ? "budget not comparable" : "partial-year budget"}</span></>
              : nvb.variancePct != null ? <> · <span style={{ color: nvb.colour === "green" ? "#3e8a2f" : nvb.colour === "red" ? K.red : K.gray, fontWeight: nvb.colour ? 700 : 400 }}>{nvb.variancePct > 0 ? "+" : ""}{nvb.variancePct.toFixed(1)}%</span></> : null} · to {nvb.period ?? ""} · {nvb.basis ? `${nvb.basis === "mixed" ? "mixed cash/accrual" : nvb.basis + " basis"}` : "basis not stated"} ⓘ</span></Src>}</td>
            <td style={num}>{ar ? <ArCell ar={ar} /> : "—"}</td>
            <td style={td}>{owner ?? <span style={{ color: K.gray }}>no owner on file</span>}{owner && !ownerEntered && <Src>from Datex</Src>}{isAdmin && <div><button style={{ ...miniBtn, marginTop: 4 }} onClick={() => saveOwner(d)}>{owner ? "Change" : "Set owner"}</button></div>}</td>
          </tr>
        ))}</tbody>
      </Table>
      <Src>Each owned deal page has the full live panel: rent roll, Underwritten vs Today, leasing activity, and tenant sales & occupancy cost. Datex can't be read by the server directly — a scheduled Claude task posts the changes with an auto-refresh token, and a full snapshot can still be imported by hand (Portfolio Analytics → Maintenance → Import Datex snapshot).</Src>
      {autoOpen && <AutoRefreshTokens onClose={() => setAutoOpen(false)} />}
      {editMap && map && <DatexMapEditor deals={deals} rows={map} onClose={() => setEditMap(false)} onSaved={() => apiAmDatexMap().then(setMap)} />}
    </>
  );
}
// ── Datex auto-refresh: status line (everyone) + scoped tokens (admin) ──
const BLOCK_LABEL: Record<string, string> = { occupancy: "occupancy", tenants: "rent roll", vacantSuites: "vacant suites", sales: "sales", arAging: "A/R", financials: "financials", leasing: "leasing", assetManager: "asset manager", notes: "notes" };
const fmtWhen = (iso: string) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
function AutoRefreshStatus() {
  const [st, setSt] = useState<{ last: IngestLogView | null; setting?: AutoRefreshSettingView } | null>(null);
  useEffect(() => { apiDatexAutoStatus().then(setSt).catch(() => setSt({ last: null })); }, []);
  if (!st) return null;
  const l = st.last;
  return (
    <div style={{ ...card, padding: "9px 14px", marginTop: 10, fontSize: 12.5, color: K.ink, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "baseline" }}>
      <b style={{ fontFamily: "'Montserrat',sans-serif", fontSize: 11, letterSpacing: ".06em", textTransform: "uppercase", color: K.charcoal }}>Last auto-refresh</b>
      {st.setting && !st.setting.enabled && <span style={{ color: K.red, fontWeight: 700 }}>Turned off{st.setting.updatedBy ? ` by ${st.setting.updatedBy}` : ""} ·</span>}
      {!l ? <span style={{ color: K.gray }}>none yet — the scheduled Datex task hasn't posted.</span> : (
        <span>
          {fmtWhen(l.at)}{l.asOf ? ` (Datex as of ${fmtDate(l.asOf)})` : ""} · {Object.keys(l.blocks).map(b => BLOCK_LABEL[b] ?? b).join(", ") || "no blocks"} · {l.dealsChanged} propert{l.dealsChanged === 1 ? "y" : "ies"} changed, {l.dealsUnchanged} unchanged
          {l.rejected.length > 0 && <span style={{ color: K.red }} title={l.rejected.map(r => `${r.dealId}: ${r.problem}`).join("\n")}> · {l.rejected.length} rejected ⓘ</span>}
          {l.error && <span style={{ color: K.red }}> · failed: {l.error}</span>}
          {l.warnings > 0 && <span style={{ color: K.gray }}> · {l.warnings} warning{l.warnings === 1 ? "" : "s"}</span>}
        </span>
      )}
    </div>
  );
}
function AutoRefreshTokens({ onClose }: { onClose: () => void }) {
  const [tokens, setTokens] = useState<IngestTokenView[] | null>(null);
  const [recent, setRecent] = useState<IngestLogView[]>([]);
  const [setting, setSetting] = useState<AutoRefreshSettingView | null>(null);
  const [issued, setIssued] = useState<IngestAuditView[]>([]);
  const [label, setLabel] = useState("Weekly Datex task");
  const [fresh, setFresh] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const load = () => { apiDatexAutoTokens().then(setTokens).catch(e => setErr(e.message)); apiDatexAutoStatus().then(s => { setRecent(s.recent); setSetting(s.setting ?? null); setIssued(s.shortLived ?? []); }).catch(() => {}); };
  const toggle = async () => {
    if (!setting) return;
    if (setting.enabled && !window.confirm("Turn Datex auto-refresh OFF? Every token stops working and the scheduled task can't get new credentials until it's turned back on.")) return;
    try { setSetting(await apiDatexAutoSetEnabled(!setting.enabled)); load(); } catch (e) { setErr(e instanceof Error ? e.message : "failed"); }
  };
  useEffect(load, []);
  const create = async () => { setErr(null); try { const r = await apiDatexAutoCreateToken(label); setFresh(r.token); setCopied(false); load(); } catch (e) { setErr(e instanceof Error ? e.message : "failed"); } };
  const revoke = async (t: IngestTokenView) => { if (!window.confirm(`Turn off "${t.label}"? Any task using it stops working.`)) return; try { await apiDatexAutoRevokeToken(t.id); load(); } catch (e) { setErr(e instanceof Error ? e.message : "failed"); } };
  const copy = async () => { try { await navigator.clipboard.writeText(fresh ?? ""); setCopied(true); } catch { setCopied(false); } };
  return (
    <Modal title="Datex auto-refresh" onClose={onClose}>
      <div style={{ fontSize: 12.5, color: K.gray, lineHeight: 1.45 }}>A token lets a scheduled Claude task read what's stored (<code>GET /api/datex/state</code>) and post Datex changes (<code>POST /api/datex/ingest</code>). It can do nothing else on the site. Anything the task doesn't send is kept as it is.</div>
      {setting && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap", border: `1px solid ${setting.enabled ? K.line : K.red}`, borderRadius: 10, padding: "10px 12px", marginTop: 12 }}>
          <div style={{ fontSize: 13, color: K.ink }}>
            <b>Auto-refresh is {setting.enabled ? "ON" : "OFF"}</b>
            <Src>{setting.enabled ? "Tokens work, and the scheduled task can get 3-hour credentials through the KPR connector." : "Every token is refused and no new credentials are issued."}{setting.updatedBy ? ` Last changed by ${setting.updatedBy}${setting.updatedAt ? ` · ${fmtWhen(setting.updatedAt)}` : ""}.` : ""}</Src>
          </div>
          <button style={btn(!setting.enabled)} onClick={toggle}>{setting.enabled ? "Turn off" : "Turn on"}</button>
        </div>
      )}
      {fresh && (
        <div style={{ border: `1px solid ${K.green}`, background: "#f3faf0", borderRadius: 10, padding: 12, marginTop: 12 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: K.ink }}>Copy this token now — it won't be shown again.</div>
          <div style={{ fontFamily: "monospace", fontSize: 12, wordBreak: "break-all", background: "#fff", border: `1px solid ${K.line}`, borderRadius: 6, padding: "8px 10px", marginTop: 6 }}>{fresh}</div>
          <button style={{ ...btn(true), marginTop: 8 }} onClick={copy}>{copied ? "Copied ✓" : "Copy token"}</button>
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 12 }}>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Label (e.g. Weekly Datex task)" style={{ flex: "1 1 200px", minWidth: 0, border: `1px solid ${K.line}`, borderRadius: 8, padding: "8px 10px", fontSize: 13, minHeight: 36 }} />
        <button style={btn(true)} onClick={create}>Create token</button>
      </div>
      {err && <div style={{ color: K.red, fontSize: 12.5, marginTop: 8 }}>{err}</div>}
      <SectionTitle>Tokens</SectionTitle>
      {!tokens ? <Src>Loading…</Src> : !tokens.length ? <Src>No tokens yet.</Src> : tokens.map(t => (
        <div key={t.id} style={{ display: "flex", gap: 10, alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", borderTop: `1px solid ${K.line}`, padding: "8px 0", opacity: t.revokedAt ? 0.55 : 1 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 700, color: K.ink }}>{t.label} <span style={{ fontFamily: "monospace", fontWeight: 400, color: K.gray, fontSize: 11.5 }}>{t.display}</span></div>
            <Src>created {fmtWhen(t.createdAt)}{t.createdBy ? ` by ${t.createdBy}` : ""} · {t.lastUsedAt ? `last used ${fmtWhen(t.lastUsedAt)}` : "never used"}{t.revokedAt ? ` · turned off ${fmtWhen(t.revokedAt)}` : ""}</Src>
          </div>
          {!t.revokedAt && <button style={btn()} onClick={() => revoke(t)}>Turn off</button>}
        </div>
      ))}
      {issued.length > 0 && (
        <>
          <SectionTitle>Short-lived credentials issued</SectionTitle>
          <Src>Minted by the scheduled task through the KPR connector (admins only); each expires after 3 hours and isn't listed as a permanent token.</Src>
          {issued.map(a => (
            <div key={a.at} style={{ fontSize: 12, color: K.ink, borderTop: `1px solid ${K.line}`, padding: "6px 0" }}>
              {fmtWhen(a.at)} · {a.by} · {a.via} · {Date.parse(a.expiresAt) > Date.now() ? `expires ${fmtWhen(a.expiresAt)}` : "expired"}
            </div>
          ))}
        </>
      )}
      {recent.length > 0 && (
        <>
          <SectionTitle>Recent runs</SectionTitle>
          {recent.slice(0, 10).map(l => (
            <div key={l.at} style={{ fontSize: 12, color: K.ink, borderTop: `1px solid ${K.line}`, padding: "6px 0" }}>
              {fmtWhen(l.at)} · {l.dryRun ? "dry run" : "applied"} · {Object.keys(l.blocks).map(b => BLOCK_LABEL[b] ?? b).join(", ") || "—"} · {l.dealsChanged} changed{l.rejected.length ? ` · ${l.rejected.length} rejected` : ""}{l.error ? ` · failed: ${l.error}` : ""}
              {l.rejected.length > 0 && <Src>{l.rejected.slice(0, 3).map(r => `${r.dealId}: ${r.problem}`).join(" · ")}</Src>}
            </div>
          ))}
        </>
      )}
    </Modal>
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
      <h1 className="kpr-page-title">Asset Management</h1>
      <div style={{ fontSize: 13.5, color: K.gray, marginTop: 4 }}>{owned.length} owned properties · KPR-owned only (Sold deals are excluded)</div>
      <div role="tablist" style={{ display: "flex", gap: 4, borderBottom: `1px solid ${K.line}`, marginTop: 14, overflowX: "auto" }}>
        {TABS.map(([id, label]) => (
          <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)}
            style={{ background: "none", border: "none", padding: "10px 12px", minHeight: 40, fontFamily: "'Montserrat',sans-serif", fontWeight: 700, fontSize: 13, color: tab === id ? K.ink : K.gray, boxShadow: tab === id ? `inset 0 -3px 0 ${K.green}` : "none", cursor: "pointer", whiteSpace: "nowrap" }}>{label}</button>
        ))}
      </div>
      {error && <div style={{ color: K.red, fontSize: 13, marginTop: 10 }}>{error}</div>}
      {records == null ? <div aria-busy="true" style={{ paddingTop: 16 }}><div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(170px,1fr))", gap: 10, marginBottom: 14 }}>{[0, 1, 2, 3].map(k => <div key={k} className="kpr-skel" style={{ height: 84, borderRadius: 12 }} />)}</div><div className="kpr-skel" style={{ height: 240, borderRadius: 12 }} /></div> : (
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
  const prefs = buildPrefRows(mine, [deal], today);
  const dates = buildCriticalDates([deal], mine, abstracts.filter(a => a.dealId === deal.id), today, 365).items.filter(i => i.days >= 0).slice(0, 8);
  const cmp = omVsToday(deal);
  const sales = buildSalesRows(deal, bench);
  const dx = (deal as unknown as { datexLive?: Record<string, unknown> }).datexLive;
  const ar = splitArAging(dx);
  const fin = dx?.financials as Record<string, number | string> | undefined;
  const leasing = (dx?.leasing as Array<Record<string, unknown>> | undefined) ?? [];
  const tie = datexGlaTieOut(dx);
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
            {tie && (tie.level === "note" || tie.level === "warn") && (tie.level === "note"
              ? <div style={{ color: K.gray, fontSize: 12.5, marginTop: 8 }}>Small gap: the Datex rent roll adds up to {tie.rosterGLA.toLocaleString()} SF vs {tie.occupancyGLA?.toLocaleString()} SF in Occupancy ({tie.diffPct}%) — usually a lease generation or suite split; occupancy above is taken from Datex Occupancy.{tie.adjustments.length ? ` (Already allowed for: ${tie.adjustments.join("; ")}.)` : ""}</div>
              : <div style={{ color: K.red, fontSize: 12.5, marginTop: 8 }}>⚠ The Datex rent roll adds up to {tie.rosterGLA.toLocaleString()} SF but Occupancy reports {tie.occupancyGLA?.toLocaleString()} SF ({tie.diffPct}% apart) — check for missing or duplicate suites before trusting occupancy.{tie.adjustments.length ? ` (Already allowed for: ${tie.adjustments.join("; ")}.)` : ""}</div>)}
            <div style={{ display: "flex", gap: 18, flexWrap: "wrap", marginTop: 10, fontSize: 13 }}>
              {fin?.noiYtdActual != null && <span title={BASIS_TIP}><b>NOI YTD</b> {fmtM(Number(fin.noiYtdActual))} vs budget {fmtM(fin.noiYtdBudget != null ? Number(fin.noiYtdBudget) : null)} <span style={{ color: K.gray }}>(to {String(fin.period)} · {basisLabel(fin)} ⓘ)</span></span>}
              {ar && <span><b>A/R</b> current tenants over 60 days {fmtM(ar.current60)} · over 90 {fmtM(ar.current90)}{ar.currentTop.length ? <span style={{ color: K.gray }}> · largest: {ar.currentTop.slice(0, 3).map(t => `${t.name} ${fmtM(t.over60)}`).join(", ")}</span> : null}
                {ar.former.length > 0 && <span style={{ color: K.gray }}> · <b>former tenants</b> over 90 {fmtM(ar.former90)} ({ar.former.slice(0, 3).map(t => t.name).join(", ")})</span>}</span>}
            </div>
          </>
        )}
      </div>
      {dx && sales.rows.length > 0 && <DatexSalesCard deal={deal} bench={bench} />}
      {(debt.length > 0 || prefs.length > 0 || dates.length > 0 || leasing.length > 0) && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit,minmax(320px,1fr))", gap: 14 }}>
          {(debt.length > 0 || prefs.length > 0) && (
            <div style={{ ...card, padding: 14 }}>
              <div style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: K.charcoal }}>Debt & swaps</div>
              {debt.filter(r => !r.superseded).map(r => (
                <div key={r.record.id} style={{ fontSize: 13, marginTop: 8 }}>
                  <b>{r.lender ?? "Loan"}</b>{r.loanLabel ? ` (${r.loanLabel})` : ""} · {fmtM(r.balance)} · {fmtPct(r.allInPct, 3)} {r.rateType ?? ""} · matures {fmtDate(r.maturity)} {daysPill(r.daysToMaturity, r.flag)}
                  {r.swaps.map(w => <div key={w.record.id} style={{ fontSize: 12.5, color: K.gray }}>{w.termsPending ? <>Swap{w.counterparty ? ` with ${w.counterparty}` : ""} — terms pending (not priced)</> : <>Swap {fmtM(w.notional)} at {fmtPct(w.fixedSwapRatePct, 4)} to {fmtDate(w.maturity)} · MTM {w.mtm == null ? "—" : `${w.mtm >= 0 ? "+" : "−"}${fmtM(Math.abs(w.mtm))}`} ({w.curve})</>}</div>)}
                  <Src>{r.record.sourceNote ?? "no source noted"}</Src>
                </div>
              ))}
              {prefs.map(p => (
                <div key={p.record.id} style={{ fontSize: 13, marginTop: 8 }}>
                  <b>Preferred equity</b>{p.investor ? ` · ${p.investor}` : ""}{p.loanLabel ? ` (${p.loanLabel})` : ""} · {fmtM(p.amount)}{p.ratePct != null ? ` at ${fmtPct(p.ratePct, 2)}` : ""}
                  <Src>not debt — excluded from loan totals · {p.record.sourceNote ?? "no source noted"}</Src>
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
              <div style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: K.charcoal }}>Leasing pipeline (applications)</div>
              <Src>Datex lease applications — deals in negotiation, not executed leases (unless an execution date shows)</Src>
              {leasing.slice(0, 8).map((l, i) => <div key={i} style={{ fontSize: 13, marginTop: 6 }}><b>{String(l.tenant)}</b>{l.suite ? ` · ${l.suite}` : ""}{l.gla ? ` · ${Number(l.gla).toLocaleString()} SF` : ""}{l.rentPSF ? ` · $${Number(l.rentPSF).toFixed(2)}/SF` : ""}<div style={{ fontSize: 12, color: K.gray }}>{String(l.stage ?? "")}{l.executed ? ` · executed ${fmtDate(String(l.executed))}` : l.submitted ? ` · submitted ${fmtDate(String(l.submitted))}` : ""}</div></div>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}


/** Datex tenant sales & occupancy cost (12 most recent REPORTED months from SalesHistory). */
export function DatexSalesCard({ deal, bench, note }: { deal: Deal; bench?: AnalystTenantBenchmark[]; note?: string }) {
  const [b, setB] = useState<AnalystTenantBenchmark[]>(bench ?? []);
  useEffect(() => { if (!bench) apiLoadTenantBenchmarks().then(setB).catch(() => {}); }, [bench]);
  const sales = buildSalesRows(deal, bench ?? b);
  if (!sales.rows.length) return null;
  return (
        <div style={{ ...card, padding: 14 }}>
          <div style={{ fontFamily: "'Montserrat',sans-serif", fontWeight: 800, fontSize: 12, letterSpacing: ".1em", textTransform: "uppercase", color: K.charcoal }}>Tenant sales & occupancy cost</div>
          {note && <div style={{ fontSize: 12.5, color: K.ink, marginTop: 4 }}>{note}</div>}
          <Src>{sales.source}. Occupancy cost = base rent + recoveries + other ÷ 12-month sales; at risk over 12% (anchors) / 15% (shops). Benchmark = library median sales PSF for the brand.</Src>
          <div style={{ overflowX: "auto", marginTop: 8 }}>
            <table className="kpr-table" style={{ width: "100%", minWidth: 760, borderCollapse: "collapse" }}>
              <thead><tr>{["Tenant", "SF", "12-mo sales", "Sales PSF", "Period", "Occ. cost", "vs library", "Flags"].map(h => <th key={h} style={th}>{h}</th>)}</tr></thead>
              <tbody>{sales.rows.map(r => (
                <tr key={r.tenant}>
                  <td style={td}>{r.tenant}{r.isAnchor && <Src>anchor</Src>}</td>
                  <td style={num}>{r.sf ? Math.round(r.sf).toLocaleString() : "—"}</td>
                  <td style={num}>{fmtM(r.sales12)}{r.suspect.length > 0 && (
                    <div><span className="kpr-chip" title={r.suspect.map(x => `${x.period.slice(4)}/${x.period.slice(0, 4)}: ${fmtM(x.amount)} vs a usual month of ${fmtM(x.medianMonth)} — looks like an annual total; left out of the 12-month sum`).join("\n")}
                      style={{ background: "#fff2e0", color: K.amber, fontSize: 10.5, fontWeight: 700, padding: "1px 6px", borderRadius: 6, whiteSpace: "nowrap" }}>⚠ {r.suspect.length} suspect month{r.suspect.length === 1 ? "" : "s"}</span></div>)}</td>
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
  const items = useMemo(() => records == null ? [] : collapsePortfolioCovenants(buildCriticalDates(owned, records, abstracts, today, 90).items.filter(i => i.days >= 0), records, owned), [owned, records, abstracts, today]);
  if (!owned.length) return null;
  if (records == null) return <div className="kpr-skel" style={{ height: 120, borderRadius: 12 }} aria-hidden />;
  const thisWeek = items.filter(i => i.days <= 7).length;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 10 }}>
        <div style={{ fontSize: 13, color: K.gray }}>Week of {monday.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · <b style={{ color: thisWeek ? K.red : K.ink }}>{thisWeek} this week</b> · {items.length} in the next 90 days</div>
        <button onClick={onSeeAll} style={{ ...miniBtn, padding: "5px 10px", minHeight: 30 }}>All critical dates →</button>
      </div>
      <DateTimeline items={items.slice(0, 8)} onOpenDeal={onOpenDeal} />
    </div>
  );
}

// Timeline rendering of critical dates — a type icon per item and colour by urgency
// (≤7 days red, ≤30 amber, later green). Used by the home "This week" card.
const TYPE_ICON: Record<string, string> = { "Lease expiry": "▭", "Option notice": "✉", "Termination / kick-out": "⇥", "Co-tenancy": "⛓", "Loan maturity": "$", "Extension notice": "↦", "Swap maturity": "⇄", "Covenant test": "✓", "Covenant trigger": "!", "Other": "•" };
export function DateTimeline({ items, onOpenDeal }: { items: CriticalDate[]; onOpenDeal: (id: string) => void }) {
  if (!items.length) return <div style={{ ...card, padding: 16, fontSize: 13.5, color: K.gray }}>Nothing due in the next 90 days.</div>;
  return (
    <div style={{ ...card, padding: "6px 14px" }}>
      {items.map((i, k) => {
        const c = i.days <= 7 ? K.red : i.days <= 30 ? K.amber : "#3e8a2f";
        return (
          <div key={`${i.type}-${i.dealId}-${i.date}-${k}`} style={{ display: "grid", gridTemplateColumns: "34px 1fr auto", gap: 12, alignItems: "center", padding: "10px 0", borderTop: k ? "1px solid #f3f2ee" : "none" }}>
            <span title={i.type} style={{ position: "relative", width: 30, height: 30, borderRadius: "50%", background: `${c}14`, color: c, border: `1.5px solid ${c}55`, display: "flex", alignItems: "center", justifyContent: "center", fontWeight: 800, fontSize: 13 }}>{TYPE_ICON[i.type] ?? "•"}</span>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13.5, color: K.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}><button onClick={() => onOpenDeal(i.dealId)} style={linkBtn}>{i.property}</button>{i.tenant ? ` · ${i.tenant}` : ""}</div>
              <div style={{ fontSize: 12, color: K.gray, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{i.type}{i.description ? ` — ${i.description}` : ""}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontFamily: "'Roboto',sans-serif", fontVariantNumeric: "tabular-nums", fontSize: 13, color: K.ink, whiteSpace: "nowrap" }}>{fmtDate(i.date)}</div>
              <div style={{ fontSize: 11.5, fontWeight: 700, color: c }}>{i.days === 0 ? "today" : `in ${i.days}d`}</div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
