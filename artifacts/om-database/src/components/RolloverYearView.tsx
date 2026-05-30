import { useState, useEffect } from "react";
import { useIsMobile } from "../hooks/use-mobile";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface RolloverTenant {
  name: string;
  dealName: string;
  sf: number | null;
  annualRent: number | null;
  expiryDate: string | null;
  dealStatus: string | null;
}

interface RolloverDetail {
  year: string;
  tenants: RolloverTenant[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fmtRent(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}k`;
  return `$${Math.round(n)}`;
}

function fmtSF(n: number | null): string {
  if (n == null) return "—";
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return Math.round(n).toLocaleString();
}

function fmtDate(d: string | null): string {
  if (!d) return "—";
  const dt = new Date(d + "T00:00:00");
  if (isNaN(dt.getTime())) return d;
  return dt.toLocaleDateString("en-US", { month: "short", year: "numeric" });
}

const STATUS_BADGE: Record<string, { bg: string; color: string }> = {
  Owned:            { bg: "#e6f4d5", color: "#3f7a1f" },
  Sold:             { bg: "#fef3c7", color: "#92400e" },
  "Under Contract": { bg: "#dbeafe", color: "#1d4ed8" },
  Prospect:         { bg: "#f3f4f6", color: "#6b7280" },
  Passed:           { bg: "#fce7f3", color: "#9d174d" },
};

function StatusBadge({ status }: { status: string | null }) {
  if (!status) return <span style={{ color: "#c9c2b8", fontSize: 10 }}>—</span>;
  const style = STATUS_BADGE[status] ?? { bg: "#f3f4f6", color: "#6b7280" };
  return (
    <span style={{
      display: "inline-block",
      padding: "2px 7px",
      borderRadius: 20,
      fontSize: 10,
      fontWeight: 600,
      background: style.bg,
      color: style.color,
      whiteSpace: "nowrap",
      fontFamily: "'Inter',sans-serif",
    }}>
      {status}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  year: string;
  filterDealIds?: string[];
  onBack: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function RolloverYearView({ year, filterDealIds, onBack }: Props) {
  const isMobile = useIsMobile();
  const [data, setData] = useState<RolloverDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
    let url = `/api/analytics/rollover-detail?year=${encodeURIComponent(year)}`;
    if (filterDealIds && filterDealIds.length > 0) {
      url += "&" + filterDealIds.map(id => `dealId[]=${encodeURIComponent(id)}`).join("&");
    }
    fetch(url, { credentials: "include" })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json() as Promise<RolloverDetail>; })
      .then(d => { setData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [year, filterDealIds]);

  const totalRent = data?.tenants.reduce((s, t) => s + (t.annualRent ?? 0), 0) ?? 0;
  const totalSF   = data?.tenants.reduce((s, t) => s + (t.sf ?? 0), 0) ?? 0;

  return (
    <div style={{ padding: isMobile ? "16px" : "28px 32px", maxWidth: 1100, margin: "0 auto", boxSizing: "border-box", width: "100%" }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 22, flexWrap: "wrap" }}>
        <button
          onClick={onBack}
          style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#7d766a", padding: "5px 12px", borderRadius: 6, cursor: "pointer", fontSize: 11, fontFamily: "'Inter',sans-serif", flexShrink: 0, marginTop: 4 }}
        >
          ← Back
        </button>
        <div>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: isMobile ? 20 : 24, fontWeight: 500, color: "#26281f", letterSpacing: "-0.02em", lineHeight: 1.15 }}>
            {year === "Unknown" ? "Unknown Expiry" : `${year} Lease Rollovers`}
          </div>
          {data && (
            <div style={{ fontSize: 12, color: "#a89f8f", marginTop: 3 }}>
              {data.tenants.length} tenant{data.tenants.length !== 1 ? "s" : ""}
              {totalRent > 0 && <> · {fmtRent(totalRent)} total annual rent</>}
              {totalSF > 0 && <> · {fmtSF(totalSF)} SF</>}
            </div>
          )}
        </div>
      </div>

      {/* States */}
      {loading && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#a89f8f", fontSize: 13 }}>Loading…</div>
      )}
      {error && (
        <div style={{ background: "#fef2f2", border: "1px solid #fecaca", borderRadius: 10, padding: "14px 18px", color: "#b91c1c", fontSize: 13 }}>
          Failed to load: {error}
        </div>
      )}
      {!loading && !error && data && data.tenants.length === 0 && (
        <div style={{ textAlign: "center", padding: "60px 0", color: "#a89f8f", fontSize: 13 }}>
          No tenants with lease expiry in {year === "Unknown" ? "unknown year" : year}.
        </div>
      )}

      {!loading && !error && data && data.tenants.length > 0 && (
        isMobile ? (
          // Mobile: stacked cards
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            {data.tenants.map((t, i) => (
              <div key={i} style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 10, padding: "14px 16px" }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8, marginBottom: 8 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, color: "#26281f", lineHeight: 1.3, flex: 1, minWidth: 0 }}>
                    {t.name}
                  </div>
                  <StatusBadge status={t.dealStatus} />
                </div>
                <div style={{ fontSize: 11, color: "#a89f8f", marginBottom: 8, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                  {t.dealName || "—"}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px 12px" }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#b8b0a3", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 1 }}>Annual Rent</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#383a37" }}>{fmtRent(t.annualRent)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "#b8b0a3", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 1 }}>SF</div>
                    <div style={{ fontSize: 13, fontWeight: 600, color: "#383a37" }}>{fmtSF(t.sf)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "#b8b0a3", textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 1 }}>Expiry</div>
                    <div style={{ fontSize: 12, color: "#5c5850" }}>{fmtDate(t.expiryDate)}</div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          // Desktop: table
          <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 12, overflow: "hidden" }}>
            <table style={{ width: "100%", borderCollapse: "collapse", tableLayout: "fixed" }}>
              <colgroup>
                <col style={{ width: 32 }} />
                <col />
                <col style={{ width: "35%" }} />
                <col style={{ width: 100 }} />
                <col style={{ width: 80 }} />
                <col style={{ width: 90 }} />
                <col style={{ width: 110 }} />
              </colgroup>
              <thead>
                <tr style={{ background: "#faf7f0", borderBottom: "1px solid #ece5d7" }}>
                  <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "#a89f8f", fontWeight: 700, letterSpacing: "0.05em" }}>#</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, color: "#a89f8f", fontWeight: 700, letterSpacing: "0.05em" }}>TENANT</th>
                  <th style={{ padding: "10px 14px", textAlign: "left", fontSize: 10, color: "#a89f8f", fontWeight: 700, letterSpacing: "0.05em" }}>PROPERTY</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "#a89f8f", fontWeight: 700, letterSpacing: "0.05em" }}>ANNUAL RENT</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "#a89f8f", fontWeight: 700, letterSpacing: "0.05em" }}>SF</th>
                  <th style={{ padding: "10px 14px", textAlign: "right", fontSize: 10, color: "#a89f8f", fontWeight: 700, letterSpacing: "0.05em" }}>EXPIRY</th>
                  <th style={{ padding: "10px 14px", textAlign: "center", fontSize: 10, color: "#a89f8f", fontWeight: 700, letterSpacing: "0.05em" }}>STATUS</th>
                </tr>
              </thead>
              <tbody>
                {data.tenants.map((t, i) => (
                  <tr key={i} style={{ borderBottom: "1px solid #f5f1ea" }}>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 10.5, color: "#c9c2b8" }}>{i + 1}</td>
                    <td style={{ padding: "10px 14px", fontWeight: 600, fontSize: 12, color: "#26281f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.name}
                    </td>
                    <td style={{ padding: "10px 14px", fontSize: 11, color: "#6f6a5f", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {t.dealName || "—"}
                    </td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 12, color: "#383a37", fontWeight: 600 }}>{fmtRent(t.annualRent)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 11, color: "#6f6a5f" }}>{fmtSF(t.sf)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 11, color: "#6f6a5f" }}>{fmtDate(t.expiryDate)}</td>
                    <td style={{ padding: "10px 14px", textAlign: "center" }}><StatusBadge status={t.dealStatus} /></td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid #ece5d7", background: "#faf7f0" }}>
                  <td />
                  <td style={{ padding: "10px 14px", fontSize: 11, color: "#a89f8f", fontWeight: 600 }}>
                    {data.tenants.length} tenant{data.tenants.length !== 1 ? "s" : ""}
                  </td>
                  <td />
                  <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 12, color: "#383a37", fontWeight: 600 }}>{fmtRent(totalRent)}</td>
                  <td style={{ padding: "10px 14px", textAlign: "right", fontSize: 11, color: "#6f6a5f" }}>{totalSF > 0 ? fmtSF(totalSF) : "—"}</td>
                  <td /><td />
                </tr>
              </tfoot>
            </table>
          </div>
        )
      )}
    </div>
  );
}
