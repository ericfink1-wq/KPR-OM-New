import type { Deal } from "../lib/idb";
import { useIsMobile } from "../hooks/use-mobile";

// LIVE FROM DATEX, shown BESIDE the acquisition-era figures rather than replacing them.
//
// Every other number on this page came from the offering documents at the time of the deal
// and is deliberately frozen — it is the record of what was marketed. Datex is the live
// property-management system. Holding both is the point: the gap between them is the
// finding, so this card leads with the differences rather than burying them under a
// restatement of what Datex says.
//
// Two things it is careful about. Occupancy comes from Datex's own Occupancy entity, never
// from Buildings — BLDGGLA is zero on 46 buildings and OCCGLA is the shop-only figure, and
// dividing one by the other is how a 67% centre was once reported as 49%. And a segment
// sitting at zero occupancy gets called out explicitly, because a healthy headline occupancy
// hides it completely: Cooks Corner reads 67% occupied while a 29,000 SF major box is empty.

const fmtInt = (n: number) => Math.round(n).toLocaleString();
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** A difference worth a person's attention: anything meaningful, or a fully dark segment. */
function differences(deal: Deal) {
  const live = deal.datexLive;
  if (!live) return [];
  const out: Array<{ label: string; was: string; now: string; delta: string | null; alarming: boolean }> = [];

  const occWas = num(deal.occupancy), occNow = num(live.occupancyPct);
  if (occWas != null && occNow != null) {
    const d = Math.round((occNow - occWas) * 10) / 10;
    out.push({
      label: "Occupancy", was: `${occWas}%`, now: `${occNow}%`,
      delta: d === 0 ? null : `${d > 0 ? "+" : ""}${d} pts`,
      alarming: d <= -5,
    });
  }
  const sfWas = num(deal.totalSF), sfNow = num(live.totalGLA);
  if (sfWas != null && sfNow != null && sfWas > 0) {
    const pct = Math.round(((sfNow - sfWas) / sfWas) * 1000) / 10;
    out.push({
      label: "Total GLA", was: `${fmtInt(sfWas)} SF`, now: `${fmtInt(sfNow)} SF`,
      delta: pct === 0 ? null : `${pct > 0 ? "+" : ""}${pct}%`,
      alarming: Math.abs(pct) >= 5,
    });
  }
  // Current billed base rent vs the OM's gross potential rent (base only, both sides).
  const rentNow = (live.tenants || []).reduce((s, t) => s + (num(t.annualRent) ?? 0), 0);
  const rentWas = num(deal.grossPotentialRent);
  if (rentNow > 0 && rentWas != null && rentWas > 0) {
    const pct = Math.round(((rentNow - rentWas) / rentWas) * 1000) / 10;
    out.push({
      label: "Base rent (annual)", was: `$${fmtInt(rentWas)}`, now: `$${fmtInt(rentNow)}`,
      delta: pct === 0 ? null : `${pct > 0 ? "+" : ""}${pct}%`,
      alarming: pct <= -5,
    });
  }
  return out;
}

/** Leases expiring in the next 12 and 13–24 months, from Datex's live tenant list. */
export function datexRollover(deal: Deal, today = new Date()) {
  const ts = deal.datexLive?.tenants || [];
  const t0 = today.getTime(), Y = 365.25 * 86_400_000;
  const bucket = () => ({ count: 0, sf: 0, rent: 0 });
  const y1 = bucket(), y2 = bucket();
  const next: Array<{ name: string; expiry: string; sf: number | null; rent: number | null }> = [];
  for (const t of ts) {
    const e = t.leaseExpiry ? Date.parse(String(t.leaseExpiry).slice(0, 10)) : NaN;
    if (!Number.isFinite(e) || e < t0) continue;
    const b = e - t0 <= Y ? y1 : e - t0 <= 2 * Y ? y2 : null;
    if (b) { b.count++; b.sf += num(t.sf) ?? 0; b.rent += num(t.annualRent) ?? 0; }
    next.push({ name: t.name || "Tenant", expiry: String(t.leaseExpiry).slice(0, 10), sf: num(t.sf), rent: num(t.annualRent) });
  }
  next.sort((a, b) => a.expiry.localeCompare(b.expiry));
  return { y1, y2, next: next.slice(0, 5), hasData: ts.some(t => t.leaseExpiry) };
}

/** Segments standing entirely empty — invisible in a headline occupancy figure. */
function darkSegments(deal: Deal) {
  const seg = deal.datexLive?.segments;
  if (!seg) return [];
  return Object.entries(seg)
    .map(([name, s]) => ({ name, gla: num(s?.gla), occ: num(s?.occupiedGLA) }))
    .filter(s => s.gla != null && s.gla > 0 && s.occ === 0);
}

export default function DatexLiveCard({ deal }: { deal: Deal }) {
  const live = deal.datexLive;
  const isMobile = useIsMobile();
  if (!live) return null;

  const diffs = differences(deal);
  const dark = darkSegments(deal);
  const asOf = live.asOf ? String(live.asOf).slice(0, 10) : null;

  const card: React.CSSProperties = {
    background: "#fff", border: "1px solid #e3e1db", borderRadius: 12,
    padding: isMobile ? 14 : 18, marginBottom: 16, fontFamily: "'Roboto',sans-serif",
  };
  const label: React.CSSProperties = { fontSize: 10, fontWeight: 700, letterSpacing: 0.6, textTransform: "uppercase", color: "#94928b" };

  return (
    <div style={card}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, flexWrap: "wrap", marginBottom: 12 }}>
        <span style={{ fontSize: 14.5, fontWeight: 700, color: "#383a37" }}>📡 Live from Datex</span>
        {asOf && <span style={{ fontSize: 11.5, color: "#7d8b78", fontWeight: 600 }}>as of {asOf}</span>}
        <span style={{ fontSize: 11, color: "#94928b" }}>
          Property-management system of record — current. The figures elsewhere on this page are the acquisition-era snapshot.
        </span>
      </div>

      {/* The differences lead, because they are the reason both records exist. */}
      {diffs.length > 0 && (
        <div style={{ marginBottom: dark.length || live.tenants?.length ? 14 : 0 }}>
          <div style={{ ...label, marginBottom: 6 }}>Against the acquisition snapshot</div>
          <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(auto-fit,minmax(210px,1fr))", gap: 10 }}>
            {diffs.map(d => (
              <div key={d.label} style={{
                border: `1px solid ${d.alarming ? "#f0c9b8" : "#ece6da"}`, background: d.alarming ? "#fdf4f0" : "#faf8f4",
                borderRadius: 9, padding: "9px 11px",
              }}>
                <div style={{ ...label, marginBottom: 3 }}>{d.label}</div>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: "#383a37", fontVariantNumeric: "tabular-nums" }}>
                  {d.was} <span style={{ color: "#c3bbac", fontWeight: 500 }}>→</span> {d.now}
                  {d.delta && <span style={{ marginLeft: 7, fontSize: 11.5, fontWeight: 700, color: d.alarming ? "#b06a4e" : "#7d8b78" }}>{d.delta}</span>}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* A fully dark segment: the thing a healthy headline occupancy hides. */}
      {dark.map(s => (
        <div key={s.name} style={{
          display: "flex", gap: 9, alignItems: "flex-start", border: "1px solid #f0c9b8", background: "#fdf4f0",
          borderRadius: 9, padding: "10px 12px", marginBottom: 10, fontSize: 12.5, lineHeight: 1.45, color: "#5c4a3f",
        }}>
          <span style={{ fontSize: 14, lineHeight: 1.1 }}>⚠️</span>
          <div>
            <strong>{fmtInt(s.gla!)} SF of {s.name} space is entirely vacant.</strong>{" "}
            The centre's overall occupancy does not show this — an empty box of this size is invisible in a headline figure.
          </div>
        </div>
      ))}

      {/* Current state, stated plainly. */}
      <div style={{ display: "grid", gridTemplateColumns: isMobile ? "repeat(2,1fr)" : "repeat(auto-fit,minmax(130px,1fr))", gap: 10 }}>
        {([
          ["Occupied GLA", live.occupiedGLA != null ? `${fmtInt(live.occupiedGLA)} SF` : null],
          ["Vacant GLA", live.vacantGLA != null ? `${fmtInt(live.vacantGLA)} SF` : null],
          ["Units", live.totalUnits != null ? `${live.occupiedUnits ?? "—"} of ${live.totalUnits}` : null],
          ["Datex period", live.period ?? null],
        ] as Array<[string, string | null]>).filter(([, v]) => v).map(([k, v]) => (
          <div key={k}>
            <div style={label}>{k}</div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#383a37", fontVariantNumeric: "tabular-nums" }}>{v}</div>
          </div>
        ))}
      </div>

      {(() => {
        const ro = datexRollover(deal);
        if (!ro.hasData) return null;
        const line = (lbl: string, b: { count: number; sf: number; rent: number }) => (
          <div style={{ border: "1px solid #ece6da", background: "#faf8f4", borderRadius: 9, padding: "9px 11px" }}>
            <div style={{ ...label, marginBottom: 3 }}>{lbl}</div>
            <div style={{ fontSize: 13.5, fontWeight: 700, color: "#383a37" }}>{b.count} lease{b.count === 1 ? "" : "s"} · {fmtInt(b.sf)} SF</div>
            <div style={{ fontSize: 11.5, color: "#6b6a65" }}>${fmtInt(b.rent)}/yr base rent</div>
          </div>
        );
        return (
          <div style={{ marginTop: 14 }}>
            <div style={{ ...label, marginBottom: 6 }}>Rollover — from Datex, as of today</div>
            <div style={{ display: "grid", gridTemplateColumns: isMobile ? "1fr" : "repeat(2,minmax(0,1fr))", gap: 10 }}>
              {line("Next 12 months", ro.y1)}
              {line("13–24 months", ro.y2)}
            </div>
            {ro.next.length > 0 && (
              <div style={{ marginTop: 8, fontSize: 12, color: "#55544f", lineHeight: 1.6 }}>
                Next up: {ro.next.map(n => `${n.name} (${n.expiry.slice(0, 7)}${n.sf ? `, ${fmtInt(n.sf)} SF` : ""})`).join(" · ")}
              </div>
            )}
          </div>
        );
      })()}

      {live.tenants && live.tenants.length > 0 && (
        <div style={{ marginTop: 12, fontSize: 11.5, color: "#94928b" }}>
          {live.tenants.length} tenant{live.tenants.length === 1 ? "" : "s"} currently billed
          {live.vacantSuites?.length ? ` · ${live.vacantSuites.length} vacant suite${live.vacantSuites.length === 1 ? "" : "s"}` : ""}
        </div>
      )}
    </div>
  );
}
