import {
  ComposedChart, Bar, Line, XAxis, YAxis, Cell, LabelList,
  ResponsiveContainer, Tooltip, ReferenceLine,
} from "recharts";
import type { Tenant } from "../lib/idb";
import { isVacant, parseLeaseDate } from "../lib/utils";
import { RISK_BAND_META, type TenantRenewalRisk, type RentAtRisk, type RenewalRiskBand } from "../lib/renewalRisk";

interface Props {
  tenants: Tenant[];
  tenantsAsOf?: string | null;
  // Per-tenant renewal-risk read (buildRenewalRiskIndex). When present the bars
  // stack by risk band — WHICH expirations to worry about, not just when.
  risks?: Map<Tenant, TenantRenewalRisk> | null;
  rentAtRisk?: RentAtRisk | null;
}

function toNum(v: number | string | null | undefined): number {
  if (v == null) return 0;
  const n = typeof v === "string" ? parseFloat(v) : v;
  return isNaN(n) ? 0 : n;
}

function fmtRent(r: number): string {
  if (r >= 1_000_000) return `$${(r / 1_000_000).toFixed(1)}M`;
  if (r >= 1_000) return `$${Math.round(r / 1_000)}K`;
  return `$${Math.round(r)}`;
}

const BANDS: RenewalRiskBand[] = ["secure", "likely", "uncertain", "at-risk"];

interface BucketDatum {
  label: string;
  pct: number;
  cumPct: number;
  rent: number;
  sf: number;
  count: number;
  nearTerm: boolean;
  isPast: boolean;
  // % of total occupied rent in this bucket, split by renewal-risk band
  secureP: number;
  likelyP: number;
  uncertainP: number;
  atRiskP: number;
  // $ split for the tooltip
  bandRent: Record<RenewalRiskBand, number>;
}

// Date parsing is shared from lib/utils (parseLeaseDate) so the rollover chart,
// roster math, and WALT all bucket dates identically — a local copy here once
// drifted and is exactly the kind of inconsistency to avoid.

export default function LeaseRollover({ tenants, tenantsAsOf, risks, rentAtRisk }: Props) {
  const occupied = tenants.filter(t => !isVacant(t.name));
  if (occupied.length === 0) return null;

  // Parse the as-of date the same way as lease dates (local noon) — a bare
  // "YYYY-MM-DD" via new Date() is UTC midnight, which in US time zones lands on
  // the prior day and could shift the whole rollover bucketing by a year at a
  // year boundary.
  const refDate = (tenantsAsOf && parseLeaseDate(tenantsAsOf)) || new Date();
  const refYear = refDate.getFullYear();

  const withExpiry = occupied
    .filter(t => t.leaseExpiry)
    .map(t => {
      const exp = parseLeaseDate(t.leaseExpiry);
      if (!exp) return null;
      const remainingYears = Math.max(
        0,
        (exp.getTime() - refDate.getTime()) / (365.25 * 86_400_000)
      );
      return { t, remainingYears, expYear: exp.getFullYear() };
    })
    .filter((x): x is NonNullable<typeof x> => x !== null);

  const hasExpiry = withExpiry.length > 0;
  const hasRisk = !!risks && risks.size > 0;

  // WALT by SF
  const waltSFNum = withExpiry.reduce((acc, x) => acc + toNum(x.t.sf) * x.remainingYears, 0);
  const waltSFDen = withExpiry.reduce((acc, x) => acc + toNum(x.t.sf), 0);
  const waltSF = waltSFDen > 0 ? waltSFNum / waltSFDen : null;

  // WALT by rent
  const withRent = withExpiry.filter(x => toNum(x.t.annualRent) > 0);
  const waltRentNum = withRent.reduce((acc, x) => acc + toNum(x.t.annualRent) * x.remainingYears, 0);
  const waltRentDen = withRent.reduce((acc, x) => acc + toNum(x.t.annualRent), 0);
  const waltRent = waltRentDen > 0 ? waltRentNum / waltRentDen : null;

  // Rollover buckets: year+0 … year+9, then "10+". Leases that already expired
  // (offset < 0) are holdovers/MTM — they used to be silently lumped into the
  // current-year bar, which hid them. Collect them in a leading "Past" bucket so
  // an analyst can see month-to-month exposure at a glance.
  const mkBandRent = (): Record<RenewalRiskBand, number> => ({ secure: 0, likely: 0, uncertain: 0, "at-risk": 0 });
  const mkBucket = (label: string) => ({ label, sf: 0, rent: 0, count: 0, bandRent: mkBandRent() });
  const raw: ReturnType<typeof mkBucket>[] = [];
  for (let i = 0; i <= 9; i++) raw.push(mkBucket(String(refYear + i)));
  raw.push(mkBucket("10+"));
  const past = mkBucket("Past/MTM");

  for (const x of withExpiry) {
    const offset = x.expYear - refYear;
    const bucket = offset < 0 ? past : raw[offset >= 10 ? 10 : offset];
    bucket.sf += toNum(x.t.sf);
    bucket.rent += toNum(x.t.annualRent);
    bucket.count += 1;
    // A holdover with no risk entry still lands in a band ("likely" = base rate)
    // so stacked bars always sum to the bucket total.
    const band: RenewalRiskBand = risks?.get(x.t)?.band ?? "likely";
    bucket.bandRent[band] += toNum(x.t.annualRent);
  }

  // Only surface the Past bucket when there's actually holdover exposure, so a
  // clean roster looks exactly as it did before.
  const displayBuckets = past.count > 0 ? [past, ...raw] : raw;

  const totalOccupiedRent = occupied.reduce((acc, t) => acc + toNum(t.annualRent), 0);

  // Coverage: % of occupied base rent with a successfully parsed expiry
  const coveredRent = withExpiry.reduce((acc, x) => acc + toNum(x.t.annualRent), 0);
  const coveragePct = totalOccupiedRent > 0 ? Math.round((coveredRent / totalOccupiedRent) * 100) : 100;
  const showCoverageWarning = totalOccupiedRent > 0 && coveragePct < 90;

  const curLabel = String(refYear), nextLabel = String(refYear + 1);
  // Build chart data with cumulative %
  let running = 0;
  const chartData: BucketDatum[] = displayBuckets.map((b) => {
    const pctOf = (v: number) => totalOccupiedRent > 0 ? (v / totalOccupiedRent) * 100 : 0;
    const pct = pctOf(b.rent);
    running += pct;
    const isPast = b.label === "Past/MTM";
    return {
      label: b.label,
      pct,
      cumPct: Math.min(100, running),
      rent: b.rent,
      sf: b.sf,
      count: b.count,
      nearTerm: b.label === curLabel || b.label === nextLabel,
      isPast,
      secureP: pctOf(b.bandRent.secure),
      likelyP: pctOf(b.bandRent.likely),
      uncertainP: pctOf(b.bandRent.uncertain),
      atRiskP: pctOf(b.bandRent["at-risk"]),
      bandRent: b.bandRent,
    };
  });

  // 24-month summary: current year + next two (Past excluded — it has already rolled)
  const rent24mo = raw.slice(0, 3).reduce((acc, b) => acc + b.rent, 0);
  const pct24mo = totalOccupiedRent > 0
    ? Math.round((rent24mo / totalOccupiedRent) * 100)
    : 0;

  return (
    <div style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: 12, padding: "16px 18px", marginBottom: 12 }}>
      <div style={{ fontSize: 9, letterSpacing: "0.12em", color: "#958d80", fontWeight: 700, textTransform: "uppercase", marginBottom: 12 }}>
        Lease Rollover &amp; WALT
      </div>

      {/* WALT stats */}
      <div style={{ display: "flex", gap: 28, marginBottom: 16, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 10, color: "#a89f8f", marginBottom: 3, fontFamily: "'Inter',sans-serif" }}>WALT (by SF)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#2a2c28", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>
            {waltSF != null ? `${waltSF.toFixed(1)} yrs` : "—"}
          </div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "#a89f8f", marginBottom: 3, fontFamily: "'Inter',sans-serif" }}>WALT (by rent)</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: "#2a2c28", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>
            {waltRent != null ? `${waltRent.toFixed(1)} yrs` : "—"}
          </div>
        </div>
        {hasRisk && rentAtRisk && rentAtRisk.tenantsInWindow > 0 && (
          <div title={`Base rent expiring within 36 months, weighted by each tenant's estimated renewal probability (occupancy cost, sales trend, watchlist, credit, options). ${fmtRent(rentAtRisk.expiring)} expires in the window in total.`}>
            <div style={{ fontSize: 10, color: "#a06430", marginBottom: 3, fontFamily: "'Inter',sans-serif" }}>Rent at risk (36 mo)</div>
            <div style={{ fontSize: 20, fontWeight: 700, color: "#b3541a", fontFamily: "'Fraunces',Georgia,serif", lineHeight: 1 }}>
              {fmtRent(rentAtRisk.atRisk)}
              {rentAtRisk.pctOfRent != null && (
                <span style={{ fontSize: 12, color: "#a06430", fontWeight: 600 }}> · {Math.round(rentAtRisk.pctOfRent)}%</span>
              )}
            </div>
          </div>
        )}
      </div>

      {!hasExpiry ? (
        <p style={{ margin: 0, fontSize: 12, color: "#a89f8f", fontStyle: "italic" }}>
          No lease expiration dates available.
        </p>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={210}>
            <ComposedChart data={chartData} margin={{ top: 22, right: 42, left: 4, bottom: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: "#a89f8f", fontFamily: "'Inter',sans-serif" }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis yAxisId="bar" hide domain={[0, "auto"]} />
              <YAxis
                yAxisId="cum"
                orientation="right"
                domain={[0, 100]}
                tickFormatter={v => `${v}%`}
                tick={{ fontSize: 9, fill: "#c0b8ab", fontFamily: "'Inter',sans-serif" }}
                axisLine={false}
                tickLine={false}
                width={34}
                ticks={[0, 25, 50, 75, 100]}
              />
              <ReferenceLine yAxisId="cum" y={50} stroke="#e7e0d2" strokeDasharray="3 3" />
              <Tooltip
                cursor={{ fill: "rgba(63,122,31,0.06)" }}
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const d = payload[0].payload as BucketDatum;
                  return (
                    <div style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: 7, padding: "7px 11px", fontSize: 11, fontFamily: "'Inter',sans-serif", boxShadow: "0 4px 14px rgba(0,0,0,0.1)", lineHeight: 1.55 }}>
                      <div style={{ fontWeight: 700, color: "#2a2c28", marginBottom: 2 }}>{d.label}</div>
                      <div style={{ color: "#52554e" }}>{fmtRent(d.rent)} · {Math.round(d.pct)}% of rent</div>
                      <div style={{ color: "#a89f8f" }}>{Math.round(d.sf).toLocaleString()} SF · {d.count} tenant{d.count !== 1 ? "s" : ""}</div>
                      {hasRisk && d.rent > 0 && (
                        <div style={{ marginTop: 3, borderTop: "1px solid #f1eadc", paddingTop: 3 }}>
                          {BANDS.filter(b => d.bandRent[b] > 0).map(b => (
                            <div key={b} style={{ color: RISK_BAND_META[b].color, fontWeight: 600 }}>
                              {RISK_BAND_META[b].label}: {fmtRent(d.bandRent[b])}
                            </div>
                          ))}
                        </div>
                      )}
                      <div style={{ color: "#3f7a1f", fontWeight: 600, marginTop: 3, borderTop: "1px solid #f1eadc", paddingTop: 3 }}>
                        {Math.round(d.cumPct)}% cumulative roll
                      </div>
                    </div>
                  );
                }}
              />
              {hasRisk ? (
                <>
                  {/* Stacked by renewal-risk band: WHICH expirations to worry about */}
                  <Bar yAxisId="bar" dataKey="secureP" stackId="roll" fill={RISK_BAND_META.secure.color} maxBarSize={44} />
                  <Bar yAxisId="bar" dataKey="likelyP" stackId="roll" fill={RISK_BAND_META.likely.color} maxBarSize={44} />
                  <Bar yAxisId="bar" dataKey="uncertainP" stackId="roll" fill={RISK_BAND_META.uncertain.color} maxBarSize={44} />
                  <Bar yAxisId="bar" dataKey="atRiskP" stackId="roll" fill={RISK_BAND_META["at-risk"].color} radius={[3, 3, 0, 0]} maxBarSize={44}>
                    <LabelList
                      dataKey="pct"
                      position="top"
                      formatter={(v: unknown) => {
                        const n = typeof v === "number" ? v : 0;
                        return n >= 1 ? `${Math.round(n)}%` : "";
                      }}
                      style={{ fontSize: 9, fill: "#6f6a5f", fontFamily: "'Inter',sans-serif" }}
                    />
                  </Bar>
                </>
              ) : (
                <Bar yAxisId="bar" dataKey="pct" radius={[3, 3, 0, 0]} maxBarSize={44}>
                  {chartData.map((entry, index) => (
                    <Cell key={index} fill={entry.isPast ? "#c97a18" : entry.nearTerm ? "#8cbf63" : "#3f7a1f"} />
                  ))}
                  <LabelList
                    dataKey="pct"
                    position="top"
                    formatter={(v: unknown) => {
                      const n = typeof v === "number" ? v : 0;
                      return n >= 1 ? `${Math.round(n)}%` : "";
                    }}
                    style={{ fontSize: 9, fill: "#6f6a5f", fontFamily: "'Inter',sans-serif" }}
                  />
                </Bar>
              )}
              <Line
                yAxisId="cum"
                dataKey="cumPct"
                type="monotone"
                stroke="#c97a18"
                strokeWidth={1.5}
                dot={{ r: 2.5, fill: "#c97a18", strokeWidth: 0 }}
                activeDot={{ r: 4, fill: "#c97a18", strokeWidth: 0 }}
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 4, marginBottom: 4, flexWrap: "wrap" }}>
            {hasRisk ? (
              BANDS.map(b => (
                <div key={b} style={{ display: "flex", alignItems: "center", gap: 5 }}>
                  <div style={{ width: 10, height: 10, borderRadius: 2, background: RISK_BAND_META[b].color }} />
                  <span style={{ fontSize: 10, color: "#a89f8f", fontFamily: "'Inter',sans-serif" }}>{RISK_BAND_META[b].label}</span>
                </div>
              ))
            ) : (
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <div style={{ width: 10, height: 10, borderRadius: 2, background: "#3f7a1f" }} />
                <span style={{ fontSize: 10, color: "#a89f8f", fontFamily: "'Inter',sans-serif" }}>Roll by year</span>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 14, height: 2, background: "#c97a18", borderRadius: 1 }} />
              <span style={{ fontSize: 10, color: "#a89f8f", fontFamily: "'Inter',sans-serif" }}>Cumulative roll %</span>
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#a89f8f", marginTop: 2, fontFamily: "'Inter',sans-serif" }}>
            <strong style={{ color: "#383a37", fontWeight: 600 }}>{pct24mo}%</strong> of base rent rolls in the next 24 months.
            {hasRisk && rentAtRisk && rentAtRisk.tenantsInWindow > 0 && (
              <> Weighted by renewal probability, <strong style={{ color: "#b3541a", fontWeight: 600 }}>{fmtRent(rentAtRisk.atRisk)}/yr</strong> of the rent expiring within 36 months is genuinely at risk.</>
            )}
          </div>

          {showCoverageWarning && (
            <div style={{ marginTop: 10, padding: "7px 10px", background: "#fff8ee", border: "1px solid #f0c97a", borderRadius: 7, fontSize: 11, color: "#7a5200", fontFamily: "'Inter',sans-serif", lineHeight: 1.45 }}>
              ⚠ Lease-expiry data incomplete — WALT/rollover reflect only <strong>{coveragePct}%</strong> of base rent.
            </div>
          )}
        </>
      )}
    </div>
  );
}
