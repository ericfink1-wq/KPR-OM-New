// Branded ONE-PAGE Investment Committee memo (PDF). Designed to look professionally
// laid out: KPR logo + olive/sage brand palette, a metric strip, a two-column body with
// tenancy + retail-resilience, demographics, financials, risks and upside. Consumes the
// structured ICMemoModel so the content stays in one tested place (lib/icMemo).

import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { Deal } from "../lib/idb";
import { buildICMemoModel } from "../lib/icMemo";

const C = {
  ink: "#26281f", body: "#383a37", muted: "#6f6a5f", faint: "#a69e91",
  olive: "#3f7a1f", oliveDk: "#2f5d16", sage: "#eef3e6", border: "#c3dba8",
  cream: "#f6f2ea", rule: "#d8d2c1", gold: "#9a6a1e", red: "#b23b3b",
};

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 8.5, color: C.body, paddingTop: 26, paddingHorizontal: 34, paddingBottom: 34 },
  // Header
  hdrRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  logoZone: { flexDirection: "row", alignItems: "center" },
  kicker: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.olive, letterSpacing: 1.4 },
  hdrRight: { fontSize: 7, color: C.muted, textAlign: "right" },
  rule: { height: 1.4, backgroundColor: C.olive, marginBottom: 10 },
  // Title
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 9 },
  propName: { fontSize: 19, fontFamily: "Helvetica-Bold", color: C.ink, maxWidth: 400 },
  sub: { fontSize: 8.5, color: C.muted, marginTop: 3 },
  gradeBox: { backgroundColor: C.olive, borderRadius: 6, paddingHorizontal: 12, paddingVertical: 7, alignItems: "center", minWidth: 74 },
  gradeVal: { fontSize: 20, fontFamily: "Helvetica-Bold", color: "#fff", lineHeight: 1 },
  gradeLbl: { fontSize: 6.5, color: "#e8f0dd", letterSpacing: 0.6, marginTop: 3 },
  // Recommendation banner
  recBox: { backgroundColor: C.sage, borderWidth: 0.6, borderColor: C.border, borderStyle: "solid", borderRadius: 5, paddingHorizontal: 10, paddingVertical: 7, marginBottom: 10 },
  recTxt: { fontSize: 9, color: C.oliveDk, lineHeight: 1.35 },
  // Metric strip
  mStrip: { flexDirection: "row", marginBottom: 11 },
  mBox: { flex: 1, backgroundColor: C.cream, borderWidth: 0.6, borderColor: C.rule, borderStyle: "solid", borderRadius: 3, paddingVertical: 6, paddingHorizontal: 3, alignItems: "center", marginRight: 4 },
  mVal: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 2 },
  mLbl: { fontSize: 5.8, color: C.muted, textTransform: "uppercase", letterSpacing: 0.3 },
  // Body columns
  body: { flexDirection: "row" },
  colL: { width: "57%", paddingRight: 12 },
  colR: { width: "43%" },
  secH: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.olive, letterSpacing: 0.8, paddingBottom: 2.5, marginBottom: 5, marginTop: 2, borderBottomWidth: 0.6, borderBottomColor: C.olive, borderBottomStyle: "solid", textTransform: "uppercase" },
  line: { fontSize: 8.5, color: C.body, marginBottom: 3, lineHeight: 1.3 },
  lblIn: { fontFamily: "Helvetica-Bold", color: C.ink },
  // retail bars
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 2.5 },
  barCat: { width: "38%", fontSize: 7.5, color: C.body },
  barTrack: { flex: 1, height: 7, backgroundColor: C.cream, borderRadius: 2, marginRight: 5 },
  barFill: { height: 7, borderRadius: 2, backgroundColor: C.olive },
  barPct: { width: 26, fontSize: 7, color: C.muted, textAlign: "right" },
  chip: { alignSelf: "flex-start", backgroundColor: C.olive, borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2.5, marginBottom: 5 },
  chipTxt: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: "#fff" },
  // table rows (right column)
  tRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2.5 },
  tLbl: { fontSize: 8, color: C.muted },
  tVal: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.ink },
  bullet: { flexDirection: "row", marginBottom: 2.5 },
  bDot: { width: 7, fontSize: 8, color: C.olive },
  bTxt: { flex: 1, fontSize: 8, color: C.body, lineHeight: 1.3 },
  bDotR: { width: 7, fontSize: 8, color: C.red },
  footer: { position: "absolute", bottom: 18, left: 34, right: 34, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.6, borderTopColor: C.rule, borderTopStyle: "solid", paddingTop: 5 },
  footTxt: { fontSize: 6.5, color: C.faint },
});

// Short sections stay whole (wrap=false). Long bullet lists (Risks / Upside) may
// flow across the page break so they fill page 1's column instead of jumping wholesale
// to page 2 and leaving a half-empty first page.
function Sec({ title, children, wrap = false }: { title: string; children: React.ReactNode; wrap?: boolean }) {
  return (<View wrap={wrap}><Text style={s.secH}>{title}</Text>{children}</View>);
}

export default function ICMemoPDF({ deal, logoUrl }: { deal: Deal; logoUrl: string }) {
  const m = buildICMemoModel(deal);
  const mix = m.mix;
  // top category bars (cap to keep one page)
  const bars = mix ? mix.slices.filter(x => x.rentPct > 0).slice(0, 6) : [];
  const maxPct = bars.length ? Math.max(...bars.map(b => b.rentPct)) : 1;

  return (
    <Document title={`IC Memo — ${m.name}`}>
      <Page size="LETTER" style={s.page}>
        {/* Header */}
        <View style={s.hdrRow}>
          <View style={s.logoZone}>
            <Image src={logoUrl} style={{ height: 18, width: 54, marginRight: 8, objectFit: "contain" }} />
            <Text style={s.kicker}>INVESTMENT COMMITTEE MEMO</Text>
          </View>
          <Text style={s.hdrRight}>{m.generatedOn}{m.asOf ? `\nRent roll as of ${m.asOf}` : ""}</Text>
        </View>
        <View style={s.rule} />

        {/* Title + grade */}
        <View style={s.titleRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.propName}>{m.name}</Text>
            {m.addressLine ? <Text style={s.sub}>{m.addressLine}</Text> : null}
            {m.typeLine ? <Text style={[s.sub, { color: C.olive, fontFamily: "Helvetica-Bold" }]}>{m.typeLine}</Text> : null}
          </View>
          {m.grade ? (
            <View style={s.gradeBox}>
              <Text style={s.gradeVal}>{m.grade.grade}</Text>
              <Text style={s.gradeLbl}>{m.grade.score != null ? `${m.grade.score}/100` : "GRADE"}</Text>
            </View>
          ) : null}
        </View>

        {/* Recommendation */}
        {m.grade?.rationale ? (
          <View style={s.recBox}><Text style={s.recTxt}>{m.grade.rationale}</Text></View>
        ) : null}

        {/* Metric strip */}
        {m.metrics.length ? (
          <View style={s.mStrip}>
            {m.metrics.slice(0, 7).map((x, i, arr) => (
              <View key={i} style={[s.mBox, i === arr.slice(0, 7).length - 1 ? { marginRight: 0 } : {}]}>
                <Text style={s.mVal}>{x.value}</Text>
                <Text style={s.mLbl}>{x.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Body */}
        <View style={s.body}>
          {/* Left column */}
          <View style={s.colL}>
            {(m.anchors.length || m.topTenants.length) ? (
              <Sec title="Tenancy">
                {m.anchors.length ? <Text style={s.line}><Text style={s.lblIn}>Anchors: </Text>{m.anchors.join(", ")}</Text> : null}
                {m.topTenants.length ? <Text style={s.line}><Text style={s.lblIn}>Top by rent: </Text>{m.topTenants.map(t => `${t.name} (${t.pct}%)`).join(", ")}</Text> : null}
                {m.concentration ? <Text style={s.line}><Text style={s.lblIn}>Concentration: </Text>top tenant {m.concentration.top1}% of base rent; top 3 {m.concentration.top3}%.</Text> : null}
              </Sec>
            ) : null}

            {mix ? (
              <Sec title="Retail Mix & Resilience">
                <View style={s.chip}><Text style={s.chipTxt}>Resilience {mix.resilienceScore}/100 · {mix.necessityRentPct}% necessity/service</Text></View>
                <Text style={[s.line, { marginBottom: 5 }]}>{mix.characterization}</Text>
                {bars.map((b, i) => (
                  <View key={i} style={s.barRow}>
                    <Text style={s.barCat}>{b.category}</Text>
                    <View style={s.barTrack}>
                      <View style={[s.barFill, { width: `${Math.max(4, (b.rentPct / maxPct) * 100)}%`, backgroundColor: b.resistance >= 80 ? C.olive : b.resistance >= 55 ? "#7aa653" : C.gold }]} />
                    </View>
                    <Text style={s.barPct}>{b.rentPct}%</Text>
                  </View>
                ))}
              </Sec>
            ) : null}

            {m.rollover ? (
              <Sec title="Lease Rollover">
                <Text style={s.line}><Text style={s.lblIn}>{m.rollover.count} lease{m.rollover.count === 1 ? "" : "s"}{m.rollover.pct != null ? ` (${m.rollover.pct}% of base rent)` : ""}</Text> expire through {m.rollover.throughYear}.</Text>
                {(() => {
                  // Per-year expiration schedule as a bar chart (% of base rent rolling
                  // each year) — turns the one-liner into a scannable rollover picture.
                  const rows = m.rolloverByYear.filter((r) => r.count > 0);
                  if (rows.length < 2) return null;
                  const max = Math.max(...rows.map((r) => r.pct), 1);
                  return (
                    <View style={{ marginTop: 5 }}>
                      {m.rolloverByYear.map((r, i) => (
                        <View key={i} style={s.barRow}>
                          <Text style={s.barCat}>{r.year}{r.count > 0 ? `  (${r.count})` : ""}</Text>
                          <View style={s.barTrack}><View style={[s.barFill, { width: `${Math.round((r.pct / max) * 100)}%` }]} /></View>
                          <Text style={s.barPct}>{r.pct > 0 ? `${r.pct}%` : "—"}</Text>
                        </View>
                      ))}
                      <Text style={[s.footTxt, { marginTop: 2 }]}>Share of base rent expiring each year · (n) = leases</Text>
                    </View>
                  );
                })()}
              </Sec>
            ) : null}
          </View>

          {/* Right column */}
          <View style={s.colR}>
            {m.demographics.length ? (
              <Sec title="Location & Demographics">
                {m.demographics.map((d, i) => (
                  <View key={i} style={s.tRow}><Text style={s.tLbl}>{d.label}</Text><Text style={s.tVal}>{d.value}</Text></View>
                ))}
              </Sec>
            ) : null}

            {m.financials.length ? (
              <Sec title="Financial Summary">
                {m.financials.map((f, i) => (
                  <View key={i} style={s.tRow}><Text style={s.tLbl}>{f.label}</Text><Text style={s.tVal}>{f.value}</Text></View>
                ))}
              </Sec>
            ) : null}

            {m.risks.length ? (
              <Sec title="Risks" wrap>
                {m.risks.map((r, i) => (<View key={i} style={s.bullet} wrap={false}><Text style={s.bDotR}>•</Text><Text style={s.bTxt}>{r}</Text></View>))}
              </Sec>
            ) : null}

            {m.upside.length ? (
              <Sec title="Upside / Value-Add" wrap>
                {m.upside.map((u, i) => (<View key={i} style={s.bullet} wrap={false}><Text style={s.bDot}>•</Text><Text style={s.bTxt}>{u}</Text></View>))}
              </Sec>
            ) : null}
          </View>
        </View>

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footTxt}>KPR Centers · Confidential — for internal investment-committee use only.</Text>
          <Text style={s.footTxt}>Auto-generated from captured OM data; verify against source documents.</Text>
        </View>
      </Page>
    </Document>
  );
}
