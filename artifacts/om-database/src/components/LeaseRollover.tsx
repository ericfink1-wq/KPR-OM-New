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

// ---------------------------------------------------------------------------
// Robust date parser — handles:
//   YYYY-MM-DD  (ISO)
//   YYYY-MM     (end of that month)
//   MM/DD/YYYY  M/D/YY  M/D/YYYY
//   Mon-YYYY    Mon YYYY  (e.g. "Jan-2030", "January 2030") → end of month
//   YYYY        (bare year → Dec 31)
// ---------------------------------------------------------------------------
const MONTH_MAP: Record<string, number> = {
  jan:0, feb:1, mar:2, apr:3, may:4, jun:5,
  jul:6, aug:7, sep:8, oct:9, nov:10, dec:11,
};

function parseLeaseDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;

  // YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const d = new Date(s + "T12:00:00");
    return isNaN(d.getTime()) ? null : d;
  }

  // YYYY-MM → end of that month
  if (/^\d{4}-\d{2}$/.test(s)) {
    const [y, m] = s.split("-").map(Number);
    return new Date(y, m, 0, 12, 0, 0); // day 0 = last day of month m
  }

  // MM/DD/YYYY or M/D/YY or M/D/YYYY
  if (/^\d{1,2}\/\d{1,2}\/\d{2,4}$/.test(s)) {
    const [mo, d, y] = s.split("/").map(Number);
    const fullY = y < 100 ? (y < 50 ? 2000 + y : 1900 + y) : y;
    const dt = new Date(fullY, mo - 1, d, 12, 0, 0);
    return isNaN(dt.getTime()) ? null : dt;
  }

  // Mon-YYYY or Mon YYYY (e.g. "Jan-2030", "January 2030")
  const monYear = s.match(/^([A-Za-z]{3,9})[-\s](\d{4})$/);
  if (monYear) {
    const key = monYear[1].toLowerCase().slice(0, 3);
    const mon = MONTH_MAP[key];
    const yr = parseInt(monYear[2], 10);
    if (mon !== undefined && !isNaN(yr)) {
      return new Date(yr, mon + 1, 0, 12, 0, 0); // last day of that month
    }
  }

  // Bare YYYY → Dec 31
  if (/^\d{4}$/.test(s)) {
    return new Date(parseInt(s, 10), 11, 31, 12, 0, 0);
  }

  // Native fallback
  const d = new Date(s);
  return isNaN(d.getTime()) ? null : d;
}

export default function LeaseRollover({ tenants, tenantsAsOf }: Props) {
  const occupied = tenants.filter(t => !isVacant(t.name));
  if (occupied.length === 0) return null;

  const refDate = tenantsAsOf ? new Date(tenantsAsOf) : new Date();
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
