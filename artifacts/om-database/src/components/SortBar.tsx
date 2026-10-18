import { MAX_SORT_LEVELS, flipSortLevel, promoteSortLevel, removeSortLevel, type SortDir, type SortLevel } from "../lib/multiSort";
import { useIsMobile } from "../hooks/use-mobile";

// Shows the active sort chain above a table ("Sorted by 1 Status ▲ · then 2 Last
// upload ▼") and lets anyone add, flip, reorder or remove levels with taps — the
// touch-friendly counterpart to Shift-clicking a column header.
export default function SortBar({ levels, setLevels, labels, isDefault, onReset, defaultDir = "desc", dirFor }: {
  levels: SortLevel[];
  setLevels: (next: SortLevel[]) => void;
  /** Sortable columns, key → label. Only these can be added. */
  labels: Record<string, string>;
  isDefault: boolean;
  onReset: () => void;
  defaultDir?: SortDir;
  /** Natural first direction per column (e.g. dates newest-first, names A–Z). */
  dirFor?: (key: string) => SortDir;
}) {
  const isMobile = useIsMobile();
  const available = Object.keys(labels).filter(k => !levels.some(l => l.key === k));
  const chip: React.CSSProperties = {
    display: "inline-flex", alignItems: "center", gap: 2, background: "#fff", border: "1px solid #dfddd6",
    borderRadius: 999, padding: "2px 4px 2px 8px", fontSize: 11.5, color: "#383a37", fontFamily: "'Roboto',sans-serif",
  };
  const mini: React.CSSProperties = {
    background: "transparent", border: "none", cursor: "pointer", color: "#9b9992", fontSize: 12,
    minWidth: isMobile ? 28 : 20, minHeight: isMobile ? 28 : 20, padding: 0, lineHeight: 1, fontFamily: "'Roboto',sans-serif",
  };

  return (
    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 6, margin: "0 0 8px", fontSize: 11, color: "#7a7973", fontFamily: "'Roboto',sans-serif" }}>
      <span style={{ fontWeight: 600 }}>Sorted by</span>
      {levels.map((l, i) => (
        <span key={l.key} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          {i > 0 && <span style={{ color: "#b8b5ad" }}>then</span>}
          <span style={chip}>
            {levels.length > 1 && <span style={{ fontSize: 9.5, fontWeight: 700, color: "#94928b", marginRight: 3 }}>{i + 1}</span>}
            <button onClick={() => setLevels(flipSortLevel(levels, l.key))} title="Flip direction"
              style={{ ...mini, color: "#383a37", fontWeight: 600, fontSize: 11.5, minWidth: 0, padding: "0 2px" }}>
              {labels[l.key] ?? l.key} {l.dir === "asc" ? "▲" : "▼"}
            </button>
            {i > 0 && <button onClick={() => setLevels(promoteSortLevel(levels, l.key))} title="Make this a higher priority" aria-label="Move earlier" style={mini}>↑</button>}
            {levels.length > 1 && <button onClick={() => setLevels(removeSortLevel(levels, l.key))} title="Remove this sort level" aria-label="Remove" style={mini}>×</button>}
          </span>
        </span>
      ))}
      {levels.length < MAX_SORT_LEVELS && available.length > 0 && (
        <select value="" onChange={e => { const k = e.target.value; if (k) setLevels([...levels, { key: k, dir: dirFor?.(k) ?? defaultDir }]); }}
          style={{ fontSize: 11, color: "#4f4d48", border: "1px dashed #d7d5ce", borderRadius: 999, padding: isMobile ? "5px 8px" : "2px 6px", background: "transparent", fontFamily: "'Roboto',sans-serif", cursor: "pointer" }}>
          <option value="">+ then by…</option>
          {available.map(k => <option key={k} value={k}>{labels[k]}</option>)}
        </select>
      )}
      {!isDefault && (
        <button onClick={onReset} style={{ background: "none", border: "none", color: "#9b9992", fontSize: 11, cursor: "pointer", textDecoration: "underline", padding: isMobile ? "6px 2px" : 0, fontFamily: "'Roboto',sans-serif" }}>
          reset
        </button>
      )}
    </div>
  );
}
