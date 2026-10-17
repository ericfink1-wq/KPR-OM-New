import { useState, useRef, useEffect, useMemo } from "react";
import { getOwnedProperties } from "../lib/ownedPortfolio";
import type { Deal, LeaseAbstract } from "../lib/idb";
import { buildSystemPrompt, cityState, tenantKey, tenantLabel, isVacant, openAuditCount, LIBRARY_TRIMMED_MARKER } from "../lib/utils";
import { buildFocusContext } from "../lib/analystRetrieval";
import { scoreDealConfidence } from "../lib/dealConfidence";
import { isInvestmentGrade, brandFamilyKey, brandDisplayName } from "../lib/tenantCredit";
import { SUGGESTED } from "../lib/constants";
import { apiLoadImages, apiListAllLeaseAbstracts, apiLoadComps, apiLoadTenantBenchmarks, type AnalystTenantBenchmark } from "../lib/api";
import { buildCompsSummary, type CompsSummary } from "../lib/compsSummary";
import { useWatchlist } from "../lib/useWatchlist";
import { useCreateAiMessage } from "@workspace/api-client-react";
import DealTiles from "./DealTiles";
import { CalendarClock, BarChart3, ShieldAlert, Scale, Landmark, Users, ChevronRight, ArrowUp, Square } from "lucide-react";

interface Message {
  role: "user" | "assistant";
  content: string;
  ts?: number;
}

interface Props {
  deals: Deal[];
  onOpenDeal: (id: string) => void;
  onTenantClick?: (name: string) => void;
  initialQuery?: string;
  onClearQuery?: () => void;
  // When set (home-page/dashboard mode), submitting a question or tapping a
  // suggested prompt hands off to the drawer via onAsk instead of running the
  // conversation inline. When absent (drawer mode), the chat runs here.
  onAsk?: (q: string) => void;
  /** Home page only: jump to an analytics page (the owned-risk cards link there). */
  onNav?: (dest: string) => void;
}

// ── Formatting helpers ──────────────────────────────────────────────────────
function fmtSF(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M SF`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K SF`;
  return `${n} SF`;
}
function fmtM(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${n}`;
}
const num = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? 0 : Number(v);

// ── Home page (KPR house style, 10/17/26) ───────────────────────────────────
const K = { green: "#5BBA47", charcoal: "#383A37", ink: "#232422", gray: "#676767", page: "#FAF9F5" };
const SUGGESTED_ICONS = [CalendarClock, BarChart3, ShieldAlert, Scale, Landmark, Users];

const HOME_CSS = `
.kpr-home{font-family:'Roboto',system-ui,sans-serif;color:${K.ink}}
.kpr-hero{position:relative;overflow:hidden;background:${K.charcoal};border-radius:16px;padding:28px 46px 34px 30px;margin-bottom:26px;display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1.35fr);gap:28px;align-items:center;box-shadow:0 18px 40px -28px rgba(35,36,34,.7)}
.kpr-hero-greet h1{font-family:'Lora',Georgia,serif;font-weight:500;font-size:34px;line-height:1.12;color:#fff;margin:0 0 10px;letter-spacing:-.01em}
.kpr-hero-greet p{font-size:14.5px;line-height:1.6;color:rgba(255,255,255,.74);margin:0;max-width:460px}
.kpr-hero-panel{position:relative;z-index:1;border:1px solid rgba(255,255,255,.16);border-radius:12px;padding:14px 16px 16px;background:rgba(0,0,0,.12)}
.kpr-eyebrow{font-family:'Montserrat',sans-serif;font-weight:700;font-size:12px;letter-spacing:.12em;text-transform:uppercase;margin-bottom:10px}
.kpr-eyebrow-dark{color:${K.green}}
.kpr-rule-grid{display:grid;gap:1px;grid-template-columns:repeat(auto-fit,minmax(130px,1fr))}
.kpr-rule-grid-dark{background:rgba(255,255,255,.14);border:1px solid rgba(255,255,255,.14);border-radius:8px;overflow:hidden}
.kpr-rule-grid-dark>div{background:${K.charcoal}}
.kpr-rule-grid-light{background:#e7e7e3}
.kpr-rule-grid-light>div{background:#fff}
.kpr-lib-grid{grid-template-columns:repeat(6,minmax(0,1fr))}
.kpr-stat{padding:14px 16px 15px;min-width:0}
.kpr-stat-v{font-family:'Roboto',sans-serif;font-variant-numeric:tabular-nums;font-weight:500;font-size:clamp(22px,2.2vw,30px);line-height:1.1;white-space:nowrap;color:${K.ink}}
.kpr-stat-l{font-family:'Montserrat',sans-serif;font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${K.charcoal};margin-top:7px}
.kpr-stat-s{font-size:13px;color:${K.gray};margin-top:2px;line-height:1.35}
.kpr-stat.dark .kpr-stat-v{color:#fff}
.kpr-stat.dark .kpr-stat-l{color:rgba(255,255,255,.9)}
.kpr-stat.dark .kpr-stat-s{color:rgba(255,255,255,.6)}
.kpr-anchors{display:flex;flex-wrap:wrap;align-items:center;gap:6px 0;margin-top:13px}
.kpr-anchors-label{font-family:'Montserrat',sans-serif;font-weight:700;font-size:11px;letter-spacing:.12em;text-transform:uppercase;color:rgba(255,255,255,.55);margin-right:12px}
.kpr-wordmark{font-family:'Montserrat',sans-serif;font-weight:700;font-size:12.5px;letter-spacing:.08em;text-transform:uppercase;color:#fff;background:none;border:none;padding:2px 0}
.kpr-wordmark:hover{color:${K.green}}
.kpr-dot{width:4px;height:4px;border-radius:50%;background:${K.green};margin:0 10px;display:inline-block}
.kpr-anchors-more{font-size:12px;color:rgba(255,255,255,.55);margin-left:10px}
.kpr-chevron{position:absolute;right:0;bottom:0;width:70px;height:70px;pointer-events:none}
.kpr-section{margin-bottom:26px}
.kpr-title{display:block;font-family:'Montserrat',sans-serif;font-weight:800;font-size:13px;letter-spacing:.12em;text-transform:uppercase;color:${K.charcoal};margin-bottom:12px}
.kpr-title:after{content:"";display:block;height:2px;margin-top:8px;background:linear-gradient(90deg,${K.green} 0 56px,#dcdcd8 56px)}
.kpr-card{background:#fff;border:1px solid #ecebe6;border-radius:12px;box-shadow:0 1px 2px rgba(35,36,34,.04),0 10px 26px -20px rgba(35,36,34,.35)}
.kpr-attn-row{display:flex;align-items:center;gap:14px;width:100%;text-align:left;background:#fff;border:none;padding:12px 16px;cursor:pointer;font-family:inherit}
.kpr-attn-row:hover{background:#f6f6f2}
.kpr-attn-name{display:block;font-family:'Lora',Georgia,serif;font-weight:600;font-size:15.5px;color:${K.ink}}
.kpr-attn-why{display:block;font-size:13px;color:${K.gray};margin-top:2px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.kpr-attn-go{display:inline-flex;align-items:center;gap:2px;font-family:'Montserrat',sans-serif;font-weight:700;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:${K.charcoal};white-space:nowrap}
.kpr-ask-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px}
.kpr-ask-card{display:flex;align-items:flex-start;gap:12px;text-align:left;padding:15px 16px;cursor:pointer;font-family:inherit;font-size:14px;line-height:1.45;color:${K.ink};transition:border-color .15s ease,transform .15s ease}
.kpr-ask-card:hover{border-color:${K.green};transform:translateY(-1px)}
.kpr-ask-icon{flex-shrink:0;width:32px;height:32px;border-radius:8px;background:#eef7eb;color:#3e8a2f;display:flex;align-items:center;justify-content:center}
@media(max-width:1023px){.kpr-lib-grid{grid-template-columns:repeat(3,minmax(0,1fr))}.kpr-hero{grid-template-columns:1fr;gap:20px}}
@media(max-width:640px){
  .kpr-home{padding:0 16px 8px !important}
  .kpr-hero{padding:22px 18px 46px;border-radius:14px}
  .kpr-hero-greet h1{font-size:27px}
  .kpr-hero-greet p{font-size:13.5px}
  .kpr-hero-panel{padding:12px}
  .kpr-rule-grid-dark{grid-template-columns:repeat(2,minmax(0,1fr))}
  .kpr-lib-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
  .kpr-stat{padding:12px 12px 13px}
  .kpr-ask-grid{grid-template-columns:1fr}
  .kpr-chevron{width:48px;height:48px}
  .kpr-attn-why{white-space:normal;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
  .kpr-attn-row{padding:12px 12px;gap:11px}
}
`;

function HomeStat({ label, value, sub, dark }: { label: string; value: string; sub?: string; dark?: boolean }) {
  return (
    <div className={`kpr-stat${dark ? " dark" : ""}`}>
      <div className="kpr-stat-v">{value}</div>
      <div className="kpr-stat-l">{label}</div>
      {sub && <div className="kpr-stat-s">{sub}</div>}
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <h2 className="kpr-title">{children}</h2>;
}

/** Data-confidence score as a ring — the arc fills to score/100 in the confidence colour. */
function ConfidenceRing({ score, color, label }: { score: number; color: string; label: string }) {
  const r = 17, c = 2 * Math.PI * r, f = Math.max(0, Math.min(100, score)) / 100;
  return (
    <span title={`Data confidence ${score}/100 (${label}) — how complete, consistent and current this deal's data is. Green 85+ high · dark green 70–84 good · amber 50–69 partial · red under 50 low.`}
      style={{ position: "relative", width: 42, height: 42, flexShrink: 0, cursor: "help" }}>
      <svg width="42" height="42" viewBox="0 0 42 42" aria-hidden>
        <circle cx="21" cy="21" r={r} fill="none" stroke="#ecebe6" strokeWidth="4" />
        <circle cx="21" cy="21" r={r} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeDasharray={`${c * f} ${c}`} transform="rotate(-90 21 21)" />
      </svg>
      <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontFamily: "'Roboto',sans-serif", fontVariantNumeric: "tabular-nums", fontWeight: 700, fontSize: 13, color: K.ink }}>{score}</span>
    </span>
  );
}


export default function AnalystChat({ deals, onOpenDeal, onTenantClick, initialQuery, onClearQuery, onAsk, onNav }: Props) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputWrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showSuggestions) return;
    const handler = (e: MouseEvent) => {
      if (inputWrapRef.current && !inputWrapRef.current.contains(e.target as Node)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showSuggestions]);
  const { mutateAsync: sendMessage } = useCreateAiMessage();
  const active = deals.filter(d => !d.trashedAt);

  // "Needs your attention" — the deals a first-pass analyst would flag: open arithmetic
  // contradictions, low/partial data confidence, or a stale analysis. Sorted worst-first
  // so the team starts the day on the records that actually need a human.
  const attention = useMemo(() => {
    return active
      .filter(d => d.status !== "Passed")
      .map(d => ({ d, conf: scoreDealConfidence(d), audits: openAuditCount(d) }))
      .filter(x => x.audits > 0 || x.conf.score < 80)
      .map(x => ({ ...x, priority: x.audits * 12 + (100 - x.conf.score) }))
      .sort((a, b) => b.priority - a.priority)
      .slice(0, 6);
  }, [active]);

  // Lease abstracts on file, folded into the system prompt so the chat can answer
  // lease-level questions (options, go-dark, exclusives, guaranties) with citations.
  // Fetched once; [] on failure so the chat is never blocked.
  const [abstracts, setAbstracts] = useState<LeaseAbstract[]>([]);
  useEffect(() => { apiListAllLeaseAbstracts().then(setAbstracts).catch(() => {}); }, []);

  // Sales-comp benchmark — computed in code from the comps database (cardinal rule:
  // the app computes comp stats, the analyst only narrates), folded into the prompt
  // so cap-rate / price-PSF comparisons are answerable. Fetched once; null on failure.
  const [compsSummary, setCompsSummary] = useState<CompsSummary | null>(null);
  useEffect(() => { apiLoadComps().then(rows => setCompsSummary(buildCompsSummary(rows))).catch(() => {}); }, []);

  // Retailer distress watchlist — folded in so the analyst flags bankrupt/distressed tenants.
  const watch = useWatchlist();

  // Official database-wide tenant benchmarks (recency-weighted per-brand medians),
  // so the analyst quotes the app's real numbers. Fetched once; [] on failure.
  const [tenantBenchmarks, setTenantBenchmarks] = useState<AnalystTenantBenchmark[]>([]);
  useEffect(() => { apiLoadTenantBenchmarks().then(setTenantBenchmarks).catch(() => {}); }, []);

  // Reset to top on initial mount — prevents opening scrolled to bottom
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  // Incoming query (from the dashboard hand-off / ask bar / "Ask about this
  // property"). In drawer mode (no onAsk) auto-send it so the answer appears;
  // in dashboard mode just pre-fill the box.
  useEffect(() => {
    if (!initialQuery) return;
    onClearQuery?.();
    if (onAsk) setInput(initialQuery);
    else sendMsg(initialQuery);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialQuery]);

  // Only auto-scroll to newest message after the user has sent something
  useEffect(() => {
    if (msgs.length === 0 && !loading) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading]);

  // Each send gets a generation id. Pressing Stop bumps the counter, so when the
  // (still in-flight) request resolves we see it's stale and discard the answer
  // instead of dropping it into the chat — an immediate Stop for an accidental ask.
  const genRef = useRef(0);
  const stop = () => { genRef.current++; setLoading(false); };

  const sendMsg = async (text: string) => {
    if (!text.trim() || loading) return;
    const myGen = ++genRef.current;
    const userMsg: Message = { role: "user", content: text, ts: Date.now() };
    setMsgs(m => [...m, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const systemPrompt = buildSystemPrompt(deals, abstracts, compsSummary, watch, tenantBenchmarks);
      const history = [...msgs, userMsg].map(m => ({ role: m.role, content: m.content }));

      // RETRIEVAL: when the library was too large and the system prompt trimmed deal
      // detail, attach the FULL, untrimmed data for the deals THIS question is about
      // (matched by name/alias, city, or tenant brand) to the outgoing question only.
      // The system prompt stays byte-identical across questions so prompt caching
      // keeps working; the chat display shows the raw question, not the data block.
      if (systemPrompt.includes(LIBRARY_TRIMMED_MARKER)) {
        const focus = buildFocusContext(text, deals);
        if (focus) history[history.length - 1] = { role: "user", content: `${focus}\n\nQUESTION: ${text}` };
      }

      const resp = await sendMessage({
        data: {
          system: systemPrompt,
          messages: history,
          max_tokens: 2048,
        }
      });

      if (genRef.current !== myGen) return; // stopped — discard the response
      const content = (resp as any)?.content?.[0]?.text || (resp as any)?.text || "I couldn't generate a response.";
      setMsgs(m => [...m, { role: "assistant", content, ts: Date.now() }]);
    } catch (err: unknown) {
      if (genRef.current !== myGen) return; // stopped — swallow the error too
      const msg = err instanceof Error ? err.message : "Request failed";
      setMsgs(m => [...m, { role: "assistant", content: `Error: ${msg}`, ts: Date.now() }]);
    } finally {
      if (genRef.current === myGen) setLoading(false);
    }
  };

  // Route a submitted question: in dashboard mode hand off to the drawer (onAsk),
  // otherwise run the conversation inline (drawer mode).
  const submit = (text: string) => {
    if (!text.trim()) return;
    if (onAsk) { onAsk(text.trim()); setInput(""); return; }
    sendMsg(text);
  };

  // ── Intelligence Library stats ───────────────────────────────────────────
  const stats = (() => {
    const tenantBrands = new Set(
      active.flatMap(d => (d.tenants || []).map(t => tenantKey(t.canonicalName || t.name))).filter(Boolean)
    ).size;
    const leases = active.reduce((s, d) => s + (d.tenants || []).length, 0);
    const sfAnalyzed = active.reduce((s, d) => s + num(d.totalSF), 0);
    const markets = new Set(active.map(d => (d.market || "").trim().toLowerCase()).filter(Boolean)).size;
    const dataPoints = (() => {
      let n = 0;
      const skip = (k: string) => k === "editHistory" || k === "images" || k.startsWith("_");
      function walk(o: Record<string, unknown>) {
        for (const k in o) {
          if (skip(k)) continue;
          const v = o[k];
          if (v == null || v === "") continue;
          if (Array.isArray(v)) v.forEach(x => (x && typeof x === "object") ? walk(x as Record<string, unknown>) : (x != null && x !== "" && n++));
          else if (typeof v === "object") walk(v as Record<string, unknown>);
          else n++;
        }
      }
      active.forEach(d => walk(d as unknown as Record<string, unknown>));
      return n;
    })();
    return { total: active.length, tenantBrands, leases, sfAnalyzed, markets, dataPoints };
  })();

  // ── Owned portfolio stats ────────────────────────────────────────────────
  const portfolio = (() => {
    const owned = getOwnedProperties(active);
    const tenants = owned.flatMap(d => (d.tenants || []));
    // Aggregate each anchor brand's total annual rent across owned properties,
    // then rank the list by rent (highest first).
    const anchorAgg = new Map<string, { label: string; rent: number }>();
    for (const t of tenants) {
      if (!t.isAnchor || !t.name) continue;
      const k = brandFamilyKey(t.canonicalName || t.name) || tenantKey(t.canonicalName || t.name);
      if (!k) continue;
      const cur = anchorAgg.get(k) ?? { label: brandDisplayName(tenantLabel(t.name, t.canonicalName)), rent: 0 };
      cur.rent += num(t.annualRent);
      anchorAgg.set(k, cur);
    }
    const anchors = [...anchorAgg.values()].sort((a, b) => b.rent - a.rent).map(a => a.label);
    const totalValue = owned.reduce((s, d) => s + (num(d.txnPurchasePrice) || num(d.askingPrice)), 0);
    const totalSF = owned.reduce((s, d) => s + num(d.totalSF), 0);
    const allOccupied = tenants.filter(t => !isVacant(t.name));
    const igTenants = allOccupied.filter(t => t.name && isInvestmentGrade(t.name, t.creditRating));
    const totalRent = allOccupied.reduce((s, t) => s + num(t.annualRent), 0);
    const igRent = igTenants.reduce((s, t) => s + num(t.annualRent), 0);
    const igRentPct = totalRent > 0 ? Math.round(igRent / totalRent * 100) : null;
    return { count: owned.length, value: totalValue, sf: totalSF, anchors, igRentPct };
  })();

  const isEmpty = msgs.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: onAsk ? K.page : "transparent" }}>
      {/* Messages area */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 0 0" }}>
        {isEmpty ? (
          <div className="kpr-home" style={{ maxWidth: 1400, margin: "0 auto", padding: "0 28px 8px", animation: "riseIn 0.3s ease both" }}>
            <style>{HOME_CSS}</style>
            {/* Hero — charcoal band: greeting + owned portfolio (KPR house style, 10/17/26) */}
            <section className="kpr-hero">
              <div className="kpr-hero-greet">
                <h1>Good {getTimeGreeting()}.</h1>
                <p>I'm your KPR deal analyst. I know your entire deal library — ask me anything about your deals, comps, lease rollover, demographics, or market trends.</p>
              </div>
              {active.length > 0 && (
                <div className="kpr-hero-panel">
                  <div className="kpr-eyebrow kpr-eyebrow-dark">Owned portfolio</div>
                  {portfolio.count === 0 ? (
                    <div style={{ fontSize: 13, color: "rgba(255,255,255,.72)", padding: "4px 0 2px" }}>
                      No owned properties yet — mark a deal as <span style={{ color: K.green, fontWeight: 700 }}>Owned</span> to build your portfolio snapshot here.
                    </div>
                  ) : (
                    <>
                      <div className="kpr-rule-grid kpr-rule-grid-dark">
                        <HomeStat dark label="Properties" value={portfolio.count.toLocaleString()} sub="marked Owned" />
                        {portfolio.value > 0 && <HomeStat dark label="Cost basis" value={fmtM(portfolio.value)} sub="purchase price, or asking where none" />}
                        {portfolio.sf > 0 && <HomeStat dark label="Square footage" value={fmtSF(portfolio.sf)} sub="gross leasable area" />}
                        {portfolio.igRentPct != null && <HomeStat dark label="Investment-grade rent" value={`${portfolio.igRentPct}%`} sub="of in-place base rent" />}
                      </div>
                      {portfolio.anchors.length > 0 && (
                        <div className="kpr-anchors">
                          <span className="kpr-anchors-label">Key anchors</span>
                          {portfolio.anchors.slice(0, 12).map((a, i) => (
                            <span key={a} style={{ display: "inline-flex", alignItems: "center" }}>
                              {i > 0 && <span className="kpr-dot" aria-hidden />}
                              <button type="button" onClick={() => onTenantClick?.(a)} className="kpr-wordmark" style={{ cursor: onTenantClick ? "pointer" : "default" }}>{a}</button>
                            </span>
                          ))}
                          {portfolio.anchors.length > 12 && <span className="kpr-anchors-more">+{portfolio.anchors.length - 12}</span>}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )}
              <svg className="kpr-chevron" viewBox="0 0 120 120" aria-hidden><path d="M120 0 L120 120 L0 120 Z" fill={K.green} /><path d="M120 34 L120 120 L34 120 Z" fill="#4a9a3a" /></svg>
            </section>

            {/* Intelligence library — one ruled white panel */}
            {active.length > 0 && (
              <section className="kpr-section">
                <SectionTitle>Intelligence library</SectionTitle>
                <div className="kpr-card" style={{ padding: 0, overflow: "hidden" }}>
                  <div className="kpr-rule-grid kpr-rule-grid-light kpr-lib-grid">
                    <HomeStat label="OMs read" value={stats.total ? stats.total.toLocaleString() : "—"} sub="every deal recorded" />
                    <HomeStat label="Tenant brands" value={stats.tenantBrands ? stats.tenantBrands.toLocaleString() : "—"} sub="distinct brands" />
                    <HomeStat label="Leases analyzed" value={stats.leases ? stats.leases.toLocaleString() : "—"} sub="roster rows read" />
                    <HomeStat label="SF analyzed" value={stats.sfAnalyzed ? fmtSF(stats.sfAnalyzed) : "—"} sub="across all centers" />
                    <HomeStat label="Markets covered" value={stats.markets ? stats.markets.toLocaleString() : "—"} sub="distinct markets" />
                    <HomeStat label="Data points" value={stats.dataPoints ? stats.dataPoints.toLocaleString() : "—"} sub="figures captured" />
                  </div>
                </div>
              </section>
            )}

            {/* Owned-portfolio risk cards live on Portfolio Analytics → Owned only (Eric, 10/17/26). */}
            {active.some(d => d.status === "Under Contract" || d.status === "Prospect") && (
              <section className="kpr-section">
                <SectionTitle>Pipeline</SectionTitle>
                <DealTiles deals={active} onOpen={onOpenDeal} />
              </section>
            )}

            {/* Needs your attention */}
            {attention.length > 0 && (
              <section className="kpr-section">
                <SectionTitle>Needs your attention — {attention.length} deal{attention.length === 1 ? "" : "s"}</SectionTitle>
                <div style={{ fontSize: 13, color: K.gray, margin: "-4px 0 10px" }}>The ring is each deal's data-confidence score out of 100 — amber 50–69 is partial, red under 50 is low.</div>
                <div className="kpr-card" style={{ padding: 0, overflow: "hidden" }}>
                  {attention.map(({ d, conf, audits }, i) => {
                    const reasons: string[] = [];
                    if (audits > 0) reasons.push(audits === 1 ? "1 number to verify" : `${audits} numbers to verify`);
                    for (const g of conf.gaps) { if (reasons.length >= 3) break; if (!/don't tie out|doesn't tie out/.test(g)) reasons.push(g); }
                    return (
                      <button key={d.id} onClick={() => onOpenDeal(d.id)} className="kpr-attn-row" style={{ borderTop: i ? "1px solid #ecebe6" : "none" }}>
                        <ConfidenceRing score={conf.score} color={conf.color} label={conf.label} />
                        <span style={{ flex: 1, minWidth: 0 }}>
                          <span className="kpr-attn-name">{d.propertyName || d.fileName || "Untitled deal"}</span>
                          <span className="kpr-attn-why">{reasons.join(" · ") || "Review the data"}</span>
                        </span>
                        <span className="kpr-attn-go">Review <ChevronRight size={15} strokeWidth={2} aria-hidden /></span>
                      </button>
                    );
                  })}
                </div>
              </section>
            )}

            {/* Try asking — 3-column cards */}
            <section className="kpr-section">
              <SectionTitle>Try asking</SectionTitle>
              <div className="kpr-ask-grid">
                {SUGGESTED.map((s, i) => {
                  const Icon = SUGGESTED_ICONS[i % SUGGESTED_ICONS.length];
                  return (
                    <button key={s} onClick={() => submit(s)} className="kpr-card kpr-ask-card">
                      <span className="kpr-ask-icon"><Icon size={17} strokeWidth={1.8} aria-hidden /></span>
                      <span>{s}</span>
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        ) : (
          <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 28px", display: "flex", flexDirection: "column", gap: 20 }}>
            {msgs.map((m, i) => (
              <div key={i} style={{ display: "flex", flexDirection: m.role === "user" ? "row-reverse" : "row", gap: 12, animation: "riseIn 0.22s ease both" }}>
                {m.role === "assistant" && (
                  <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#26281f", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                    <span style={{ fontFamily: "'Fraunces', serif", fontSize: 12, color: "#e8e0cf", fontWeight: 500 }}>K</span>
                  </div>
                )}
                <div style={{
                  maxWidth: "76%",
                  background: m.role === "user" ? "#26281f" : "#fff",
                  color: m.role === "user" ? "#e8e0cf" : "#383a37",
                  border: m.role === "user" ? "none" : "1px solid #e7e0d2",
                  borderRadius: m.role === "user" ? "14px 14px 4px 14px" : "4px 14px 14px 14px",
                  padding: "12px 16px",
                  fontSize: 13.5,
                  lineHeight: 1.7,
                  boxShadow: "0 1px 2px rgba(56,58,55,0.05)",
                }}>
                  <MarkdownText text={m.content} />
                </div>
              </div>
            ))}
            {loading && (
              <div style={{ display: "flex", gap: 12, animation: "riseIn 0.2s ease both" }}>
                <div style={{ width: 28, height: 28, borderRadius: "50%", background: "#26281f", flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
                  <span style={{ fontFamily: "'Fraunces', serif", fontSize: 12, color: "#e8e0cf" }}>K</span>
                </div>
                <div style={{ background: "#fff", border: "1px solid #e7e0d2", borderRadius: "4px 14px 14px 14px", padding: "16px 20px", display: "flex", gap: 5 }}>
                  {[0,1,2].map(i => (
                    <span key={i} style={{ width: 6, height: 6, borderRadius: "50%", background: "#c8bfb0", display: "block", animation: `dotPulse 1.2s ease ${i*0.2}s infinite` }}/>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input bar */}
      <div className="kpr-chatbar-wrap" style={{ background: "linear-gradient(180deg, rgba(250,249,245,0) 0%, rgba(250,249,245,0.92) 38%)", flexShrink: 0 }}>
        <div className="kpr-chatbar" style={{ maxWidth: 1400, margin: "0 auto", padding: "10px 28px 12px" }}>
        {msgs.length > 0 && (
          <button onClick={() => setMsgs([])} style={{ fontSize: 10, color: "#a89f8f", background: "transparent", border: "none", cursor: "pointer", marginBottom: 8, fontFamily: "'Inter', sans-serif" }}>
            ← New conversation
          </button>
        )}
        <div ref={inputWrapRef} style={{ display: "flex", gap: 8, alignItems: "center", position: "relative", background: "#fff", border: "1px solid #e4e3de", borderRadius: 999, padding: "6px 6px 6px 8px", boxShadow: "0 2px 4px rgba(35,36,34,0.05), 0 14px 32px -16px rgba(35,36,34,0.45)" }}>
          {showSuggestions && (
            <div style={{
              position: "absolute", bottom: "calc(100% + 6px)", left: 0, right: 54,
              background: "#fff", border: "1px solid #e3dccd", borderRadius: 12,
              boxShadow: "0 4px 20px rgba(56,58,55,0.13)", overflow: "hidden", zIndex: 200,
            }}>
              {SUGGESTED.slice(0, 5).map((s, i) => (
                <button key={s}
                  onMouseDown={e => { e.preventDefault(); setInput(s); setShowSuggestions(false); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left", background: "transparent",
                    border: "none", borderBottom: i < 4 ? "1px solid #f1eadc" : "none",
                    padding: "10px 14px", fontSize: 13, color: "#5c5f57", cursor: "pointer",
                    fontFamily: "'Inter',sans-serif", lineHeight: 1.4,
                  }}
                  onMouseEnter={e => (e.currentTarget.style.background = "#faf7f0")}
                  onMouseLeave={e => (e.currentTarget.style.background = "transparent")}
                >{s}</button>
              ))}
            </div>
          )}
          <textarea
            aria-label="Ask the KPR Analyst"
            value={input}
            onChange={e => { setInput(e.target.value); if (e.target.value) setShowSuggestions(false); }}
            onFocus={() => { if (!input.trim()) setShowSuggestions(true); }}
            onKeyDown={e => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); setShowSuggestions(false); submit(input); }
              if (e.key === "Escape") setShowSuggestions(false);
            }}
            placeholder={active.length === 0 ? "Upload some OMs first, then ask me anything…" : "Ask about your deal library…"}
            disabled={loading}
            rows={1}
            style={{
              flex: 1, resize: "none", fontFamily: "'Roboto', sans-serif", fontSize: 14.5,
              padding: "8px 10px", border: "none", borderRadius: 999,
              color: "#232422", background: "transparent", lineHeight: 1.5,
              outline: "none",
            }}
          />
          {loading ? (
            <button onClick={stop} title="Stop generating"
              style={{
                background: "#b91c1c", border: "none", color: "#fff",
                borderRadius: "50%", width: 40, height: 40, cursor: "pointer", flexShrink: 0,
                display: "flex", alignItems: "center", justifyContent: "center",
              }}>
              <Square size={14} fill="currentColor" aria-hidden />
            </button>
          ) : (
            <button onClick={() => { setShowSuggestions(false); submit(input); }} disabled={!input.trim()}
              style={{
                background: input.trim() ? "#5BBA47" : "#e7e7e3",
                border: "none", color: input.trim() ? "#fff" : "#9b9b96",
                borderRadius: "50%", width: 40, height: 40, cursor: input.trim() ? "pointer" : "default",
                flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center",
              }} aria-label="Send">
              <ArrowUp size={19} strokeWidth={2.2} aria-hidden />
            </button>
          )}
        </div>
        <div style={{ fontSize: 11, color: "#8d8d88", marginTop: 6, paddingLeft: 18 }}><span className="kpr-kbd-hint">Enter to send · Shift+Enter for new line · </span>Powered by Claude</div>
        </div>
      </div>
    </div>
  );
}

function getTimeGreeting(): string {
  const h = new Date().getHours();
  if (h < 12) return "morning";
  if (h < 17) return "afternoon";
  return "evening";
}

// Very lightweight markdown-to-JSX: bold, bullets, headers
function MarkdownText({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  lines.forEach((line, i) => {
    // Any heading level renders as a heading — a stray "# Title" used to show its "#".
    const hm = /^(#{1,6})\s+(.*)$/.exec(line);
    if (hm && (hm[1].length === 1 || hm[1].length >= 4)) {
      const big = hm[1].length === 1;
      elements.push(<div key={i} style={{ fontFamily: "'Fraunces', serif", fontSize: big ? 18 : 14.5, fontWeight: big ? 500 : 600, color: "#26281f", marginTop: big ? 6 : 10, marginBottom: 4 }}>{inlineFmt(hm[2])}</div>);
    } else if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
      elements.push(<div key={i} style={{ height: 1, background: "#e7e0d2", margin: "10px 0" }} />);
    } else if (line.startsWith("### ")) {
      elements.push(<div key={i} style={{ fontFamily: "'Fraunces', serif", fontSize: 15, fontWeight: 600, color: "#26281f", marginTop: 12, marginBottom: 4 }}>{inlineFmt(line.slice(4))}</div>);
    } else if (line.startsWith("## ")) {
      elements.push(<div key={i} style={{ fontFamily: "'Fraunces', serif", fontSize: 17, fontWeight: 500, color: "#26281f", marginTop: 14, marginBottom: 4 }}>{inlineFmt(line.slice(3))}</div>);
    } else if (/^[-*] /.test(line)) {
      elements.push(<div key={i} style={{ display: "flex", gap: 8, marginLeft: 4 }}><span style={{ color: "#6dba43", flexShrink: 0 }}>›</span><span>{inlineFmt(line.slice(2))}</span></div>);
    } else if (/^\d+\. /.test(line)) {
      const [num2, ...rest] = line.split(". ");
      elements.push(<div key={i} style={{ display: "flex", gap: 8, marginLeft: 4 }}><span style={{ color: "#a89f8f", flexShrink: 0 }}>{num2}.</span><span>{inlineFmt(rest.join(". "))}</span></div>);
    } else if (line === "") {
      elements.push(<div key={i} style={{ height: 6 }} />);
    } else {
      elements.push(<span key={i}>{inlineFmt(line)}<br /></span>);
    }
  });
  return <>{elements}</>;
}

function inlineFmt(text: string): React.ReactNode {
  const parts = text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g);
  return parts.map((p, i) => {
    if (p.startsWith("**") && p.endsWith("**")) return <strong key={i}>{p.slice(2, -2)}</strong>;
    if (p.startsWith("`") && p.endsWith("`")) return <code key={i} style={{ background: "#f1eadc", borderRadius: 3, padding: "0 4px", fontSize: "0.9em" }}>{p.slice(1, -1)}</code>;
    return p;
  });
}
