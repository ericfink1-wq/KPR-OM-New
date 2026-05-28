import {
  ComposedChart, Bar, Line, XAxis, YAxis, Cell, LabelList,
  ResponsiveContainer, Tooltip, ReferenceLine,
} from "recharts";
import type { Tenant } from "../lib/idb";
import { isVacant } from "../lib/utils";

interface Props {
  tenants: Tenant[];
  tenantsAsOf?: string | null;
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

interface BucketDatum {
  label: string;
  pct: number;
  cumPct: number;
  rent: number;
  sf: number;
  count: number;
  nearTerm: boolean;
}

export default function LeaseRollover({ tenants, tenantsAsOf }: Props) {
  const occupied = tenants.filter(
    t => !isVacant(t.name)
  );
  if (occupied.length === 0) return null;

  const refDate = tenantsAsOf ? new Date(tenantsAsOf) : new Date();
  const refYear = refDate.getFullYear();

  const withExpiry = occupied
    .filter(t => t.leaseExpiry)
    .map(t => {
      const exp = new Date(t.leaseExpiry!);
      if (isNaN(exp.getTime())) return null;
      const remainingYears = Math.max(
        0,
        (exp.getTime() - refDate.getTime()) / (365.25 * 86_400_000)
      );
      return { ...t, remainingYears, expYear: exp.getFullYear() };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

  const hasExpiry = withExpiry.length > 0;

  // WALT by SF
  const waltSFNum = withExpiry.reduce((acc, t) => acc + toNum(t.sf) * t.remainingYears, 0);
  const waltSFDen = withExpiry.reduce((acc, t) => acc + toNum(t.sf), 0);
  const waltSF = waltSFDen > 0 ? waltSFNum / waltSFDen : null;

  // WALT by rent
  const withRent = withExpiry.filter(t => toNum(t.annualRent) > 0);
  const waltRentNum = withRent.reduce((acc, t) => acc + toNum(t.annualRent) * t.remainingYears, 0);
  const waltRentDen = withRent.reduce((acc, t) => acc + toNum(t.annualRent), 0);
  const waltRent = waltRentDen > 0 ? waltRentNum / waltRentDen : null;

  // Rollover buckets: year+0 … year+9, then "10+"
  const raw: { label: string; sf: number; rent: number; count: number }[] = [];
  for (let i = 0; i <= 9; i++) {
    raw.push({ label: String(refYear + i), sf: 0, rent: 0, count: 0 });
  }
  raw.push({ label: "10+", sf: 0, rent: 0, count: 0 });

  for (const t of withExpiry) {
    const offset = t.expYear - refYear;
    const idx = offset >= 10 ? 10 : Math.max(0, offset);
    raw[idx].sf += toNum(t.sf);
    raw[idx].rent += toNum(t.annualRent);
    raw[idx].count += 1;
  }

  const totalOccupiedRent = occupied.reduce((acc, t) => acc + toNum(t.annualRent), 0);

  // Build chart data with cumulative %
  let running = 0;
  const chartData: BucketDatum[] = raw.map((b, i) => {
    const pct = totalOccupiedRent > 0 ? (b.rent / totalOccupiedRent) * 100 : 0;
    running += pct;
    return {
      label: b.label,
      pct,
      cumPct: Math.min(100, running),
      rent: b.rent,
      sf: b.sf,
      count: b.count,
      nearTerm: i <= 1,
    };
  });

  // 24-month summary: buckets 0, 1, 2 per spec
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
      <div style={{ display: "flex", gap: 28, marginBottom: 16 }}>
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
              {/* Hidden left axis — just for bar scale */}
              <YAxis yAxisId="bar" hide domain={[0, "auto"]} />
              {/* Right axis — cumulative %, 0–100 */}
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
                      <div style={{ color: "#3f7a1f", fontWeight: 600, marginTop: 3, borderTop: "1px solid #f1eadc", paddingTop: 3 }}>
                        {Math.round(d.cumPct)}% cumulative roll
                      </div>
                    </div>
                  );
                }}
              />
              <Bar yAxisId="bar" dataKey="pct" radius={[3, 3, 0, 0]} maxBarSize={44}>
                {chartData.map((entry, index) => (
                  <Cell key={index} fill={entry.nearTerm ? "#8cbf63" : "#3f7a1f"} />
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
          <div style={{ display: "flex", gap: 16, alignItems: "center", marginTop: 4, marginBottom: 4 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 10, height: 10, borderRadius: 2, background: "#3f7a1f" }} />
              <span style={{ fontSize: 10, color: "#a89f8f", fontFamily: "'Inter',sans-serif" }}>Roll by year</span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
              <div style={{ width: 14, height: 2, background: "#c97a18", borderRadius: 1 }} />
              <span style={{ fontSize: 10, color: "#a89f8f", fontFamily: "'Inter',sans-serif" }}>Cumulative roll %</span>
            </div>
          </div>

          <div style={{ fontSize: 11, color: "#a89f8f", marginTop: 2, fontFamily: "'Inter',sans-serif" }}>
            <strong style={{ color: "#383a37", fontWeight: 600 }}>{pct24mo}%</strong> of base rent rolls in the next 24 months.
          </div>
        </>
      )}
    </div>
  );
}
