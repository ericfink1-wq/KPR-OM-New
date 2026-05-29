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

const SECTIONS: { id: number; title: string; brief: React.ReactNode; detail: React.ReactNode }[] = [
  {
    id: 1,
    title: "Uploading OMs & deals",
    brief: (
      <>
        <p style={{ margin:0 }}>Click <B>Upload OMs</B> in the top-right to add deals. Three paths:</p>
        <BriefList items={[
          <><B>Upload PDF(s)</B> — the AI reads the full document and extracts tenants, financials, lease data, demographics, and cover images automatically. Takes 1–3 min per deal.</>,
          <><B>Import a folder</B> — scan a whole directory of OMs and queue them all at once. Good for bulk onboarding.</>,
          <><B>Upload JSON</B> — import a pre-extracted deal file directly. No AI tokens used. This is how Claude-extracted deals get loaded in.</>,
        ]} />
        <p style={{ margin:"9px 0 0", color:"#6f6a5f" }}>An <B>upload password</B> is required the first time you upload in each browser session — this limits API spend to authorized users.</p>
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>After upload:</B> the deal lands in your Portfolio as a Prospect. A green "Fresh" badge means it was just extracted. Check the tenant roster and financials — if anything looks off, use <B>Analyze → Re-run extraction</B> on the deal page before editing manually.</>,
        <><B>Partial or thin extraction?</B> This happens when the PDF is low-quality, scanned, or missing key pages. Try "Re-run extraction" first. If it still looks sparse, you can fill in fields manually by clicking the pencil icon on any field, or upload a JSON with corrected data — it merges by address.</>,
        <><B>JSON upload</B> is the zero-token path: send Claude an OM or rent roll PDF, ask it to extract in the app's schema, download the .json, and upload here. Identical result to full AI extraction, no API cost. The JSON always merges by address — uploading an updated file overwrites the existing deal, it doesn't create a duplicate.</>,
        <><B>Updating a rent roll only:</B> on any deal page, the tenant roster panel has an "Upload new rent roll" option. This re-runs just the tenant extraction — updates leases without touching financials or other deal-level data.</>,
        <><B>Cover photo wrong?</B> Use "Set cover from page #" to pick any page from the PDF, with left/right/full spread options.</>,
      ]} />
    ),
  },
  {
    id: 2,
    title: "Portfolio — deal library",
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Portfolio</B> tab is your deal library. Every OM you've uploaded lives here, organized by status.</p>
        <BriefList items={[
          <><B>Status flow:</B> Prospect → Under Contract → Owned → Sold (or Passed). Set status on the deal page. Cards sort by status — active deals surface first.</>,
          <><B>Deal cards</B> show key metrics at a glance: anchor, SF, occupancy, WALT, NOI, cap rate, and market. Red flags show as a badge count.</>,
          <><B>Filters & search</B> — filter the library by market, asset type, status, or anchor tenant. Search by property name.</>,
          <><B>Compare</B> — select up to 4 deals from the list and hit Compare for a side-by-side view across all key metrics.</>,
          <><B>Analytics bar</B> at the bottom of the Portfolio page — type any question about your library and hit Enter to get an instant AI answer.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Deal status controls grouping:</B> Owned deals show first, then Under Contract, then Prospects. Passed and Sold deals are collapsed at the bottom but still searchable and usable as comps.</>,
        <><B>Red flag badges</B> on cards are generated by the AI during extraction — lease rollover concentration, below-market rents, gross leases, anchor co-tenancy risks. Click the deal to see the full list.</>,
        <><B>Bulk operations:</B> select multiple deals with the checkboxes that appear on hover to move them to a different status or delete them together.</>,
        <><B>Compare view</B> puts up to 4 deals side-by-side on every metric — anchor, WALT, occupancy, rent PSF, NOI, demographics, lease rollover schedule, and tenant mix. Good for investment committee prep.</>,
        <><B>The portfolio count</B> in the nav (e.g. "Portfolio (28)") is your total deal count including Prospects and Passed deals — it's your full library, not just owned assets.</>,
      ]} />
    ),
  },
  {
    id: 3,
    title: "Deal pages — everything about one property",
    brief: (
      <>
        <p style={{ margin:0 }}>Click any deal card to open its detail page. This is the full picture for a single property.</p>
        <BriefList items={[
          <><B>Tenant roster</B> — every lease with SF, rent/SF, commencement, expiration, remaining term, options, lease type, and anchor/credit flags. Click any tenant name to see all their locations across the library.</>,
          <><B>AI Investment Highlights</B> — institutional-grade narrative covering the asset, anchor quality, inline mix, key metrics, investment thesis, and top risk. Generated from the OM.</>,
          <><B>Financials</B> — NOI, cap rate, occupancy, WALT, and cash flow summary from the OM proforma.</>,
          <><B>Trade Area demographics</B> — 1/3/5-mile population, households, and average household income from US Census data.</>,
          <><B>Red Flags & Upside Items</B> — AI-surfaced risks and value-creation opportunities specific to this deal.</>,
          <><B>Jump to ▾</B> in the sticky header navigates instantly to any section on the page.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Tenant roster columns:</B> base rent (not gross), rent/SF, lease dates, remaining term in years, anchor flag (≥10,000 SF), and investment-grade credit flag. Vacant suites appear as "Vacant" rows so occupancy math is honest.</>,
        <><B>Clicking a tenant name</B> opens a cross-portfolio summary for that brand — total SF across all deals, blended rent/SF, and which properties they occupy. Great for credit concentration analysis.</>,
        <><B>Editing any field:</B> click the pencil icon on any field to edit it directly. Changes save automatically and are logged in the deal's edit history. Figures you've verified can be locked to prevent them being overwritten by a future re-extraction.</>,
        <><B>Re-run extraction (Analyze menu):</B> re-reads the original OM PDF and refreshes all extracted fields. Use this if the initial extraction missed something or the data looks stale.</>,
        <><B>Score button</B> runs the AI deal scoring model — grades the deal on anchor quality, lease structure, demographics, and market, and returns a letter grade with explanation.</>,
        <><B>Summary button</B> generates a one-page investment summary you can copy or share.</>,
        <><B>Excel button</B> exports the deal's full rent roll and financials as a spreadsheet.</>,
        <><B>Find Sale button</B> searches public records and market sources for comparable sales.</>,
        <><B>Closing Costs estimator</B> calculates title, transfer, and mortgage-recording taxes by state with buyer/seller splits. Defaults to 65% LTV; an entity-sale toggle adds controlling-interest taxes. Treat as a ballpark — confirm with your title company.</>,
        <><B>Deal Terms & Financing (owned deals):</B> purchase price, going-in cap, seller, close date, lender, loan amount, rate, and maturity — all editable. These feed the portfolio analytics.</>,
        <><B>Trash:</B> moves the deal out of the library but doesn't delete it permanently. Restore from the Trash section at the bottom of Portfolio.</>,
      ]} />
    ),
  },
  {
    id: 4,
    title: "The Analyst — AI across your whole library",
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Analyst</B> reads your entire deal library and answers questions across tenants, rents, expirations, financials, and demographics. Reach it three ways:</p>
        <BriefList items={[
          <><B>Ask bar</B> — the text box at the bottom of the Portfolio, Analytics, and Comps pages. Type and hit Enter; your question opens the Analyst with an answer.</>,
          <><B>Analyst tab</B> — the full chat view with conversation history. Follow-ups work; it remembers the thread.</>,
          <><B>Ask about this property</B> — on any deal page, this scopes the question to just that deal.</>,
        ]} />
        <TryAsking items={[
          "Which grocery-anchored deals have a WALT under 5 years?",
          "What leases roll in the next 18 months across our owned portfolio?",
          "Rank our prospects by NOI per square foot.",
          "How many SF of Dollar Tree do we have across all deals?",
          "What's our total exposure to non-investment-grade tenants?",
          "Compare Somerset Square and Eagle Plaza on anchor quality and lease rollover.",
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Be specific.</B> "WALT for owned grocery-anchored centers" gets a precise answer. "Tell me about the portfolio" gets a vague summary. The more targeted the question, the more useful the answer.</>,
        <><B>Ask for tables and ranked lists</B> — the analyst formats them well. "Top 10 tenants by total rent across all deals, sorted by credit rating" works great.</>,
        <><B>Cross-deal analysis</B> is where this shines. Lease rollover concentration, tenant credit exposure, market diversification, anchor performance — questions that would take hours in a spreadsheet answer in seconds.</>,
        <><B>It only knows what's been uploaded.</B> If you ask about a property not in the library, it won't have data. Upload the OM first.</>,
        <><B>If a number looks wrong,</B> the underlying deal data may be stale or have an extraction error. Check the deal page, correct the field, and ask again.</>,
        <><B>Shift+Enter</B> inserts a line break without sending. Enter alone sends.</>,
      ]} />
    ),
  },
  {
    id: 5,
    title: "Analytics — portfolio-wide intelligence",
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Analytics</B> tab surfaces patterns across your entire deal library — tenant concentration, lease rollover timelines, occupancy trends, market exposure, and credit distribution.</p>
        <BriefList items={[
          <><B>Lease rollover chart</B> — shows how much GLA and rent expires by year across all deals. Immediately reveals rollover concentration risk.</>,
          <><B>Tenant concentration</B> — top tenants by total SF and total rent across the portfolio. See where you're over-indexed on a single brand or category.</>,
          <><B>Market & asset type breakdowns</B> — how your library splits across geographies and property types.</>,
          <><B>Credit distribution</B> — what percentage of rent comes from investment-grade vs. non-rated tenants.</>,
          <><B>Tenant Name Audit</B> — flags tenant names that may be the same brand but aren't grouping together in analytics. Fix them here.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Tenant Name Audit</B> catches cases like "Burlington" vs "Burlington Coat Factory" or "T Mobile" vs "T-Mobile." The system auto-normalizes common variants, but the audit surfaces what it missed. Mark pairs as <em>Correct (merge)</em> or <em>Incorrect (keep separate)</em> — these corrections apply going forward.</>,
        <><B>Analytics update in real time</B> as you add or update deals. There's no refresh needed — the charts always reflect the current state of the library.</>,
        <><B>All deal statuses are included</B> in analytics by default — Owned, Prospect, Passed. This gives you the full picture including historical deals you didn't pursue.</>,
      ]} />
    ),
  },
  {
    id: 6,
    title: "Comps — find comparable deals",
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Comps</B> tab lets you filter across every deal in the library to build a comp set quickly — by market, asset type, cap rate, occupancy, SF, WALT, anchor type, or any combination.</p>
        <BriefList items={[
          <>Stack filters to narrow down to truly comparable deals.</>,
          <>Results show key metrics side-by-side — SF, NOI, cap rate, occupancy, WALT, anchor.</>,
          <>Click any result to open the full deal page.</>,
          <>All deals are searchable — Owned, Prospects, and Passed deals — so historical context is always available.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Filters stack:</B> you can narrow by market AND cap rate AND WALT AND anchor type simultaneously. The result set updates as you adjust.</>,
        <><B>Passed deals are your best comps</B> — they have full OM data and represent real market datapoints even if you didn't buy them. Don't exclude them from comp searches.</>,
        <><B>Use Comps before an IC meeting</B> to quickly pull 3–5 deals with similar profiles to benchmark pricing and structure for a live deal.</>,
      ]} />
    ),
  },
  {
    id: 7,
    title: "Backups, exports & data safety",
    brief: (
      <>
        <p style={{ margin:0 }}>Your data is backed up automatically, but these manual tools give you full control. Access them from the <B>☰ menu</B> in the top-right.</p>
        <BriefList items={[
          <><B>Full backup (.json)</B> — downloads all deals, sources, and images as a single file. Do this before any large import or batch change.</>,
          <><B>Export spreadsheet (.csv)</B> — exports key fields for Excel or Google Sheets. Good for sharing a deal list or doing your own analysis.</>,
          <><B>Automatic snapshots</B> — the app auto-saves before every import, delete, or restore. Up to 30 snapshots kept; no action required.</>,
          <><B>Restore a snapshot</B> — rolls back to any recent auto-save. Merge-only — never wipes deals that exist in the current database.</>,
          <><B>Restore from backup</B> — re-imports a downloaded backup file. Same merge behavior.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Snapshots are automatic</B> — triggered before imports, deletes, and restores. You'll never lose data from a bad import. The "Restore a snapshot" option shows a timestamped list of all available saves.</>,
        <><B>Restore is always non-destructive:</B> it merges by deal ID. Deals in the live database that aren't in the snapshot are untouched. Nothing gets wiped — only missing or changed deals are restored.</>,
        <><B>Full backup includes everything:</B> deal data, the raw OM source text, and cover images. Download one before any major bulk operation.</>,
        <><B>CSV export</B> is useful for sharing deal lists with people who don't have app access, or for building custom models in Excel.</>,
        <><B>Permanent delete</B> is only available from the Trash section. Moving a deal to Trash is reversible; deleting from Trash is not.</>,
      ]} />
    ),
  },
  {
    id: 8,
    title: "Tips, shortcuts & things worth knowing",
    brief: (
      <>
        <p style={{ margin:0 }}>A few things that aren't obvious but save time:</p>
        <BriefList items={[
          <><B>Tenant names are always clickable</B> — anywhere you see a tenant name (roster, analytics, Comps), clicking it opens their cross-portfolio summary.</>,
          <><B>Back button</B> respects navigation history — going back from a tenant summary returns you to the deal page, not the portfolio list.</>,
          <><B>Jump to ▾</B> in the sticky header of any deal page skips directly to any section — saves scrolling on long OMs.</>,
          <><B>Verified fields</B> — check the box next to any figure to lock it against future re-extractions. Use this for fields you've manually confirmed are correct.</>,
          <><B>Feedback button</B> (life-ring icon, bottom-left) — report bugs or request features. Goes directly to the team, logged and tracked.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Upload on the live site, not the Replit preview.</B> The preview and live site have separate databases — anything uploaded in the preview won't appear on the live site after a publish.</>,
        <><B>Always upload full JSON files</B> when correcting deal data — never a partial patch. The app merges by address, so a full file updates all fields cleanly.</>,
        <><B>Shift+Enter</B> in the Analyst chat inserts a line break. Enter alone sends.</>,
        <><B>Occupancy cost</B> displayed on deal pages is total occupancy cost (base rent + CAM + taxes + recoveries) ÷ gross sales — not just base rent ÷ sales. If only base rent is available, the field shows as estimated.</>,
        <><B>Demographics auto-populate</B> when a deal is created from a PDF. Hit "Re-Pull" on the deal page to refresh them if the property location changed or data looks stale.</>,
        <><B>If the site feels slow</B> after a large import, give it 30 seconds — the background indexing catches up and search/analytics will snap back to speed.</>,
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
