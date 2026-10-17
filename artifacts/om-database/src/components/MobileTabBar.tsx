import { useState } from "react";
import { ANALYTICS_GROUPS } from "./Header";

// Phone navigation (Eric, 10/16/26): the top nav strip scrolled sideways with no hint
// there was more. Below 768px the main sections live here instead — Analyst · Deals ·
// Comps · Analytics · More. "Analytics" opens a sheet with every analytics page;
// "More" opens the account menu (upload, rates, house view, settings…).
interface Props {
  tab: string;
  onTab: (t: string) => void;
  onAnalyticsNav?: (dest: string) => void;
}

export const MOBILE_TAB_BAR_H = 60;

export default function MobileTabBar({ tab, onTab, onAnalyticsNav }: Props) {
  const [sheet, setSheet] = useState(false);
  // Drawn icons — symbol characters render inconsistently (or as a speck) on iOS.
  const ICON: Record<string, string> = {
    Analyst: "M12 3l1.9 5.6L19.5 10l-5.6 1.9L12 17.5l-1.9-5.6L4.5 10l5.6-1.4z",
    Deals: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
    Comps: "M4 8h13l-3-3M20 16H7l3 3",
    Analytics: "M5 20V11M12 20V5M19 20v-6",
    More: "M4 7h16M4 12h16M4 17h16",
  };
  const item = (label: string, _icon: string, active: boolean, onClick: () => void) => (
    <button key={label} onClick={onClick} aria-current={active ? "page" : undefined}
      style={{ flex: 1, minWidth: 0, background: "none", border: "none", padding: "6px 2px 4px", display: "flex", flexDirection: "column", alignItems: "center", gap: 2, cursor: "pointer", color: active ? "#2a2c27" : "#958d80", fontFamily: "'Inter',sans-serif" }}>
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={active ? 2.2 : 1.8} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={ICON[label]} /></svg>
      <span style={{ fontSize: 10.5, fontWeight: active ? 700 : 500 }}>{label}</span>
      <span style={{ width: 18, height: 2.5, borderRadius: 2, background: active ? "#6dba43" : "transparent" }} />
    </button>
  );
  return (
    <>
      <nav aria-label="Main" style={{ flexShrink: 0, height: MOBILE_TAB_BAR_H, paddingBottom: "env(safe-area-inset-bottom)", boxSizing: "content-box", display: "flex", alignItems: "stretch", background: "rgba(252,250,245,0.97)", borderTop: "1px solid #e7e0d2", backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)", zIndex: 150 }}>
        {item("Analyst", "✦", tab === "analyst", () => onTab("analyst"))}
        {item("Deals", "▦", tab === "portfolio", () => onTab("portfolio"))}
        {item("Comps", "⇄", tab === "comps", () => onTab("comps"))}
        {item("Analytics", "◔", tab === "analytics", () => setSheet(true))}
        {item("More", "☰", false, () => window.dispatchEvent(new Event("kpr:open-menu")))}
      </nav>
      {sheet && (
        <>
          <div onClick={() => setSheet(false)} style={{ position: "fixed", inset: 0, zIndex: 1200, background: "rgba(38,40,31,0.42)" }} />
          <div role="dialog" aria-label="Analytics" style={{ position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 1201, background: "#fff", borderRadius: "16px 16px 0 0", padding: "8px 0 calc(12px + env(safe-area-inset-bottom))", maxHeight: "75vh", overflowY: "auto", boxShadow: "0 -12px 40px rgba(38,40,31,0.2)" }}>
            <div style={{ width: 40, height: 4, borderRadius: 2, background: "#e1d9c8", margin: "4px auto 8px" }} />
            {(["portfolio", "tenant"] as const).map(g => (
              <div key={g}>
                <div style={{ padding: "10px 18px 4px", fontSize: 10, fontWeight: 800, letterSpacing: "0.1em", color: "#a69e91", textTransform: "uppercase" }}>
                  {g === "portfolio" ? "Portfolio analytics" : "Tenant analytics"}
                </div>
                {ANALYTICS_GROUPS[g].map(([label, dest]) => (
                  <button key={dest} onClick={() => { setSheet(false); onAnalyticsNav?.(dest); }}
                    style={{ display: "block", width: "100%", textAlign: "left", background: "none", border: "none", borderBottom: "1px solid #f4efe5", padding: "14px 18px", fontSize: 14.5, color: "#383a37", fontFamily: "'Inter',sans-serif", cursor: "pointer" }}>
                    {label}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
