import { useState, useRef, useEffect } from "react";
import type { Deal } from "../lib/idb";
import { buildSystemPrompt, cityState } from "../lib/utils";
import { SUGGESTED } from "../lib/constants";
import { STATUS_COLORS } from "../lib/constants";
import { idbLoadImages } from "../lib/idb";
import { useCreateAiMessage } from "@workspace/api-client-react";
import DealTiles from "./DealTiles";
import PortfolioMontage from "./PortfolioMontage";

interface Message {
  role: "user" | "assistant";
  content: string;
  ts?: number;
}

interface Props {
  deals: Deal[];
  onOpenDeal: (id: string) => void;
  initialQuery?: string;
  onClearQuery?: () => void;
}

export default function AnalystChat({ deals, onOpenDeal, initialQuery, onClearQuery }: Props) {
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const { mutateAsync: sendMessage } = useCreateAiMessage();
  const active = deals.filter(d => !d.trashedAt);

  // Handle incoming query from DetailView
  useEffect(() => {
    if (initialQuery) {
      setInput(initialQuery);
      onClearQuery?.();
    }
  }, [initialQuery]);

  useEffect(() => {
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

  const isEmpty = msgs.length === 0;

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", background: "transparent" }}>
      {/* Messages area */}
      <div style={{ flex: 1, overflowY: "auto", padding: "24px 28px" }}>
        {isEmpty ? (
          <div style={{ animation: "riseIn 0.3s ease both" }}>
            {/* Hero */}
            <div style={{ marginBottom: 32 }}>
              <div style={{ fontFamily: "'Fraunces', serif", fontSize: 28, fontWeight: 400, color: "#26281f", marginBottom: 6, letterSpacing: "-0.02em", lineHeight: 1.15 }}>
                Good {getTimeGreeting()}.
              </div>
              <p style={{ fontSize: 14, color: "#7d766a", lineHeight: 1.65, maxWidth: 560, margin: 0 }}>
                I'm your KPR deal analyst. I know your entire portfolio — ask me anything about your deals, comps, lease rollover, demographics, or market trends.
              </p>
            </div>

            {/* Portfolio stat strip */}
            {active.length > 0 && (
              <div style={{ display: "flex", gap: 16, marginBottom: 28, flexWrap: "wrap" }}>
                {[
                  ["DEALS", active.length, "#383a37"],
                  ["UNDER CONTRACT", active.filter(d => d.status === "Under Contract").length, STATUS_COLORS["Under Contract"]],
                  ["OWNED", active.filter(d => d.status === "Owned").length, STATUS_COLORS.Owned],
                  ["PASSED", active.filter(d => d.status === "Passed").length, STATUS_COLORS.Passed],
                ].map(([l, v, c]) => (
                  <div key={l as string} style={{ background: "#fff", border: "1px solid #ece5d7", borderRadius: 10, padding: "12px 16px", minWidth: 80 }}>
                    <div style={{ fontFamily: "'Fraunces', serif", fontSize: 22, fontWeight: 500, color: c as string, lineHeight: 1 }}>{v as number}</div>
                    <div style={{ fontSize: 8, letterSpacing: "0.12em", color: "#a89f8f", fontWeight: 700, textTransform: "uppercase", marginTop: 4 }}>{l as string}</div>
                  </div>
                ))}
              </div>
            )}

            {/* Deal tiles */}
            {active.length > 0 && <DealTiles deals={active} onOpen={onOpenDeal} />}

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

            {/* Montage */}
            {active.length >= 2 && <PortfolioMontage deals={active} onOpen={onOpenDeal} />}
          </div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
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
      <div style={{ borderTop: "1px solid #e7e0d2", padding: "14px 28px", background: "rgba(250,247,240,0.85)", backdropFilter: "blur(12px)" }}>
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
            placeholder={active.length === 0 ? "Upload some OMs first, then ask me anything…" : "Ask anything about your portfolio…"}
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
      const [num, ...rest] = line.split(". ");
      elements.push(<div key={i} style={{ display: "flex", gap: 8, marginLeft: 4 }}><span style={{ color: "#a89f8f", flexShrink: 0 }}>{num}.</span><span>{inlineFmt(rest.join(". "))}</span></div>);
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
