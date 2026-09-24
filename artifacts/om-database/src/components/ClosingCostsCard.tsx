import { useState, useMemo, useEffect, useRef } from "react";
import type { Deal } from "../lib/idb";
import {
  getJurisdiction, calculateClosingCosts, formatRate, resolveLocal, isStale, monthsSince, todayIso,
  LOCAL_LEVEL_LABEL, type ResolvedJurisdiction, type LocalSelection, type LocalTaxTable,
  DEFAULT_LTV, SPLITS_SOURCE, FIDELITY_SOURCE_URL,
} from "../lib/closingCosts";
import { hasLocalTable, loadLocalTable } from "../lib/transferTaxLocal";

interface Props { deal: Deal; }

const fmt = (n: number) => `$${Math.round(n).toLocaleString()}`;
const fmtPct = (r: number) => `${(r * 100).toFixed(2)}%`;
const fmtRange = (lo: number, hi: number) => (Math.round(lo) === Math.round(hi) ? fmt(lo) : `${fmt(lo)} – ${fmt(hi)}`);

// Realized effective % of the amount against its measuring base (price or loan).
const effPct = (amt: number, baseAmt: number): string | null => {
  if (!baseAmt || amt <= 0) return null;
  const r = amt / baseAmt;
  const d = r < 0.001 ? 4 : r < 0.01 ? 3 : 2;
  return `${(r * 100).toFixed(d).replace(/\.?0+$/, "")}%`;
};

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
  const [closingDate, setClosingDate] = useState<string>(todayIso());
  const [entitySale, setEntitySale] = useState(false);

  const dealAddress = useMemo(
    () => [deal.address, deal.city, deal.state].map((s) => (s || "").trim()).filter(Boolean).join(", "),
    [deal.address, deal.city, deal.state],
  );

  // Live address autocomplete (free OSM geocoder via /api/closing/suggest).
  const [addrOverride, setAddrOverride] = useState<{ address: string; state: string } | null>(null);
  const [addrInput, setAddrInput] = useState("");
  const [suggests, setSuggests] = useState<Array<{ label: string; address: string; state: string }>>([]);
  const [sugOpen, setSugOpen] = useState(false);
  const sugTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (sugTimer.current) clearTimeout(sugTimer.current); }, []);
  useEffect(() => { setAddrOverride(null); setAddrInput(""); setSuggests([]); setSugOpen(false); }, [deal.id]);

  const onAddrType = (v: string) => {
    setAddrInput(v);
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
  const pickAddr = (s: { label: string; address: string; state: string }) => {
    setAddrOverride({ address: s.address, state: s.state });
    setAddrInput(s.label); setSuggests([]); setSugOpen(false);
  };
  const clearAddr = () => { setAddrOverride(null); setAddrInput(""); setSuggests([]); setSugOpen(false); };

  const fullAddress = addrOverride?.address || dealAddress;
  const effectiveState = ((addrOverride?.state || deal.state || "") as string).trim().toUpperCase();
  const hasStreet = !!(addrOverride || (deal.address && deal.address.trim()));
  const [geo, setGeo] = useState<ResolvedJurisdiction | null>(null);
  const [geoStatus, setGeoStatus] = useState<"idle" | "loading" | "done" | "failed">("idle");

  useEffect(() => {
    setGeo(null); setGeoStatus("idle");
    if (!hasStreet) return;
    // v2: the resolver now requests all Census layers (incorporated place + school district).
    const cacheKey = `cc-geo2:${deal.id}:${fullAddress}`;
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

  // Lazy-load the big local tables (PA, WA, …) for this state.
  const [lazyTable, setLazyTable] = useState<{ state: string; table: LocalTaxTable | undefined } | null>(null);
  const needsLazy = hasLocalTable(effectiveState);
  useEffect(() => {
    if (!needsLazy) return;
    let alive = true;
    loadLocalTable(effectiveState).then((t) => { if (alive) setLazyTable({ state: effectiveState, table: t }); }).catch(() => { /* stays unverified */ });
    return () => { alive = false; };
  }, [effectiveState, needsLazy]);
  const tableLoading = needsLazy && lazyTable?.state !== effectiveState;

  const baseJurisdiction = useMemo(() => getJurisdiction(effectiveState), [effectiveState]);
  const jurisdiction = useMemo(
    () => (needsLazy && lazyTable?.state === effectiveState && lazyTable.table ? { ...baseJurisdiction, local: lazyTable.table } : baseJurisdiction),
    [baseJurisdiction, needsLazy, lazyTable, effectiveState],
  );

  // Manual locality pick (overrides the geocoder). Cleared when switching deals/states.
  const [manual, setManual] = useState<LocalSelection>({});
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { setManual({}); setPickerOpen(false); }, [deal.id, effectiveState]);

  const local = useMemo(() => resolveLocal(jurisdiction, geo, manual), [jurisdiction, geo, manual]);

  const price = Number(priceInput.replace(/,/g, "")) || 0;
  const loan  = Number(loanInput.replace(/,/g, ""))  || 0;
  const breakdown = useMemo(
    () => calculateClosingCosts(jurisdiction, price, loan, { includeEntityTaxes: entitySale, local, closingDate }),
    [jurisdiction, price, loan, entitySale, local, closingDate],
  );

  const verifyLines = useMemo(() => breakdown.lines.filter((l) => l.verify && !l.inactive && !l.unverified), [breakdown]);
  const unverifiedLines = useMemo(() => breakdown.lines.filter((l) => l.unverified), [breakdown]);

  const hasPrice = price > 0;
  const loanIsAssumed = !knownLoan && hasPrice && loan === Math.round(price * DEFAULT_LTV);
  const hasEntityLine = jurisdiction.transferTaxes.some((t) => t.entitySaleOnly);
  const isPlaceholder = jurisdiction.state === "—";
  const stale = !isPlaceholder && isStale(jurisdiction.ratesAsOf);
  const staleMonths = Math.floor(monthsSince(jurisdiction.ratesAsOf) ?? 0);
  const hasRange = unverifiedLines.length > 0;

  // Picker options (county list, then municipalities in the chosen/resolved county).
  const entries = jurisdiction.local?.entries ?? [];
  const countyEntries = entries.filter((e) => e.kind === "county").sort((a, b) => a.name.localeCompare(b.name));
  const muniCounties = Array.from(new Set(entries.filter((e) => e.kind === "municipal" && e.county).map((e) => e.county!))).sort();
  const [pickCounty, setPickCounty] = useState<string>("");
  useEffect(() => { setPickCounty(geo?.county || ""); }, [geo?.county, effectiveState]);
  const muniOptions = entries
    .filter((e) => e.kind === "municipal" && (!pickCounty || !e.county || e.county === pickCounty))
    .sort((a, b) => a.name.localeCompare(b.name));

  const inputStyle: React.CSSProperties = {
    display: "block", width: "100%", fontSize: 13, padding: "7px 10px", border: "1px solid #e3dccd",
    borderRadius: 6, color: "#383a37", background: "#fafaf8", marginTop: 4, fontFamily: "'Inter',sans-serif", boxSizing: "border-box",
  };
  const labelStyle: React.CSSProperties = { display: "block", fontSize: 10, color: "#a69e91", fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.04em" };
  const selectStyle: React.CSSProperties = { ...inputStyle, minHeight: 36 };

  const appliedLocalNames = local.applied.map((e) => e.name + (e.schoolDistrict ? ` · ${e.schoolDistrict}` : ""));

  return (
    <div id="section-closing-costs" style={{ background: "#fff", border: "1px solid #efe8da", borderRadius: 12, padding: "16px 20px", marginBottom: 14, boxShadow: "0 1px 2px rgba(56,58,55,0.04)" }}>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.06em", color: "#a69e91", fontWeight: 600, textTransform: "uppercase", marginBottom: 4 }}>
          Estimated Closing Costs
        </div>
        <div style={{ fontSize: 11, color: "#7d766a", lineHeight: 1.45 }}>
          {jurisdiction.stateName} customary practices, commercial treatment. Rates show whether or not a price is entered; dollar amounts fill in once you add a price.
        </div>
      </div>

      {isPlaceholder && (
        <div style={{ fontSize: 10.5, color: "#8a5a14", background: "#fff8ec", border: "1px solid #ead9b3", borderRadius: 6, padding: "8px 10px", marginBottom: 12, lineHeight: 1.5 }}>
          ⚠ This state isn't configured with sourced data yet — figures below are national-average placeholders. Verify via the Fidelity guide linked below before relying on them.
        </div>
      )}

      {stale && (
        <div style={{ fontSize: 11, color: "#8a5a14", background: "#fff8ec", border: "1px solid #ead9b3", borderRadius: 6, padding: "8px 10px", marginBottom: 12, lineHeight: 1.5 }}>
          ⏳ <b>{jurisdiction.stateName} rates were last verified {jurisdiction.ratesAsOf}</b> ({staleMonths} months ago). Transfer-tax rates change — they're due for the annual refresh. Confirm with title before relying on them.
        </div>
      )}

      {/* RED: the local rate for this exact locality is not verified. Never a silent default. */}
      {hasRange && (
        <div style={{ fontSize: 12, color: "#8a1f14", background: "#fde9e6", border: "2px solid #d9695a", borderRadius: 8, padding: "11px 13px", marginBottom: 14, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 4, display: "flex", alignItems: "flex-start", gap: 6 }}>
            <span style={{ fontSize: 15, lineHeight: 1.2 }}>⛔</span>
            <span>Local rate not verified for {local.where} — confirm with title</span>
          </div>
          <div style={{ color: "#9a3a2c" }}>
            {tableLoading
              ? <>Loading {jurisdiction.stateName}'s local rate table…</>
              : <>{local.unverified.map((u) => u.reason).join("; ")}. {jurisdiction.stateName} sets local transfer taxes at the <b>{LOCAL_LEVEL_LABEL[jurisdiction.localLevel]}</b> level, so the local line is shown as a <b>range</b>, not a single number. Pick the exact {jurisdiction.localLevel === "county" ? "county" : "town"} below if you know it.</>}
          </div>
        </div>
      )}

      {verifyLines.length > 0 && (
        <div style={{ fontSize: 12, color: "#8a2b14", background: "#fdf3ee", border: "1px solid #e8b9a6", borderRadius: 8, padding: "10px 12px", marginBottom: 14, lineHeight: 1.5 }}>
          <div style={{ fontWeight: 700, fontSize: 12, marginBottom: 4 }}>🚩 Confirm with title before relying on these lines</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {verifyLines.map((l, i) => (
              <li key={i} style={{ marginBottom: 2 }}><span style={{ fontWeight: 600 }}>{l.name}</span>{l.notes ? <span style={{ color: "#9a4a32" }}> — {l.notes}</span> : null}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Address autocomplete */}
      <div style={{ position: "relative", marginBottom: 10 }}>
        <label style={labelStyle}>
          Property Address
          <input
            type="text" value={addrInput}
            onChange={(e) => onAddrType(e.target.value)}
            onFocus={() => { if (suggests.length) setSugOpen(true); }}
            onBlur={() => setTimeout(() => setSugOpen(false), 120)}
            placeholder={dealAddress || "Type an address to estimate…"}
            autoComplete="off" style={inputStyle}
          />
        </label>
        {sugOpen && suggests.length > 0 && (
          <div style={{ position: "absolute", zIndex: 30, left: 0, right: 0, top: "100%", marginTop: 2, background: "#fff", border: "1px solid #e3dccd", borderRadius: 6, boxShadow: "0 6px 18px rgba(56,58,55,0.14)", overflow: "hidden" }}>
            {suggests.map((s, i) => (
              <div key={i}
                onMouseDown={(e) => { e.preventDefault(); pickAddr(s); }}
                onMouseEnter={(e) => (e.currentTarget.style.background = "#f7f4ee")}
                onMouseLeave={(e) => (e.currentTarget.style.background = "#fff")}
                style={{ padding: "9px 10px", fontSize: 12, color: "#383a37", cursor: "pointer", borderTop: i ? "1px solid #f1eadc" : "none", lineHeight: 1.35 }}>
                {s.label}
              </div>
            ))}
          </div>
        )}
        <div style={{ fontSize: 10, color: "#a69e91", marginTop: 4 }}>
          {addrOverride
            ? <>Estimating a custom address ({effectiveState || "—"}). <span onClick={clearAddr} style={{ color: "#6dba43", cursor: "pointer", fontWeight: 600 }}>↺ use deal address</span></>
            : (dealAddress ? "Using the deal address — type above to estimate a different one." : "Type an address to set the state & locality.")}
        </div>
      </div>

      {/* Inputs */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(130px, 1fr))", gap: 10, marginBottom: 6 }}>
        <label style={labelStyle}>
          Purchase Price
          <input type="text" inputMode="numeric" value={priceInput} onChange={(e) => setPriceInput(e.target.value)} onBlur={() => setPriceInput(v => commaFmt(v))} onFocus={() => setPriceInput(v => v.replace(/,/g, ""))} placeholder="optional" style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Loan Amount
          <input type="text" inputMode="numeric" value={loanInput} onChange={(e) => setLoanInput(e.target.value)} onBlur={() => setLoanInput(v => commaFmt(v))} onFocus={() => setLoanInput(v => v.replace(/,/g, ""))} placeholder="optional" style={inputStyle} />
        </label>
        <label style={labelStyle}>
          Expected Closing
          <input type="date" value={closingDate} onChange={(e) => setClosingDate(e.target.value || todayIso())} style={inputStyle} />
        </label>
      </div>
      <div style={{ fontSize: 10, color: "#a69e91", marginBottom: 10, minHeight: 14 }}>
        {loanIsAssumed ? `Loan assumed at ${Math.round(DEFAULT_LTV * 100)}% LTV — edit above to override.` : ""}
      </div>

      {hasEntityLine && (
        <label style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11, color: "#52554e", marginBottom: 12, cursor: "pointer" }}>
          <input type="checkbox" checked={entitySale} onChange={(e) => setEntitySale(e.target.checked)} style={{ accentColor: "#3f7a1f", width: 16, height: 16 }} />
          Entity / controlling-interest sale (applies the Controlling Interest Transfer Tax)
        </label>
      )}

      {/* Local jurisdiction — resolved from the address; manual pick only on "Change". */}
      {jurisdiction.localLevel !== "none" ? (
        <div style={{ marginBottom: 12 }}>
          <div style={{ ...labelStyle, marginBottom: 4 }}>Local taxing jurisdiction · set by {LOCAL_LEVEL_LABEL[jurisdiction.localLevel]}</div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, background: local.status === "unverified" ? "#fdf1ef" : "#fafaf8", border: `1px solid ${local.status === "unverified" ? "#e9b3aa" : "#e3dccd"}`, borderRadius: 6, padding: "8px 10px" }}>
            <span style={{ fontSize: 12.5, color: "#383a37", lineHeight: 1.4 }}>
              {local.status === "verified" && <span style={{ color: "#3f7a1f", marginRight: 5 }}>✓</span>}
              {local.status === "unverified" && <span style={{ color: "#b3261e", marginRight: 5 }}>⛔</span>}
              {appliedLocalNames.length ? appliedLocalNames.join(" + ") : local.where}
              {local.confirmedNone.length > 0 && <span style={{ color: "#7d766a" }}> · no {local.confirmedNone.join("/")} tax here</span>}
            </span>
            <button type="button" onClick={() => setPickerOpen((v) => !v)}
              style={{ background: "transparent", border: "none", color: "#4f8a2b", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "'Inter',sans-serif", padding: "6px 6px", flexShrink: 0 }}>
              {pickerOpen ? "Done" : "Change"}
            </button>
          </div>
          <div style={{ fontSize: 10, color: "#a69e91", marginTop: 4, lineHeight: 1.45 }}>
            {geoStatus === "loading" && <>📍 Resolving the exact jurisdiction from the property address…</>}
            {geoStatus === "done" && geo?.matched && local.basis !== "manual" && (
              <>📍 {[geo.place, geo.municipality].filter(Boolean).join(" / ") || "—"}{geo.county ? ` · ${geo.county}` : ""}{geo.schoolDistrict ? ` · ${geo.schoolDistrict}` : ""} — resolved from the address ({geo.source || "US Census"}).</>
            )}
            {geoStatus === "done" && !geo?.matched && <>Couldn't pin the jurisdiction from the address — pick it with "Change".</>}
            {geoStatus === "failed" && <>Address lookup unavailable right now — pick the jurisdiction with "Change".</>}
            {geoStatus === "idle" && !hasStreet && <>No street address on this deal — add one, or pick the jurisdiction with "Change".</>}
            {local.basis === "manual" && <>Manually selected. <span onClick={() => setManual({})} style={{ color: "#4f8a2b", cursor: "pointer", fontWeight: 600 }}>↺ use the address</span></>}
          </div>
          {pickerOpen && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 8, marginTop: 8 }}>
              {countyEntries.length > 0 && (
                <label style={labelStyle}>County
                  <select value={manual.countyId ?? ""} onChange={(e) => setManual((m) => ({ ...m, countyId: e.target.value || null }))} style={selectStyle}>
                    <option value="">— from address —</option>
                    {countyEntries.map((c) => <option key={c.id} value={c.id}>{c.name}{c.lines.length ? "" : " (no county tax)"}</option>)}
                  </select>
                </label>
              )}
              {muniCounties.length > 0 && (
                <label style={labelStyle}>County (filter towns)
                  <select value={pickCounty} onChange={(e) => setPickCounty(e.target.value)} style={selectStyle}>
                    <option value="">All counties</option>
                    {muniCounties.map((c) => <option key={c} value={c}>{c}</option>)}
                  </select>
                </label>
              )}
              {muniOptions.length > 0 && (
                <label style={labelStyle}>{jurisdiction.localLevel === "municipality+school" ? "Municipality · school district" : "City / town"}
                  <select value={manual.muniId ?? ""} onChange={(e) => setManual((m) => ({ ...m, muniId: e.target.value || null }))} style={selectStyle}>
                    <option value="">— from address —</option>
                    {muniOptions.map((m) => <option key={m.id} value={m.id}>{m.name}{m.schoolDistrict ? ` · ${m.schoolDistrict}` : ""}{!pickCounty && m.county ? ` (${m.county})` : ""}</option>)}
                  </select>
                </label>
              )}
              {!entries.length && <div style={{ fontSize: 11, color: "#7d766a" }}>{tableLoading ? "Loading local table…" : "No local table for this state."}</div>}
            </div>
          )}
        </div>
      ) : (
        <div style={{ fontSize: 10.5, color: "#7d766a", marginBottom: 12, lineHeight: 1.45 }}>
          ✓ {jurisdiction.stateName} has no local (county/city) transfer tax — {jurisdiction.localLevelSource.source}, as of {jurisdiction.localLevelSource.asOf}.
        </div>
      )}

      {/* Summary tiles */}
      {hasPrice && (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(96px, 1fr))", gap: 8, marginBottom: 14 }}>
          {([["Buyer", breakdown.totals.buyer, breakdown.totalsMax.buyer, "#f6f9f0", "#d6e9bd", "#5c7a3c", "#3f7a1f"],
             ["Seller", breakdown.totals.seller, breakdown.totalsMax.seller, "#fff8ec", "#ead9b3", "#7a5c2c", "#8a5a14"],
             ["Combined", breakdown.totals.combined, breakdown.totalsMax.combined, "#f4f1ea", "#ddd4c2", "#6f6a5f", "#383a37"]] as const).map(
            ([label, lo, hi, bg, bd, lc, vc]) => (
              <div key={label} style={{ background: bg, border: `1px solid ${bd}`, borderRadius: 8, padding: "10px 12px", minWidth: 0 }}>
                <div style={{ fontSize: 9, color: lc, fontWeight: 700, letterSpacing: "0.08em", textTransform: "uppercase", marginBottom: 2 }}>{label}{Math.round(lo) !== Math.round(hi) ? " (range)" : ""}</div>
                <div style={{ fontSize: Math.round(lo) !== Math.round(hi) ? 13 : 16, color: vc, fontWeight: 600, overflowWrap: "anywhere" }}>{fmtRange(lo, hi)}</div>
                <div style={{ fontSize: 10, color: "#7d766a", marginTop: 2 }}>{Math.round(lo) !== Math.round(hi) ? `${fmtPct(lo / price)}–${fmtPct(hi / price)}` : fmtPct(lo / price)} of price</div>
              </div>
            )
          )}
        </div>
      )}

      {/* Rate table — ALWAYS visible */}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11.5, minWidth: 420 }}>
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
              const dormant = !!l.inactive;
              const needsVerify = !!l.verify && !dormant;
              const baseAmt = l.base === "loan" ? loan : price;
              const isFlat = l.rate === 0 && l.rateMin == null;
              const r = l.range;
              const cell = (amt: number, lo: number | undefined, hi: number | undefined, color: string) => {
                if (!hasPrice) return <span style={{ color: "#c9c2b3" }}>—</span>;
                if (r) return (hi ?? 0) > 0 ? <span style={{ color: "#b3261e", fontWeight: 600 }}>{fmtRange(lo ?? 0, hi ?? 0)}</span> : <span style={{ color: "#c9c2b3" }}>—</span>;
                if (dormant || amt <= 0) return <span style={{ color: "#c9c2b3" }}>—</span>;
                const p = isFlat ? null : effPct(amt, baseAmt);
                return <span style={{ color, fontWeight: 500 }}>{fmt(amt)}{p && <div style={{ fontSize: 9.5, color: "#a69e91", fontWeight: 400, marginTop: 1 }}>({p})</div>}</span>;
              };
              return (
                <tr key={i} style={{ borderBottom: "1px solid #f5efe2", opacity: dormant ? 0.45 : 1, background: l.unverified ? "#fdf1ef" : undefined }}>
                  <td style={{ padding: "8px 8px", color: l.unverified ? "#8a1f14" : "#383a37", verticalAlign: "top", fontWeight: l.unverified ? 600 : 400 }}>
                    <div>
                      {l.name}
                      {dormant ? <span style={{ fontSize: 9, color: "#a69e91", fontWeight: 600 }}> · not applied</span> : null}
                      {needsVerify ? <span style={{ fontSize: 9, color: "#b04a2e", fontWeight: 700, marginLeft: 5, whiteSpace: "nowrap" }}>🚩 confirm w/ title</span> : null}
                    </div>
                    {l.notes && <div style={{ fontSize: 9.5, color: l.unverified ? "#9a3a2c" : "#a69e91", marginTop: 2, lineHeight: 1.4, fontWeight: 400 }}>{l.notes}</div>}
                    {l.source && (
                      <div style={{ fontSize: 9, color: "#b3ab9c", marginTop: 2, lineHeight: 1.35, fontWeight: 400 }}>
                        Source:{" "}
                        {l.sourceUrl ? <a href={l.sourceUrl} target="_blank" rel="noreferrer" style={{ color: "#7d8fa8" }}>{l.source}</a> : l.source}
                        {l.asOf ? <> · as of {l.asOf}</> : null}
                      </div>
                    )}
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "left", color: l.unverified ? "#b3261e" : "#52554e", whiteSpace: "nowrap", verticalAlign: "top", fontVariantNumeric: "tabular-nums" }}>
                    {isFlat && !l.unverified ? (dormant ? "—" : `flat ${fmt(l.amount)}`) : formatRate(l)}
                  </td>
                  <td style={{ padding: "8px 8px", textAlign: "right", verticalAlign: "top" }}>{cell(l.buyer, r?.buyerMin, r?.buyerMax, "#3f7a1f")}</td>
                  <td style={{ padding: "8px 8px", textAlign: "right", verticalAlign: "top" }}>{cell(l.seller, r?.sellerMin, r?.sellerMax, "#8a5a14")}</td>
                </tr>
              );
            })}
            {hasPrice && (
              <tr style={{ background: "#faf7f0" }}>
                <td style={{ padding: "10px 8px", color: "#26281f", fontWeight: 700 }} colSpan={2}>Total{hasRange ? " (range — local rate unverified)" : ""}</td>
                <td style={{ padding: "10px 8px", textAlign: "right", color: "#3f7a1f", fontWeight: 700 }}>{fmtRange(breakdown.totals.buyer, breakdown.totalsMax.buyer)}</td>
                <td style={{ padding: "10px 8px", textAlign: "right", color: "#8a5a14", fontWeight: 700 }}>{fmtRange(breakdown.totals.seller, breakdown.totalsMax.seller)}</td>
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

      <div style={{ fontSize: 9.5, color: "#a69e91", marginTop: 12, lineHeight: 1.6, borderTop: "1px solid #f0e9da", paddingTop: 10 }}>
        <div>Splits: {SPLITS_SOURCE}. {jurisdiction.stateName} rates last verified {jurisdiction.ratesAsOf}. Local level: {jurisdiction.localLevelSource.source} (as of {jurisdiction.localLevelSource.asOf}).</div>
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
