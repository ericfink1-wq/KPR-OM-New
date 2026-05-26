import { STATUS_COLORS } from "../lib/constants";
import type { Deal } from "../lib/idb";

interface Props {
  tab: string;
  onTab: (t: string) => void;
  deals: Deal[];
  queueLen: number;
  onLogout?: () => void;
}

export default function Header({ tab, onTab, deals, queueLen, onLogout }: Props) {
  const active = deals.filter(d => !d.trashedAt);
  const stats = [
    { label: "DEALS", val: active.length, color: "#383a37" },
    { label: "PROSPECT", val: active.filter(d => d.status === "Prospect").length, color: STATUS_COLORS.Prospect },
    { label: "UNDER CONTRACT", val: active.filter(d => d.status === "Under Contract").length, color: STATUS_COLORS["Under Contract"] },
    { label: "OWNED", val: active.filter(d => d.status === "Owned").length, color: STATUS_COLORS.Owned },
    { label: "SOLD", val: active.filter(d => d.status === "Sold").length, color: STATUS_COLORS.Sold },
    { label: "PASSED", val: active.filter(d => d.status === "Passed").length, color: STATUS_COLORS.Passed },
  ];

  const tabs = [
    { id: "analyst", label: "Analyst" },
    { id: "portfolio", label: "Portfolio" },
  ];

  return (
    <div style={{
      background: "rgba(250,247,240,0.9)",
      backdropFilter: "blur(18px)",
      borderBottom: "1px solid #e7e0d2",
      padding: "0 28px",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      gap: 16,
      height: 52,
      position: "sticky",
      top: 0,
      zIndex: 100,
    }}>
      {/* Logo + tabs */}
      <div style={{ display: "flex", alignItems: "center", gap: 0 }}>
        <div style={{ marginRight: 24 }}>
          <span style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 600, color: "#26281f", letterSpacing: "-0.02em" }}>KPR</span>
          <span style={{ fontFamily: "'Inter', sans-serif", fontSize: 10, fontWeight: 700, letterSpacing: "0.16em", color: "#a89f8f", marginLeft: 6, textTransform: "uppercase" }}>OM Database</span>
        </div>
        {tabs.map(t => (
          <button key={t.id} onClick={() => onTab(t.id)}
            style={{
              background: "transparent", border: "none", cursor: "pointer",
              fontFamily: "'Inter', sans-serif", fontSize: 12, fontWeight: tab === t.id ? 700 : 500,
              color: tab === t.id ? "#383a37" : "#a89f8f",
              padding: "0 14px", height: 52,
              borderBottom: tab === t.id ? "2px solid #383a37" : "2px solid transparent",
              letterSpacing: "0.02em",
              transition: "color .15s ease, border-color .15s ease",
            }}>
            {t.label}
            {t.id === "analyst" && queueLen > 0 && (
              <span style={{ marginLeft: 5, background: "#6dba43", color: "#1f2b16", fontSize: 9, fontWeight: 700, padding: "1px 5px", borderRadius: 10 }}>
                {queueLen}
              </span>
            )}
          </button>
        ))}
      </div>
      {/* Stats + logout */}
      <div style={{ display: "flex", gap: 18, alignItems: "center" }} className="hdr-stats">
        {stats.map(s => (
          <div key={s.label} style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Fraunces', serif", fontSize: 16, fontWeight: 500, color: s.color, lineHeight: 1 }}>{s.val}</div>
            <div style={{ fontSize: 8, letterSpacing: "0.1em", color: "#b3aa9b", fontWeight: 600, textTransform: "uppercase" }}>{s.label}</div>
          </div>
        ))}
        {onLogout && (
          <button onClick={onLogout}
            style={{ background: "transparent", border: "1px solid #e7e0d2", color: "#a89f8f", padding: "4px 10px", borderRadius: 6, cursor: "pointer", fontSize: 10, fontFamily: "'Inter',sans-serif", letterSpacing: "0.04em", marginLeft: 4 }}>
            Sign out
          </button>
        )}
      </div>
    </div>
  );
}
