import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import { pdfWidths, type ExportCol } from "../lib/tableExport";

// Branded, shareable PDF for the two ROLL-UP pages — one retailer across the
// library (tenant page) and one holdco across its brands (parent-company page).
// Same KPR header/footer language and olive/sage palette as RentRollPDF, so a
// packet of exports reads as one set. Paginates automatically; the table header
// repeats on every page.

const C = {
  ink: "#26281f", body: "#383a37", muted: "#7d766a", faint: "#a89f8f",
  olive: "#3f7a1f", oliveDk: "#2f5d16", sage: "#eef3e6", sageBd: "#cfe3b8",
  rule: "#e3dccd", cream: "#fcfbf6", green: "#0f6d47",
};

const today = (): string => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 8, color: C.body, paddingTop: 26, paddingHorizontal: 26, paddingBottom: 44 },

  hdrRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 },
  hdrRule: { height: 1.5, backgroundColor: C.olive, marginBottom: 9 },
  logoZone: { flexDirection: "row", alignItems: "center" },
  logoLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.olive, letterSpacing: 0.8 },
  hdrRight: { fontSize: 7.5, color: C.muted, letterSpacing: 0.5 },

  title: { fontSize: 18, fontFamily: "Helvetica-Bold", color: C.ink },
  titleRow: { flexDirection: "row", alignItems: "flex-end", flexWrap: "wrap" },
  chip: { fontSize: 7, fontFamily: "Helvetica-Bold", color: C.oliveDk, backgroundColor: C.sage, borderRadius: 7, paddingVertical: 2, paddingHorizontal: 6, marginLeft: 7, marginBottom: 2 },
  sub: { fontSize: 9, color: C.muted, marginTop: 2 },
  desc: { fontSize: 8, color: C.body, marginTop: 6, lineHeight: 1.45 },

  kpiBand: { flexDirection: "row", flexWrap: "wrap", marginTop: 10, marginBottom: 11, borderWidth: 1, borderColor: C.sageBd, borderStyle: "solid", borderRadius: 4, backgroundColor: C.cream },
  kpi: { paddingVertical: 6, paddingHorizontal: 9, borderRightWidth: 0.5, borderRightColor: C.rule, borderRightStyle: "solid" },
  kpiLabel: { fontSize: 6, fontFamily: "Helvetica-Bold", color: C.muted, letterSpacing: 0.7, marginBottom: 2 },
  kpiVal: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.oliveDk },
  kpiSub: { fontSize: 6.5, color: C.faint, marginTop: 1 },

  th: { flexDirection: "row", backgroundColor: C.olive, paddingVertical: 4.5, paddingHorizontal: 4 },
  thTxt: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#fff", letterSpacing: 0.2 },
  tr: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: "#efe9dc", borderBottomStyle: "solid", alignItems: "center" },
  trAlt: { backgroundColor: "#faf8f2" },
  td: { fontSize: 7, color: C.body },
  tdBold: { fontSize: 7, fontFamily: "Helvetica-Bold", color: C.ink },
  tdFaint: { fontSize: 7, color: C.faint },
  tdRent: { fontSize: 7, color: C.green },

  totalRow: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 4, borderTopWidth: 1.5, borderTopColor: C.olive, borderTopStyle: "solid", marginTop: 1, backgroundColor: C.sage },
  totalTxt: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.ink },

  note: { fontSize: 6.5, color: C.faint, marginTop: 8, lineHeight: 1.4 },
  footer: { position: "absolute", bottom: 16, left: 26, right: 26, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: C.rule, borderTopStyle: "solid", paddingTop: 5 },
  footerTxt: { fontSize: 7.5, color: C.muted },
});

export interface TableKpi { label: string; value: string; sub?: string }

export interface TablePDFProps {
  title: string;
  kicker: string;             // "TENANT SUMMARY" / "PORTFOLIO" / "SALE COMPS" …
  subtitle?: string | null;
  chips?: string[];
  description?: string | null;
  kpis?: TableKpi[];
  columns: ExportCol[];
  rows: Record<string, unknown>[];
  /** Optional footer row, one entry per column ("" to leave a cell blank). */
  totalRow?: string[] | null;
  notes?: string | null;
  orientation?: "portrait" | "landscape";
}

export default function TablePDF(p: TablePDFProps) {
  const logoUrl = `${window.location.origin}/apple-touch-icon.png`;
  const widths = pdfWidths(p.columns);
  const kpis = p.kpis ?? [];
  const kpiW = `${100 / Math.max(kpis.length, 1)}%`;
  const toneStyle = (t?: ExportCol["tone"]) =>
    t === "bold" ? s.tdBold : t === "faint" ? s.tdFaint : t === "money" ? s.tdRent : s.td;

  return (
    <Document title={`${p.title} — KPR Deal Library`} author="KPR Centers">
      <Page size="LETTER" orientation={p.orientation ?? "landscape"} style={s.page}>
        <View fixed>
          <View style={s.hdrRow}>
            <View style={s.logoZone}>
              <Image src={logoUrl} style={{ height: 20, width: 60, marginRight: 7, objectFit: "contain" }} />
              <Text style={s.logoLabel}>KPR DEAL LIBRARY</Text>
            </View>
            <Text style={s.hdrRight}>{p.kicker} · {today()}</Text>
          </View>
          <View style={s.hdrRule} />
        </View>

        <View style={s.titleRow}>
          <Text style={s.title}>{p.title}</Text>
          {(p.chips || []).filter(Boolean).map((c, i) => <Text key={i} style={s.chip}>{c}</Text>)}
        </View>
        {p.subtitle ? <Text style={s.sub}>{p.subtitle}</Text> : null}
        {p.description ? <Text style={s.desc}>{p.description}</Text> : null}

        {kpis.length > 0 && (
          <View style={s.kpiBand}>
            {kpis.map((k, i) => (
              <View key={k.label} style={[s.kpi, { width: kpiW }, i === kpis.length - 1 ? { borderRightWidth: 0 } : {}]}>
                <Text style={s.kpiLabel}>{k.label.toUpperCase()}</Text>
                <Text style={s.kpiVal}>{k.value}</Text>
                {k.sub ? <Text style={s.kpiSub}>{k.sub}</Text> : null}
              </View>
            ))}
          </View>
        )}

        <View style={s.th} fixed>
          {p.columns.map((col, i) => (
            <Text key={col.header} style={[s.thTxt, { width: widths[i], textAlign: col.align ?? "left" }]}>
              {col.header.toUpperCase()}
            </Text>
          ))}
        </View>

        {p.rows.map((r, i) => (
          <View key={i} style={[s.tr, ...(i % 2 ? [s.trAlt] : [])]} wrap={false}>
            {p.columns.map((col, ci) => (
              <Text key={col.header} style={[toneStyle(col.tone), { width: widths[ci], textAlign: col.align ?? "left" }]}>
                {col.text(r)}
              </Text>
            ))}
          </View>
        ))}

        {p.totalRow && (
          <View style={s.totalRow} wrap={false}>
            {p.columns.map((col, ci) => (
              <Text key={col.header} style={[s.totalTxt, { width: widths[ci], textAlign: col.align ?? "left" }]}>
                {p.totalRow?.[ci] ?? ""}
              </Text>
            ))}
          </View>
        )}

        {p.notes ? <Text style={s.note}>{p.notes}</Text> : null}

        <View style={s.footer} fixed>
          <Text style={s.footerTxt}>Generated {today()} · KPR Deal Library · in-place figures</Text>
          <Text style={s.footerTxt} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
        </View>
      </Page>
    </Document>
  );
}
