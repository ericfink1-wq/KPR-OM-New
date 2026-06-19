// Branded ONE-PAGE Investment Committee teaser (PDF) — institutional style (think a
// Blackstone deal teaser): a tight, scannable single page that teaches an exec the
// deal in 30 seconds — punchy thesis, headline metric band, tenancy + rollover visual,
// and Value-Add vs. Risks side by side as one-line bullets. Long narrative/bullets are
// COMPRESSED here (first sentence, capped counts) so it never spills to a second page.
// Consumes the structured ICMemoModel so content stays in one tested place (lib/icMemo).

import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { Deal } from "../lib/idb";
import { buildICMemoModel } from "../lib/icMemo";

const C = {
  ink: "#26281f", body: "#383a37", muted: "#6f6a5f", faint: "#a69e91",
  olive: "#3f7a1f", oliveDk: "#2f5d16", sage: "#eef3e6", border: "#c3dba8",
  cream: "#f6f2ea", rule: "#d8d2c1", gold: "#9a6a1e", red: "#b23b3b", redBg: "#fbeeee",
};

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 8.3, color: C.body, paddingTop: 24, paddingHorizontal: 32, paddingBottom: 26 },
  hdrRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 },
  logoZone: { flexDirection: "row", alignItems: "center" },
  kicker: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.olive, letterSpacing: 1.5 },
  hdrRight: { fontSize: 7, color: C.muted, textAlign: "right" },
  rule: { height: 1.6, backgroundColor: C.olive, marginBottom: 9 },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 9 },
  propName: { fontSize: 21, fontFamily: "Helvetica-Bold", color: C.ink },
  sub: { fontSize: 8.5, color: C.muted, marginTop: 3 },
  typeTxt: { fontSize: 8.5, color: C.olive, fontFamily: "Helvetica-Bold", marginTop: 2 },
  gradeBox: { backgroundColor: C.olive, borderRadius: 6, paddingHorizontal: 13, paddingVertical: 7, alignItems: "center", minWidth: 76 },
  gradeVal: { fontSize: 21, fontFamily: "Helvetica-Bold", color: "#fff", lineHeight: 1 },
  gradeLbl: { fontSize: 6.5, color: "#e8f0dd", letterSpacing: 0.6, marginTop: 3 },
  thesisWrap: { marginBottom: 10 },
  thesisTxt: { fontSize: 9.5, color: C.ink, lineHeight: 1.45 },
  mStrip: { flexDirection: "row", marginBottom: 11 },
  mBox: { flex: 1, backgroundColor: C.cream, borderWidth: 0.6, borderColor: C.rule, borderStyle: "solid", borderRadius: 4, paddingVertical: 7, paddingHorizontal: 3, alignItems: "center", marginRight: 5 },
  mVal: { fontSize: 13, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 2 },
  mLbl: { fontSize: 5.8, color: C.muted, textTransform: "uppercase", letterSpacing: 0.4 },
  secH: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.olive, letterSpacing: 0.9, paddingBottom: 2.5, marginBottom: 5, borderBottomWidth: 0.6, borderBottomColor: C.olive, borderBottomStyle: "solid", textTransform: "uppercase" },
  line: { fontSize: 8.3, color: C.body, marginBottom: 3, lineHeight: 1.3 },
  lblIn: { fontFamily: "Helvetica-Bold", color: C.ink },
  body: { flexDirection: "row", marginBottom: 4 },
  colL: { width: "54%", paddingRight: 14 },
  colR: { width: "46%" },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 2.3 },
  barCat: { width: 56, fontSize: 7.3, color: C.body },
  barTrack: { flex: 1, height: 6.5, backgroundColor: C.cream, borderRadius: 2, marginRight: 5 },
  barFill: { height: 6.5, borderRadius: 2, backgroundColor: C.olive },
  barPct: { width: 24, fontSize: 7, color: C.muted, textAlign: "right" },
  chip: { alignSelf: "flex-start", backgroundColor: C.sage, borderWidth: 0.6, borderColor: C.border, borderStyle: "solid", borderRadius: 3, paddingHorizontal: 6, paddingVertical: 2.5, marginBottom: 5 },
  chipTxt: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.oliveDk },
  tRow: { flexDirection: "row", justifyContent: "space-between", marginBottom: 2.4 },
  tLbl: { fontSize: 8, color: C.muted },
  tVal: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.ink },
  // Anchor table
  anchHead: { flexDirection: "row", borderBottomWidth: 0.6, borderBottomColor: C.rule, borderBottomStyle: "solid", paddingBottom: 2, marginBottom: 2 },
  anchRow: { flexDirection: "row", paddingVertical: 1.6, alignItems: "center" },
  ahCell: { fontSize: 6.4, color: C.muted, textTransform: "uppercase", letterSpacing: 0.2, fontFamily: "Helvetica-Bold" },
  acName: { fontSize: 8, color: C.ink, fontFamily: "Helvetica-Bold" },
  acVal: { fontSize: 7.8, color: C.body },
  acNum: { fontSize: 7.8, color: C.body },
  splitRow: { flexDirection: "row", marginTop: 2 },
  splitCol: { flex: 1 },
  bullet: { flexDirection: "row", marginBottom: 3 },
  bDot: { width: 9, fontSize: 8, color: C.olive, fontFamily: "Helvetica-Bold" },
  bDotR: { width: 9, fontSize: 8, color: C.red, fontFamily: "Helvetica-Bold" },
  bTxt: { flex: 1, fontSize: 8, color: C.body, lineHeight: 1.3 },
  footer: { position: "absolute", bottom: 16, left: 32, right: 32, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.6, borderTopColor: C.rule, borderTopStyle: "solid", paddingTop: 5 },
  footTxt: { fontSize: 6.5, color: C.faint },
});

// Split prose into sentences WITHOUT breaking decimals ($5.86M, "2.5 years"): a
// terminator is only a boundary when it follows a non-digit and precedes a space +
// capital / open-paren / quote. Uses a lookahead (portable) + marker, no lookbehind.
const MARK = "␟";
const sentencesOf = (t: string): string[] => {
  const clean = (t || "").replace(/\s+/g, " ").trim();
  if (!clean) return [];
  const marked = clean.replace(/([^0-9\s][.!?])\s+(?=[A-Z("'$])/g, "$1" + MARK);
  return marked.split(MARK).map((x) => x.trim()).filter(Boolean);
};
// The thesis: the first 2–3 sentences, capped — a punchy teaser open, not the full essay.
const thesisOf = (t: string | null | undefined, maxChars = 340, maxSent = 3): string => {
  let out = "", n = 0;
  for (const p of sentencesOf(t || "")) {
    if (n >= maxSent) break;
    const next = out ? `${out} ${p}` : p;
    if (out && next.length > maxChars) break;
    out = next; n++;
  }
  return out;
};
// A bullet: its first sentence, or a clean word-boundary truncation — one scannable line.
const tighten = (t: string, max = 135): string => {
  const clean = (t || "").replace(/\s+/g, " ").trim();
  const first = sentencesOf(clean)[0] || clean;
  let out = first.length >= 30 ? first : clean;
  if (out.length > max) {
    out = out.slice(0, max);
    const sp = out.lastIndexOf(" ");
    out = (sp > 40 ? out.slice(0, sp) : out).replace(/[,;:.\s]+$/, "") + "…";
  }
  return out.replace(/\.$/, "");
};

// Column layout for the anchor table (fractions sum to 1).
const AW = { name: "27%", sf: "11%", rent: "12%", rentv: "13%", term: "10%", sales: "13%", salesv: "14%" } as const;
const signed = (p: number | null) => p == null ? "—" : `${p > 0 ? "+" : ""}${p}%`;

export default function ICMemoPDF({ deal, logoUrl, allDeals }: { deal: Deal; logoUrl: string; allDeals?: Deal[] }) {
  const m = buildICMemoModel(deal, { allDeals });
  const thesis = thesisOf(m.grade?.rationale || m.narrative);
  const upside = m.upside.slice(0, 4).map((u) => tighten(u));
  const risks = m.risks.slice(0, 4).map((r) => tighten(r));
  const rollRows = m.rolloverByYear.filter((r) => r.count > 0);
  const rollMax = rollRows.length ? Math.max(...m.rolloverByYear.map((r) => r.pct), 1) : 1;

  return (
    <Document title={`IC Memo — ${m.name}`}>
      <Page size="LETTER" style={s.page} wrap={false}>
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
            {m.typeLine ? <Text style={s.typeTxt}>{m.typeLine}</Text> : null}
          </View>
          {m.grade ? (
            <View style={s.gradeBox}>
              <Text style={s.gradeVal}>{m.grade.grade}</Text>
              <Text style={s.gradeLbl}>{m.grade.score != null ? `${m.grade.score}/100` : "GRADE"}</Text>
            </View>
          ) : null}
        </View>

        {/* Investment thesis (compressed) */}
        {thesis ? (
          <View style={s.thesisWrap}>
            <Text style={s.secH}>Investment Thesis</Text>
            <Text style={s.thesisTxt}>{thesis}</Text>
          </View>
        ) : null}

        {/* Metric strip */}
        {m.metrics.length ? (
          <View style={s.mStrip}>
            {m.metrics.slice(0, 7).map((x, i, arr) => (
              <View key={i} style={[s.mBox, i === arr.length - 1 ? { marginRight: 0 } : {}]}>
                <Text style={s.mVal}>{x.value}</Text>
                <Text style={s.mLbl}>{x.label}</Text>
              </View>
            ))}
          </View>
        ) : null}

        {/* Anchor summary — rent, term, sales, each vs the chain's own DB median */}
        {m.anchorDetail.length ? (
          <View style={{ marginBottom: 8 }}>
            <Text style={s.secH}>Anchor Summary — rent · term · sales vs chain average</Text>
            <View style={s.anchHead}>
              <Text style={[s.ahCell, { width: AW.name }]}>Anchor</Text>
              <Text style={[s.ahCell, { width: AW.sf, textAlign: "right" }]}>GLA</Text>
              <Text style={[s.ahCell, { width: AW.rent, textAlign: "right" }]}>Rent/SF</Text>
              <Text style={[s.ahCell, { width: AW.rentv, textAlign: "right" }]}>vs chain</Text>
              <Text style={[s.ahCell, { width: AW.term, textAlign: "right" }]}>Term</Text>
              <Text style={[s.ahCell, { width: AW.sales, textAlign: "right" }]}>Sales/SF</Text>
              <Text style={[s.ahCell, { width: AW.salesv, textAlign: "right" }]}>vs chain</Text>
            </View>
            {m.anchorDetail.map((a, i) => (
              <View key={i} style={[s.anchRow, i % 2 ? { backgroundColor: "#fbfaf6" } : {}]}>
                <Text style={[s.acName, { width: AW.name }]}>{a.name}</Text>
                <Text style={[s.acNum, { width: AW.sf, textAlign: "right" }]}>{a.sf != null ? `${Math.round(a.sf / 1000)}k` : "—"}</Text>
                <Text style={[s.acNum, { width: AW.rent, textAlign: "right" }]}>{a.rentPSF != null ? `$${a.rentPSF.toFixed(2)}` : "—"}</Text>
                <Text style={[s.acNum, { width: AW.rentv, textAlign: "right", color: a.rentVsChain == null ? C.faint : a.rentVsChain > 0 ? C.oliveDk : C.gold }]}>{signed(a.rentVsChain)}</Text>
                <Text style={[s.acNum, { width: AW.term, textAlign: "right" }]}>{a.termYears != null ? `${a.termYears.toFixed(1)}y` : "—"}</Text>
                <Text style={[s.acNum, { width: AW.sales, textAlign: "right" }]}>{a.salesPSF != null ? `$${Math.round(a.salesPSF)}` : "—"}</Text>
                <Text style={[s.acNum, { width: AW.salesv, textAlign: "right", color: a.salesVsChain == null ? C.faint : a.salesVsChain >= 0 ? C.oliveDk : C.red }]}>{signed(a.salesVsChain)}</Text>
              </View>
            ))}
            <Text style={[s.footTxt, { marginTop: 2 }]}>vs chain = this store vs the median of other same-brand locations in your database (— = too few to compare); sales shown where disclosed.</Text>
          </View>
        ) : null}

        {/* Body: tenancy + rollover (left) · demographics + financials (right) */}
        <View style={s.body}>
          <View style={s.colL}>
            {(m.topTenants.length || m.mix) ? (
              <View>
                <Text style={s.secH}>Tenancy</Text>
                {m.mix ? <View style={s.chip}><Text style={s.chipTxt}>Resilience {m.mix.resilienceScore}/100 · {m.mix.necessityRentPct}% necessity/service</Text></View> : null}
                {m.topTenants.length ? <Text style={s.line}><Text style={s.lblIn}>Top by rent: </Text>{m.topTenants.slice(0, 5).map((t) => `${t.name} (${t.pct}%)`).join(", ")}</Text> : null}
                {m.concentration ? <Text style={s.line}><Text style={s.lblIn}>Concentration: </Text>top tenant {m.concentration.top1}%; top 3 {m.concentration.top3}% of base rent.</Text> : null}
              </View>
            ) : null}

            {m.rollover ? (
              <View style={{ marginTop: 6 }}>
                <Text style={s.secH}>Lease Rollover</Text>
                <Text style={[s.line, { marginBottom: 4 }]}><Text style={s.lblIn}>{m.rollover.count} lease{m.rollover.count === 1 ? "" : "s"}{m.rollover.pct != null ? ` (${m.rollover.pct}% of rent)` : ""}</Text> expire through {m.rollover.throughYear}.</Text>
                {rollRows.length >= 2 ? m.rolloverByYear.map((r, i) => (
                  <View key={i} style={s.barRow}>
                    <Text style={s.barCat}>{r.year}{r.count > 0 ? ` (${r.count})` : ""}</Text>
                    <View style={s.barTrack}><View style={[s.barFill, { width: `${Math.round((r.pct / rollMax) * 100)}%` }]} /></View>
                    <Text style={s.barPct}>{r.pct > 0 ? `${r.pct}%` : "—"}</Text>
                  </View>
                )) : null}
              </View>
            ) : null}
          </View>

          <View style={s.colR}>
            {m.demographics.length ? (
              <View>
                <Text style={s.secH}>Location & Demographics</Text>
                {m.demographics.map((d, i) => (
                  <View key={i} style={s.tRow}><Text style={s.tLbl}>{d.label}</Text><Text style={s.tVal}>{d.value}</Text></View>
                ))}
              </View>
            ) : null}
            {m.financials.length ? (
              <View style={{ marginTop: 6 }}>
                <Text style={s.secH}>Financial Summary</Text>
                {m.financials.map((f, i) => (
                  <View key={i} style={s.tRow}><Text style={s.tLbl}>{f.label}</Text><Text style={s.tVal}>{f.value}</Text></View>
                ))}
              </View>
            ) : null}
          </View>
        </View>

        {/* Value-Add vs. Risks — side by side, one-line bullets */}
        {(upside.length || risks.length) ? (
          <View style={s.splitRow}>
            <View style={[s.splitCol, { paddingRight: 14 }]}>
              <Text style={s.secH}>Value-Add / Upside</Text>
              {upside.length ? upside.map((u, i) => (
                <View key={i} style={s.bullet}><Text style={s.bDot}>•</Text><Text style={s.bTxt}>{u}</Text></View>
              )) : <Text style={s.line}>—</Text>}
            </View>
            <View style={s.splitCol}>
              <Text style={s.secH}>Key Risks</Text>
              {risks.length ? risks.map((r, i) => (
                <View key={i} style={s.bullet}><Text style={s.bDotR}>•</Text><Text style={s.bTxt}>{r}</Text></View>
              )) : <Text style={s.line}>—</Text>}
            </View>
          </View>
        ) : null}

        {/* Footer */}
        <View style={s.footer} fixed>
          <Text style={s.footTxt}>KPR Centers · Confidential — for internal investment-committee use only.</Text>
          <Text style={s.footTxt}>Auto-generated from captured OM data; verify against source documents.</Text>
        </View>
      </Page>
    </Document>
  );
}
