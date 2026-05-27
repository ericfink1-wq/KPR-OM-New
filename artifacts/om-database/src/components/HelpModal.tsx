import { useEffect, useState } from "react";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
}

function Chevron({ up }: { up: boolean }) {
  return (
    <span style={{ display:"inline-flex", flexShrink:0, transform: up ? "rotate(180deg)" : "rotate(0deg)", transition:"transform 0.2s ease" }}>
      <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path d="M4 6l4 4 4-4" stroke="#6f6a5f" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </span>
  );
}

function Chip({ n }: { n: number }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:26, height:26, background:"#3f7a1f", borderRadius:4, color:"#fff", fontWeight:700, fontSize:12, fontFamily:"'Inter',sans-serif", flexShrink:0 }}>
      {n}
    </span>
  );
}

function DetailList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul style={{ margin:"10px 0 0", padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:7 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display:"flex", gap:8 }}>
          <span style={{ color:"#6f6a5f", flexShrink:0, marginTop:1 }}>•</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function B({ children }: { children: React.ReactNode }) {
  return <strong style={{ fontWeight:600, color:"#2a2c28" }}>{children}</strong>;
}

function BriefList({ items }: { items: React.ReactNode[] }) {
  return (
    <ul style={{ margin:"7px 0 0", padding:0, listStyle:"none", display:"flex", flexDirection:"column", gap:6 }}>
      {items.map((item, i) => (
        <li key={i} style={{ display:"flex", gap:8 }}>
          <span style={{ color:"#a89f8f", flexShrink:0, marginTop:1 }}>›</span>
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

const SECTIONS: { id: number; title: string; brief: React.ReactNode; detail: React.ReactNode }[] = [
  {
    id: 1,
    title: "What you see on the home page",
    brief: (
      <>
        <p style={{ margin:0 }}>Three things, top to bottom:</p>
        <BriefList items={[
          <><B>Stat rows.</B> Intelligence Library (everything we've ingested) and Owned Portfolio (properties we actually own, with key anchors).</>,
          <><B>Deal cards.</B> Under Contract first, then Pipeline prospects. Click any card to open the deal.</>,
          <><B>Ask anything.</B> The chat bar pinned at the bottom. That's the analyst — it can answer questions across every deal in the library.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Intelligence Library</B> stats: OMs Read = how many offering memoranda the AI has processed. Tenant Brands = unique brands across the library (Target counts once even if it shows up at five centers). SF Analyzed = total gross leasable area.</>,
        <><B>Owned Portfolio</B> only counts deals tagged Owned. If a deal is missing here that you'd expect, check its status flag on the deal page.</>,
        <><B>Deal statuses</B> flow Prospect → Under Contract → Owned → Sold (or Passed). Status drives where the deal shows up on the home page.</>,
      ]} />
    ),
  },
  {
    id: 2,
    title: "Ask the analyst",
    brief: (
      <>
        <p style={{ margin:0 }}>Type a question in the bar at the bottom. It reads the whole deal library — tenants, rents, expirations, demographics, financials — so you can ask things you'd otherwise have to dig for. Follow-up questions work; it remembers the conversation.</p>
        <div style={{ marginTop:10, background:"#eef3e6", border:"1px solid #b8d49a", borderRadius:8, padding:12 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#3f7a1f", letterSpacing:"0.1em", marginBottom:8, fontFamily:"'Inter',sans-serif" }}>TRY ASKING…</div>
          <div style={{ display:"flex", flexDirection:"column", gap:5, fontSize:13, color:"#383a37" }}>
            <span>— Which deals have a grocery anchor?</span>
            <span>— Compare the Marshalls at University Hills vs Vestavia.</span>
            <span>— What leases roll in the next 24 months across the owned portfolio?</span>
            <span>— Which prospect has the highest going-in cap rate?</span>
          </div>
        </div>
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Be specific.</B> "WALT for our owned grocery-anchored centers" gets a real answer; "Tell me about the portfolio" gets a vague one.</>,
        <><B>Ask for tables and ranked lists</B> — the analyst will format them. Try "Rank our prospects by cap rate" or "Top 10 tenants by total rent across the portfolio."</>,
        <><B>Comparisons are a strong use case.</B> "Compare Vestavia and Pointe Plaza on tenant mix and occupancy" works well.</>,
        <><B>It only knows what's been uploaded.</B> If you ask about a property that isn't in the library, it won't know — upload the OM first.</>,
        <><B>If the numbers look off,</B> open the source deal — the rent roll might be stale and need a refresh.</>,
      ]} />
    ),
  },
  {
    id: 3,
    title: "Open a deal",
    brief: (
      <>
        <p style={{ margin:0 }}>Clicking a card takes you to the deal page. The tags, title, and address sit right under the button row, with the cover photo below. Scroll for the tenant roster, key assumptions, demographics, and (for owned deals) the full acquisition and financing record.</p>
        <BriefList items={[
          <><B>Tenant roster</B> is the live rent roll — square footage, rent, lease dates, NNN flags. The <em>as of</em> date is shown at the top.</>,
          <><B>Key Assumptions</B> shows the top 5 from the OM with a "Show more" toggle for the rest.</>,
          <><B>Cover photo / site plan</B> can be re-picked from any page of the OM if the auto-pick missed.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Tenant roster columns:</B> base rent (not gross), rent/SF, lease commencement and expiration, remaining term keyed to the as-of date, and an anchor flag for tenants ≥ 10,000 SF or branded as such.</>,
        <><B>Vacant suites</B> show up as "Vacant" rows with their square footage — they keep occupancy math honest.</>,
        <><B>The "as of" date</B> at the top tells you how stale the data is. If it's months old, refresh the roster (see Section 5).</>,
        <><B>For owned deals,</B> you'll also see Deal Terms (purchase price, going-in cap, closing date, seller, broker) and Financing (lender, loan amount, rate, maturity). Click the edit pencil to update any field.</>,
        <><B>Cover photo wrong?</B> Use "Set cover from page #" to pick a different page from the OM. Same for the site plan.</>,
      ]} />
    ),
  },
  {
    id: 4,
    title: "Refresh or add deals (admin)",
    brief: (
      <>
        <p style={{ margin:0 }}>These actions cost API tokens, so they're behind a separate <B>upload password</B> (different from your sign-in). The site asks for it the first time you use one in a browser session.</p>
        <BriefList items={[
          <><B>Upload OMs</B> — drop one or more PDFs on the home page. The extractor reads the whole document and creates the deal.</>,
          <><B>Refresh a rent roll (PDF)</B> — on the deal page, upload a new rent roll and the roster updates automatically.</>,
          <><B>Refresh a rent roll (free)</B> — same deal page, the "Paste roster from Claude" toggle on the roster panel. Send the rent roll in a Claude chat, paste the JSON it gives back. No tokens.</>,
          <><B>Backup</B> the database from the header before any big change. Costs nothing, saves you if something goes sideways.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Why the upload password exists:</B> OM extraction and rent-roll AI refresh hit the Anthropic API and cost real money per run. Keeping that password tight means everyone can browse the library and chat with the analyst freely, but only a couple of people can spend.</>,
        <><B>OM upload flow:</B> drop a PDF on the home page, the extractor runs for 1–3 minutes, the deal appears with cover photo and site plan auto-picked. If data looks wrong, use "Re-run extraction" on the deal page rather than re-uploading.</>,
        <><B>The free rent-roll path in detail:</B> open Claude (the regular chat app, not the API) and send the rent roll PDF. Ask for it in the site's roster schema — Claude returns a JSON block. Copy it, open the "Paste roster from Claude" toggle, paste, and click Apply. Same result as the PDF refresh, zero tokens spent.</>,
        <><B>Backup vs Restore:</B> Backup downloads a full JSON snapshot. Restore <em>merges</em> deals back in by ID — it does NOT wipe what's there. Do a Backup before any big import or batch edit.</>,
      ]} />
    ),
  },
];

function PanelContent({ expanded, toggle, onClose }: {
  expanded: Set<number>;
  toggle: (id: number) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
        <div>
          <div id="help-modal-title" style={{ fontSize:21, fontWeight:700, color:"#2a2c28", fontFamily:"'Fraunces',Georgia,serif", lineHeight:1.2 }}>A quick tour</div>
          <div style={{ fontSize:13, color:"#6f6a5f", marginTop:5 }}>Skim the briefs to get going. Click any section for more detail when you want it.</div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close help"
          style={{ background:"transparent", border:"none", cursor:"pointer", color:"#a89f8f", fontSize:18, lineHeight:1, padding:"2px 4px", marginTop:2, borderRadius:4 }}
        >✕</button>
      </div>

      <div style={{ display:"flex", flexDirection:"column", gap:8 }}>
        {SECTIONS.map(section => {
          const isOpen = expanded.has(section.id);
          return (
            <div key={section.id} style={{ border:"1px solid #e3dccd", borderRadius:10, overflow:"hidden", background:"#fff" }}>
              <button
                type="button"
                onClick={() => toggle(section.id)}
                aria-expanded={isOpen}
                aria-controls={`help-detail-${section.id}`}
                style={{ display:"flex", alignItems:"center", gap:11, width:"100%", background:"#faf7f0", border:"none", cursor:"pointer", padding:"11px 14px", minHeight:48, textAlign:"left", fontFamily:"'Inter',-apple-system,sans-serif" }}
              >
                <Chip n={section.id} />
                <span style={{ flex:1, fontWeight:700, color:"#3f7a1f", fontSize:14 }}>{section.title}</span>
                <Chevron up={isOpen} />
              </button>

              <div style={{ padding:"12px 14px 12px 51px", fontSize:13, color:"#383a37", lineHeight:1.65 }}>
                {section.brief}
              </div>

              {isOpen && (
                <div
                  id={`help-detail-${section.id}`}
                  style={{ padding:"10px 14px 14px 51px", fontSize:13, color:"#383a37", lineHeight:1.65, borderTop:"1px solid #f0e9db", background:"#fcfbf8" }}
                >
                  {section.detail}
                </div>
              )}
            </div>
          );
        })}
      </div>

      <div style={{ marginTop:18, paddingTop:14, borderTop:"1px solid #e3dccd", fontSize:11, color:"#a89f8f", textAlign:"center", lineHeight:1.6 }}>
        Something broken or confusing? Send a screenshot — fixes are quick.&nbsp;&nbsp;·&nbsp;&nbsp;KPR Deal Library&nbsp;&nbsp;·&nbsp;&nbsp;v1
      </div>

      <div style={{ marginTop:12, textAlign:"center" }}>
        <button
          type="button"
          onClick={onClose}
          style={{ background:"#f6f2ea", border:"1px solid #ddd4c2", color:"#52554e", padding:"8px 24px", borderRadius:8, cursor:"pointer", fontSize:13, fontWeight:600, fontFamily:"'Inter',sans-serif" }}
        >
          Close
        </button>
      </div>
    </>
  );
}

export default function HelpModal({ open, onClose }: HelpModalProps) {
  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [isDesktop, setIsDesktop] = useState(() => window.matchMedia("(min-width: 1024px)").matches);
  const [panelIn, setPanelIn] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1024px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (open) setExpanded(new Set());
  }, [open]);

  useEffect(() => {
    if (open && isDesktop) {
      const id = setTimeout(() => setPanelIn(true), 10);
      return () => clearTimeout(id);
    }
    setPanelIn(false);
    return undefined;
  }, [open, isDesktop]);

  useEffect(() => {
    if (!open) return undefined;
    const handler = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  const toggle = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  if (!open) return null;

  if (isDesktop) {
    return (
      <div
        role="dialog"
        aria-labelledby="help-modal-title"
        style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: 420,
          zIndex: 1001, background: "#fff",
          borderLeft: "1px solid #d8d2c1",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.06)",
          overflowY: "auto", padding: "26px 26px 22px",
          fontFamily: "'Inter',-apple-system,sans-serif",
          transform: panelIn ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.2s ease",
        }}
      >
        <PanelContent expanded={expanded} toggle={toggle} onClose={onClose} />
      </div>
    );
  }

  return (
    <>
      <div
        onClick={onClose}
        style={{ position:"fixed", inset:0, background:"rgba(42,44,40,0.52)", zIndex:1000, backdropFilter:"blur(2px)" }}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="help-modal-title"
        style={{ position:"fixed", top:"50%", left:"50%", transform:"translate(-50%,-50%)", zIndex:1001, width:"min(680px, calc(100vw - 32px))", maxHeight:"85vh", overflowY:"auto", background:"#fff", borderRadius:14, boxShadow:"0 20px 60px rgba(42,44,40,0.22)", padding:"26px 26px 22px", fontFamily:"'Inter',-apple-system,sans-serif" }}
      >
        <PanelContent expanded={expanded} toggle={toggle} onClose={onClose} />
      </div>
    </>
  );
}
