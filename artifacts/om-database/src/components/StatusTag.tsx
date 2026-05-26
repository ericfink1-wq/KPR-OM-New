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
  return (
    <select
      value={status || ""}
      onChange={e => onChange(e.target.value)}
      style={{
        fontSize: size === "sm" ? 9 : 10, fontWeight: 700, color,
        background: `${color}18`, border: `1px solid ${color}55`,
        padding: size === "sm" ? "1px 7px" : "3px 10px", borderRadius: 20,
        cursor: "pointer", fontFamily: "'Inter', sans-serif",
        letterSpacing: "0.05em", textTransform: "uppercase",
        appearance: "none", paddingRight: 20,
      }}
    >
      {STATUS_OPTS.map(s => (
        <option key={s} value={s}>{s}</option>
      ))}
    </select>
  );
}
