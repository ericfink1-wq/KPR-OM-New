import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { Deal, Tenant } from "../lib/idb";
import { isVacant, isNAPTenant, fmtLeaseDate, formatFullAddress } from "../lib/utils";

// Branded, institutional-quality rent roll PDF. Leads with a summary KPI band,
// then a grouped roster (anchors → in-line → vacant) with subtotals, % of GLA /
// % of rent, and integrated tenant SALES + OCCUPANCY COST. Same KPR header/footer
// language as DealSummaryPDF. Paginates automatically.

const C = {
  ink: "#26281f", body: "#383a37", muted: "#7d766a", faint: "#a89f8f",
  olive: "#3f7a1f", oliveDk: "#2f5d16", sage: "#eef3e6", sageBd: "#cfe3b8",
  rule: "#e3dccd", zebra: "#faf8f2", dark: "#9a5b12", cream: "#fcfbf6",
};

const toN = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n; };
const today = (): string => new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const money0 = (v: number): string => v ? `$${Math.round(v).toLocaleString()}` : "—";
const moneyBig = (v: number): string => {
  if (!v) return "—";
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`;
  if (v >= 1_000) return `$${Math.round(v / 1_000)}k`;
  return `$${Math.round(v)}`;
};
const money2 = (v: number): string => v ? `$${v.toFixed(2)}` : "—";
const num0 = (v: number): string => v ? Math.round(v).toLocaleString() : "—";
const pct = (v: number): string => v ? `${v.toFixed(1)}%` : "—";

const norm = (x: unknown): string => String(x ?? "").toLowerCase().replace(/\s+/g, " ").trim();

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 8, color: C.body, paddingTop: 26, paddingHorizontal: 26, paddingBottom: 44 },

  hdrRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 },
  hdrRule: { height: 1.5, backgroundColor: C.olive, marginBottom: 9 },
  logoZone: { flexDirection: "row", alignItems: "center" },
  logoLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.olive, letterSpacing: 0.8 },
  hdrRight: { fontSize: 7.5, color: C.muted, letterSpacing: 0.5 },

  propName: { fontSize: 16, fontFamily: "Helvetica-Bold", color: C.ink },
  addr: { fontSize: 9, color: C.muted, marginTop: 1 },

  // Summary KPI band
  kpiBand: { flexDirection: "row", flexWrap: "wrap", marginTop: 9, marginBottom: 11, borderWidth: 1, borderColor: C.sageBd, borderStyle: "solid", borderRadius: 4, backgroundColor: C.cream },
  kpi: { width: "20%", paddingVertical: 6, paddingHorizontal: 9, borderRightWidth: 0.5, borderRightColor: C.rule, borderRightStyle: "solid" },
  kpiLabel: { fontSize: 6, fontFamily: "Helvetica-Bold", color: C.muted, letterSpacing: 0.7, marginBottom: 2 },
  kpiVal: { fontSize: 11, fontFamily: "Helvetica-Bold", color: C.oliveDk },
  kpiSub: { fontSize: 6.5, color: C.faint, marginTop: 1 },

  // Table
  th: { flexDirection: "row", backgroundColor: C.olive, paddingVertical: 4.5, paddingHorizontal: 4 },
  thTxt: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: "#fff", letterSpacing: 0.2 },
  tr: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 4, borderBottomWidth: 0.5, borderBottomColor: "#efe9dc", borderBottomStyle: "solid", alignItems: "center" },
  td: { fontSize: 7.5, color: C.body },
  tdFaint: { fontSize: 7.5, color: C.faint },

  sectionRow: { flexDirection: "row", backgroundColor: C.sage, paddingVertical: 3, paddingHorizontal: 4, marginTop: 2 },
  sectionTxt: { fontSize: 6.5, fontFamily: "Helvetica-Bold", color: C.oliveDk, letterSpacing: 0.6 },

  subRow: { flexDirection: "row", paddingVertical: 3.5, paddingHorizontal: 4, borderTopWidth: 0.5, borderTopColor: C.sageBd, borderTopStyle: "solid", backgroundColor: "#f6f8f1" },
  subTxt: { fontSize: 7.5, fontFamily: "Helvetica-Bold", color: C.oliveDk },

  totalRow: { flexDirection: "row", paddingVertical: 5, paddingHorizontal: 4, borderTopWidth: 1.5, borderTopColor: C.olive, borderTopStyle: "solid", marginTop: 1, backgroundColor: C.sage },
  totalTxt: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.ink },

  note: { fontSize: 6.5, color: C.faint, marginTop: 7 },

  footer: { position: "absolute", bottom: 16, left: 26, right: 26, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: C.rule, borderTopStyle: "solid", paddingTop: 5 },
  footerTxt: { fontSize: 7.5, color: C.muted },
});

// Column layout (sums to 100). Lease type/tags ride under the tenant name so the
// grid stays uncrowded while still adding the sales + occ-cost columns.
const COL = {
  suite:  { width: "6%" },
  tenant: { width: "21%" },
  sf:     { width: "8%",  textAlign: "right" as const },
  gla:    { width: "6%",  textAlign: "right" as const },
  rentSf: { width: "8%",  textAlign: "right" as const },
  rent:   { width: "11%", textAlign: "right" as const },
  pctRent:{ width: "6%",  textAlign: "right" as const, paddingRight: 7 },
  start:  { width: "9%" },
  expiry: { width: "9%" },
  sales:  { width: "9%",  textAlign: "right" as const },
  occ:    { width: "7%",  textAlign: "right" as const },
};

function Header() {
  const logoUrl = `${window.location.origin}/apple-touch-icon.png`;
  return (
    <View fixed>
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
      <Text style={s.footerTxt}>Generated {today()} · KPR Deal Library · in-place figures</Text>
      <Text style={s.footerTxt} render={({ pageNumber, totalPages }) => `Page ${pageNumber} of ${totalPages}`} />
    </View>
  );
}

function Kpi({ label, value, sub, last }: { label: string; value: string; sub?: string; last?: boolean }) {
  return (
    <View style={[s.kpi, last ? { borderRightWidth: 0 } : {}]}>
      <Text style={s.kpiLabel}>{label}</Text>
      <Text style={s.kpiVal}>{value}</Text>
      {sub ? <Text style={s.kpiSub}>{sub}</Text> : null}
    </View>
  );
}

export default function RentRollPDF({ deal: d }: { deal: Deal }) {
  const tenants = (d.tenants || []);
  const addr = formatFullAddress(d);

  // ── Sales lookup: prefer the tenant's own fields, else the latest reported year
  // from tenantSalesHistory (matched by name). ───────────────────────────────
  const salesByName = new Map<string, { salesPSF?: number | null; occ?: number | null; year?: number }>();
  for (const yr of [...(d.tenantSalesHistory || [])].sort((a, b) => a.year - b.year)) {
    for (const ts of yr.tenants || []) {
      if (ts.removed) continue;
      salesByName.set(norm(ts.name), { salesPSF: ts.salesPSF, occ: ts.occupancyCost, year: yr.year });
    }
  }
  const salesOf = (t: Tenant): { sf: number; year?: number; occ?: number | null } => {
    const own = t.salesPSF != null && t.salesPSF !== "" ? toN(t.salesPSF) : 0;
    if (own) return { sf: own, year: t.salesYear ?? undefined, occ: t.occupancyCost != null ? toN(t.occupancyCost) : null };
    const m = salesByName.get(norm(t.name));
    if (m && m.salesPSF) return { sf: toN(m.salesPSF), year: m.year, occ: m.occ ?? null };
    return { sf: 0 };
  };

  // ── Partition + sort: anchors (SF desc) → other occupied (SF desc) → vacant. ──
  const occTenants = tenants.filter(t => !isVacant(t.name));
  const vacTenants = tenants.filter(t => isVacant(t.name));
  const anchors = occTenants.filter(t => t.isAnchor).sort((a, b) => toN(b.sf) - toN(a.sf));
  const inline = occTenants.filter(t => !t.isAnchor).sort((a, b) => toN(b.sf) - toN(a.sf));
  vacTenants.sort((a, b) => toN(b.sf) - toN(a.sf));

  // ── Totals ───────────────────────────────────────────────────────────────
  const occSF = occTenants.reduce((a, t) => a + toN(t.sf), 0);
  const vacSF = vacTenants.reduce((a, t) => a + toN(t.sf), 0);
  const rosterSF = occSF + vacSF;
  const gla = d.totalSF ? toN(d.totalSF) : rosterSF;
  const occRent = occTenants.reduce((a, t) => a + toN(t.annualRent), 0);
  const occPct = d.occupancy != null ? toN(d.occupancy) : (gla ? (occSF / gla) * 100 : 0);
  const vacPct = gla ? (Math.max(gla - occSF, vacSF) / gla) * 100 : 0;
  const avgRentSf = occSF ? occRent / occSF : 0;
  const walt = d.walt != null ? toN(d.walt) : 0;
  const anchorName = anchors[0]?.name || "—";

  // Reported tenant sales rollup (for the note line)
  const reporting = occTenants.filter(t => salesOf(t).sf > 0);

  const Row = ({ t, i }: { t: Tenant; i: number }) => {
    const vacant = isVacant(t.name);
    const nap = isNAPTenant(t);
    const sf = toN(t.sf);
    const rent = toN(t.annualRent);
    const sub = [t.leaseType ? String(t.leaseType).replace(/\s*\(.*$/, "").trim() : null,
      t.isAnchor ? "Anchor" : null, t.isDark ? "Dark" : null, nap ? "NAP" : null].filter(Boolean).join(" · ");
    const sl = salesOf(t);
    return (
      <View style={[s.tr, i % 2 === 1 ? { backgroundColor: C.zebra } : {}]} wrap={false}>
        <Text style={[s.tdFaint, COL.suite]}>{t.suite || "—"}</Text>
        <View style={COL.tenant}>
          <Text style={[s.td, { fontFamily: "Helvetica-Bold", color: vacant ? C.faint : C.ink }]}>{vacant ? "Vacant" : (t.name || "—")}</Text>
          {sub ? <Text style={{ fontSize: 6, color: t.isDark ? C.dark : C.muted, marginTop: 0.5 }}>{sub}</Text> : null}
        </View>
        <Text style={[s.td, COL.sf]}>{num0(sf)}</Text>
        <Text style={[s.tdFaint, COL.gla]}>{gla && sf ? pct((sf / gla) * 100) : "—"}</Text>
        <Text style={[s.td, COL.rentSf]}>{money2(toN(t.rentPerSF))}</Text>
        <Text style={[s.td, COL.rent]}>{money0(rent)}</Text>
        <Text style={[s.tdFaint, COL.pctRent]}>{occRent && rent ? pct((rent / occRent) * 100) : "—"}</Text>
        <Text style={[s.td, COL.start]}>{t.leaseStart ? fmtLeaseDate(t.leaseStart) : "—"}</Text>
        <Text style={[s.td, COL.expiry]}>{t.leaseExpiry ? fmtLeaseDate(t.leaseExpiry) : "—"}</Text>
        <Text style={[sl.sf ? s.td : s.tdFaint, COL.sales]}>{sl.sf ? `${money0(sl.sf)}${sl.year ? ` '${String(sl.year).slice(2)}` : ""}` : "—"}</Text>
        <Text style={[sl.occ ? s.td : s.tdFaint, COL.occ]}>{sl.occ ? pct(sl.occ) : "—"}</Text>
      </View>
    );
  };

  const SubTotal = ({ label, list }: { label: string; list: Tenant[] }) => {
    const sf = list.reduce((a, t) => a + toN(t.sf), 0);
    const rent = list.reduce((a, t) => a + toN(t.annualRent), 0);
    return (
      <View style={s.subRow} wrap={false}>
        <Text style={[s.subTxt, COL.suite]}> </Text>
        <Text style={[s.subTxt, COL.tenant]}>{label} ({list.length})</Text>
        <Text style={[s.subTxt, COL.sf]}>{num0(sf)}</Text>
        <Text style={[s.subTxt, COL.gla]}>{gla ? pct((sf / gla) * 100) : "—"}</Text>
        <Text style={[s.subTxt, COL.rentSf]}>{sf ? money2(rent / sf) : "—"}</Text>
        <Text style={[s.subTxt, COL.rent]}>{money0(rent)}</Text>
        <Text style={[s.subTxt, COL.pctRent]}> </Text>
        <Text style={[s.subTxt, COL.start]}> </Text>
        <Text style={[s.subTxt, COL.expiry]}> </Text>
        <Text style={[s.subTxt, COL.sales]}> </Text>
        <Text style={[s.subTxt, COL.occ]}> </Text>
      </View>
    );
  };

  let idx = 0;

  return (
    <Document title={`${d.propertyName || "Rent Roll"} — Rent Roll`} author="KPR Centers">
      <Page size="LETTER" orientation="landscape" style={s.page}>
        <Header />
        <Text style={s.propName}>{d.propertyName || d.fileName || "Untitled"}</Text>
        {addr ? <Text style={s.addr}>{addr}{d.tenantsAsOf ? `   ·   Rent roll as of ${fmtLeaseDate(d.tenantsAsOf)}` : ""}</Text> : null}

        {/* Summary KPI band */}
        <View style={s.kpiBand}>
          <Kpi label="OCCUPANCY" value={pct(occPct)} sub={`${num0(occTenants.length)} of ${num0(tenants.length)} suites`} />
          <Kpi label="GLA" value={`${num0(gla)} SF`} sub={`${num0(occSF)} SF occupied`} />
          <Kpi label="VACANT" value={`${num0(Math.max(gla - occSF, vacSF))} SF`} sub={pct(vacPct)} />
          <Kpi label="IN-PLACE RENT" value={moneyBig(occRent)} sub={`${money2(avgRentSf)}/SF`} />
          <Kpi label={walt ? "WALT" : "ANCHOR"} value={walt ? `${walt.toFixed(1)} yrs` : anchorName} sub={walt ? anchorName : undefined} last />
        </View>
        {(d.noi || d.weightedAvgRentPSF) ? (
          <View style={[s.kpiBand, { marginTop: -5 }]}>
            <Kpi label="NOI (IN-PLACE)" value={d.noi ? moneyBig(toN(d.noi)) : "—"} sub={d.capRate ? `${toN(d.capRate).toFixed(2)}% cap` : undefined} />
            <Kpi label="AVG RENT / SF" value={d.weightedAvgRentPSF ? money2(toN(d.weightedAvgRentPSF)) : money2(avgRentSf)} sub="occupied GLA" />
            <Kpi label="ANCHOR" value={anchorName} sub={anchors[0] ? `${num0(toN(anchors[0].sf))} SF` : undefined} />
            <Kpi label="REPORTING SALES" value={reporting.length ? `${reporting.length} tenants` : "—"} sub={reporting.length ? "see Sales/SF" : undefined} />
            <Kpi label="GROSS POTENTIAL" value={d.grossPotentialRent ? moneyBig(toN(d.grossPotentialRent)) : moneyBig(occRent)} sub="base rent" last />
          </View>
        ) : null}

        {/* Column header (repeats each page) */}
        <View style={s.th} fixed>
          <Text style={[s.thTxt, COL.suite]}>Suite</Text>
          <Text style={[s.thTxt, COL.tenant]}>Tenant</Text>
          <Text style={[s.thTxt, COL.sf]}>SF</Text>
          <Text style={[s.thTxt, COL.gla]}>% GLA</Text>
          <Text style={[s.thTxt, COL.rentSf]}>Rent/SF</Text>
          <Text style={[s.thTxt, COL.rent]}>Annual Rent</Text>
          <Text style={[s.thTxt, COL.pctRent]}>% Rent</Text>
          <Text style={[s.thTxt, COL.start]}>Commence</Text>
          <Text style={[s.thTxt, COL.expiry]}>Expiry</Text>
          <Text style={[s.thTxt, COL.sales]}>Sales/SF</Text>
          <Text style={[s.thTxt, COL.occ]}>Occ Cost</Text>
        </View>

        {anchors.length ? <View style={s.sectionRow}><Text style={s.sectionTxt}>ANCHOR TENANTS</Text></View> : null}
        {anchors.map(t => <Row key={`a${idx}`} t={t} i={idx++} />)}

        {inline.length ? <View style={s.sectionRow}><Text style={s.sectionTxt}>IN-LINE TENANTS</Text></View> : null}
        {inline.map(t => <Row key={`i${idx}`} t={t} i={idx++} />)}

        <SubTotal label="OCCUPIED" list={occTenants} />

        {vacTenants.length ? <View style={s.sectionRow}><Text style={s.sectionTxt}>VACANT</Text></View> : null}
        {vacTenants.map(t => <Row key={`v${idx}`} t={t} i={idx++} />)}

        {/* Grand total */}
        <View style={s.totalRow} wrap={false}>
          <Text style={[s.totalTxt, COL.suite]}> </Text>
          <Text style={[s.totalTxt, COL.tenant]}>TOTAL · {num0(tenants.length)} suites</Text>
          <Text style={[s.totalTxt, COL.sf]}>{num0(rosterSF)}</Text>
          <Text style={[s.totalTxt, COL.gla]}>{gla ? pct((rosterSF / gla) * 100) : "—"}</Text>
          <Text style={[s.totalTxt, COL.rentSf]}>{occSF ? money2(occRent / occSF) : "—"}</Text>
          <Text style={[s.totalTxt, COL.rent]}>{money0(occRent)}</Text>
          <Text style={[s.totalTxt, COL.pctRent]}> </Text>
          <Text style={[s.totalTxt, COL.start]}> </Text>
          <Text style={[s.totalTxt, COL.expiry]}> </Text>
          <Text style={[s.totalTxt, COL.sales]}> </Text>
          <Text style={[s.totalTxt, COL.occ]}> </Text>
        </View>

        <Text style={s.note}>
          Rent/SF and Annual Rent are in-place BASE rent (excludes recoveries, percentage & other rent). % GLA is of {num0(gla)} SF total.
          {reporting.length ? ` Sales/SF and Occ Cost shown for ${num0(reporting.length)} reporting tenant${reporting.length === 1 ? "" : "s"} (latest reported FY).` : ""}
          {" "}Subtotals exclude NAP square footage where applicable.
        </Text>

        <Footer />
      </Page>
    </Document>
  );
}
