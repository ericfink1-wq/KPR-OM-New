import { useState, useMemo, useRef, useEffect } from "react";
import type { Deal } from "../lib/idb";
import { CLOSING_COSTS_BY_STATE, type ResolvedJurisdiction } from "../lib/closingCosts";
import ClosingCostsCard from "./ClosingCostsCard";

// Standalone closing-cost estimator for a property that may not be in the database
// yet. Type an address (or pick a state), verify it against the US Census, then the
// same per-jurisdiction closing-cost engine the deal page uses computes the costs.
export default function ClosingCostEstimator({ deals, onClose }: { deals: Deal[]; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [resolved, setResolved] = useState<ResolvedJurisdiction | null>(null);
  const [manualState, setManualState] = useState<string>("");
  const [err, setErr] = useState<string | null>(null);

  // Live address autocomplete — same free OSM geocoder the deal-page card uses
  // (/api/closing/suggest — no API key, no LLM tokens). Each keystroke (debounced)
  // fetches matching addresses; picking one verifies it.
  const [suggests, setSuggests] = useState<Array<{ label: string; address: string; state: string }>>([]);
  const [sugOpen, setSugOpen] = useState(false);
  const sugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (sugTimer.current) clearTimeout(sugTimer.current); }, []);

  const onAddrType = (v: string) => {
    setQuery(v);
    if (sugTimer.current) clearTimeout(sugTimer.current);
    const q = v.trim();
    if (q.length < 4) { setSuggests([]); setSugOpen(false); return; }
    sugTimer.current = setTimeout(() => {
      fetch(`/api/closing/suggest?q=${encodeURIComponent(q)}`, { credentials: "include" })
        .then((r) => r.json() as Promise<{ suggestions: Array<{ label: string; address: string; state: string }> }>)
        .then((d) => { setSuggests(d.suggestions || []); setSugOpen((d.suggestions || []).length > 0); })
        .catch(() => { setSuggests([]); setSugOpen(false); });
    }, 320);
  };
  const pickSuggest = (s: { label: string; address: string; state: string }) => {
    setQuery(s.label); setSuggests([]); setSugOpen(false);
    verify(s.address);
  };

  // State options, alphabetized by name (skip the "—" placeholder jurisdiction).
  const stateOptions = useMemo(
    () => Object.values(CLOSING_COSTS_BY_STATE)
      .filter(j => j.state !== "—")
      .map(j => ({ abbr: j.state, name: j.stateName }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    [],
  );

  // If the typed text matches a property already in the library, offer its address.
  const dealMatch = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 3) return null;
    return deals.find(d => !d.trashedAt && (d.propertyName || "").toLowerCase().includes(q)) || null;
  }, [query, deals]);

  const verify = async (address: string) => {
    const addr = address.trim();
    if (!addr) return;
    setBusy(true); setErr(null); setResolved(null);
    try {
      const r = await fetch(`/api/closing/resolve?address=${encodeURIComponent(addr)}`, { credentials: "include" });
      const j = await r.json() as ResolvedJurisdiction;
      if (j && j.matched && j.state) {
        setResolved(j);
        setManualState("");
      } else {
        setResolved(null);
        setErr("Couldn't verify that address. Enter a full street address (street, city, state), or pick the state below.");
      }
    } catch {
      setErr("Address lookup is unavailable right now — pick the state below to estimate from state rates.");
    } finally {
      setBusy(false);
    }
  };

  // The state actually driving the estimate: a verified address wins, else the manual pick.
  const activeState = resolved?.state || manualState || "";
  const syntheticDeal = useMemo(() => (activeState ? ({
    id: `cc-standalone:${(resolved?.matchedAddress || query || activeState)}`,
    propertyName: query || "Standalone estimate",
    address: resolved?.matchedAddress || undefined,
    city: resolved?.place || undefined,
    state: activeState,
  } as Deal) : null), [activeState, resolved, query]);

  const inp: React.CSSProperties = {
    flex: 1, minWidth: 0, border: "1px solid #c8b89a", borderRadius: 8, padding: "9px 11px",
    fontSize: 14, color: "#383a37", fontFamily: "'Inter',sans-serif", outline: "none", background: "#fff",
  };

  return (
    <div onClick={onClose} style={{ position: "fixed", inset: 0, background: "rgba(38,40,31,0.45)", backdropFilter: "blur(3px)", zIndex: 9500, display: "flex", alignItems: "flex-start", justifyContent: "center", padding: "5vh 16px 16px", overflowY: "auto" }}>
      <div onClick={e => e.stopPropagation()} style={{ background: "#faf8f3", borderRadius: 16, width: "100%", maxWidth: 640, boxShadow: "0 20px 60px rgba(38,40,31,0.3)", overflow: "hidden" }}>
        {/* Header */}
        <div style={{ padding: "18px 22px 14px", borderBottom: "1px solid #f1eadc", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12, background: "#fff" }}>
          <div>
            <div style={{ fontFamily: "'Fraunces',serif", fontSize: 19, fontWeight: 600, color: "#26281f" }}>Closing Cost Estimator</div>
            <div style={{ fontSize: 12.5, color: "#8b8578", marginTop: 4, lineHeight: 1.5 }}>
              Estimate title, transfer, and recording costs for any property — even one not in the database. Enter an address to verify it, or pick a state.
            </div>
          </div>
          <button onClick={onClose} style={{ background: "transparent", border: "none", fontSize: 22, color: "#a89f8f", cursor: "pointer", lineHeight: 1, flexShrink: 0 }}>×</button>
        </div>

        <div style={{ padding: "16px 22px 20px", maxHeight: "78vh", overflowY: "auto" }}>
          {/* Address / property input — with live keystroke autocomplete */}
          <div style={{ display: "flex", gap: 8, marginBottom: 6 }}>
            <div style={{ position: "relative", flex: 1, minWidth: 0 }}>
              <input
                autoFocus value={query} disabled={busy}
                onChange={e => onAddrType(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" && !busy) { setSugOpen(false); verify(query); } if (e.key === "Escape") setSugOpen(false); }}
                onBlur={() => setTimeout(() => setSugOpen(false), 150)}
                onFocus={() => { if (suggests.length) setSugOpen(true); }}
                autoComplete="off"
                placeholder="Start typing an address — e.g. 5600 W Touhy Ave, Niles, IL"
                style={{ ...inp, width: "100%" }}
              />
              {sugOpen && suggests.length > 0 && (
                <div style={{ position: "absolute", top: "calc(100% + 4px)", left: 0, right: 0, zIndex: 20, background: "#fff", border: "1px solid #d9d2c4", borderRadius: 8, boxShadow: "0 10px 28px rgba(38,40,31,0.16)", overflow: "hidden", maxHeight: 260, overflowY: "auto" }}>
                  {suggests.map((s, i) => (
                    <button
                      key={`${s.address}-${i}`}
                      type="button"
                      onMouseDown={e => { e.preventDefault(); pickSuggest(s); }}
                      style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", textAlign: "left", background: "transparent", border: "none", borderBottom: i < suggests.length - 1 ? "1px solid #f1eadc" : "none", padding: "9px 12px", cursor: "pointer", fontSize: 13, color: "#383a37", fontFamily: "'Inter',sans-serif" }}
                      onMouseEnter={e => (e.currentTarget.style.background = "#f6f2ea")}
                      onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                    >
                      <span style={{ flexShrink: 0, fontSize: 12 }}>📍</span>
                      <span style={{ flex: 1, minWidth: 0 }}>{s.label}</span>
                      {s.state && <span style={{ flexShrink: 0, fontSize: 10, fontWeight: 700, color: "#8b8578" }}>{s.state}</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button onClick={() => { setSugOpen(false); verify(query); }} disabled={busy || !query.trim()}
              style={{ background: busy ? "#9bbf7e" : "#3f7a1f", border: "none", color: "#fff", padding: "9px 16px", borderRadius: 8, cursor: busy ? "default" : "pointer", fontSize: 13, fontWeight: 600, fontFamily: "'Inter',sans-serif", flexShrink: 0 }}>
              {busy ? "Verifying…" : "Verify"}
            </button>
          </div>

          {dealMatch && !resolved && (
            <div style={{ fontSize: 11.5, color: "#3f7a1f", marginBottom: 8 }}>
              “{dealMatch.propertyName}” is already in your library.{" "}
              {dealMatch.address && <button onClick={() => { const a = [dealMatch.address, dealMatch.city, dealMatch.state].filter(Boolean).join(", "); setQuery(a); verify(a); }} style={{ background: "none", border: "none", color: "#4f7aac", textDecoration: "underline", cursor: "pointer", fontSize: 11.5, padding: 0 }}>Use its address ↗</button>}
            </div>
          )}

          {err && <div style={{ fontSize: 12, color: "#b5503a", marginBottom: 8 }}>{err}</div>}

          {resolved?.matched && (
            <div style={{ fontSize: 12, color: "#3f7a1f", background: "#f4f8ef", border: "1px solid #cfe3b8", borderRadius: 8, padding: "9px 12px", marginBottom: 12 }}>
              ✓ Verified: <b>{resolved.matchedAddress}</b>{resolved.county ? ` · ${resolved.county}` : ""}{resolved.state ? `, ${resolved.state}` : ""} <span style={{ color: "#7d9a5c" }}>({resolved.source || "US Census"})</span>
            </div>
          )}

          {/* Manual state fallback (always available) */}
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14, fontSize: 12, color: "#7d766a" }}>
            <span>{resolved ? "Or override the state:" : "No address? Pick a state:"}</span>
            <select value={resolved ? "" : manualState} disabled={!!resolved && false}
              onChange={e => { setManualState(e.target.value); setResolved(null); setErr(null); }}
              style={{ border: "1px solid #d9d2c4", borderRadius: 7, padding: "6px 9px", fontSize: 13, color: "#383a37", background: "#fff" }}>
              <option value="">Select state…</option>
              {stateOptions.map(s => <option key={s.abbr} value={s.abbr}>{s.name}</option>)}
            </select>
          </div>

          {/* The estimate — reuses the exact deal-page closing-cost engine */}
          {syntheticDeal ? (
            <ClosingCostsCard deal={syntheticDeal} />
          ) : (
            <div style={{ textAlign: "center", color: "#a89f8f", fontSize: 13, padding: "26px 16px" }}>
              Verify an address or choose a state to see the closing-cost breakdown.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
