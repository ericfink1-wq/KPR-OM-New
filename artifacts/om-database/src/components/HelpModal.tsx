import { useEffect, useState } from "react";

// Where a tutorial section can jump you. App maps this to the right tab/subview.
export type HelpDest = "portfolio" | "analytics" | "analytics-watchlist" | "comps" | "analyst";

interface HelpModalProps {
  open: boolean;
  onClose: () => void;
  onNavigate?: (dest: HelpDest) => void;
  // When true, the tutorial also shows the "Admin tools" section. Admin-only
  // features are kept OUT of the regular sections and live only in that gated
  // section, so a non-admin never sees actions they can't use.
  isAdmin?: boolean;
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

const SECTIONS: { id: number; title: string; brief: React.ReactNode; detail: React.ReactNode; goTo?: { dest: HelpDest; label: string }; admin?: boolean }[] = [
  {
    id: 1,
    title: "Uploading OMs, rent rolls & sales reports",
    goTo: { dest: "portfolio", label: "Go to Portfolio" },
    brief: (
      <>
        <p style={{ margin:0 }}>Drop in a document — <B>PDF or Excel/CSV</B> — and the AI reads it, <B>auto-detects the type</B>, and routes it to the right deal.</p>
        <p style={{ margin:"9px 0 0", padding:"8px 11px", background:"#eef7ee", border:"1px solid #cfe9c4", borderRadius:7, color:"#2f5d2a", fontSize:12.5 }}>✨ <B>Drop the whole set at once.</B> The OM + rent roll + lease-options + sales report for one property can go in together — the app sorts each file, builds one deal, and auto-refreshes the analysis.</p>
        <p style={{ margin:"9px 0 0", padding:"8px 11px", background:"#fdf6e8", border:"1px solid #ecd9a8", borderRadius:7, color:"#6f5b2a", fontSize:12.5 }}>💲 <B>AI reads cost money.</B> Each PDF/Excel read uses paid tokens (a full OM is the biggest); browsing, editing, and exporting are free.</p>
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>The file types it handles:</B> <B>OM</B> — the foundation (tenants, financials, lease terms, demographics, grade, cover; ~1–3 min on a stronger model). <B>Rent roll</B> — your authoritative roster (only adds/fills, never deletes a tenant; gets a teal "RENT ROLL" tag a later OM won't overwrite). <B>Lease options</B> — renewal-option ladders. <B>Sales report</B> — tenant sales by year, suite-matched and stacked by vintage. <B>Financing docs</B> (term sheet/loan, swap confirmation, amortization schedule) fill the Financing tab.</>,
        <><B>Confirm import details</B> — if the AI was unsure of a value (or numbers don't reconcile), the deal shows a <B>"📝 N to confirm"</B> banner. Confirm, dismiss, or fix it (type the value, or describe the change in plain English). This corrects <em>this deal only</em> — it doesn't change how future OMs are read.</>,
        <><B>Smart sorting is automatic</B> — types are detected by content/name and merged into one deal; the rent roll's fresher rents win on shared tenants, nothing gets wiped. Analysis auto-refreshes after import.</>,
        <><B>Thin extraction?</B> Usually a scanned/low-quality PDF — try <B>Analyze → ↺ Rebuild from OM</B> (or the <em>Re-run from PDF</em> link if the saved text came out garbled), or fix any value with its pencil icon. A very large OM is capped at ~5 min so it can't churn tokens; if it stops early it flags the roster for review.</>,
        <><B>Load a whole portfolio at once</B> — the ▾ by Upload offers <em>Upload .json</em>, and one JSON file can hold <B>many deals</B> (a whole portfolio in a single upload) or just one. It merges by address, so re-uploading updates the matching deals instead of duplicating them, and each deal auto-scores. A deal in the file can also carry its <B>lease abstracts</B> and <B>site agreements / REAs</B> inline (as <code>leaseAbstracts</code> and <code>siteAgreements</code> arrays) — <B>one upload loads all three</B> and routes each to the right place. <em>Import a folder</em> is also there for a folder of documents.</>,
        <><B>Some documents aren't built here</B> — a <B>raw lease/amendment</B>, an <B>REA/easement</B>, or a <B>portfolio OM</B> covering many properties. Drop a lease or REA and the uploader flags it (amber ⚠) instead of mis-reading it. The move: run it through <B>Claude Code</B> to get a JSON, then import it — a lease abstract via <B>"Upload abstracts"</B> on the deal, an REA in the deal's <B>Site Agreements</B> section, a multi-property portfolio via <B>Upload .json</B>. (A broker's ready-made lease <em>abstract</em> — PDF/Excel/Word — you <em>can</em> drop straight into "Upload abstracts.") Everyday OMs, rent rolls, sales reports and loan docs all read here as normal.</>,
      ]} />
    ),
  },
  {
    id: 2,
    title: "Portfolio — deal library",
    goTo: { dest: "portfolio", label: "Go to Portfolio" },
    brief: (
      <>
        <p style={{ margin:0 }}>The <B>Portfolio</B> tab is your deal library, organized by status (Prospect → Under Contract → Owned → Sold, or Passed) — active deals first.</p>
        <BriefList items={[
          <><B>Two views</B> (⊞/☰): a sortable <B>table</B> or visual <B>cards</B> with the cover, status, AI score, and headline NOI · cap rate · WALT.</>,
          <><B>Filters & search</B> — multi-select state/type/status, and a search box matching the columns you see plus a deal's saved aliases.</>,
          <><B>Compare</B> — pick 2+ deals for a side-by-side: best value per metric, KPR vs. OM economics, shared tenants, an AI read, and Excel export.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Bulk actions</B> — checkboxes (on hover) re-status several deals at once, find their sale records, or pull demographics.</>,
        <><B>Red-flag badges</B> are AI-generated during extraction (rollover concentration, below-market rent, gross leases, co-tenancy risk) — click a deal for the full list.</>,
        <><B>The nav count</B> ("Portfolio (28)") is your whole library including Prospects/Passed, not just owned.</>,
      ]} />
    ),
  },
  {
    id: 3,
    title: "Deal pages — everything about one property",
    goTo: { dest: "portfolio", label: "Go to Portfolio — open any deal" },
    brief: (
      <>
        <p style={{ margin:0 }}>Click any card to open its detail page, organized into tabs. By default you see four everyday tabs — <B>Summary, AI Analysis, Tenants & Sales,</B> and <B>Market & Comps</B>; a <B>"Show underwriting"</B> toggle reveals the deeper tabs (Transaction, Financing, Underwriting) when you need them.</p>
        <p style={{ margin:"9px 0 0", padding:"8px 11px", background:"#eef7ee", border:"1px solid #cfe9c4", borderRadius:7, color:"#2f5d2a", fontSize:12.5 }}>✦ <B>Start on the Summary tab</B> — a stat band of the headline metrics, AI highlights, a side-by-side <B>Upside / Key Risks</B> strip, an <B>anchor comparison</B> (rent, term & sales vs. the chain's average across your book), then key financials and your notes. A <B>◆ DATA</B> badge scores how complete this deal's data is.</p>
        <p style={{ margin:"9px 0 0", color:"#6f6a5f" }}>Expand below for what lives on each tab and how editing, re-analysis and the calculators work.</p>
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Tenants & Sales</B> — every lease (SF, rent/SF, annual rent, dates, term, steps, options, reimbursements) with <B>Anchor / Investment-Grade / NAP / dark-store / ATM</B> badges; click a tenant for all its locations. <B>Tenant Sales</B> tracks figures by year with a green ▲ / red ▼ vs. the prior year. A roster bar lets you <B>⬆ Refresh from rent roll</B> (PDF/Excel), <B>⌘ Paste roster</B> (from Claude — token-free), and export as <B>Excel</B> or a polished one-page institutional <B>Rent roll — PDF</B>.</>,
        <><B>Lease Risk (anchor dependency)</B> — on the Tenants tab, pick anchors to model "what if they go dark": the co-tenancy / kickout rent relief and termination exposure, read live from disclosed clauses and any uploaded lease abstracts (an executed abstract can flip a clause to <em>verified</em> or <em>mitigated</em>).</>,
        <><B>AI Analysis</B> — narrative, deal score, upside & red flags, plus <B>Our Thesis</B> (type why you like it; <B>"Save & Re-grade"</B> folds it in, staying objective). The grade also reads <B>trade-area demographics</B> as a location-quality lens — dense + high-income/population supports higher rents and a tighter cap (and flags rent/cap that looks aggressive for a weaker area).</>,
        <><B>Market & Comps</B> — the <B>Comp Benchmark</B> (median cap rate & price/SF vs. comparable trades, with ★ star / × drop / click-to-expand; tiered by relevance, withholds a verdict below a minimum sample) and <B>1/3/5-mile</B> Census demographics. The Summary also benchmarks this deal's <B>cap, expense ratio & rent PSF</B> against comparable deals in your own book (p25–median–p75) — informational, changes no numbers.</>,
        <><B>Financing</B> — record the loan and estimate early-payoff cost: a <B>prepayment-penalty</B> calculator (<em>exact</em> for step-down, <em>indicative</em> for yield-maintenance / defeasance) and a <B>swap-breakage</B> estimator (indicative, proxying the market swap rate from Today's Rates — replace with your bank's quote). Import a swap confirmation or enter/edit it by hand. Preferred equity has its own block.</>,
        <><B>Transaction & Underwriting</B> — the purchase / closing-cost record, plus <B>KPR's own economics & cash-flow projection</B> kept separate from the OM figures. <B>Closing Costs</B> estimates title/transfer/recording taxes by state (65% LTV default; entity-sale toggle), and the <B>Tax Reassessment forecaster</B> projects the post-sale bill step-up by state/county rules — both grounded in the real bill, saying "confirm locally" where county data is missing.</>,
        <><B>Site Agreements / REAs & lease abstracts</B> — record property-level recorded documents (OEAs, easements, use restrictions, cost-share); upload per-tenant abstracts via <B>⬆ Upload abstracts</B>, and <B>Export abstracts</B> to an Excel workbook (Issues Summary + one tab per tenant).</>,
        <><B>Edit any field</B> via its pencil icon (auto-saved, logged); lock verified figures so a re-extraction won't overwrite them. Click the address under the title to fill in street/city/state (drives Closing Costs); type a date any common way — <em>3/12/26</em> — and it standardizes.</>,
        <>In a deal's <B>Analyze</B> menu, <B>↺ Rebuild from OM</B> re-reads the saved OM and regenerates everything (won't wipe a manual roster without confirming); <B>✨ Refresh Analysis (current roster)</B> regenerates the grade/narrative from the current roster (safe after a rent-roll paste). Each asks "this uses tokens — continue?" The score re-benchmarks against your portfolio automatically.</>,
        <><B>Re-uploading never overwrites your data</B> — it recognizes the deal (even if renamed), fills only blank fields, and flags conflicting numbers (price, cap, NOI, SF, occupancy…) as a review item — keep yours or apply the OM's in one click.</>,
        <><B>Automatic data checks</B> — every extraction runs deterministic tie-outs (NOI÷cap vs price, roster SF vs GLA, occupancy, weighted-avg rent…); contradictions surface in the <B>"📝 to confirm"</B> banner, a clean run shows <B>"Data checks passed."</B> The portfolio-wide <B>Data Audit</B> re-runs them across every deal.</>,
        <><B>Cover & site plan</B> fit to screen — <B>click either for a full-screen zoom/pan viewer</B> (scroll/pinch to zoom, drag to move, double-click to reset); each has a 🗑 (with confirm). <B>📄 Deal Memo (PDF)</B> exports a one-page branded teaser; <B>Excel</B> and <B>Find Sale</B> export or research it.</>,
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
        <p style={{ margin:"9px 0 0", padding:"8px 11px", background:"#eef7ee", border:"1px solid #cfe9c4", borderRadius:7, color:"#2f5d2a", fontSize:12.5 }}>👀 <B>Needs your attention.</B> The Analyst home leads with the deals a first-pass analyst would flag — open data-check contradictions or low <B>◆ DATA</B> confidence — so you can clear the worst data gaps before relying on the numbers. Click any to jump straight in.</p>
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
        <><B>Stop anytime</B> — while a reply is generating, the send button turns into a red <B>■ Stop</B> that halts it instantly (handy if you fired off a question by accident).</>,
      ]} />
    ),
  },
  {
    id: 5,
    title: "Analytics — portfolio-wide intelligence",
    goTo: { dest: "analytics", label: "Go to Analytics" },
    brief: (
      <>
        <p style={{ margin:0 }}>Everything lives in one <B>Analytics ▾</B> menu, grouped into <B>Portfolio</B> (Overview, Lease Rollover, Critical Dates, Co-Tenancy Cascade, Data Audit, Learning) and <B>Tenants</B> (Tenant Analytics, Mark-to-Market, Retailer Watchlist, Name Audit, Link Tenants).</p>
        <BriefList items={[
          <><B>Lease Rollover & 📅 Critical Dates</B> — GLA/rent expiring by year (click a year to drill in), and a portfolio calendar of lease, loan and pref maturities by horizon.</>,
          <><B>📈 Mark-to-Market & 🔗 Co-Tenancy Cascade</B> — in-place rents below your book's median for the same brand (with the $ upside), and which anchors going dark would trip co-tenancy / kickout relief.</>,
          <><B>🧮 Data Audit</B> — runs the arithmetic & consistency tie-outs across every deal at once and lists the contradictions to fix (click a row to jump to the deal).</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Tenant & Parent concentration</B> (Tenant Analytics) — top exposure by rent or store count; an eye-slash toggle excludes an outlier and stats recompute live. A pinned search jumps to any tenant/parent (their page shows a description + all locations).</>,
        <><B>🔗 Link Tenants</B> (its own page) — tick two spellings of one brand (<em>Walmart</em> / <em>Wal-Mart</em>), pick the name to keep, and Link; they merge everywhere. Existing links list below with <B>Unlink</B>, and a tenant page has an <B>unlink icon</B> per row to split a stray back out.</>,
        <><B>ATMs</B> are tracked separately from branches (their own <B>ATM</B> badge) but still roll up to the parent bank; a <B>Hide ATMs</B> toggle appears only when the list has them. <B>Tenant Name Audit</B> reviews suspected brand-name variants ("Burlington" vs "Burlington Coat Factory") to merge or keep separate — choices persist.</>,
        <><B>Updates live</B> as deals change — no refresh; all statuses included. <B>"Score unscored deals"</B> (Overview) grades any deal missing a letter in one click.</>,
        <><B>⚙ Maintenance ▾</B> (Overview) gathers the housekeeping — <B>Clean & re-audit all</B> (token-free auto-fix + re-check, snapshots first), <B>Rebuild comps index</B>, and <B>Rebuild tenant index</B>.</>,
        <><B>Learning</B> (Portfolio) is where you review and export the plain-English rules you've taught the extractor — your corrections in one place.</>,
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
        <>The deal-page Comp Benchmark weights <B>OWNED &gt; MANUAL &gt; OM</B>, auto-includes strongly-similar trades (by region/anchor/size/cap), and suggests more you can add. <B>★ Star</B> a comp to force-include it and weight it 3× in the medians; <B>click any comp to expand</B> its full center detail (address, anchor, occupancy, buyer/seller, why it matched).</>,
        <>JSON imports instantly; Excel/PDF are AI-read and shown for review (small token cost) before adding — tagged UPLOAD and fully editable. Use Excel export to share a comp set or build a pricing model outside the app.</>,
      ]} />
    ),
  },
  {
    id: 7,
    title: "Tips, shortcuts & things worth knowing",
    brief: (
      <>
        <BriefList items={[
          <><B>Accounts & access</B> — everyone signs in with their own login; new people request access from the sign-in screen and get an email once approved. Logins persist across updates.</>,
          <><B>Today's Rates</B> (top bar) — Treasury yields, Term SOFR, and SOFR swaps live from the market (ET-stamped); they seed the deal-page prepay & swap-breakage estimates.</>,
          <><B>Search (⌘K / Ctrl-K)</B> — jump to any deal or tenant across the library in a couple keystrokes. Tenant names are clickable everywhere → cross-portfolio summary.</>,
          <><B>Feedback flag</B> (bottom-left life-ring) goes straight to the team.</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Back button</B> (on-page and browser/phone) steps back through the app, not off the site. <B>Verified fields</B> — lock a confirmed figure against future re-extractions.</>,
        <><B>What costs AI tokens:</B> uploading OMs / rent rolls / sales files, importing comps from Excel or PDF, rebuilding from the OM, and asking the Analyst (incl. Refresh Analysis, Find Comps, Find Sale). <B>Free:</B> browsing, editing, sorting/searching, all Analytics & Comp Benchmark, Closing Costs, demographics Re-Pull (Census, not AI), and JSON/Excel exports. Bottom line: uploading documents and talking to the Analyst are where the cost is.</>,
        <><B>Occupancy cost (health ratio)</B> is always the TOTAL: (base rent + reimbursements + percentage rent + other rent) ÷ gross sales — never base rent alone. Uses the stated total when given, else computes from disclosed components.</>,
        <><B>Upload on the live site, not the Replit preview</B> — they have separate databases.</>,
        <><B>If the site feels slow</B> right after a big import, give it ~30 seconds for background indexing to catch up.</>,
      ]} />
    ),
  },
  {
    id: 8,
    admin: true,
    title: "Admin tools",
    brief: (
      <>
        <p style={{ margin:0 }}>You're seeing this because you're signed in as an <B>admin</B> (the 5-tap-logo + password gate). These cover the destructive and account-level actions — <B>regular users never see them.</B></p>
        <BriefList items={[
          <><B>🎓 Teach the extractor</B> (a deal's <B>Actions</B> menu) — caught a recurring mistake? Write a rule in plain English (e.g. "always capture anchor tenants even on a separate page") and the AI follows it on <B>every future OM extraction.</B> This is the only thing that changes future methodology — the everyday "Confirm import details" review just fixes the one deal.</>,
          <><B>Delete deals</B> — deletion is admin-only and requires <B>typing DELETE</B> (single deal or bulk). It's permanent — there's no Trash — but an automatic <B>snapshot</B> is taken first, so it's recoverable from Backup → Restore a snapshot.</>,
          <><B>Members</B> (top bar) — <B>approve or decline</B> access requests, grant/remove admin, and review the <B>Upload activity</B> log (every file, when, ok/failed, who) with a <B>CSV export</B> and a red badge when uploads recently failed.</>,
          <><B>Backup ▾</B> (top bar) — <B>Full backup</B> (.json, includes images), <B>CSV export</B>, <B>Restore from backup</B> (merges by deal id — never deletes existing deals), <B>Restore a snapshot</B> (auto-saved before imports, deletes & restores), <B>Clean up addresses</B>, and the <B>Feedback inbox</B>.</>,
          <><B>⚙ Maintenance ▾</B> (Portfolio Overview) — the rebuilds (<B>Rebuild tenant index</B>, <B>Rebuild comps index</B>) and <B>Clean & re-audit all</B> are token-free and open to everyone; a <B>🗑 Remove deleted deals</B> item appears <B>admin-only</B> and permanently purges trashed deals still sitting in the DB (snapshots first). ("Score unscored," "Refresh outdated analyses," and "Audit data integrity" are open to everyone too.)</>,
          <><B>House View</B> — edit or rebuild the portfolio "house view" the analyst applies to grades, strengths, risks & pricing (regular users see it read-only).</>,
        ]} />
      </>
    ),
    detail: (
      <DetailList items={[
        <><B>Destructive actions are gated for a reason</B> — delete, restore, and the index rebuilds all sit behind admin. The auto-snapshots (before every import, delete, and restore) are the safety net; <B>Backup → Restore a snapshot</B> rolls back a bad import or an accidental delete.</>,
        <><B>Teaching the extractor is free</B> to save and applies going forward only — it never rewrites existing deals. Rebuilding an index is also token-free; re-running an extraction (to pick up a new rule on an old deal) does cost tokens.</>,
        <><B>Admin is per-person</B> — grant it under Members only to people who should be able to delete and restore. The gate is a convenience lock, not a security boundary.</>,
      ]} />
    ),
  },
];

function PanelContent({ expanded, toggle, onClose, onNavigate, isDesktop, isAdmin }: {
  onNavigate?: (dest: HelpDest) => void;
  isDesktop?: boolean;
  isAdmin?: boolean;
  expanded: Set<number>;
  toggle: (id: number) => void;
  onClose: () => void;
}) {
  // Admin-only sections appear only when signed in as admin.
  const sections = SECTIONS.filter(s => !s.admin || isAdmin);
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
        {sections.map(section => {
          const isOpen = expanded.has(section.id);
          return (
            <div key={section.id} style={{ border: section.admin ? "1px solid #d8c2a0" : "1px solid #e3dccd", borderRadius:10, overflow:"hidden", background:"#fff" }}>
              {/* Header row: title toggles open/close; the "Go to" action sits on the right. */}
              <div style={{ display:"flex", alignItems:"center", gap:11, background: section.admin ? "#fbf4e6" : "#faf7f0", padding:"11px 14px", minHeight:48 }}>
                <button
                  type="button"
                  onClick={() => toggle(section.id)}
                  aria-expanded={isOpen}
                  aria-controls={`help-detail-${section.id}`}
                  style={{ display:"flex", alignItems:"center", gap:11, flex:1, minWidth:0, background:"transparent", border:"none", cursor:"pointer", padding:0, textAlign:"left", fontFamily:"'Inter',-apple-system,sans-serif" }}
                >
                  {section.admin
                    ? <span style={{ display:"inline-flex", alignItems:"center", justifyContent:"center", width:26, height:26, background:"#9a6a1e", borderRadius:4, color:"#fff", fontSize:13, flexShrink:0 }}>🔒</span>
                    : <Chip n={section.id} />}
                  <span style={{ flex:1, fontWeight:700, color: section.admin ? "#9a6a1e" : "#3f7a1f", fontSize:14 }}>{section.title}</span>
                  {section.admin && <span style={{ flexShrink:0, fontSize:9, fontWeight:700, letterSpacing:"0.08em", color:"#9a6a1e", background:"#fff", border:"1px solid #e0c9a8", borderRadius:4, padding:"2px 6px" }}>ADMIN ONLY</span>}
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

export default function HelpModal({ open, onClose, onNavigate, isAdmin }: HelpModalProps) {
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
        <PanelContent expanded={expanded} toggle={toggle} onClose={onClose} onNavigate={onNavigate} isDesktop={true} isAdmin={isAdmin} />
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
        <PanelContent expanded={expanded} toggle={toggle} onClose={onClose} onNavigate={onNavigate} isDesktop={false} isAdmin={isAdmin} />
      </div>
    </>
  );
}
