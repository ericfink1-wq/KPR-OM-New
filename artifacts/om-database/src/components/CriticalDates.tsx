import { useMemo, useState } from "react";
import type { Deal } from "../lib/idb";
import { parseLeaseDate, isVacant, isNAPTenant } from "../lib/utils";
import ScopeToggle, { scopeDeals, type Scope } from "./ScopeToggle";

interface Props {
  deals: Deal[];
  onOpenDeal: (dealId: string) => void;
}

type Kind = "Lease expiry" | "Debt maturity" | "Pref maturity";

interface Ev {
  date: Date;
  dealId: string;
  dealName: string;
  kind: Kind;
  who: string;
  sub: string;
}

const KIND_COLOR: Record<Kind, { bg: string; fg: string }> = {
  "Lease expiry": { bg: "#eef5e6", fg: "#3f7a1f" },
  "Debt maturity": { bg: "#fdecec", fg: "#b3403f" },
  "Pref maturity": { bg: "#fff2e0", fg: "#b3711a" },
};

const HORIZONS: { label: string; days: number | null }[] = [
  { label: "90 days", days: 90 },
  { label: "6 months", days: 183 },
  { label: "12 months", days: 365 },
  { label: "24 months", days: 730 },
  { label: "All", days: null },
];

function num(v: unknown): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return isNaN(n) ? null : n;
}

function fmtMoney(n: number): string {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

function monthKey(d: Date): string {
  return d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

function relLabel(days: number): string {
  if (days < 0) return `${Math.abs(days)} day${Math.abs(days) === 1 ? "" : "s"} ago`;
  if (days === 0) return "today";
  if (days < 45) return `in ${days} day${days === 1 ? "" : "s"}`;
  const mo = Math.round(days / 30.44);
  return `in ${mo} month${mo === 1 ? "" : "s"}`;
}

export default function CriticalDates({ deals, onOpenDeal }: Props) {
  const [horizonDays, setHorizonDays] = useState<number | null>(365);
  const [kinds, setKinds] = useState<Set<Kind>>(new Set(["Lease expiry", "Debt maturity", "Pref maturity"]));
  const [scope, setScope] = useState<Scope>("owned");

  const ownedCount = useMemo(() => deals.filter(d => !d.trashedAt && d.status === "Owned").length, [deals]);
  const allCount = useMemo(() => deals.filter(d => !d.trashedAt).length, [deals]);

  const allEvents = useMemo<Ev[]>(() => {
    const out: Ev[] = [];
    for (const d of scopeDeals(deals, scope)) {
      if (d.trashedAt) continue;
      const dealName = d.propertyName || d.address || "Untitled deal";
      // Lease expiries — real, occupied lease occupants only.
      for (const t of d.tenants || []) {
        if (!t || isVacant(t.name) || isNAPTenant(t)) continue;
        const date = parseLeaseDate(t.leaseExpiry);
        if (!date) continue;
        const sf = num(t.sf), rent = num(t.annualRent);
        const bits: string[] = [];
        if (sf) bits.push(`${Math.round(sf).toLocaleString()} SF`);
        if (rent) bits.push(`${fmtMoney(rent)}/yr`);
        out.push({ date, dealId: d.id, dealName, kind: "Lease expiry", who: t.name || "Tenant", sub: bits.join(" · ") });
      }
      // Debt maturity — prefer the structured debt field, fall back to OM-stated loan maturity.
      const debt = parseLeaseDate(d.debtMaturityDate || d.loanMaturity);
      if (debt) {
        const amt = num(d.debtLoanAmount);
        out.push({ date: debt, dealId: d.id, dealName, kind: "Debt maturity", who: d.debtLender || "Loan", sub: amt ? `${fmtMoney(amt)} balance` : "" });
      }
      // Preferred-equity maturity.
      const pref = parseLeaseDate(d.prefMaturityDate);
      if (pref) {
        const amt = num(d.prefAmount);
        out.push({ date: pref, dealId: d.id, dealName, kind: "Pref maturity", who: d.prefLender || "Preferred equity", sub: amt ? `${fmtMoney(amt)}` : "" });
      }
    }
    out.sort((a, b) => a.date.getTime() - b.date.getTime());
    return out;
  }, [deals, scope]);

  const today = useMemo(() => { const t = new Date(); t.setHours(0, 0, 0, 0); return t; }, []);

  const filtered = useMemo(() => {
    const horizonMs = horizonDays == null ? null : today.getTime() + horizonDays * 86_400_000;
    return allEvents.filter(e => {
      if (!kinds.has(e.kind)) return false;
      if (horizonMs != null && e.date.getTime() > horizonMs) return false;
      return true;
    });
  }, [allEvents, kinds, horizonDays, today]);

  const pastDue = filtered.filter(e => e.date.getTime() < today.getTime());
  const upcoming = filtered.filter(e => e.date.getTime() >= today.getTime());

  // Group upcoming by month.
  const groups = useMemo(() => {
    const m = new Map<string, Ev[]>();
    for (const e of upcoming) {
      const k = monthKey(e.date);
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(e);
    }
    return [...m.entries()];
  }, [upcoming]);

  const toggleKind = (k: Kind) => setKinds(prev => {
    const next = new Set(prev);
    if (next.has(k)) next.delete(k); else next.add(k);
    return next.size ? next : new Set<Kind>([k]); // never empty
  });

  const Row = ({ e }: { e: Ev }) => {
    const days = Math.round((e.date.getTime() - today.getTime()) / 86_400_000);
    const c = KIND_COLOR[e.kind];
    return (
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "11px 4px", borderBottom: "1px solid #f1eadc" }}>
        <div style={{ minWidth: 92, flexShrink: 0 }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "#2a2c28" }}>{fmtDate(e.date)}</div>
          <div style={{ fontSize: 10.5, color: days < 0 ? "#b3403f" : "#a89f8f" }}>{relLabel(days)}</div>
        </div>
        <span style={{ flexShrink: 0, fontSize: 9.5, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.04em", color: c.fg, background: c.bg, padding: "3px 7px", borderRadius: 5, marginTop: 1 }}>
          {e.kind === "Lease expiry" ? "Lease" : e.kind === "Debt maturity" ? "Debt" : "Pref"}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "#2a2c28", overflow: "hidden", textOverflow: "ellipsis" }}>{e.who}</div>
          <div style={{ fontSize: 11.5, color: "#7d766a" }}>
            <button
              onClick={() => onOpenDeal(e.dealId)}
              style={{ background: "none", border: "none", padding: 0, color: "#3f7a1f", cursor: "pointer", fontWeight: 600, fontSize: 11.5, fontFamily: "inherit" }}
            >
              {e.dealName}
            </button>
            {e.sub ? ` · ${e.sub}` : ""}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div style={{ padding: "20px 18px 80px", maxWidth: 940, margin: "0 auto", width: "100%", boxSizing: "border-box", fontFamily: "'Inter',sans-serif" }}>
      <h2 style={{ fontFamily: "'Fraunces',Georgia,serif", fontSize: 22, fontWeight: 600, color: "#26281f", margin: "0 0 4px" }}>Critical Dates</h2>
      <p style={{ fontSize: 12.5, color: "#7d766a", margin: "0 0 18px", lineHeight: 1.5 }}>
        Upcoming lease expirations and loan maturities across the portfolio — what needs attention, soonest first.
      </p>

      {/* Controls */}
      <div style={{ marginBottom: 12 }}>
        <ScopeToggle scope={scope} onChange={setScope} ownedCount={ownedCount} allCount={allCount} />
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 6 }}>
        {HORIZONS.map(h => (
          <button key={h.label} onClick={() => setHorizonDays(h.days)}
            style={{ padding: "7px 13px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", minHeight: 34,
              border: `1px solid ${horizonDays === h.days ? "#6dba43" : "#e0d8c8"}`,
              background: horizonDays === h.days ? "#f0fae8" : "#fff",
              color: horizonDays === h.days ? "#3f7a1f" : "#8b8578" }}>
            {h.label}
          </button>
        ))}
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center", marginBottom: 18 }}>
        {(["Lease expiry", "Debt maturity", "Pref maturity"] as Kind[]).map(k => (
          <button key={k} onClick={() => toggleKind(k)}
            style={{ padding: "6px 11px", borderRadius: 999, fontSize: 11.5, fontWeight: 600, cursor: "pointer", minHeight: 32,
              border: `1px solid ${kinds.has(k) ? KIND_COLOR[k].fg : "#e0d8c8"}`,
              background: kinds.has(k) ? KIND_COLOR[k].bg : "#fff",
              color: kinds.has(k) ? KIND_COLOR[k].fg : "#b0a899" }}>
            {kinds.has(k) ? "✓ " : ""}{k}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p style={{ fontSize: 13, color: "#a89f8f", fontStyle: "italic" }}>No dated events in this window. Try a longer horizon.</p>
      ) : (
        <div style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: 12, padding: "8px 16px" }}>
          {pastDue.length > 0 && (
            <div style={{ marginBottom: 6 }}>
              <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, color: "#b3403f", padding: "12px 0 4px" }}>
                Past due / holdover ({pastDue.length})
              </div>
              {pastDue.map((e, i) => <Row key={`p${i}`} e={e} />)}
            </div>
          )}
          {groups.map(([k, evs]) => (
            <div key={k}>
              <div style={{ fontSize: 10, letterSpacing: "0.1em", textTransform: "uppercase", fontWeight: 700, color: "#a89f8f", padding: "14px 0 4px" }}>
                {k} ({evs.length})
              </div>
              {evs.map((e, i) => <Row key={`${k}${i}`} e={e} />)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
