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
    title: "Uploading OMs",
    brief: (
      <>
        <p style={{ margin:0 }}>Click <B>Upload OMs</B> in the top-right to add deals. Three paths:</p>
        <BriefList items={[
          <><B>Upload files…</B> — pick one or more PDFs. The AI reads the full document and extracts tenants, financials, demographics, and cover images automatically (1–3 min per deal).</>,
          <><B>Import a folder…</B> — scan a whole directory of OMs at once.</>,
          <><B>Upload .json deal(s)</B> — import pre-extracted deals (e.g. from a Claude chat). No API tokens used.</>,
        ]} />
        <p style={{ margin:"9px 0 0", color:"#6f6a5f" }}>A separate <B>upload password</B> (different from your sign-in) is required the first time you upload in a browser session — this limits API spend.</p>
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>OM extraction flow:</B> drop PDFs, the queue shows progress per file. Cover photo and site plan are auto-selected from the PDF. If something looks off after extraction, use "Re-run extraction" on the deal page rather than re-uploading.</>,
        <><B>Folder import</B> scans all PDFs in the chosen directory and queues them together — useful for batch-adding a tranche of new deals.</>,
        <><B>JSON upload</B> is the zero-token path: open Claude, send it a rent roll or OM, ask for it in the app's schema, paste the JSON response and upload. Same result as full extraction, no API cost.</>,
        <><B>Refresh a rent roll:</B> on any deal page, the roster panel has an "Upload new rent roll" option that re-runs just the tenant extraction — updates the roster without touching financials or other deal data.</>,
        <><B>Re-run extraction</B> on the deal page re-reads the whole OM. Use this if the deal data looks incomplete or wrong after the first upload.</>,
      ]} />
    ),
  },
  {
    id: 2,
    title: "Portfolio — deal library & deal pages",
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Portfolio</B> tab is your deal library. Cards are sorted by status: Under Contract first, then Pipeline prospects. Click any card to open its detail page.</p>
        <BriefList items={[
          <><B>Statuses</B> flow Prospect → Under Contract → Owned → Sold (or Passed). Set status on the deal page; it controls how cards are grouped.</>,
          <><B>Deal detail page</B> — tenant roster (SF, rent, dates, anchor / IG flags), financials, trade-area demographics, closing cost estimator, red flags, and for owned deals: acquisition terms and financing.</>,
          <><B>Jump to ▾</B> in the sticky header skips to any section on a long deal page.</>,
          <><B>Tenant names are clickable</B> — tap one to see every location of that tenant across the library (total SF, blended rent, center list).</>,
          <><B>Compare</B> up to four deals side-by-side from the Portfolio list.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Roster columns:</B> base rent (not gross), rent/SF, lease commencement and expiration, remaining term keyed to the rent-roll as-of date, and an anchor flag for tenants ≥ 10,000 SF. Vacant suites show as "Vacant" rows so occupancy math stays honest.</>,
        <><B>Trade Area demographics</B> pull from the US Census ACS 5-Year estimates (1 / 3 / 5-mile rings). They auto-populate when a deal is created; hit <B>Re-Pull</B> on the deal page to refresh.</>,
        <><B>Closing Costs</B> estimates title, transfer, and mortgage-recording taxes by state with buyer/seller splits. Defaults to 65% LTV; an entity-sale toggle adds controlling-interest taxes where applicable. Treat as a ballpark — confirm with the title company for live deals.</>,
        <><B>Red Flags</B> surface deal risks automatically, including a flag when meaningful GLA sits on gross or fixed-CAM leases (landlord absorbs expense inflation).</>,
        <><B>Cover photo or site plan wrong?</B> Use "Set cover from page #" on the deal page to pick a different page from the PDF.</>,
        <><B>For owned deals,</B> Deal Terms (purchase price, going-in cap, seller, close date) and Financing (lender, loan, rate, maturity) are editable — click the pencil icon on any field.</>,
        <><B>Trash:</B> moving a deal to Trash hides it from the library but doesn't delete it. Restore it from the Trash section at the bottom of the Portfolio list.</>,
      ]} />
    ),
  },
  {
    id: 3,
    title: "The Analyst — ask anything, anywhere",
    brief: (
      <>
        <p style={{ margin:0 }}>The analyst reads your entire deal library and answers questions across tenants, rents, expirations, financials, and demographics. Three ways to reach it:</p>
        <BriefList items={[
          <><B>Ask bar at the bottom</B> — visible on Portfolio, Analytics, and Comps pages. Type and hit Enter; your question opens the Analyst tab with an answer.</>,
          <><B>Analyst tab</B> — the full chat view with conversation history. Follow-ups work; it remembers the thread.</>,
          <><B>Ask about this property</B> — on any individual deal page, this button sends the question pre-scoped to that deal.</>,
        ]} />
        <div style={{ marginTop:10, background:"#eef3e6", border:"1px solid #b8d49a", borderRadius:8, padding:12 }}>
          <div style={{ fontSize:10, fontWeight:700, color:"#3f7a1f", letterSpacing:"0.1em", marginBottom:8, fontFamily:"'Inter',sans-serif" }}>TRY ASKING…</div>
          <div style={{ display:"flex", flexDirection:"column", gap:5, fontSize:13, color:"#383a37" }}>
            <span>— Which deals have a grocery anchor?</span>
            <span>— What leases roll in the next 24 months across the owned portfolio?</span>
            <span>— Compare Vestavia and University Hills on tenant mix and occupancy.</span>
            <span>— Rank our prospects by going-in cap rate.</span>
          </div>
        </div>
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Be specific.</B> "WALT for owned grocery-anchored centers" gets a real answer; "Tell me about the portfolio" gets a vague one.</>,
        <><B>Ask for tables and ranked lists</B> — the analyst formats them. "Top 10 tenants by total rent across the portfolio" works well.</>,
        <><B>It only knows what's been uploaded.</B> If you ask about a property not in the library, it won't know — upload the OM first.</>,
        <><B>If numbers look off,</B> check the deal page — the rent roll may be stale. Re-run extraction or upload a fresh rent roll to refresh.</>,
        <><B>Shift+Enter</B> inserts a line break without sending. Enter alone sends.</>,
      ]} />
    ),
  },
  {
    id: 4,
    title: "Analytics & Tenant Name Audit",
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Analytics</B> tab surfaces portfolio-wide patterns — tenant concentration, lease rollover, occupancy trends, and market exposure across all deals.</p>
        <BriefList items={[
          <><B>Tenant Name Audit</B> — flags tenant names that may be the same brand but aren't grouping together (e.g. "Burlington" vs "Burlington Coat Factory"). Open it from the Analytics tab.</>,
          <><B>Possible splits</B> are pairs the system thinks might be duplicates. Some are false alarms — eyeball them.</>,
          <><B>Correct (merge)</B> — confirms they're the same tenant; the system will group them going forward.</>,
          <><B>Incorrect (keep separate)</B> — confirms they're actually different tenants; suppresses the flag.</>,
          <><B>Vacancies are automatically ignored</B> in the audit — only named tenants are evaluated.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>How name grouping works:</B> common variants collapse automatically — "T-Mobile", "T Mobile", "TMobile" become one tenant, as do store-code suffixes (#1234) and format words ("Factory", "Outlet"). The audit catches what didn't collapse automatically.</>,
        <><B>Possible-split false alarms</B> are common when two different brands share a first word (e.g. "Great Clips" vs "Great Greek"). Use <em>Incorrect</em> to suppress those pairs permanently.</>,
        <><B>Merging via Correct</B> trains the grouping for future uploads — it doesn't rename tenants in the database, it records a canonical pairing.</>,
        <><B>Tenant cross-deal view:</B> from any rent roll, click a tenant name to see all their locations — total SF, blended rent/SF, and which centers they occupy. Good for gauging credit concentration.</>,
      ]} />
    ),
  },
  {
    id: 5,
    title: "Comps search",
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Comps</B> tab lets you search and filter across every deal in the library to build a quick comp set — by market, asset type, cap rate, occupancy, SF, WALT, or any combination.</p>
        <BriefList items={[
          <>Filter results by market, asset type, and key financial metrics.</>,
          <>Click any result to open the full deal page for that property.</>,
          <>Use it to benchmark a live deal against similar properties already in the library.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Comp set building:</B> filters stack — you can narrow by market AND cap rate AND WALT simultaneously to find truly comparable deals.</>,
        <><B>All deals in the library are searchable</B>, including Prospects and Passed deals, so historical comps are available even if you didn't pursue the deal.</>,
      ]} />
    ),
  },
  {
    id: 6,
    title: "Send Feedback (support button)",
    brief: (
      <>
        <p style={{ margin:0 }}>The small <B>life-ring button</B> in the bottom-left corner opens a feedback form. Use it to report bugs, request features, or flag anything that looks wrong.</p>
        <BriefList items={[
          <>Choose a type — Bug, Idea, or Other — and describe what you saw.</>,
          <>Your name is optional but helps with follow-up.</>,
          <>Submissions go directly to the team. You don't need to email separately.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Screenshots help</B> — if you're reporting a display bug, describe which page and what you expected to see vs. what appeared.</>,
        <><B>All submissions are logged</B> and visible to the team in the admin inbox. They're marked resolved once addressed.</>,
      ]} />
    ),
  },
  {
    id: 7,
    title: "Backups & data safety (admin)",
    brief: (
      <>
        <p style={{ margin:0 }}>These features are available to the <B>app owner</B> via admin mode. Regular users can browse, search, and chat freely without them.</p>
        <BriefList items={[
          <><B>Automatic snapshots</B> — the app saves a snapshot of the database automatically before imports, deletes, and restores. No action required.</>,
          <><B>Full backup (.json)</B> — downloads all deals, sources, and images as a single file. Do this before any large import or batch change.</>,
          <><B>Export spreadsheet (.csv)</B> — exports key fields for Excel or Sheets.</>,
          <><B>Restore a snapshot…</B> — rolls the database back to any recent auto-save. Restore merges by deal ID — it does not wipe deals that exist in the current database.</>,
          <><B>Restore from backup (.json)</B> — re-imports a previously downloaded backup file. Same merge-by-ID behavior.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Snapshots are automatic</B> — you don't need to trigger them. Up to 30 are kept; oldest are pruned. Auto-snapshots run at most once every 12 hours; "before-delete" and "before-restore" snapshots run on demand.</>,
        <><B>Restore is non-destructive:</B> it merges snapshot deals into the live database by ID. Deals in the live database that aren't in the snapshot are left untouched — nothing is wiped.</>,
        <><B>Full backup</B> includes deal data, source text (the raw OM text), and images. Keep a local copy somewhere safe if you're about to make sweeping changes.</>,
        <><B>Admin mode</B> also controls permanent deal deletion (via the Trash section in Portfolio) and access to the feedback inbox. Contact the app owner if you need admin access.</>,
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
