import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { Deal } from "../lib/idb";
import { isVacant, isNAPTenant, fmtLeaseDate } from "../lib/utils";

// Branded, presentation-quality rent roll PDF — same KPR header/footer language
// as DealSummaryPDF. One clean table that paginates automatically.

const C = {
  ink: "#2a2c28", body: "#383a37", muted: "#6f6a5f",
  olive: "#3f7a1f", sage: "#eef3e6", border: "#b8d49a",
  rule: "#d8d2c1", zebra: "#faf7f0", dark: "#9a5b12",
};

const toN = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n; };
const today = (): string => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const money0 = (v: number): string => v ? `$${Math.round(v).toLocaleString()}` : "—";
const money2 = (v: number): string => v ? `$${v.toFixed(2)}` : "—";
const num0 = (v: number): string => v ? Math.round(v).toLocaleString() : "—";

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 8, color: C.body, paddingTop: 28, paddingHorizontal: 28, paddingBottom: 46 },
  hdrRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 },
  hdrRule: { height: 1, backgroundColor: C.olive, marginBottom: 10 },
  logoZone: { flexDirection: "row", alignItems: "center" },
  logoLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.olive, letterSpacing: 0.8 },
  hdrRight: { fontSize: 7.5, color: C.muted },
  propName: { fontSize: 15, fontFamily: "Helvetica-Bold", color: C.ink },
  addr: { fontSize: 9, color: C.muted, marginTop: 2, marginBottom: 4 },
  metaRow: { flexDirection: "row", flexWrap: "wrap", marginBottom: 10 },
  metaPill: { backgroundColor: C.sage, borderWidth: 0.5, borderColor: C.border, borderStyle: "solid", borderRadius: 3, paddingHorizontal: 6, paddingVertical: 3, marginRight: 5, marginTop: 3 },
  metaTxt: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.olive },
  th: { flexDirection: "row", backgroundColor: C.olive, paddingVertical: 4, paddingHorizontal: 3 },
  thTxt: { fontSize: 7, fontFamily: "Helvetica-Bold", color: "#fff" },
  tr: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 3, borderBottomWidth: 0.5, borderBottomColor: "#ece5d7", borderBottomStyle: "solid" },
  td: { fontSize: 7.5, color: C.body },
  totalRow: { flexDirection: "row", paddingVertical: 4, paddingHorizontal: 3, borderTopWidth: 1, borderTopColor: C.olive, borderTopStyle: "solid", marginTop: 1 },
  totalTxt: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.ink },
  footer: { position: "absolute", bottom: 16, left: 28, right: 28, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: C.rule, borderTopStyle: "solid", paddingTop: 5 },
  footerTxt: { fontSize: 7.5, color: C.muted },
});

// Column layout (flex widths sum loosely to ~100)
const COLS = {
  tenant: { width: "21%" },
  sf:     { width: "9%",  textAlign: "right" as const },
  rentSf: { width: "9%",  textAlign: "right" as const },
  rent:   { width: "12%", textAlign: "right" as const },
  start:  { width: "10%" },
  expiry: { width: "10%" },
  term:   { width: "8%",  textAlign: "right" as const },
  type:   { width: "11%" },
  credit: { width: "10%" },
};

function Header() {
  const logoUrl = `${window.location.origin}/apple-touch-icon.png`;
  return (
    <View>
      <View style={s.hdrRow}>
        <View style={s.logoZone}>
          <Image src={logoUrl} style={{ height: 20, width: 60, marginRight: 7, objectFit: "contain" }} />
          <Text style={s.logoLabel}>KPR DEAL LIBRARY</Text>
        </View>
        <Text style={s.hdrRight}>RENT ROLL · {today()}</Text>
      </View>
      <View style={s.hdrRule} />
    </View>
  );
}

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerTxt}>Generated {today()} · KPR Deal Library</Text>
      <Text style={s.footerTxt} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

export default function RentRollPDF({ deal: d }: { deal: Deal }) {
  const tenants = (d.tenants || []);
  const addr = [d.address, [d.city, d.state].filter(Boolean).join(", ")].filter(Boolean).join(" · ");
  const totSF = tenants.reduce((a, t) => a + toN(t.sf), 0);
  const totRent = tenants.reduce((a, t) => a + toN(t.annualRent), 0);
  const occupied = tenants.filter(t => !isVacant(t.name)).length;

  return (
    <Document title={`${d.propertyName || "Rent Roll"} — Rent Roll`} author="KPR Centers">
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <Header />
        <Text style={s.propName}>{d.propertyName || d.fileName || "Untitled"}</Text>
        {addr ? <Text style={s.addr}>{addr}</Text> : null}
        <View style={s.metaRow}>
          {d.tenantsAsOf ? <View style={s.metaPill}><Text style={s.metaTxt}>AS OF {fmtLeaseDate(d.tenantsAsOf)}</Text></View> : null}
          <View style={s.metaPill}><Text style={s.metaTxt}>{tenants.length} SUITES · {occupied} OCCUPIED</Text></View>
          {totSF ? <View style={s.metaPill}><Text style={s.metaTxt}>{num0(totSF)} SF</Text></View> : null}
          {totRent ? <View style={s.metaPill}><Text style={s.metaTxt}>{money0(totRent)} ANNUAL RENT</Text></View> : null}
        </View>

        {/* Header row (repeats on each page) */}
        <View style={s.th} fixed>
          <Text style={[s.thTxt, COLS.tenant]}>Tenant</Text>
          <Text style={[s.thTxt, COLS.sf]}>SF</Text>
          <Text style={[s.thTxt, COLS.rentSf]}>Rent/SF</Text>
          <Text style={[s.thTxt, COLS.rent]}>Annual Rent</Text>
          <Text style={[s.thTxt, COLS.start]}>Lease Start</Text>
          <Text style={[s.thTxt, COLS.expiry]}>Lease Expiry</Text>
          <Text style={[s.thTxt, COLS.term]}>Term</Text>
          <Text style={[s.thTxt, COLS.type]}>Lease Type</Text>
          <Text style={[s.thTxt, COLS.credit]}>Credit</Text>
        </View>

        {tenants.map((t, i) => {
          const vacant = isVacant(t.name);
          const nap = isNAPTenant(t);
          const tags = [t.isAnchor ? "Anchor" : null, t.isDark ? "Dark" : null, nap ? "NAP" : null].filter(Boolean).join(" · ");
          return (
            <View key={i} style={[s.tr, i % 2 === 1 ? { backgroundColor: C.zebra } : {}]} wrap={false}>
              <View style={COLS.tenant}>
                <Text style={[s.td, { fontFamily: "Helvetica-Bold", color: vacant ? C.muted : C.body }]}>{vacant ? "Vacant" : t.name}</Text>
                {tags ? <Text style={{ fontSize: 6, color: t.isDark ? C.dark : C.olive }}>{tags}</Text> : null}
              </View>
              <Text style={[s.td, COLS.sf]}>{num0(toN(t.sf))}</Text>
              <Text style={[s.td, COLS.rentSf]}>{money2(toN(t.rentPerSF))}</Text>
              <Text style={[s.td, COLS.rent]}>{money0(toN(t.annualRent))}</Text>
              <Text style={[s.td, COLS.start]}>{t.leaseStart ? fmtLeaseDate(t.leaseStart) : "—"}</Text>
              <Text style={[s.td, COLS.expiry]}>{t.leaseExpiry ? fmtLeaseDate(t.leaseExpiry) : "—"}</Text>
              <Text style={[s.td, COLS.term]}>{t.remainingTermYears != null && t.remainingTermYears !== "" ? `${Number(t.remainingTermYears).toFixed(1)}y` : "—"}</Text>
              <Text style={[s.td, COLS.type]}>{t.leaseType || "—"}</Text>
              <Text style={[s.td, COLS.credit]}>{t.creditRating || "—"}</Text>
            </View>
          );
        })}

        {/* Totals */}
        <View style={s.totalRow} wrap={false}>
          <Text style={[s.totalTxt, COLS.tenant]}>TOTAL</Text>
          <Text style={[s.totalTxt, COLS.sf]}>{num0(totSF)}</Text>
          <Text style={[s.totalTxt, COLS.rentSf]}>{totSF ? money2(totRent / totSF) : "—"}</Text>
          <Text style={[s.totalTxt, COLS.rent]}>{money0(totRent)}</Text>
          <Text style={[s.totalTxt, COLS.start]}> </Text>
          <Text style={[s.totalTxt, COLS.expiry]}> </Text>
          <Text style={[s.totalTxt, COLS.term]}> </Text>
          <Text style={[s.totalTxt, COLS.type]}> </Text>
          <Text style={[s.totalTxt, COLS.credit]}> </Text>
        </View>

        <Footer />
      </Page>
    </Document>
  );
}
