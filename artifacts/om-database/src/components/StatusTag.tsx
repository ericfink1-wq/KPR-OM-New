import { STATUS_OPTS, STATUS_COLORS } from "../lib/constants";

interface Props {
  status?: string;
  onChange?: (s: string) => void;
  size?: "sm" | "md";
}

export default function StatusTag({ status, onChange, size = "md" }: Props) {
  const color = STATUS_COLORS[status || ""] || "#a69e91";
  if (!onChange) {
    return (
      <span style={{
        display: "inline-flex", alignItems: "center", gap: 5,
        background: `${color}18`, border: `1px solid ${color}55`,
        padding: size === "sm" ? "1px 7px" : "3px 10px", borderRadius: 20,
        fontSize: size === "sm" ? 9 : 10, fontWeight: 700, color,
        letterSpacing: "0.05em", textTransform: "uppercase",
      }}>
        <span style={{ width: 5, height: 5, borderRadius: "50%", background: color }}/>
        {status || "—"}
      </span>
    );
  }
  // Inline chevron so it reads clearly as an editable dropdown, not a static chip.
  const caret = encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 16 16"><path d="M4 6l4 4 4-4" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>`
  );
  return (
    <select
      value={status || ""}
      onChange={e => onChange(e.target.value)}
      title="Change status"
      style={{
        fontSize: size === "sm" ? 9 : 10, fontWeight: 700, color,
        background: `${color}22 url("data:image/svg+xml,${caret}") no-repeat right 7px center`,
        border: `1px solid ${color}`, borderRadius: 20,
        padding: size === "sm" ? "1px 22px 1px 9px" : "3px 24px 3px 11px",
        cursor: "pointer", fontFamily: "'Inter', sans-serif",
        letterSpacing: "0.05em", textTransform: "uppercase",
        appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
        boxShadow: `0 1px 2px ${color}33`,
      }}
    >
      {STATUS_OPTS.map(s => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
}
