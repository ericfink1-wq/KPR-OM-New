import { useState, useRef, useEffect } from "react";
import type { Deal } from "../lib/idb";
import { buildSystemPrompt, cityState, tenantKey, tenantLabel } from "../lib/utils";
import { isInvestmentGrade } from "../lib/tenantCredit";
import { SUGGESTED } from "../lib/constants";
import { apiLoadImages } from "../lib/api";
import { useCreateAiMessage } from "@workspace/api-client-react";
import DealTiles from "./DealTiles";

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

// Stat box tile
function StatBox({ label, value, accent, flexWeight }: { label: string; value: string | number; accent?: string; flexWeight?: number }) {
  return (
    <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 10, padding: "10px 14px", flex: `${flexWeight ?? 1} 1 0`, minWidth: 80 }}>
      <div style={{ fontFamily: "'Fraunces', serif", fontSize: "clamp(1.3rem, 2.2vw, 2.4rem)", fontWeight: 500, color: accent || "#26281f", lineHeight: 1.1, whiteSpace: "nowrap" }}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
      <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#a89f8f", fontWeight: 700, textTransform: "uppercase" as const, marginTop: 4 }}>{label}</div>
    </div>
  );
}

const panelLabel: React.CSSProperties = {
  fontSize: 9,
  fontWeight: 700,
  letterSpacing: "0.14em",
  color: "#a89f8f",
  textTransform: "uppercase",
  marginBottom: 8,
  marginTop: 16,
};

export default function AnalystChat({ deals, onOpenDeal, onTenantClick, initialQuery, onClearQuery }: Props) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const { mutateAsync: sendMessage } = useCreateAiMessage();
  const active = deals.filter(d => !d.trashedAt);

  // Reset to top on initial mount — prevents opening scrolled to bottom
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
  }, []);

  // Handle incoming query from DetailView
  useEffect(() => {
    if (initialQuery) {
      setInput(initialQuery);
      onClearQuery?.();
    }
  }, [initialQuery]);

  // Only auto-scroll to newest message after the user has sent something
  useEffect(() => {
    if (msgs.length === 0 && !loading) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [msgs, loading]);

  const sendMsg = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { role: "user", content: text, ts: Date.now() };
    setMsgs(m => [...m, userMsg]);
    setInput("");
    setLoading(true);

    try {
      const systemPrompt = buildSystemPrompt(deals);
      const history = [...msgs, userMsg].map(m => ({ role: m.role, content: m.content }));

      const resp = await sendMessage({
        data: {
          system: systemPrompt,
          messages: history,
          max_tokens: 2048,
        }
      });

      const content = (resp as any)?.content?.[0]?.text || (resp as any)?.text || "I couldn't generate a response.";
      setMsgs(m => [...m, { role: "assistant", content, ts: Date.now() }]);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Request failed";
      setMsgs(m => [...m, { role: "assistant", content: `Error: ${msg}`, ts: Date.now() }]);
    } finally {
      setLoading(false);
    }
  };

  // ── Intelligence Library stats ───────────────────────────────────────────
  const stats = (() => {
    const tenantBrands = new Set(
      active.flatMap(d => (d.tenants || []).map(t => tenantKey(t.name))).filter(Boolean)
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
    const owned = active.filter(d => d.status === "Owned");
    const tenants = owned.flatMap(d => (d.tenants || []));
    const seenAnchors = new Set<string>();
    const anchors = tenants.filter(t => t.isAnchor && t.name).reduce<string[]>((acc, t) => {
      const k = tenantKey(t.name);
      if (k && !seenAnchors.has(k)) { seenAnchors.add(k); acc.push(tenantLabel(t.name!)); }
      return acc;
    }, []);
    const totalValue = owned.reduce((s, d) => s + (num(d.txnPurchasePrice) || num(d.askingPrice)), 0);
    const totalSF = owned.reduce((s, d) => s + num(d.totalSF), 0);
    const allOccupied = tenants.filter(t => t.name && !/^vacant$/i.test(String(t.name).trim()));
    const igTenants = allOccupied.filter(t => t.name && isInvestmentGrade(t.name, t.creditRating));
    const totalRent = allOccupied.reduce((s, t) => s + num(t.annualRent), 0);
    const igRent = igTenants.reduce((s, t) => s + num(t.annualRent), 0);
    const igRentPct = totalRent > 0 ? Math.round(igRent / totalRent * 100) : null;
    return { count: owned.length, value: totalValue, sf: totalSF, anchors, igRentPct };
  })();

  const isEmpty = msgs.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden", background: "transparent" }}>
      {/* Messages area */}
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "24px 0 0" }}>
        {isEmpty ? (
          <div style={{ maxWidth: 1400, margin: "0 auto", padding: "0 28px", animation: "riseIn 0.3s ease both" }}>
            {/* Hero */}
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 400, color: "#26281f", marginBottom: 6, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
                Good {getTimeGreeting()}.
              </div>
              <p style={{ fontSize: 14, color: "#7d766a", lineHeight: 1.65, maxWidth: 560, margin: 0 }}>
                I'm your KPR deal analyst. I know your entire deal library — ask me anything about your deals, comps, lease rollover, demographics, or market trends.
              </p>
            </div>

            {/* ── Intelligence Library stat row ────────────────────────────── */}
            {active.length > 0 && (
              <>
                <div style={panelLabel}>Intelligence library — everything read into the system</div>
                <div className="grid grid-cols-2 lg:grid-cols-6" style={{ gap: 10, marginBottom: 4, width: "100%" }}>
                  <StatBox label="OMs Read" value={stats.total || "—"} />
                  <StatBox label="Tenant Brands" value={stats.tenantBrands ? stats.tenantBrands.toLocaleString() : "—"} accent="#0f9d63" />
                  <StatBox label="Leases Analyzed" value={stats.leases ? stats.leases.toLocaleString() : "—"} />
                  <StatBox label="SF Analyzed" value={stats.sfAnalyzed ? fmtSF(stats.sfAnalyzed) : "—"} />
                  <StatBox label="Markets Covered" value={stats.markets || "—"} />
                  <StatBox label="Data Points" value={stats.dataPoints ? stats.dataPoints.toLocaleString() : "—"} accent="#0f9d63" />
                </div>
              </>
            )}

            {/* ── Owned portfolio stat row ─────────────────────────────────── */}
            {active.length > 0 && (
              <>
                <div style={panelLabel}>Owned portfolio</div>
                {portfolio.count === 0 ? (
                  <div style={{ background: "#faf7f0", border: "1px dashed #e3dccd", borderRadius: 12, padding: "12px 16px", fontSize: 12, color: "#9a917f", marginBottom: 4 }}>
                    No owned properties yet — mark a deal as <span style={{ color: "#6dba43", fontWeight: 600 }}>Owned</span> to build your portfolio snapshot here.
                  </div>
                ) : (
                  <div className="grid grid-cols-2 lg:flex lg:flex-wrap" style={{ gap: 10, marginBottom: 4, width: "100%" }}>
                    <StatBox label="Properties" value={portfolio.count} accent="#6dba43" />
                    {portfolio.value > 0 && <StatBox label="Portfolio Value" value={fmtM(portfolio.value)} accent="#6dba43" />}
                    {portfolio.sf > 0 && <StatBox label="Square Footage" value={fmtSF(portfolio.sf)} />}
                    {portfolio.igRentPct != null && <StatBox label="Investment Grade Tenant Rent" value={`${portfolio.igRentPct}%`} accent="#3f7a1f" />}
                    {portfolio.anchors.length > 0 && (
                      <div style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 10, padding: "10px 14px", flex: "3 1 0", minWidth: 160 }}>
                        <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#a89f8f", fontWeight: 700, textTransform: "uppercase", marginBottom: 6 }}>Key Anchors</div>
                        <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
                          {portfolio.anchors.slice(0, 5).map(a => (
                            <span key={a} onClick={() => onTenantClick?.(a)}
                              style={{ background: "#f0fae8", border: "1px solid #c6e6a0", color: "#3d7a1c", borderRadius: 6, padding: "2px 7px", fontSize: 10, fontWeight: 600, cursor: onTenantClick ? "pointer" : "default", textDecoration: onTenantClick ? "underline" : "none", textDecorationColor: "#c6e6a0", textUnderlineOffset: "2px" }}>{a}</span>
                          ))}
                          {portfolio.anchors.length > 5 && <span style={{ fontSize: 10, color: "#a89f8f" }}>+{portfolio.anchors.length - 5}</span>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </>
            )}

            {/* Deal tiles */}
            {active.length > 0 && (
              <>
                <div style={{ marginTop: 12, marginBottom: 8, fontSize: 9, letterSpacing: "0.16em", color: "#a89f8f", fontWeight: 700, textTransform: "uppercase" }}>Pipeline</div>
                <DealTiles deals={active} onOpen={onOpenDeal} />
              </>
            )}

            {/* Suggested prompts */}
            <div>
              <div style={{ fontSize: 10, letterSpacing: "0.14em", color: "#a89f8f", fontWeight: 700, marginBottom: 10, textTransform: "uppercase" }}>Try asking…</div>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {SUGGESTED.map(s => (
                  <button key={s} onClick={() => sendMsg(s)}
                    style={{ textAlign: "left", background: "#fff", border: "1px solid #e7e0d2", borderRadius: 10, padding: "10px 14px", cursor: "pointer", fontSize: 12.5, color: "#4a4d46", fontFamily: "'Inter', sans-serif", transition: "background .15s ease, border-color .15s ease" }}
                    onMouseEnter={e => { e.currentTarget.style.background = "#f6f2ea"; e.currentTarget.style.borderColor = "#c8bfb0"; }}
                    onMouseLeave={e => { e.currentTarget.style.background = "#fff"; e.currentTarget.style.borderColor = "#e7e0d2"; }}>
                    {s}
                  </button>
                ))}
              </div>
            </div>

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
      <div style={{ borderTop: "1px solid #e7e0d2", background: "rgba(250,247,240,0.85)", backdropFilter: "blur(12px)", flexShrink: 0 }}>
        <div style={{ maxWidth: 1400, margin: "0 auto", padding: "14px 28px" }}>
        {msgs.length > 0 && (
          <button onClick={() => setMsgs([])} style={{ fontSize: 10, color: "#a89f8f", background: "transparent", border: "none", cursor: "pointer", marginBottom: 8, fontFamily: "'Inter', sans-serif" }}>
            ← New conversation
          </button>
        )}
        <div style={{ display: "flex", gap: 10 }}>
          <textarea
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(input); } }}
            placeholder={active.length === 0 ? "Upload some OMs first, then ask me anything…" : "Ask anything about your deal library…"}
            disabled={loading}
            rows={2}
            style={{
              flex: 1, resize: "none", fontFamily: "'Inter', sans-serif", fontSize: 13.5,
              padding: "10px 14px", border: "1px solid #e3dccd", borderRadius: 12,
              color: "#383a37", background: "#fff", lineHeight: 1.55,
              outline: "none", boxShadow: "0 1px 2px rgba(56,58,55,0.05)",
            }}
          />
          <button onClick={() => sendMsg(input)} disabled={loading || !input.trim()}
            style={{
              background: input.trim() && !loading ? "#26281f" : "#e3dccd",
              border: "none", color: input.trim() && !loading ? "#e8e0cf" : "#a89f8f",
              borderRadius: 12, width: 44, cursor: input.trim() && !loading ? "pointer" : "default",
              fontSize: 18, flexShrink: 0,
            }}>
            ↑
          </button>
        </div>
        <div style={{ fontSize: 10, color: "#c4bba7", marginTop: 6 }}>Enter to send · Shift+Enter for new line · Powered by Claude</div>
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
    if (line.startsWith("### ")) {
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
