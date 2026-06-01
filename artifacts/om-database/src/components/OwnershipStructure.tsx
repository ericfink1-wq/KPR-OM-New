import { useState, useEffect } from "react";
import type { Deal, OwnerStake } from "../lib/idb";

// Ownership Structure — a light cap-table / org chart for the purchasing entity.
// Eric enters each member and their capital balance; ownership % is derived
// (capital ÷ total) so the percentages always reconcile to 100%. Persists onto
// deal.ownershipStructure via onUpdate (a normal deal PUT), and is in the
// import preserve-list so a bulk OM re-upload never wipes it.

// A $ money input that shows commas + a dollar sign when idle, and the raw
// number while you're typing (so the cursor never jumps). Reused for the JV
// capital balance and KP's outside-JV balance.
function MoneyInput({ value, placeholder, onChange, onCommit }: {
  value: number | null | undefined;
  placeholder?: string;
  onChange: (n: number | null) => void;
  onCommit: () => void;
}) {
  const [focused, setFocused] = useState(false);
  const display = value == null ? ""
    : focused ? String(value)
    : Number(value).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return (
    <div style={{ position: "relative" }}>
      <span style={{ position: "absolute", left: 9, top: "50%", transform: "translateY(-50%)", fontSize: 12.5, color: "#8b8578", pointerEvents: "none" }}>$</span>
      <input inputMode="decimal" value={display} placeholder={placeholder}
        onFocus={() => setFocused(true)}
        onBlur={() => { setFocused(false); onCommit(); }}
        onChange={e => { const raw = e.target.value.replace(/[^0-9.]/g, ""); onChange(raw === "" ? null : Number(raw)); }}
        style={{ border: "1px solid #d9d2c4", borderRadius: 6, padding: "7px 9px 7px 18px", fontSize: 12.5, fontFamily: "'Inter',sans-serif", width: "100%", boxSizing: "border-box", background: "#fff" }} />
    </div>
  );
}

const isKpName = (name?: string) => {
  const n = (name ?? "").trim().toUpperCase();
  return n === "KP" || n === "KPR";
};

export default function OwnershipStructure({ deal, onUpdate }: { deal: Deal; onUpdate: (id: string, patch: Partial<Deal>) => void }) {
  const [owners, setOwners] = useState<OwnerStake[]>(deal.ownershipStructure ?? []);

  // Re-sync when navigating to a different deal.
  useEffect(() => { setOwners(deal.ownershipStructure ?? []); }, [deal.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const totalCapital = owners.reduce((s, o) => s + (Number(o.capital) || 0), 0);
  const entityName = (deal.acqEntity && String(deal.acqEntity).trim()) || "Purchasing entity";

  const save = (next: OwnerStake[]) => onUpdate(deal.id, { ownershipStructure: next });

  const addOwner = () => { const next = [...owners, { name: "", capital: null }]; setOwners(next); save(next); };
  const removeOwner = (i: number) => { const next = owners.filter((_, idx) => idx !== i); setOwners(next); save(next); };
  // Type freely without thrashing the network; persist on blur.
  const editLocal = (i: number, patch: Partial<OwnerStake>) => setOwners(prev => prev.map((o, idx) => idx === i ? { ...o, ...patch } : o));
  const commit = () => save(owners);

  const fmtMoney = (n: number) => `$${Math.round(n).toLocaleString()}`;
  const pctOf = (cap: number) => totalCapital > 0 ? (cap / totalCapital) * 100 : 0;

  const inp: React.CSSProperties = { border: "1px solid #d9d2c4", borderRadius: 6, padding: "7px 9px", fontSize: 12.5, fontFamily: "'Inter',sans-serif", width: "100%", boxSizing: "border-box", background: "#fff" };
  const labelStyle: React.CSSProperties = { fontSize: 9.5, color: "#a69e91", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", marginBottom: 3 };

  return (
    <div style={{ background: "#ffffff", border: "1px solid #efe8da", borderRadius: 12, padding: "18px 20px", marginBottom: 14, boxShadow: "0 1px 2px rgba(56,58,55,0.04)" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 14, flexWrap: "wrap", gap: 8 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "#a69e91", fontWeight: 600, textTransform: "uppercase" }}>Ownership Structure</div>
        <div style={{ fontSize: 12, color: "#a69e91" }}>Capital balances → ownership % (auto-calculated)</div>
      </div>

      {/* Entity node — top of the org chart */}
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
        <div style={{ background: "#2a2c27", color: "#fff", borderRadius: 10, padding: "10px 18px", textAlign: "center", maxWidth: "100%" }}>
          <div style={{ fontFamily: "'Fraunces',serif", fontSize: 15, fontWeight: 600 }}>{entityName}</div>
          <div style={{ fontSize: 10.5, color: "#c9c3b4", marginTop: 2 }}>
            {owners.length} member{owners.length === 1 ? "" : "s"}{totalCapital > 0 ? ` · ${fmtMoney(totalCapital)} total capital` : ""}
          </div>
        </div>
        {owners.length > 0 && <div style={{ width: 1, height: 16, background: "#d8cfbd" }} />}
      </div>

      {/* Member rows */}
      {owners.length === 0 ? (
        <div style={{ textAlign: "center", color: "#a69e91", fontSize: 12.5, padding: "8px 0 14px" }}>
          No owners added yet. Add each member of the purchasing entity and their capital balance.
        </div>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 12 }}>
          {owners.map((o, i) => {
            const cap = Number(o.capital) || 0;
            const pct = pctOf(cap);
            const kp = isKpName(o.name);
            return (
              <div key={i} style={{ border: "1px solid #ece5d7", borderRadius: 10, padding: "10px 12px", background: "#faf7f0" }}>
                <div style={{ display: "grid", gridTemplateColumns: "minmax(0,1.6fr) minmax(0,1fr) auto auto", gap: 10, alignItems: "end" }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={labelStyle}>Member</div>
                    <input style={inp} value={o.name ?? ""} placeholder="Name or entity"
                      onChange={e => editLocal(i, { name: e.target.value })} onBlur={commit} />
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <div style={labelStyle}>Capital ($)</div>
                    <MoneyInput value={o.capital} placeholder="500,000"
                      onChange={n => editLocal(i, { capital: n })} onCommit={commit} />
                  </div>
                  <div style={{ textAlign: "right", paddingBottom: 7 }}>
                    <div style={labelStyle}>Ownership</div>
                    <div style={{ fontFamily: "'Fraunces',serif", fontSize: 18, fontWeight: 600, color: "#26281f", fontVariantNumeric: "tabular-nums" }}>{pct.toFixed(2)}%</div>
                  </div>
                  <button onClick={() => removeOwner(i)} title="Remove member" aria-label="Remove member"
                    style={{ background: "transparent", border: "none", color: "#c98", cursor: "pointer", fontSize: 16, paddingBottom: 7 }}>✕</button>
                </div>
                {/* Ownership bar */}
                <div style={{ marginTop: 8, height: 5, background: "#ece5d7", borderRadius: 3, overflow: "hidden" }}>
                  <div style={{ width: `${Math.min(100, pct)}%`, height: "100%", background: "#6dba43" }} />
                </div>
                <div style={{ marginTop: 6 }}>
                  <input style={{ ...inp, fontSize: 11.5, padding: "5px 8px", background: "transparent", border: "1px dashed #ddd4c2" }} value={o.note ?? ""} placeholder="Optional: role / class (e.g. GP, LP, Class A)"
                    onChange={e => editLocal(i, { note: e.target.value })} onBlur={commit} />
                </div>
                {/* KP-only: capital balance held OUTSIDE this JV (does not affect ownership %) */}
                {kp && (
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: "1px dashed #e3dccd" }}>
                    <div style={{ ...labelStyle, color: "#8a6d3b" }}>KP member balance — capital outside this JV</div>
                    <div style={{ maxWidth: 280 }}>
                      <MoneyInput value={o.kpMemberBalance} placeholder="e.g. 2,000,000"
                        onChange={n => editLocal(i, { kpMemberBalance: n })} onCommit={commit} />
                    </div>
                    <div style={{ fontSize: 10, color: "#bcae97", marginTop: 4 }}>Tracked for reference; excluded from the JV ownership % above.</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}>
        <button onClick={addOwner}
          style={{ background: "#2a2c27", color: "#fff", border: "none", borderRadius: 7, padding: "7px 13px", fontSize: 11.5, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif", whiteSpace: "nowrap" }}>
          + Add member
        </button>
        {owners.length > 0 && (
          <div style={{ display: "flex", gap: 24, flexWrap: "wrap" }}>
            <div style={{ textAlign: "right" }}>
              <div style={labelStyle}>Total Capital</div>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 600, color: "#383a37" }}>{fmtMoney(totalCapital)}</div>
            </div>
            <div style={{ textAlign: "right" }}>
              <div style={labelStyle}>Total Ownership</div>
              <div style={{ fontFamily: "'Fraunces',serif", fontSize: 16, fontWeight: 600, color: totalCapital > 0 ? "#0f9d63" : "#a69e91" }}>
                {totalCapital > 0 ? "100.00%" : "—"}
              </div>
            </div>
          </div>
        )}
      </div>

      <div style={{ marginTop: 12, fontSize: 11, color: "#b3aa9b", lineHeight: 1.5 }}>
        Ownership % is each member's capital balance ÷ total capital, so the column always sums to 100%. The entity name at the top pulls from “Acquiring entity” in Purchase Metrics. Name a member “KP” to also record KP's capital outside this JV.
      </div>
    </div>
  );
}
