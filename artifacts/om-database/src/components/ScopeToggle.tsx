// Shared "Owned / All deals" scope toggle used by the portfolio analytics views
// (Critical Dates, Mark-to-Market, Co-Tenancy Cascade) so they look and behave the
// same. "Owned" means deals currently held (status === "Owned").
export type Scope = "owned" | "all";

export function scopeDeals<T extends { status?: string | null }>(deals: T[], scope: Scope): T[] {
  return scope === "owned" ? deals.filter(d => d.status === "Owned") : deals;
}

export default function ScopeToggle({ scope, onChange, ownedCount, allCount }: {
  scope: Scope;
  onChange: (s: Scope) => void;
  ownedCount?: number;
  allCount?: number;
}) {
  const opt = (val: Scope, label: string, count?: number) => {
    const on = scope === val;
    return (
      <button onClick={() => onChange(val)}
        style={{
          padding: "7px 14px", fontSize: 12, fontWeight: 700, cursor: "pointer", minHeight: 34,
          border: "none", borderRadius: 999,
          background: on ? "#3f7a1f" : "transparent",
          color: on ? "#fff" : "#7d766a",
        }}>
        {label}{count != null ? ` (${count})` : ""}
      </button>
    );
  };
  return (
    <div style={{ display: "inline-flex", alignItems: "center", gap: 2, background: "#efe9dc", border: "1px solid #e0d8c8", borderRadius: 999, padding: 2 }}>
      {opt("owned", "Owned", ownedCount)}
      {opt("all", "All deals", allCount)}
    </div>
  );
}
