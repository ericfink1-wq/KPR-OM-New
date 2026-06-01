import { useEffect, useState } from "react";

// Where a tutorial section can jump you. App maps this to the right tab/subview.
export type HelpDest = "portfolio" | "analytics" | "analytics-watchlist" | "comps" | "analyst";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate?: (dest: HelpDest) => void;
}

function ExpandToggle({ open }: { open: boolean }) {
  return (
    <span style={{ display:"inline-flex", alignItems:"center", gap:5, flexShrink:0, background: open ? "#eef3e6" : "#3f7a1f", color: open ? "#3f7a1f" : "#fff", border: open ? "1px solid #b8d49a" : "1px solid #3f7a1f", borderRadius:6, padding:"4px 10px", fontSize:11.5, fontWeight:700, fontFamily:"'Inter',sans-serif", letterSpacing:"0.01em" }}>
      {open ? "Collapse" : "Expand"}
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" aria-hidden="true" style={{ transform: open ? "rotate(180deg)" : "rotate(0deg)", transition:"transform 0.2s ease" }}>
        <path d="M4 6l4 4 4-4" stroke={open ? "#3f7a1f" : "#fff"} strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round"/>
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

function TryAsking({ items }: { items: string[] }) {
  return (
    <div style={{ marginTop:10, background:"#eef3e6", border:"1px solid #b8d49a", borderRadius:8, padding:12 }}>
      <div style={{ fontSize:10, fontWeight:700, color:"#3f7a1f", letterSpacing:"0.1em", marginBottom:8, fontFamily:"'Inter',sans-serif" }}>TRY ASKING…</div>
      <div style={{ display:"flex", flexDirection:"column", gap:5, fontSize:13, color:"#383a37" }}>
        {items.map((q, i) => <span key={i}>— {q}</span>)}
      </div>
    </div>
  );
}

const SECTIONS: { id: number; title: string; brief: React.ReactNode; detail: React.ReactNode; goTo?: { dest: HelpDest; label: string } }[] = [
  {
    id: 1,
    title: "Uploading OMs, rent rolls & sales reports",
    goTo: { dest: "portfolio", label: "Go to Portfolio" },
    brief: (
      <>
        <p style={{ margin:0 }}>Drop in a document — <B>PDF or Excel/CSV</B> — and the AI reads it. It auto-detects the type and, for a rent roll or sales report, matches it to the right deal (asking if unsure).</p>
        <BriefList items={[
          <><B>OM</B> — click <B>Upload</B> (top-right) and pick one or more files; the AI fills in tenants, financials, lease terms, demographics, and the cover. ~1–3 min each, processed in parallel.</>,
          <><B>Rent roll</B> — drop it in (auto-matches) or use a deal's <B>"⬆ Refresh tenants"</B>; updates the roster + as-of date only, leaving financials intact.</>,
          <><B>Tenant sales report</B> — a deal's <B>Tenant Sales</B> panel → <B>"⬆ Upload Sales"</B>; auto-detects the year and tracks sales by vintage.</>,
        ]} />
        <p style={{ margin:"9px 0 0", color:"#6f6a5f" }}><B>Confirm import details:</B> if the AI was unsure about a value (or numbers don't reconcile), the deal shows a <B>"📝 N to confirm"</B> banner — confirm, dismiss, or fix it right there.</p>
        <p style={{ margin:"9px 0 0", padding:"8px 11px", background:"#fdf6e8", border:"1px solid #ecd9a8", borderRadius:7, color:"#6f5b2a", fontSize:12.5 }}>💲 <B>AI reads cost money.</B> Each PDF/Excel read uses paid tokens (a full OM is the biggest). Avoid re-uploading the same file; browsing, editing, and exporting are free.</p>
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Thin extraction?</B> Usually a scanned/low-quality PDF — try <B>Analyze → Re-run extraction</B>, or fix any value with its pencil icon.</>,
        <><B>Rent roll vs. OM:</B> a rent roll becomes your verified roster (teal "RENT ROLL" tag); a later OM re-extraction won't overwrite it. After updating it, run <B>Actions → ✨ Refresh Analysis</B> to refresh the grade/narrative.</>,
        <><B>Sales reports stack by year</B> — upload one annually to build a sales trend.</>,
        <><B>Advanced:</B> the ▾ by Upload also offers <em>Import a folder</em> and <em>Upload .json</em> (both merge by address; JSON deals auto-score).</>,
      ]} />
    ),
  },
  {
    id: 2,
    title: "Portfolio — deal library",
    goTo: { dest: "portfolio", label: "Go to Portfolio" },
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Portfolio</B> tab is your deal library, organized by status (Prospect → Under Contract → Owned → Sold, or Passed) — active deals surface first.</p>
        <BriefList items={[
          <><B>Cards</B> show anchor, SF, occupancy, WALT, NOI, cap rate, market, and a red-flag count.</>,
          <><B>Filters & search</B> — multi-select state/type/status, and a search box that matches <B>every field</B> (name, location, tenants, lender, notes, thesis, flags), not just the name.</>,
          <><B>Compare</B> — pick 2+ deals for a side-by-side: best value per metric highlighted, KPR's own economics next to the OM figures, shared tenants, an AI read, and Excel export.</>,
          <><B>Bulk actions</B> — checkboxes (on hover) to re-status or delete several at once.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Red-flag badges</B> are AI-generated during extraction (rollover concentration, below-market rent, gross leases, co-tenancy risk) — click a deal for the full list.</>,
        <><B>The nav count</B> ("Portfolio (28)") is your whole library including Prospects/Passed, not just owned.</>,
        <><B>Deleting is permanent</B> (with a confirm) — there's no Trash, though an automatic snapshot is taken before each delete for admin recovery.</>,
      ]} />
    ),
  },
  {
    id: 3,
    title: "Deal pages — everything about one property",
    goTo: { dest: "portfolio", label: "Go to Portfolio — open any deal" },
    brief: (
      <>
        <p style={{ margin:0 }}>Click any card to open its detail page (Overview → Tenants/Sales/Rollover → Highlights/Upside/Flags → Financials/Comps/Closing Costs → Thesis/Cash Flow → Demographics → Notes). <B>Jump to ▾</B> in the sticky header skips to any section.</p>
        <BriefList items={[
          <><B>Tenant roster</B> — every lease (SF, rent/SF, dates, term, options, anchor/credit flags). Click a tenant name for all its locations library-wide.</>,
          <><B>AI Highlights, Financials, Red Flags & Upside</B> — narrative, NOI/cap/occupancy/WALT, and AI-surfaced risks/opportunities.</>,
          <><B>Comp Benchmark</B> — median cap rate and price/SF vs. comparable trades, with sample size and date range; exclude or add comps and it recomputes.</>,
          <><B>Our Thesis / Assumptions</B> — type why you like the deal; <B>"Save & Re-grade"</B> folds it into the AI grade (it stays objective). Saved and shared with the team.</>,
          <><B>Trade Area demographics</B> — 1/3/5-mile population & income from US Census data.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Edit any field</B> via its pencil icon (auto-saved, logged); lock verified figures so a re-extraction won't overwrite them.</>,
        <><B>Re-run extraction</B> re-reads the OM PDF; <B>Refresh Analysis</B> regenerates the grade/narrative from the <em>current</em> roster (safe after a rent-roll paste); <B>Refresh Score</B> re-benchmarks against your portfolio. All show live progress.</>,
        <><B>Comp Benchmark</B> uses medians and tiers comps by relevance (same state/type/size within 24 months first, widening if needed); below a minimum sample it withholds a verdict rather than guess.</>,
        <><B>Closing Costs</B> estimates title/transfer/recording taxes by state (65% LTV default; entity-sale toggle) — a ballpark, confirm with title.</>,
        <><B>Cover & site plan</B> fit to screen; each has a 🗑 (with confirm). Dark-store flags are read-only (set from the data). Section titles show their source (OM vs. Census).</>,
        <><B>Owned-deal Terms & Financing</B> (purchase price, going-in cap, lender, loan terms) are editable and feed the analytics. <B>Summary</B>, <B>Excel</B>, and <B>Find Sale</B> buttons export or research the deal.</>,
      ]} />
    ),
  },
  {
    id: 4,
    title: "The Analyst — AI across your whole library",
    goTo: { dest: "analyst", label: "Go to the Analyst" },
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Analyst</B> reads your entire library and answers across tenants, rents, expirations, financials, and demographics. The <B>Analyst</B> tab is the home page; the <B>ask bar</B> at the bottom of other pages opens the answer in a side drawer; <B>"Ask about this property"</B> on a deal scopes it to that deal.</p>
        <TryAsking items={[
          "Which grocery-anchored deals have a WALT under 5 years?",
          "What leases roll in the next 18 months across our owned portfolio?",
          "How many SF of Dollar Tree do we have across all deals?",
          "Compare Somerset Square and Eagle Plaza on anchor quality and rollover.",
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Be specific</B> and ask for tables/ranked lists — cross-deal questions (rollover concentration, credit exposure, anchor performance) are where it shines.</>,
        <><B>It only knows what's uploaded</B>; if a number looks off, the underlying deal data may need a fix. <B>Shift+Enter</B> for a line break, Enter to send.</>,
      ]} />
    ),
  },
  {
    id: 5,
    title: "Analytics — portfolio-wide intelligence",
    goTo: { dest: "analytics", label: "Go to Analytics" },
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Analytics</B> tab surfaces patterns across the library — rollover timelines, tenant/parent concentration, credit mix, and market exposure.</p>
        <BriefList items={[
          <><B>Lease rollover chart</B> — GLA & rent expiring by year; click a year to drill into which tenants roll (sortable).</>,
          <><B>Tenant & Parent concentration</B> — top exposure by rent or store count; an eye-slash toggle excludes an outlier and stats recompute live.</>,
          <><B>Pinned search</B> (Tenant Analytics) — jump to any tenant or parent; tenant/parent pages show a description plus all locations.</>,
          <><B>Tenant Name Audit</B> — merge brand-name variants that aren't grouping (auto-rejects store-vs-fuel/storage pads).</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Updates live</B> as deals change — no refresh needed. All statuses are included by default.</>,
        <><B>"Score unscored deals"</B> (Portfolio Analytics) grades any deal missing a letter grade in one click.</>,
        <><B>Name Audit</B> catches "Burlington" vs "Burlington Coat Factory" etc.; mark pairs Correct (merge) or keep separate — choices persist.</>,
      ]} />
    ),
  },
  {
    id: 6,
    title: "Comps — your sale-comp database & benchmarking",
    goTo: { dest: "comps", label: "Go to Comps" },
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Comps</B> tab is a dedicated database of SALE comps, separate from your deals. Each is source-tagged: <B>OWNED</B> (your verified trades, strongest) &gt; <B>MANUAL</B>/<B>UPLOAD</B> &gt; <B>OM</B> (seller-selected, weakest).</p>
        <BriefList items={[
          <>Add comps by hand, or <B>Import file</B> from <B>JSON, Excel/CSV, or a PDF comps sheet</B> (AI maps the rows). Edit, delete, or export to Excel.</>,
          <>Filter by a <B>multi-select State</B>, market, sale date, and cap rate; the table is sortable and searchable, with duplicate trades flagged.</>,
          <>Only deals you actually <B>own or have sold</B> become your OWNED comps — one merely under contract won't.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <>The deal-page Comp Benchmark weights <B>OWNED &gt; MANUAL &gt; OM</B>. JSON imports instantly; Excel/PDF are AI-read and shown for review (small token cost) before adding — tagged UPLOAD and fully editable.</>,
        <>Use Excel export to share a comp set or build a pricing model outside the app.</>,
      ]} />
    ),
  },
  {
    id: 7,
    title: "Tips, shortcuts & things worth knowing",
    brief: (
      <>
        <BriefList items={[
          <><B>Tenant names are clickable</B> everywhere → cross-portfolio summary.</>,
          <><B>Back button</B> (on-page and browser/phone) steps back through the app, not off the site.</>,
          <><B>Verified fields</B> — lock a confirmed figure against future re-extractions.</>,
          <><B>Feedback button</B> (life-ring, bottom-left) goes straight to the team.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>What costs AI tokens:</B> uploading OMs / rent rolls / sales files, importing comps from Excel or PDF, re-running extraction, and asking the Analyst (incl. Refresh Analysis, Find Comps, Find Sale). <B>Free:</B> browsing, editing, sorting/searching, all Analytics & Comp Benchmark, Closing Costs, demographics Re-Pull (Census, not AI), Refresh Score, and JSON/Excel exports. Bottom line: uploading documents and talking to the Analyst are where the cost is.</>,
        <><B>Occupancy cost (health ratio)</B> is always the TOTAL: (base rent + reimbursements + percentage rent + other rent) ÷ gross sales — never base rent alone. Uses the stated total when given, else computes from disclosed components.</>,
        <><B>Upload on the live site, not the Replit preview</B> — they have separate databases.</>,
        <><B>If the site feels slow</B> right after a big import, give it ~30 seconds for background indexing to catch up.</>,
      ]} />
    ),
  },
];

function PanelContent({ expanded, toggle, onClose, onNavigate, isDesktop }: {
  onNavigate?: (dest: HelpDest) => void;
  isDesktop?: boolean;
  expanded: Set<number>;
  toggle: (id: number) => void;
  onClose: () => void;
}) {
  return (
    <>
      <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:18 }}>
        <div>
          <div id="help-modal-title" style={{ fontSize:21, fontWeight:700, color:"#2a2c28", fontFamily:"'Fraunces',Georgia,serif", lineHeight:1.2 }}>KPR Deal Library — how to use it</div>
          <div style={{ fontSize:13, color:"#6f6a5f", marginTop:5 }}>Read the briefs to get going. Expand any section for the full detail.</div>
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
              {/* Header row: title toggles open/close; the "Go to" action sits on the right. */}
              <div style={{ display:"flex", alignItems:"center", gap:11, background:"#faf7f0", padding:"11px 14px", minHeight:48 }}>
                <button
                  type="button"
                  onClick={() => toggle(section.id)}
                  aria-expanded={isOpen}
                  aria-controls={`help-detail-${section.id}`}
                  style={{ display:"flex", alignItems:"center", gap:11, flex:1, minWidth:0, background:"transparent", border:"none", cursor:"pointer", padding:0, textAlign:"left", fontFamily:"'Inter',-apple-system,sans-serif" }}
                >
                  <Chip n={section.id} />
                  <span style={{ flex:1, fontWeight:700, color:"#3f7a1f", fontSize:14 }}>{section.title}</span>
                </button>
                {section.goTo && onNavigate && (
                  <button
                    type="button"
                    onClick={() => { onNavigate(section.goTo!.dest); if (!isDesktop) onClose(); }}
                    style={{ flexShrink:0, display:"inline-flex", alignItems:"center", gap:6, background:"#3f7a1f", border:"none", color:"#fff", padding:"7px 14px", borderRadius:8, cursor:"pointer", fontSize:12.5, fontWeight:600, fontFamily:"'Inter',sans-serif" }}
                  >
                    {section.goTo.label} <span style={{ fontSize:13, lineHeight:1 }}>→</span>
                  </button>
                )}
              </div>

              {/* Brief + the Expand/Collapse toggle moved down here. */}
              <div style={{ padding:"12px 14px 12px 51px", fontSize:13, color:"#383a37", lineHeight:1.65 }}>
                {section.brief}
                <button
                  type="button"
                  onClick={() => toggle(section.id)}
                  aria-expanded={isOpen}
                  aria-controls={`help-detail-${section.id}`}
                  style={{ marginTop:12, display:"inline-flex", background:"transparent", border:"none", padding:0, cursor:"pointer" }}
                >
                  <ExpandToggle open={isOpen} />
                </button>
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
        Questions or something broken? Use the feedback button (bottom-left life-ring) — it goes straight to the team.&nbsp;&nbsp;·&nbsp;&nbsp;KPR Deal Library
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

export default function HelpModal({ open, onClose, onNavigate }: HelpModalProps) {
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
          position: "fixed", top: 0, right: 0, bottom: 0, width: "clamp(420px, 33vw, 680px)",
          zIndex: 1001, background: "#fff",
          borderLeft: "1px solid #d8d2c1",
          boxShadow: "-4px 0 24px rgba(0,0,0,0.06)",
          overflowY: "auto", padding: "26px 26px 22px",
          fontFamily: "'Inter',-apple-system,sans-serif",
          transform: panelIn ? "translateX(0)" : "translateX(100%)",
          transition: "transform 0.2s ease",
        }}
      >
        <PanelContent expanded={expanded} toggle={toggle} onClose={onClose} onNavigate={onNavigate} isDesktop={true} />
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
        <PanelContent expanded={expanded} toggle={toggle} onClose={onClose} onNavigate={onNavigate} isDesktop={false} />
      </div>
    </>
  );
}
