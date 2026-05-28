import { Document, Page, View, Text, Image, StyleSheet } from "@react-pdf/renderer";
import type { Deal, ImageBundle } from "../lib/idb";
import { isInvestmentGrade } from "../lib/tenantCredit";
import { isVacant } from "../lib/utils";

const C = {
  ink: "#2a2c28", body: "#383a37", muted: "#6f6a5f",
  olive: "#3f7a1f", sage: "#eef3e6", border: "#b8d49a",
  rule: "#d8d2c1", nearTerm: "#8cbf63", track: "#f5f2ec",
};

const toN = (v: unknown): number => { const n = Number(v); return isNaN(n) ? 0 : n; };

const fmtMoney = (v: number | null | undefined): string | null => {
  if (!v) return null;
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`;
  return `$${Math.round(v).toLocaleString()}`;
};
const fmtNOI = (v: number | null | undefined): string | null => {
  if (!v) return null;
  return v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : `$${Math.round(v).toLocaleString()}`;
};
const fmtPct = (v: number | null | undefined): string | null =>
  v != null ? `${Number(v).toFixed(2)}%` : null;

const today = (): string =>
  new Date().toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function calcRollover(tenants: NonNullable<Deal["tenants"]>, tenantsAsOf?: string | null) {
  const ref = tenantsAsOf ? new Date(tenantsAsOf) : new Date();
  const refYear = ref.getFullYear();
  const occupied = tenants.filter(t => !isVacant(t.name));
  const withExp = occupied.filter(t => t.leaseExpiry).map(t => {
    const exp = new Date(t.leaseExpiry!);
    const rem = Math.max(0, (exp.getTime() - ref.getTime()) / (365.25 * 86400000));
    return { ...t, rem, expYear: exp.getFullYear() };
  });
  const wSFN = withExp.reduce((a, t) => a + toN(t.sf) * t.rem, 0);
  const wSFD = withExp.reduce((a, t) => a + toN(t.sf), 0);
  const wSF = wSFD > 0 ? wSFN / wSFD : null;
  const wR = withExp.filter(t => toN(t.annualRent) > 0);
  const wRN = wR.reduce((a, t) => a + toN(t.annualRent) * t.rem, 0);
  const wRD = wR.reduce((a, t) => a + toN(t.annualRent), 0);
  const wRent = wRD > 0 ? wRN / wRD : null;
  const buckets: { label: string; rent: number; sf: number; count: number }[] = [];
  for (let i = 0; i <= 9; i++) buckets.push({ label: String(refYear + i), rent: 0, sf: 0, count: 0 });
  buckets.push({ label: "10+", rent: 0, sf: 0, count: 0 });
  for (const t of withExp) {
    const off = t.expYear - refYear;
    buckets[off >= 10 ? 10 : Math.max(0, off)].rent += toN(t.annualRent);
  }
  const totalRent = occupied.reduce((a, t) => a + toN(t.annualRent), 0);
  const pct24mo = totalRent > 0 ? Math.round(buckets.slice(0, 3).reduce((a, b) => a + b.rent, 0) / totalRent * 100) : 0;
  return { waltSF: wSF, waltRent: wRent, buckets, totalRent, pct24mo, hasExpiry: withExp.length > 0 };
}

const s = StyleSheet.create({
  page: { fontFamily: "Helvetica", fontSize: 10, color: C.body, paddingTop: 28, paddingHorizontal: 36, paddingBottom: 52 },
  hdrRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 5 },
  hdrRule: { height: 1, backgroundColor: C.olive, marginBottom: 12 },
  logoZone: { flexDirection: "row", alignItems: "center" },
  logoLabel: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.olive, letterSpacing: 0.8 },
  hdrRight: { fontSize: 7.5, color: C.muted },
  titleRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "flex-start", marginBottom: 8 },
  propName: { fontSize: 20, fontFamily: "Helvetica-Bold", color: C.ink, maxWidth: 360 },
  addr: { fontSize: 9.5, color: C.muted, marginTop: 3 },
  pill: { backgroundColor: C.sage, borderWidth: 0.5, borderColor: C.border, borderStyle: "solid", borderRadius: 4, paddingHorizontal: 8, paddingVertical: 4, marginTop: 2 },
  pillTxt: { fontSize: 8, fontFamily: "Helvetica-Bold", color: C.olive },
  cover: { height: 178, borderRadius: 6, marginBottom: 12, width: "100%" },
  coverPh: { height: 178, borderRadius: 6, marginBottom: 12, backgroundColor: C.olive, alignItems: "center", justifyContent: "center" },
  coverPhTxt: { color: "#fff", fontSize: 15, fontFamily: "Helvetica-Bold" },
  mRow: { flexDirection: "row", marginBottom: 14 },
  mBox: { flex: 1, backgroundColor: C.sage, borderWidth: 0.5, borderColor: C.border, borderStyle: "solid", borderRadius: 3, paddingVertical: 7, paddingHorizontal: 5, alignItems: "center", marginRight: 5 },
  mBoxL: { flex: 1, backgroundColor: C.sage, borderWidth: 0.5, borderColor: C.border, borderStyle: "solid", borderRadius: 3, paddingVertical: 7, paddingHorizontal: 5, alignItems: "center" },
  mVal: { fontSize: 12, fontFamily: "Helvetica-Bold", color: C.ink, marginBottom: 3 },
  mLbl: { fontSize: 6.5, color: C.muted, textTransform: "uppercase" },
  sec: { marginBottom: 13 },
  secH: { fontSize: 8.5, fontFamily: "Helvetica-Bold", color: C.olive, letterSpacing: 0.7, paddingBottom: 3, marginBottom: 5, borderBottomWidth: 0.5, borderBottomColor: C.olive, borderBottomStyle: "solid", textTransform: "uppercase" },
  tRow: { flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: "#f0e9db", borderBottomStyle: "solid" },
  tLbl: { width: "44%", fontSize: 9, color: C.muted },
  tVal: { width: "56%", fontSize: 9, fontFamily: "Helvetica-Bold", color: C.ink },
  barRow: { flexDirection: "row", alignItems: "center", marginBottom: 2.5 },
  barLbl: { width: 28, fontSize: 7.5, color: C.muted },
  barPct: { width: 24, fontSize: 7.5, color: C.muted, textAlign: "right" },
  footer: { position: "absolute", bottom: 18, left: 36, right: 36, flexDirection: "row", justifyContent: "space-between", borderTopWidth: 0.5, borderTopColor: C.rule, borderTopStyle: "solid", paddingTop: 5 },
  footerTxt: { fontSize: 7.5, color: C.muted },
});

function HDR({ logoUrl }: { logoUrl: string }) {
  return (
    <View>
      <View style={s.hdrRow}>
        <View style={s.logoZone}>
          <Image src={logoUrl} style={{ height: 20, width: 60, marginRight: 7 }} />
          <Text style={s.logoLabel}>KPR DEAL LIBRARY</Text>
        </View>
        <Text style={s.hdrRight}>PROPERTY SUMMARY · {today()}</Text>
      </View>
      <View style={s.hdrRule} />
    </View>
  );
}

function SH({ t }: { t: string }) {
  return <Text style={s.secH}>{t}</Text>;
}

function TR({ lbl, val }: { lbl: string; val?: string | null }) {
  if (!val) return null;
  return (
    <View style={s.tRow}>
      <Text style={s.tLbl}>{lbl}</Text>
      <Text style={s.tVal}>{val}</Text>
    </View>
  );
}

function Footer() {
  return (
    <View style={s.footer} fixed>
      <Text style={s.footerTxt}>Generated {today()} · KPR Deal Library</Text>
      <Text style={s.footerTxt}>Internal use only</Text>
    </View>
  );
}

export interface DealSummaryPDFProps {
  deal: Deal;
  imgs: ImageBundle | null;
  logoUrl: string;
}

export default function DealSummaryPDF({ deal: d, imgs, logoUrl }: DealSummaryPDFProps) {
  const tenants = d.tenants || [];
  const occupied = tenants.filter(t => !isVacant(t.name));
  const isOwned = d.status === "Owned";

  // IG exposure
  const igTens = occupied.filter(t => t.name && isInvestmentGrade(t.name, t.creditRating));
  const totalRentAll = occupied.reduce((s, t) => s + toN(t.annualRent), 0);
  const igRentAll = igTens.reduce((s, t) => s + toN(t.annualRent), 0);
  const igPct = totalRentAll > 0 ? Math.round(igRentAll / totalRentAll * 100) : null;

  // Rollover
  const ro = tenants.length > 0 ? calcRollover(tenants, d.tenantsAsOf) : null;
  const maxBR = ro ? Math.max(...ro.buckets.map(b => b.rent), 1) : 1;

  // Top tenants
  const topT = [...occupied]
    .filter(t => toN(t.annualRent) > 0)
    .sort((a, b) => toN(b.annualRent) - toN(a.annualRent))
    .slice(0, 10);

  // Anchors
  const anchors = [...occupied]
    .filter(t => t.isAnchor)
    .sort((a, b) => toN(b.sf) - toN(a.sf))
    .slice(0, 5);

  // Key assumptions
  const rawKA = d.keyAssumptions;
  const assumptions: string[] = rawKA
    ? (Array.isArray(rawKA) ? rawKA : String(rawKA).split(/\n+/).filter(Boolean))
    : [];

  // Images
  const coverSrc = imgs?.cover ?? null;
  const siteSrc = imgs?.sitePlan?.[0] ?? null;

  // Demographics
  const demo = d.marketDemographics;
  const hasDemographics = !!(demo?.pop1mi || demo?.pop3mi || d.population3mi);

  const cols3 = [
    { label: "1-Mile", pop: demo?.pop1mi, hhi: demo?.avgHHI1mi },
    { label: "3-Mile", pop: demo?.pop3mi ?? d.population3mi, hhi: demo?.avgHHI3mi ?? d.avgHHIncome3mi },
    { label: "5-Mile", pop: demo?.pop5mi, hhi: demo?.avgHHI5mi },
  ];

  return (
    <Document title={d.propertyName || "KPR Deal Summary"} author="KPR Centers">

      {/* ── PAGE 1 ─────────────────────────────────── */}
      <Page size="LETTER" style={s.page}>
        <HDR logoUrl={logoUrl} />

        {/* Title */}
        <View style={s.titleRow}>
          <View style={{ flex: 1, paddingRight: 12 }}>
            <Text style={s.propName}>{d.propertyName || d.fileName || "Untitled"}</Text>
            {(d.address || d.city) && (
              <Text style={s.addr}>{[d.address, d.city, d.state].filter(Boolean).join(", ")}</Text>
            )}
          </View>
          {d.status && (
            <View style={s.pill}><Text style={s.pillTxt}>{d.status.toUpperCase()}</Text></View>
          )}
        </View>

        {/* Cover */}
        {coverSrc
          ? <Image src={coverSrc} style={s.cover} />
          : (
            <View style={s.coverPh}>
              <Text style={s.coverPhTxt}>{d.propertyName || "No Cover Image"}</Text>
            </View>
          )}

        {/* Hero metrics */}
        <View style={s.mRow}>
          {([
            ["GLA", d.totalSF ? `${Number(d.totalSF).toLocaleString()} SF` : "—"],
            ["Occupancy", d.occupancy ? `${Number(d.occupancy).toFixed(1)}%` : "—"],
            ["Cap Rate", fmtPct(d.capRate) ?? "—"],
            ["NOI", fmtNOI(d.noi) ?? "—"],
            ["Investment Grade Exposure", igPct != null ? `${igPct}% rent` : "—"],
          ] as [string, string][]).map(([lbl, val], i, arr) => (
            <View key={lbl} style={i === arr.length - 1 ? s.mBoxL : s.mBox}>
              <Text style={s.mVal}>{val}</Text>
              <Text style={s.mLbl}>{lbl}</Text>
            </View>
          ))}
        </View>

        {/* Financial Summary */}
        <View style={s.sec}>
          <SH t="FINANCIAL SUMMARY" />
          {isOwned ? (
            <>
              <TR lbl="Purchase Price" val={fmtMoney(d.txnPurchasePrice)} />
              <TR lbl="Closing Date" val={d.txnCloseDate} />
              <TR lbl="Going-in Cap at Close" val={fmtPct(d.acqCapRate)} />
              <TR lbl="NOI at Close" val={fmtNOI(d.acqNOIAtClose)} />
              <TR lbl="Current NOI" val={fmtNOI(d.noi)} />
              <TR lbl="Lender" val={d.debtLender} />
              <TR lbl="Loan Amount" val={fmtMoney(d.debtLoanAmount)} />
              <TR lbl="Loan Rate" val={d.debtRate ? `${Number(d.debtRate).toFixed(2)}%` : null} />
              <TR lbl="Maturity Date" val={d.debtMaturityDate} />
            </>
          ) : (
            <>
              <TR lbl="Asking Price" val={fmtMoney(d.askingPrice)} />
              <TR lbl="Price / SF" val={d.pricePerSF ? `$${Number(d.pricePerSF).toFixed(2)}` : null} />
              <TR lbl="Going-in Cap Rate" val={fmtPct(d.capRate)} />
              <TR lbl="NOI (In-Place)" val={fmtNOI(d.noi)} />
              <TR lbl="Year Built" val={d.yearBuilt ? String(d.yearBuilt) : null} />
              <TR lbl="Year Renovated" val={d.renovationYear ? String(d.renovationYear) : null} />
            </>
          )}
        </View>

        {/* Anchor Tenants */}
        {anchors.length > 0 && (
          <View style={s.sec}>
            <SH t="ANCHOR TENANTS" />
            {anchors.map((t, i) => (
              <Text key={i} style={{ fontSize: 9.5, color: C.body, marginBottom: 3.5 }}>
                {t.name}
                {toN(t.sf) > 0 ? ` — ${toN(t.sf).toLocaleString()} SF` : ""}
                {t.leaseExpiry ? ` · lease through ${new Date(t.leaseExpiry).getFullYear()}` : ""}
              </Text>
            ))}
          </View>
        )}

        <Footer />
      </Page>

      {/* ── PAGE 2 ─────────────────────────────────── */}
      <Page size="LETTER" style={s.page}>
        <HDR logoUrl={logoUrl} />

        {/* Lease Rollover */}
        {ro && ro.hasExpiry && (
          <View style={s.sec}>
            <SH t="LEASE ROLLOVER" />
            <Text style={{ fontSize: 9, color: C.muted, marginBottom: 8 }}>
              {`WALT (by SF): ${ro.waltSF != null ? `${ro.waltSF.toFixed(1)} yrs` : "—"}    ·    WALT (by rent): ${ro.waltRent != null ? `${ro.waltRent.toFixed(1)} yrs` : "—"}`}
            </Text>
            {ro.buckets.map((b, i) => {
              const pct = ro.totalRent > 0 ? (b.rent / ro.totalRent) * 100 : 0;
              const barW = Math.round((b.rent / maxBR) * 360);
              return (
                <View key={b.label} style={s.barRow}>
                  <Text style={s.barLbl}>{b.label}</Text>
                  {barW > 0
                    ? <View style={{ width: barW, height: 9, borderRadius: 2, backgroundColor: i <= 1 ? C.nearTerm : C.olive }} />
                    : <View style={{ width: 2, height: 9, borderRadius: 2, backgroundColor: C.track }} />
                  }
                  <Text style={[s.barPct, { marginLeft: 4 }]}>{pct >= 0.5 ? `${Math.round(pct)}%` : ""}</Text>
                </View>
              );
            })}
            <Text style={{ fontSize: 9, color: C.muted, marginTop: 5 }}>
              {`${ro.pct24mo}% of base rent rolls in the next 24 months.`}
            </Text>
          </View>
        )}

        {/* Top Tenants */}
        {topT.length > 0 && (
          <View style={s.sec}>
            <SH t="TOP TENANTS BY RENT" />
            <View style={{ flexDirection: "row", paddingBottom: 3, borderBottomWidth: 0.5, borderBottomColor: C.rule, borderBottomStyle: "solid", marginBottom: 1 }}>
              {(["TENANT", "SF", "ANNUAL RENT", "RENT/SF", "LEASE EXPIRY"] as const).map((h, i, arr) => (
                <Text key={h} style={{ flex: [3, 1.5, 2, 1.5, 2][i], fontSize: 7.5, color: C.muted, fontFamily: "Helvetica-Bold", textAlign: i > 0 ? "right" : "left" }}>{h}</Text>
              ))}
            </View>
            {topT.map((t, i) => {
              const ig = t.name && isInvestmentGrade(t.name);
              const flexW = [3, 1.5, 2, 1.5, 2];
              return (
                <View key={i} style={{ flexDirection: "row", paddingVertical: 2.5, borderBottomWidth: 0.5, borderBottomColor: "#f5f0e8", borderBottomStyle: "solid" }}>
                  <View style={{ flex: flexW[0], flexDirection: "row", alignItems: "center" }}>
                    <Text style={{ fontSize: 9, color: C.ink }}>{t.name}</Text>
                    {ig && <Text style={{ fontSize: 7, color: C.olive, fontFamily: "Helvetica-Bold", marginLeft: 2 }}> IG</Text>}
                  </View>
                  <Text style={{ flex: flexW[1], fontSize: 9, color: C.body, textAlign: "right" }}>{toN(t.sf) > 0 ? toN(t.sf).toLocaleString() : "—"}</Text>
                  <Text style={{ flex: flexW[2], fontSize: 9, color: C.body, textAlign: "right" }}>{`$${toN(t.annualRent).toLocaleString()}`}</Text>
                  <Text style={{ flex: flexW[3], fontSize: 9, color: C.body, textAlign: "right" }}>{toN(t.rentPerSF) > 0 ? `$${toN(t.rentPerSF).toFixed(2)}` : "—"}</Text>
                  <Text style={{ flex: flexW[4], fontSize: 9, color: C.body, textAlign: "right" }}>{t.leaseExpiry || "—"}</Text>
                </View>
              );
            })}
          </View>
        )}

        {/* Demographics */}
        {hasDemographics && (
          <View style={s.sec}>
            <SH t="DEMOGRAPHICS" />
            <View style={{ flexDirection: "row" }}>
              {cols3.map((col, i) => (
                <View key={col.label} style={{ flex: 1, marginRight: i < 2 ? 12 : 0 }}>
                  <Text style={{ fontSize: 8, fontFamily: "Helvetica-Bold", color: C.olive, marginBottom: 3 }}>{col.label}</Text>
                  {col.pop ? <Text style={{ fontSize: 9, color: C.body, marginBottom: 2 }}>{`Pop: ${Number(col.pop).toLocaleString()}`}</Text> : null}
                  {col.hhi ? <Text style={{ fontSize: 9, color: C.body }}>{`Avg HHI: $${Number(col.hhi).toLocaleString()}`}</Text> : null}
                </View>
              ))}
            </View>
          </View>
        )}

        {/* Investment Thesis */}
        {assumptions.length > 0 && (
          <View style={s.sec}>
            <SH t="INVESTMENT THESIS" />
            {assumptions.slice(0, 5).map((a, i) => (
              <View key={i} style={{ flexDirection: "row", marginBottom: 4 }}>
                <Text style={{ fontSize: 10, color: C.olive, fontFamily: "Helvetica-Bold", marginRight: 5 }}>•</Text>
                <Text style={{ flex: 1, fontSize: 9.5, color: C.body, lineHeight: 1.4 }}>{String(a).trim()}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Site Plan */}
        {siteSrc && (
          <View style={s.sec}>
            <SH t="SITE PLAN" />
            <Image src={siteSrc} style={{ height: 140, borderRadius: 4, width: "100%" }} />
          </View>
        )}

        <Footer />
      </Page>
    </Document>
  );
}
