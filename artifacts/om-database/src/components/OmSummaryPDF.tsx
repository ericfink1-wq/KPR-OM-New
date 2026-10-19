// KPR OM SUMMARY — one page, the SAME sections in the SAME order for every OM, whatever the
// broker's format (Eric, 10/18/26): property · pricing · roster scrub · top tenants · rollover ·
// flags · demographics · comps. Everything comes from the deal record + the roster scrub
// (lib/rosterScrub) — no AI. A missing figure prints "—", never a guess.
import { fmtMoney } from "../lib/money";
import { Document, Page, View, Text, StyleSheet } from "@react-pdf/renderer";
import type { Deal } from "../lib/idb";
import { FLAG_META, FLAG_ORDER, type ScrubRow, type ScrubSummary } from "../lib/rosterScrub";

const C = { ink: "#232422", char: "#383A37", gray: "#676767", faint: "#a3a19b", green: "#5BBA47", greenDk: "#3e8a2f", page: "#FAF9F5", line: "#e4e2dc", red: "#b3403f", amber: "#a8640f" };
const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 8, color: C.char, padding: 26 },
  band: { backgroundColor: C.char, borderRadius: 6, padding: 12, marginBottom: 10, flexDirection: "row", justifyContent: "space-between" },
  kicker: { fontSize: 7, color: C.green, fontFamily: "Helvetica-Bold", letterSpacing: 1.4 },
  title: { fontSize: 18, color: "#ffffff", fontFamily: "Helvetica-Bold", marginTop: 3 },
  sub: { fontSize: 8, color: "#d9d8d2", marginTop: 2 },
  secH: { fontSize: 7, fontFamily: "Helvetica-Bold", color: C.char, letterSpacing: 1.1, textTransform: "uppercase", borderBottomWidth: 1, borderBottomColor: C.green, borderBottomStyle: "solid", paddingBottom: 2, marginBottom: 4 },
  row: { flexDirection: "row" },
  kpiGrid: { flexDirection: "row", flexWrap: "wrap", marginBottom: 8 },
  kpi: { width: "16.66%", paddingVertical: 4, paddingRight: 4 },
  kpiV: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.ink },
  kpiL: { fontSize: 5.8, color: C.gray, textTransform: "uppercase", letterSpacing: 0.4, marginTop: 1 },
  cell: { fontSize: 7.4, paddingVertical: 1.6 },
  tr: { flexDirection: "row", borderBottomWidth: 0.5, borderBottomColor: C.line, borderBottomStyle: "solid" },
  bar: { height: 7, backgroundColor: C.green, borderRadius: 1.5 },
  foot: { position: "absolute", bottom: 12, left: 26, right: 26, fontSize: 6, color: C.faint },
});
const $m = (v: unknown) => { const n = Number(v); return v == null || v === "" || !Number.isFinite(n) ? "—" : fmtMoney(n); };
const pct = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v.toFixed(d)}%`);
const n0 = (v: unknown) => (v == null || v === "" || !Number.isFinite(Number(v)) ? "—" : Math.round(Number(v)).toLocaleString());

function Kpi({ v, l }: { v: string; l: string }) { return <View style={s.kpi}><Text style={s.kpiV}>{v}</Text><Text style={s.kpiL}>{l}</Text></View>; }

export default function OmSummaryPDF({ deal, scrub }: { deal: Deal; scrub: { rows: ScrubRow[]; summary: ScrubSummary } }) {
  const S = scrub.summary;
  const price = Number(deal.askingPrice) || null, noi = Number(deal.noi) || null, gla = S.gla || Number(deal.totalSF) || null;
  const cap = deal.capRate != null ? Number(deal.capRate) : price && noi ? (noi / price) * 100 : null;
  // Rollover: % of in-place rent expiring by year, next 10 years.
  const y0 = new Date().getFullYear();
  const roll = Array.from({ length: 10 }, (_, i) => y0 + i).map(y => ({ y, p: S.inPlaceRent ? scrub.rows.filter(r => !r.flags.includes("proposed") && String(r.tenant.leaseExpiry ?? "").startsWith(String(y))).reduce((t, r) => t + (Number(r.tenant.annualRent) || 0), 0) / S.inPlaceRent * 100 : 0 }));
  const maxRoll = Math.max(10, ...roll.map(r => r.p));
  const counted = scrub.rows.filter(r => !r.flags.includes("proposed"));
  const top = [...counted].sort((a, b) => (Number(b.tenant.annualRent) || 0) - (Number(a.tenant.annualRent) || 0)).slice(0, 8);
  const flagCounts = FLAG_ORDER.map(f => ({ f, n: scrub.rows.filter(r => r.flags.includes(f)).length })).filter(x => x.n);
  const flagged = scrub.rows.filter(r => r.flags.some(f => ["above", "kickout", "cotenancy", "highOcc", "proposed", "holdover", "expiring"].includes(f))).slice(0, 7);
  type Comp = { name?: string; propertyName?: string; city?: string; saleDate?: string; salePrice?: number; capRate?: number; pricePerSF?: number };
  const comps = (((deal as unknown as { comparableSales?: Comp[] }).comparableSales) ?? []).filter(c => c && (c.salePrice || c.saleDate)).slice(0, 4);
  return (
    <Document title={`KPR OM Summary — ${deal.propertyName ?? ""}`}>
      <Page size="LETTER" style={s.page}>
        <View style={s.band}>
          <View style={{ flex: 1 }}>
            <Text style={s.kicker}>KPR OM SUMMARY</Text>
            <Text style={s.title}>{deal.propertyName ?? "Untitled"}</Text>
            <Text style={s.sub}>{[deal.address, deal.city, deal.state].filter(Boolean).join(", ")}{deal.centerType ? ` · ${deal.centerType}` : ""}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 7, color: "#d9d8d2" }}>Rent roll as of {deal.tenantsAsOf ?? deal.omDate ?? "—"}</Text>
            {deal.dealScore?.grade ? <Text style={{ fontSize: 16, color: C.green, fontFamily: "Helvetica-Bold", marginTop: 4 }}>{String(deal.dealScore.grade)}</Text> : null}
          </View>
        </View>

        <Text style={s.secH}>Property & pricing</Text>
        <View style={s.kpiGrid}>
          <Kpi v={gla ? `${n0(gla)} SF` : "—"} l="GLA" />
          <Kpi v={price ? $m(price) : "Unpriced"} l="Asking price" />
          <Kpi v={$m(noi)} l="NOI (OM)" />
          <Kpi v={cap != null ? pct(cap, 2) : "—"} l="Cap rate" />
          <Kpi v={price && gla ? `$${Math.round(price / gla)}` : "—"} l="Price / SF" />
          <Kpi v={deal.yearBuilt ? String(deal.yearBuilt) : "—"} l="Year built" />
        </View>

        <Text style={s.secH}>Roster scrub</Text>
        <View style={s.kpiGrid}>
          <Kpi v={pct(S.leasedPct)} l="Leased (excl. proposed)" />
          <Kpi v={pct(S.openPct)} l="Physically open" />
          <Kpi v={$m(S.inPlaceRent)} l="In-place base rent" />
          <Kpi v={pct(S.igRentPct)} l="IG share of rent" />
          <Kpi v={pct(S.top5Pct)} l="Top-5 concentration" />
          <Kpi v={S.walt != null ? `${S.walt} yrs` : "—"} l="WALT" />
          <Kpi v={`${pct(S.roll12Pct, 0)} / ${pct(S.roll24Pct, 0)} / ${pct(S.roll36Pct, 0)}`} l="Rolling 12/24/36 mo" />
          <Kpi v={`${S.belowN} · ${$m(S.belowAnnual)}`} l="Below market (gap/yr)" />
          <Kpi v={`${S.aboveN} · ${$m(-S.aboveAnnual)}`} l="Above market (premium/yr)" />
          <Kpi v={`${S.salesReporting} · ${pct(S.wtdOccCost)}`} l="Report sales · wtd occ cost" />
          <Kpi v={`${S.noOptionsN} / ${S.kickoutN} / ${S.cotenancyN}`} l="No options / kickout / co-ten." />
          <Kpi v={`${pct(S.mix.nnn, 0)} / ${pct(S.mix.gross, 0)}`} l="NNN / gross (of rent)" />
        </View>
        {S.proposed.n > 0 && <Text style={{ fontSize: 7.4, color: C.amber, marginBottom: 6 }}>Excluded as pipeline: {S.proposed.n} proposed / unsigned lease{S.proposed.n === 1 ? "" : "s"} — {n0(S.proposed.sf)} SF, {$m(S.proposed.rent)}/yr.</Text>}

        <View style={[s.row, { marginBottom: 8 }]}>
          <View style={{ width: "58%", paddingRight: 12 }}>
            <Text style={s.secH}>Top tenants</Text>
            <View style={[s.tr, { borderBottomColor: C.char }]}>
              {[["Tenant", "34%"], ["SF", "13%"], ["Rent/SF", "12%"], ["% rent", "11%"], ["Expiry", "15%"], ["Mkt/SF", "15%"]].map(([h, w]) => <Text key={h} style={[s.cell, { width: w, fontFamily: "Helvetica-Bold", color: C.gray, textAlign: h === "Tenant" ? "left" : "right" }]}>{h}</Text>)}
            </View>
            {top.map((r, i) => {
              const t = r.tenant;
              return (
                <View key={i} style={s.tr}>
                  <Text style={[s.cell, { width: "34%" }]}>{(t.canonicalName || t.name || "").slice(0, 30)}{t.isAnchor ? " ·A" : ""}</Text>
                  <Text style={[s.cell, { width: "13%", textAlign: "right" }]}>{n0(t.sf)}</Text>
                  <Text style={[s.cell, { width: "12%", textAlign: "right" }]}>{t.rentPerSF != null ? `$${Number(t.rentPerSF).toFixed(2)}` : "—"}</Text>
                  <Text style={[s.cell, { width: "11%", textAlign: "right" }]}>{S.inPlaceRent ? pct(((Number(t.annualRent) || 0) / S.inPlaceRent) * 100, 1) : "—"}</Text>
                  <Text style={[s.cell, { width: "15%", textAlign: "right" }]}>{t.leaseExpiry?.slice(0, 7) ?? "—"}</Text>
                  <Text style={[s.cell, { width: "15%", textAlign: "right", color: r.flags.includes("above") ? C.red : r.flags.includes("below") ? C.greenDk : C.char }]}>{r.bench.rentMedian ? `$${r.bench.rentMedian.toFixed(2)}` : "—"}</Text>
                </View>
              );
            })}
          </View>
          <View style={{ width: "42%" }}>
            <Text style={s.secH}>Rollover — % of base rent expiring</Text>
            {roll.map(r => (
              <View key={r.y} style={[s.row, { alignItems: "center", marginBottom: 2.2 }]}>
                <Text style={{ width: 26, fontSize: 7 }}>{r.y}</Text>
                <View style={{ flex: 1, height: 7, backgroundColor: C.page, borderRadius: 1.5, marginRight: 4 }}><View style={[s.bar, { width: `${Math.min(100, (r.p / maxRoll) * 100)}%`, backgroundColor: r.p >= 15 ? C.amber : C.green }]} /></View>
                <Text style={{ width: 26, fontSize: 7, textAlign: "right", color: C.gray }}>{r.p ? `${r.p.toFixed(0)}%` : "—"}</Text>
              </View>
            ))}
          </View>
        </View>

        <View style={[s.row, { marginBottom: 8 }]}>
          <View style={{ width: "58%", paddingRight: 12 }}>
            <Text style={s.secH}>Flags</Text>
            <Text style={{ fontSize: 7.4, color: C.gray, marginBottom: 3 }}>{flagCounts.length ? flagCounts.map(x => `${FLAG_META[x.f].label} ${x.n}`).join(" · ") : "No flags raised."}</Text>
            {flagged.map((r, i) => <Text key={i} style={{ fontSize: 7.4, marginBottom: 1.6 }}>• {(r.tenant.canonicalName || r.tenant.name || "").slice(0, 34)} — {FLAG_ORDER.filter(f => r.flags.includes(f)).map(f => FLAG_META[f].label).join(", ")}</Text>)}
          </View>
          <View style={{ width: "42%" }}>
            <Text style={s.secH}>Demographics (3-mile)</Text>
            {[["Population", n0(deal.population3mi)], ["Avg HH income", deal.avgHHIncome3mi ? $m(deal.avgHHIncome3mi) : "—"], ["Median HH income", deal.medianHHIncome3mi ? $m(deal.medianHHIncome3mi) : "—"], ["Traffic (VPD)", n0(deal.trafficCountVPD)]].map(([l, v]) => (
              <View key={l} style={[s.row, { justifyContent: "space-between", marginBottom: 2 }]}><Text style={{ fontSize: 7.4, color: C.gray }}>{l}</Text><Text style={{ fontSize: 7.4, fontFamily: "Helvetica-Bold" }}>{v}</Text></View>
            ))}
          </View>
        </View>

        <Text style={s.secH}>Sale comps (from the OM)</Text>
        {!comps.length ? <Text style={{ fontSize: 7.4, color: C.gray }}>No sale comps captured from this OM.</Text> : comps.map((c: Comp, i: number) => (
          <Text key={i} style={{ fontSize: 7.4, marginBottom: 1.6 }}>• {String(c.name ?? c.propertyName ?? "Comp").slice(0, 40)}{c.city ? `, ${c.city}` : ""}{c.saleDate ? ` · ${String(c.saleDate).slice(0, 7)}` : ""}{c.salePrice ? ` · ${$m(c.salePrice)}` : ""}{c.capRate ? ` · ${Number(c.capRate).toFixed(2)}% cap` : ""}{c.pricePerSF ? ` · $${Math.round(Number(c.pricePerSF))}/SF` : ""}</Text>
        ))}

        <View style={s.foot} fixed>
          <Text>KPR Centers · Deal Intelligence · generated {new Date().toISOString().slice(0, 10)}</Text>
          <Text>Market rent = library median for the brand (else category/state + size band). Proposed/unsigned excluded. Seller-provided OM figures; verify before relying on them.</Text>
        </View>
      </Page>
    </Document>
  );
}
