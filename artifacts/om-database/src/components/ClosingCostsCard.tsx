import { useState, useMemo, useEffect } from "react";
import type { Deal } from "../lib/idb";
import {
  getJurisdiction, calculateClosingCosts, formatRate, getLocalityGroups, autoLocalities,
  localitiesFromJurisdiction, type ResolvedJurisdiction,
  DEFAULT_LTV, SPLITS_SOURCE, FIDELITY_SOURCE_URL,
} from "../lib/closingCosts";

interface Props { deal: Deal; }

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtPct = (r: number) => `${(r * 100).toFixed(2)}%`;

function commaFmt(v: string): string {
  const stripped = v.replace(/,/g, "");
  const num = parseFloat(stripped);
  if (!stripped || isNaN(num)) return v;
  return Math.round(num).toLocaleString("en-US");
}

export default function ClosingCostsCard({ deal }: Props) {
  const defaultPrice = Number(deal.txnPurchasePrice ?? deal.askingPrice ?? 0) || 0;
  const knownLoan = Number(deal.loanBalance ?? 0) || 0;
  const defaultLoan = knownLoan || (defaultPrice ? Math.round(defaultPrice * DEFAULT_LTV) : 0);

  const [priceInput, setPriceInput] = useState<string>(defaultPrice ? Math.round(defaultPrice).toLocaleString("en-US") : "");
  const [loanInput, setLoanInput] = useState<string>(defaultLoan ? Math.round(defaultLoan).toLocaleString("en-US") : "");
  const [entitySale, setEntitySale] = useState(false);

  // Resolve the EXACT taxing jurisdiction from the street address (US Census),
  // cached per deal+address. Degrades gracefully to the city match on any failure.
  const fullAddress = useMemo(
    () => [deal.address, deal.city, deal.state].map((s) => (s || "").trim()).filter(Boolean).join(", "),
    [deal.address, deal.city, deal.state],
  );
  const hasStreet = !!(deal.address && deal.address.trim());
  const [geo, setGeo] = useState<ResolvedJurisdiction | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "done" | "failed">("idle");

  useEffect(() => {
    setGeo(null); setGeoStatus("idle");
    if (!hasStreet) return;
    const cacheKey = `cc-geo:${deal.id}:${fullAddress}`;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (cached) { setGeo(JSON.parse(cached) as ResolvedJurisdiction); setGeoStatus("done"); return; }
    } catch { /* ignore */ }
    let alive = true;
    setGeoStatus("loading");
    fetch(`/api/closing/resolve?address=${encodeURIComponent(fullAddress)}`, { credentials: "include" })
      .then((r) => r.json() as Promise<ResolvedJurisdiction>)
      .then((j) => {
        if (!alive) return;
        setGeo(j); setGeoStatus("done");
        if (j && j.matched) { try { localStorage.setItem(cacheKey, JSON.stringify(j)); } catch { /* ignore */ } }
      })
      .catch(() => { if (alive) { setGeo(null); setGeoStatus("failed"); } });
    return () => { alive = false; };
  }, [deal.id, fullAddress, hasStreet]);

  // Auto-detected locality: geocoded jurisdiction first, then the city-string fallback.
  const detected = useMemo(() => {
    const fromGeo = geo?.matched ? localitiesFromJurisdiction(deal.state, geo) : {};
    const fromCity = autoLocalities(deal.state, deal.city);
    return { ...fromCity, ...fromGeo };
  }, [geo, deal.state, deal.city]);

  // User dropdown picks win over auto-detection; cleared when switching deals.
  const [override, setOverride] = useState<Record<string, string>>({});
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());
  useEffect(() => { setOverride({}); setOpenGroups(new Set()); }, [deal.id]);
  const localities = useMemo(() => ({ ...detected, ...override }), [detected, override]);

  const price = Number(priceInput.replace(/,/g, "")) || 0;
  const loan  = Number(loanInput.replace(/,/g, ""))  || 0;
  const jurisdiction = useMemo(() => getJurisdiction(deal.state), [deal.state]);
  const localityGroups = useMemo(() => getLocalityGroups(jurisdiction), [jurisdiction]);
  const breakdown = useMemo(() => calculateClosingCosts(jurisdiction, price, loan, { includeEntityTaxes: entitySale, localities }), [jurisdiction, price, loan, entitySale, localities]);

  const hasPrice = price > 0;
  const loanIsAssumed = !knownLoan && hasPrice && loan === Math.round(price * DEFAULT_LTV);
  const hasEntityLine = jurisdiction.transferTaxes.some((t) => t.entitySaleOnly);
  const isPlaceholder = jurisdiction.state === "—";

  const inputStyle: React.CSSProperties = {
    display: "block", width: "100%", fontSize: 13, padding: "7px 10px", border: "1px solid #e3dccd",
    borderRadius: 6, color: "#383a37", background: "#fafaf8", marginTop: 4, fontFamily: "'Inter',sans-serif", boxSizing: "border-box",
  };

  return (
    <div id="section-closing-costs" style={{ background: "#fff", border: "1px solid #efe8da", borderRadius: 12, padding: "16px 20px", marginBottom: 14, boxShadow: "0 1px 2px rgba(56,58,55,0.04)" }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "#a69e91", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>
          Estimated Closing Costs
        </div>
        <div style={{ fontSize: 11, color: "#7d766a", lineHeight: 1.45 }}>
          {jurisdiction.stateName} customary practices. Rates show whether or not a price is entered; dollar amounts fill in once you add a price.
        </div>
      </div>

      {isPlaceholder && (
        <div style={{ fontSize: 10.5, color: "#8a5a14", background: "#fff8ec", border: "1px solid #ead9b3", borderRadius: 6, padding: "8px 10px", marginBottom: 12, lineHeight: 1.5 }}>
          ⚠ This state isn't configured with sourced data yet — figures below are national-average placeholders. Verify via the Fidelity guide linked below before relying on them.
        </div>
      )}

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10, marginBottom: 6 }}>
        <label style={{ display: "block", fontSize: 10, color: "#a69e91", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Purchase Price
          <input type="text" inputMode="numeric" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} onBlur={() => setPriceInput(v => commaFmt(v))} onFocus={() => setPriceInput(v => v.replace(/,/g, ""))} placeholder="optional" style={inputStyle} />
        </label>
        <label style={{ display: "block", fontSize: 10, color: "#a69e91", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" }}>
          Loan Amount
          <input type="text" inputMode="numeric" value={loanInput} onChange={(e) => setLoanInput(e.target.value)} onBlur={() => setLoanInput(v => commaFmt(v))} onFocus={() => setLoanInput(v => v.replace(/,/g, ""))} placeholder="optional" style={inputStyle} />
        </label>
      </div>
      <div style={{ fontSize: 10, color: "#a69e91", marginBottom: 10, minHeight: 14 }}>
        {loanIsAssumed ? `Loan assumed at ${Math.round(DEFAULT_LTV * 100)}% LTV — edit above to override.` : ""}
      </div>

      {hasEntityLine && (
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "#52554e", marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={entitySale} onChange={(e) => setEntitySale(e.target.checked)} style={{ accentColor: "#3f7a1f" }} />
          Entity / controlling-interest sale (applies the Controlling Interest Transfer Tax)
        </label>
      )}

      {/* Resolved jurisdiction status (from the property address, via US Census) */}
      {localityGroups.length > 0 && (
        <div style={{ fontSize: 10, color: geo?.matched ? "#3f7a1f" : "#a69e91", marginBottom: 8, lineHeight: 1.5 }}>
          {geoStatus === "loading" && <>📍 Resolving the exact jurisdiction from the property address…</>}
          {geoStatus === "done" && geo?.matched && (
            <>📍 {[geo.place, geo.municipality].filter(Boolean)[0] || geo.county}{geo.county ? ` · ${geo.county}` : ""}{geo.state ? `, ${geo.state}` : ""} — resolved from the address ({geo.source || "US Census"}).</>
          )}
          {geoStatus === "done" && !geo?.matched && <>Couldn't pin the exact jurisdiction from the address — using the city match. Verify the county/city below.</>}
          {geoStatus === "failed" && <>Address lookup unavailable right now — using the city match. Verify the county/city below.</>}
          {geoStatus === "idle" && !hasStreet && <>No street address on this deal — pick the county/city below, or add the address to auto-resolve it.</>}
        </div>
      )}

      {/* Local transfer-tax locality — resolved automatically; dropdown only on "Change". */}
      {localityGroups.map((g) => {
        const fallbackDefault = g.options.find((o) => o.isDefault)?.label ?? g.options[0]?.label ?? "";
        const autoLabel = detected[g.group];
        const current = localities[g.group] ?? fallbackDefault;
        const isOverridden = override[g.group] != null;
        const isAuto = !!autoLabel && !isOverridden;
        const open = openGroups.has(g.group);
        const setOpen = (v: boolean) => setOpenGroups((prev) => { const n = new Set(prev); if (v) n.add(g.group); else n.delete(g.group); return n; });
        return (
          <div key={g.group} style={{ marginBottom: 12 }}>
            <div style={{ fontSize: 10, color: "#a69e91", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em", marginBottom: 4 }}>
              County / City (local transfer tax)
            </div>
            {open ? (
              <select autoFocus value={current}
                onChange={(e) => { setOverride((prev) => ({ ...prev, [g.group]: e.target.value })); setOpen(false); }}
                onBlur={() => setOpen(false)}
                style={{ display: "block", width: "100%", fontSize: 13, padding: "7px 10px", border: "1px solid #6dba43", borderRadius: 6, color: "#383a37", background: "#fafaf8", fontFamily: "'Inter',sans-serif", boxSizing: "border-box" }}>
                {g.options.map((o) => <option key={o.label} value={o.label}>{o.label}{o.isDefault ? " (default)" : ""}</option>)}
              </select>
            ) : (
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: "#fafaf8", border: "1px solid #e3dccd", borderRadius: 6, padding: "7px 10px" }}>
                <span style={{ fontSize: 13, color: "#383a37" }}>
                  {isAuto && <span style={{ color: "#3f7a1f", marginRight: 5 }}>✓</span>}
                  {current}
                </span>
                <button type="button" onClick={() => setOpen(true)}
                  style={{ background: "transparent", border: "none", color: "#6dba43", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif", padding: "2px 4px", flexShrink: 0 }}>
                  Change
                </button>
              </div>
            )}
            <span style={{ display: "block", fontSize: 9.5, color: isAuto ? "#3f7a1f" : "#a69e91", fontWeight: 400, marginTop: 3 }}>
              {isAuto
                ? `✓ Auto-detected from the property address.`
                : isOverridden
                  ? `Manually selected.`
                  : `Best estimate for this state — click Change if the parcel is in a special taxing jurisdiction.`}
            </span>
          </div>
        );
      })}

      {/* Summary tiles — only when a price is entered */}
      {hasPrice && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 14 }}>
          {([["Buyer", breakdown.totals.buyer, "#f6f9f0", "#d6e9bd", "#5c7a3c", "#3f7a1f"],
             ["Seller", breakdown.totals.seller, "#fff8ec", "#ead9b3", "#7a5c2c", "#8a5a14"],
             ["Combined", breakdown.totals.combined, "#f4f1ea", "#ddd4c2", "#6f6a5f", "#383a37"]] as const).map(
            ([label, val, bg, bd, lc, vc]) => (
              <div key={label} style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 8, padding: "10px 12px" }}>
                <div style={{ fontSize: 9, color: lc, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>{label}</div>
                <div style={{ fontSize: 16, color: vc, fontWeight: 600 }}>{fmt(val)}</div>
                <div style={{ fontSize: 10, color: "#7d766a", marginTop: 2 }}>{fmtPct(val / price)} of price</div>
              </div>
            )
          )}
        </div>
      )}

      {/* Rate table — ALWAYS visible */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5 }}>
          <thead>
            <tr style={{ fontSize: 9, color: "#a69e91", fontWeight: 700, letterSpacing: "0.06em", textTransform: "uppercase" }}>
              <th style={{ textAlign: "left", padding: "7px 8px", borderBottom: "1px solid #ece5d7" }}>Item</th>
              <th style={{ textAlign: "left", padding: "7px 8px", borderBottom: "1px solid #ece5d7", whiteSpace: "nowrap" }}>Rate</th>
              <th style={{ textAlign: "right", padding: "7px 8px", borderBottom: "1px solid #ece5d7" }}>Buyer</th>
              <th style={{ textAlign: "right", padding: "7px 8px", borderBottom: "1px solid #ece5d7" }}>Seller</th>
            </tr>
          </thead>
          <tbody>
            {breakdown.lines.map((l, i) => {
              const dormant = !!(l as any).inactive;
              return (
                <tr key={i} style={{ borderBottom: "1px solid #f5efe2", opacity: dormant ? 0.45 : 1 }}>
                  <td style={{ padding: "8px 8px", color: "#383a37", verticalAlign: "top" }}>
                    <div>{l.name}{dormant ? <span style={{ fontSize: 9, color: "#a69e91", fontWeight: 600 }}> · not applied</span> : null}</div>
                    {l.notes && <div style={{ fontSize: 9.5, color: "#a69e91", marginTop: 2, lineHeight: 1.4 }}>{l.notes}</div>}
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "left", color: "#52554e", whiteSpace: "nowrap", verticalAlign: "top", fontVariantNumeric: "tabular-nums" }}>
                    {l.rate === 0 && l.rateMin == null ? (dormant ? "—" : `flat ${fmt(l.amount)}`) : formatRate(l)}
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "right", color: hasPrice && !dormant && l.buyer > 0 ? "#3f7a1f" : "#c9c2b3", fontWeight: hasPrice && !dormant && l.buyer > 0 ? 500 : 400, verticalAlign: "top" }}>
                    {!hasPrice ? "—" : !dormant && l.buyer > 0 ? fmt(l.buyer) : "—"}
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "right", color: hasPrice && !dormant && l.seller > 0 ? "#8a5a14" : "#c9c2b3", fontWeight: hasPrice && !dormant && l.seller > 0 ? 500 : 400, verticalAlign: "top" }}>
                    {!hasPrice ? "—" : !dormant && l.seller > 0 ? fmt(l.seller) : "—"}
                  </td>
                </tr>
              );
            })}
            {hasPrice && (
              <tr style={{ background: "#faf7f0" }}>
                <td style={{ padding: "10px 8px", color: "#26281f", fontWeight: 700 }} colSpan={2}>Total</td>
                <td style={{ padding: "10px 8px", textAlign: "right", color: "#3f7a1f", fontWeight: 700 }}>{fmt(breakdown.totals.buyer)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right", color: "#8a5a14", fontWeight: 700 }}>{fmt(breakdown.totals.seller)}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {jurisdiction.notes && (
        <div style={{ fontSize: 10, color: "#7d766a", lineHeight: 1.5, marginTop: 12, padding: "8px 10px", background: "#faf7f0", borderRadius: 6, border: "1px solid #f0e8d6" }}>
          <span style={{ fontWeight: 600 }}>&#9432; </span>{jurisdiction.notes}
        </div>
      )}

      {/* Provenance + verify link */}
      <div style={{ fontSize: 9.5, color: "#a69e91", marginTop: 12, lineHeight: 1.6, borderTop: "1px solid #f0e9da", paddingTop: 10 }}>
        <div>Splits: {SPLITS_SOURCE}. Rates verified {jurisdiction.ratesAsOf}.</div>
        <div style={{ marginTop: 3 }}>
          Estimates only — customary splits are negotiable and rates change.{" "}
          <a href={FIDELITY_SOURCE_URL} target="_blank" rel="noreferrer" style={{ color: "#4f7aac", textDecoration: "underline" }}>
            Verify with Fidelity's Laws &amp; Customs guide ↗
          </a>{" "}
          or your title officer before relying on these for an offer.
        </div>
      </div>
    </div>
  );
}
