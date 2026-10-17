// The "What's new" feed.
//
// A hand-maintained list of things that shipped, written for Eric's team rather
// than for engineers: what it does for you and where to find it, never the
// mechanism. Each person sees only the entries newer than the last time they
// were shown this list (see entriesSince), so nobody is made to re-read three
// months of notes to find the one change that affects them today.
//
// HOUSE RULE: when you ship something a user would notice, add an entry here in
// the same change. A feature nobody is told about may as well not exist — and
// the list is the only record the team reads. Newest FIRST. Mark a feature only
// admins can use with adminOnly: true so non-admins aren't told about it.

export type ChangeCategory = "new" | "improved" | "fixed" | "data";

export interface ChangeEntry {
  /** Stable forever — it is what "already seen" is reasoned about. Never reuse one. */
  id: string;
  /** The day it shipped, ISO YYYY-MM-DD. */
  date: string;
  category: ChangeCategory;
  /** One line, plain English. No jargon, no file names. */
  title: string;
  /** Two or three sentences: what changed, and why it matters to the reader. */
  detail: string;
  /** Where to find it in the app, when that isn't obvious. */
  where?: string;
  /** Set when the feature is only usable by admins (e.g. the Members screen), so
   *  it isn't announced to people who can't see or use it. */
  adminOnly?: boolean;
}

export const CATEGORY_LABEL: Record<ChangeCategory, string> = {
  new: "New",
  improved: "Improved",
  fixed: "Fixed",
  data: "Data quality",
};

// Olive/sage house palette, with a warm amber for data-quality items so the
// three kinds of entry are told apart at a glance and not only by their text.
export const CATEGORY_STYLE: Record<ChangeCategory, { fg: string; bg: string; border: string }> = {
  new:      { fg: "#3f7a1f", bg: "#eef3e6", border: "#b8d49a" },
  improved: { fg: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
  fixed:    { fg: "#9a5b12", bg: "#fdf4e7", border: "#f0d9b5" },
  data:     { fg: "#0f766e", bg: "#f0fdfa", border: "#99f6e4" },
};

export const CHANGELOG: ChangeEntry[] = [
  {
    id: "2026-10-17-home-restyle",
    date: "2026-10-17",
    category: "improved",
    title: "A cleaner home page in KPR's colors",
    detail: "The home page now uses the KPR palette and fonts. Your owned portfolio sits in a dark band at the top with larger, easier-to-read figures, and the anchors are listed by name. Pipeline cards show the deal photo, a status tag (gold for Under Contract), the AI grade, and NOI, square footage and occupancy. Deals that need attention show a data-confidence ring. Suggested questions appear as cards, and the question box is a floating bar. It works on desktop and phone.",
    where: "Analyst (home page)",
  },
  {
    id: "2026-10-17-dtcc-swap-curve",
    date: "2026-10-17",
    category: "new",
    title: "Live SOFR swap curve from every reported swap trade",
    detail: "SOFR swap rates (1, 2, 3, 5, 7, 10, 15 and 30 years) are now read straight off the swap trades reported to DTCC's public data — the median of the afternoon's trades at each term, with how many trades and their range. Checked against Chatham's 10/15 close, it came within about 1 basis point at every term. It updates through the trading day, keeps a 12-month history, and anyone can paste today's curve from Chatham, which is used until DTCC has newer trades. SOFR overnight now comes from the NY Fed.",
    where: "Today's Rates",
  },
  {
    id: "2026-10-17-loan-sizing",
    date: "2026-10-17",
    category: "improved",
    title: "Size a loan off any base rate, with every spread shown",
    detail: "Pick the base rate (SOFR, 1-month Term SOFR, a SOFR swap or a Treasury), add the lender spread, a swap or credit premium and a stress cushion, and see the all-in rate with its breakdown. The loan is sized on DSCR, debt yield and loan-to-value, with the one that limits it highlighted, amortizing or interest-only. The open deal's NOI and price fill in automatically.",
    where: "Today's Rates → Size a loan",
  },
  {
    id: "2026-10-17-refresh-background-tab",
    date: "2026-10-17",
    category: "fixed",
    title: "The AI write-up refresh keeps going in a background tab",
    detail: "The one-time re-analysis of every deal only moved while the site was the tab in front, so it paused whenever you switched away. It now keeps going as long as the site is open in any tab, works on more deals at once, and records why any deal fails so it can be retried.",
  },
  {
    id: "2026-10-17-faster-load",
    date: "2026-10-17",
    category: "improved",
    title: "The app loads much faster, especially on phones",
    detail: "The deal library used to download every deal's full detail — including deleted deals — on every visit (about 18 MB). It's now compressed, leaves deleted deals out, and loads the deal-page-only details (citations, tax parcels, property history and similar) when you open that deal.",
  },
  {
    id: "2026-10-17-mtm-thin-samples",
    date: "2026-10-17",
    category: "fixed",
    title: "Mark-to-Market no longer counts dollars from thin samples",
    detail: "A store with fewer than 5 comparable stores is still listed (with its percentile), but its dollars aren't added to the capturable upside or the deal total. A store paying more than half its peers is never shown as below market.",
    where: "Portfolio Analytics → Mark-to-Market",
  },
  {
    id: "2026-10-17-comp-duplicates",
    date: "2026-10-17",
    category: "data",
    title: "Duplicate sale comps merged; resales stay separate",
    detail: "The same sale entered twice is merged into one comp, keeping the best source (KPR's own trades first, then broker comps, then OM comps) and filling in any blanks from the copy. A property that sold again on a different date is a separate comp and is no longer flagged as a possible duplicate.",
    where: "Comps",
  },
  {
    id: "2026-10-17-history-renames-om-dates",
    date: "2026-10-17",
    category: "fixed",
    title: "Property history no longer counts a renamed tenant as a move-out",
    detail: "When the same tenant is spelled differently in two OMs (\"AutoBell Car Wash (GL)\" vs \"Auto Bell Car Wash\", \"Chili's\" vs \"Chili's Bar & Grill\"), it's now recognised as the same tenant instead of a departure plus a new arrival. Existing histories were re-checked. OM dates are also read from the rent roll's \"as of\" date and other dated lines inside the PDF, not just the cover, before falling back to the upload date.",
    where: "Deal page → Summary → Property History",
  },
  {
    id: "2026-10-17-reanalysis-sticks",
    date: "2026-10-17",
    category: "fixed",
    title: "Refreshed AI write-ups now stick, and the refresh runs about 5× faster",
    detail: "Saving a deal from a tab that was opened earlier could put the old write-up back over a freshly redone one. The newer write-up now always wins, while your edit still saves. The background refresh also works on several deals at once. The build number at the bottom of your account menu is easier to read, so you can check which version is live.",
  },
  {
    id: "2026-10-17-property-history",
    date: "2026-10-17",
    category: "new",
    title: "Property history: what changed between OMs",
    detail:
      "When a newer OM or rent roll replaces an older one for the same center, the newer figures still lead, and the deal page now keeps a dated Property History of what changed: tenants who left, who backfilled their space, new tenants, renewals and extensions, anchor rent moves, stores gone dark, and NOI and occupancy then vs now. It builds up with every new document and the AI write-up uses it as background. Every OM now carries a date too: read from the OM's cover, else its file name, else shown as 'uploaded … (OM undated)'.",
    where: "Deal page → Summary, under the anchor comparison",
  },
  {
    id: "2026-10-17-sold-record-flags",
    date: "2026-10-17",
    category: "improved",
    title: "Sold deals missing a closing date or sale price are flagged",
    detail:
      "A deal marked Sold with no closing date or no sale price now shows a 'number to verify' item on its page saying exactly what's missing. It clears itself once you fill it in on the Transaction tab. Bolton Plaza now has its closing date and KPR's original purchase, so it appears in Comps as both a KPR buy and a KPR sale.",
    where: "Deal page → review banner; Comps",
  },
  {
    id: "2026-10-17-small-fixes",
    date: "2026-10-17",
    category: "fixed",
    title: "Comps tidy-up and a clearer phone layout",
    detail:
      "KPR's own purchases on the Comps page now show KPR Centers as the buyer (and KPR's sales show KPR Centers as the seller). Existing comps were cleaned of known typos such as 'Dick's Sporting Good sRoss' and 'Potttstown'. On phones, the deal page's Ask button is now a small round button, and the 'Review ›' link sits under the banner text where the button can't cover it.",
    where: "Comps; deal page on phones",
  },
  {
    id: "2026-10-17-anchor-names-no-autoscore",
    date: "2026-10-17",
    category: "fixed",
    title: "Go-dark anchors show the tenant's name; opening a deal no longer re-scores it",
    detail:
      "The anchor-goes-dark figures (owned risk card, Co-Tenancy Cascade, the deal's lease-risk panel) now name the actual tenant instead of a piece of lease wording like 'Anchor Premises (Other Required Lessees per…)'. A clause that names no tenant shows as 'a required anchor'. Opening a deal page also no longer starts 'Re-scoring against portfolio benchmarks' on its own; scores refresh with Refresh Analysis and the background re-analysis.",
    where: "Portfolio Analytics → Owned; Co-Tenancy Cascade; deal page",
  },
  {
    id: "2026-10-17-implied-same-type",
    date: "2026-10-17",
    category: "fixed",
    title: "Implied value uses only comps of the same center type",
    detail:
      "The implied-value range on a deal is now built only from sales of the same kind of center (a power center from power-center sales, not grocery-anchored ones). If there aren't enough same-type sales, no range is shown rather than a misleading one. On owned deals, the summary band now shows 'Acquisition price', what KPR paid, instead of 'Price'.",
    where: "Deal page → summary band",
  },
  {
    id: "2026-10-17-reanalysis-v4",
    date: "2026-10-17",
    category: "improved",
    title: "Every deal's AI write-up is being redone under the new rules",
    detail:
      "All deal analyses are being regenerated in the background with the latest rules: above-market rent is a roll-down risk, never upside; the write-up's numbers must match the deal's own figures; office users like IWG don't count as anchors; and no mention of pending sales. It runs as one discounted batch and the results land on their own, usually within a few hours. Until then, an above-market 'upside' item has already been moved to red flags, and a write-up figure that disagrees with the stored one shows up as a question to review.",
    where: "Every deal page → Overview and AI Analysis",
  },
  {
    id: "2026-10-17-failed-upload-cleanup",
    date: "2026-10-17",
    category: "fixed",
    title: "Duplicate and blank deals from failed uploads cleared",
    detail:
      "Uploads or re-analyses that failed used to leave a record behind in the Deal Library, often with a blank name or just the file name, so the same property seemed to appear several times. Each one was merged into the real deal: any notes or acquisition / debt terms the real deal was missing were copied over, then the leftover was moved to Trash, where it can be restored. A re-analysis that fails no longer wipes the deal's rent roll and numbers; it leaves the deal exactly as it was.",
    where: "Deal Library; Trash",
  },
  {
    id: "2026-10-17-no-pending-sales",
    date: "2026-10-17",
    category: "improved",
    title: "Sales are recorded only once they close",
    detail:
      "The sale-stage flag, the Dispositions page and the pending-sale fields (buyer, price, deposit, PSA, diligence and expected closing on an owned property) are gone, and the data that was in them has been deleted. An owned property simply stays Owned until the sale closes; then mark it Sold with the closing date, price and buyer. The Analyst chat and the AI write-ups no longer mention pending sales.",
    where: "Deal page → status tag and Transaction tab",
  },
  {
    id: "2026-10-17-home-tidy",
    date: "2026-10-17",
    category: "improved",
    title: "Simpler home page",
    detail:
      "The watchlist-rent and anchor-goes-dark cards moved off the home page; they're on Portfolio Analytics → Owned. Pipeline now comes right after the Owned Portfolio numbers.",
    where: "Analyst home",
  },
  {
    id: "2026-10-17-webp-thumbs",
    date: "2026-10-17",
    category: "improved",
    title: "Deal Library photos load faster",
    detail:
      "Property photos in the Deal Library, the home page tiles and the portfolio montage are now smaller WebP images, about half the download of before at the same on-screen size. Existing photos convert in the background the first time you open the Deal Library; nothing to do on your end.",
    where: "Deal Library and home page",
  },
  {
    id: "2026-10-17-owned-rollover-datex",
    date: "2026-10-17",
    category: "improved",
    title: "Owned rollover uses today's Datex tenants",
    detail:
      "On the Owned view of Portfolio Analytics, the lease-expiration waterfall, top tenants and credit mix now use each center's current tenant list from Datex wherever a Datex snapshot is loaded, instead of the OM's roster. A note under the waterfall says how many owned centers are on Datex and when it was synced; any center without a snapshot still uses its OM or rent roll.",
    where: "Portfolio Analytics → Owned",
  },
  {
    id: "2026-10-17-datex-owned",
    date: "2026-10-17",
    category: "improved",
    title: "Owned deals lead with today's Datex numbers",
    detail:
      "On an owned deal with a Datex snapshot, the summary band now shows today's occupancy from Datex, labelled with its date, and the OM / rent-roll figure underneath for comparison. The 'Live from Datex' card adds current base rent compared with the OM's, and a rollover view built from Datex's current tenant list: leases expiring in the next 12 months and in 13–24 months (count, SF, rent) and the next five expirations. Load a fresh snapshot any time from Portfolio Analytics → Maintenance → Import Datex snapshot.",
    where: "Owned deal page → summary band and Transaction tab",
  },
  {
    id: "2026-10-17-comp-scatter",
    date: "2026-10-17",
    category: "new",
    title: "Comp scatter chart",
    detail:
      "The Comps page and each deal's comp benchmark now show a chart of cap rate by sale date, with each sale colored by center type (grocery-anchored, power, neighborhood/community, lifestyle, strip). On a deal page the deal's own cap rate is drawn as a dashed line, so you can see at a glance where it sits. Hover or tap a dot to see the sale. The chart follows the filters you've set.",
    where: "Comps page; deal page → Market & Comps",
  },
  {
    id: "2026-10-17-debt-sizing",
    date: "2026-10-17",
    category: "new",
    title: "Today's Rates: all-in fixed rate, cap-rate spread and loan sizing",
    detail:
      "Today's Rates now opens with a Debt sizing box. It shows an all-in fixed rate (the 10-Yr Treasury plus a spread you can adjust, 200 bps by default), and the cap-rate spread: the median cap rate of real sales in the last 12 months minus the 10-Yr, with a 12-month trend line. It also sizes a loan: enter NOI (it's filled in when a deal page is open), DSCR (1.30x), debt yield (9%) and amortization, and it shows the loan each test allows and which one limits it. These are indicative numbers, not a lender quote.",
    where: "Today's Rates (top bar, or ☰ menu on a phone)",
  },
  {
    id: "2026-10-17-dispositions-risk",
    date: "2026-10-17",
    category: "new",
    title: "Owned-portfolio risk cards",
    detail:
      "The Owned view of Portfolio Analytics now shows two cards: how much owned rent is with tenants on the retailer watchlist, and, for each owned center, the rent at risk if its key anchor goes dark (co-tenancy clauses that trip on that anchor alone).",
    where: "Portfolio Analytics → Owned",
  },
  {
    id: "2026-10-17-layout-pass",
    date: "2026-10-17",
    category: "improved",
    title: "Deal page pricing, tidier screens",
    detail:
      "Deal pages now show an Implied value tile when there are enough comparable sales: NOI divided by the middle range of comparable cap rates for that center type and state, for example '$17.8M–$19.2M at 6.0–6.5%' with the price per SF. Hover it to see how many comps it used. The cover photo is now a short banner, so the key numbers sit above the fold; tap it to see the full photo. The tags under the deal name show one location type and the income tier (e.g. 'Middle-income') instead of contradictory labels. On the home page, the attention badges now say what they are ('DATA 64 · PARTIAL'), with a tooltip explaining the colors. Portfolio Analytics' admin buttons (Score unscored, Refresh outdated, data issues, Feedback & Trends) are now inside the Maintenance menu, with one count badge. Pages also have proper headings, labels and photo descriptions for screen readers.",
    where: "Deal page; Analyst home; Portfolio Analytics",
  },
  {
    id: "2026-10-17-library-cards",
    date: "2026-10-17",
    category: "improved",
    title: "Deal Library: phone cards, NOI / WALT / Grade columns",
    detail:
      "On a phone the Deal Library is now a list of cards, each with the photo, name, city and state, status (plus any sale-stage flag), NOI, GLA and occupancy. On a computer the table gains NOI, WALT and Grade columns. Where a deal has no stated cap rate but has NOI and an asking price, the implied cap is shown, marked with *. Cap, Price and Seller are hidden while 90% or more of deals leave them blank; tap 'show' to bring them back.",
    where: "Portfolio → Deal Library",
  },
  {
    id: "2026-10-17-mtm-houseview",
    date: "2026-10-17",
    category: "improved",
    title: "Like-for-like Mark-to-Market, and a House View that starts full",
    detail:
      "Mark-to-Market now compares each store only with the same brand in the same size band (under 10k, 10–25k, 25–50k, 50k+ SF) and the same region, falling back to national when the region is thin. Ground leases, pads and kiosks are left out, so a Santander pad or a small-format Office Depot is no longer measured against full-size stores. Each row shows how many stores it was compared with, and when there are fewer than 5 it shows where the rent ranks (percentile) instead of a % gap. House View now opens with KPR's standing underwriting rules built in, and every analysis uses them from day one. What your team's deal takes teach it is added underneath.",
    where: "Analytics → Mark-to-Market; header → House View",
  },
  {
    id: "2026-10-17-ai-guardrails",
    date: "2026-10-17",
    category: "improved",
    title: "AI write-ups checked against the deal's own numbers",
    detail:
      "After the AI writes a deal's analysis, the app now checks it. A tenant paying ABOVE market rent can no longer be listed as 'upside'; it moves to the red flags as roll-down risk. If the write-up quotes an occupancy, or a tenant's share of base rent, that is more than half a point off the deal's stored figure, a review question appears so you can see which one is right. Calling a lease 'already in holdover' when it hasn't expired yet is flagged too. The AI also gets today's date, so a lease that ends before the OM's future rent-roll date isn't mistaken for expired. Office, coworking, medical and bank tenants are no longer treated as anchors. The chat answers 'what do we own / what are we selling / what have we sold' from a computed status list, so an under-contract sale is never reported as sold.",
    where: "Deal page → AI Analysis and review questions; Analyst chat",
  },
  {
    id: "2026-10-17-fewer-requests",
    date: "2026-10-17",
    category: "improved",
    title: "Faster start-up",
    detail:
      "The app no longer asks the server for the same data twice when it opens: lease abstracts, comps, tenant benchmarks and deal photos are each loaded once and shared. The daily automatic backup now runs in the background shortly after you sign in, instead of slowing down the first screen. Home-page photos now load as small cached thumbnails instead of each deal's full image set (roughly 5 MB less on the home page). The app's first download is about 45% smaller: the spreadsheet tools, the upload readers, Closing Costs, Critical Dates, Mark-to-Market and Co-Tenancy load the first time you open them.",
    where: "Everywhere",
  },
  {
    id: "2026-10-17-fl-closing",
    date: "2026-10-17",
    category: "fixed",
    title: "Florida closing costs: correct county range and title payer",
    detail:
      "Before an address is entered, Florida's deed tax now shows 0.70%–1.05% in total. Miami-Dade's 1.05% replaces the 0.70% state rate rather than adding to it, so the high end is no longer overstated. Who pays the owner's title policy now follows county custom: the buyer in Miami-Dade, Broward, Sarasota and Collier, the seller everywhere else. Picking a state with no address shows a neutral note instead of a red error, and the card no longer says 'Using the deal address' when there isn't one.",
    where: "Closing Costs",
  },
  {
    id: "2026-10-17-header-links",
    date: "2026-10-17",
    category: "improved",
    title: "Tidier header, shareable links, Escape closes windows",
    detail:
      "What's new, Tutorial, Claude access, Send feedback, Members, Backup, Change password, Security and Sign out now live in one menu (☰) at the top right, so the top bar no longer runs off the screen or slides under the logo. Today's Rates, House View and Upload sit next to the search bar. Every page now has its own web address, such as a deal page, Comps or Mark-to-Market. Refreshing keeps your place, the browser's Back button works, and you can copy the address to send someone a link to a deal. Escape now closes any open window, menu or drawer. Chat replies no longer show a stray '#' before headings. The floating feedback flag is gone; use ☰ → Send feedback.",
    where: "Top bar; ☰ menu; every page",
  },
  {
    id: "2026-10-17-phone-nav",
    date: "2026-10-17",
    category: "improved",
    title: "Phone layout: bottom tabs and a smaller header",
    detail:
      "On a phone, the main sections are now tabs along the bottom: Analyst, Deals, Comps, Analytics and More. Analytics opens a list of every analytics page, and More opens the menu, which also holds Upload, Today's Rates, House View and Closing Costs. The top bar is just the logo, a search button and the menu. The always-on question bar is replaced by one floating Ask button, so far more of the screen shows your data. Keyboard hints such as 'Ctrl+K' are hidden on touch screens.",
    where: "iPhone / small screens",
  },
  {
    id: "2026-10-17-analytics-labels",
    date: "2026-10-17",
    category: "improved",
    title: "Clearer Portfolio Analytics headings and lease waterfall",
    detail:
      "The All view is now titled 'Market Corpus (N OMs)' so it can't be mistaken for KPR's portfolio, and very large totals read as $1.07B instead of $1069.1M. In the lease expiration waterfall, leases whose expiry year has already passed are grouped into a single 'Expired' bar instead of a row for every old year. The year labels no longer look like blue links, and a note says the dates are as of each OM or rent roll.",
    where: "Analytics → Portfolio Overview",
  },
  {
    id: "2026-10-17-comps-cleanup-admin",
    date: "2026-10-17",
    category: "new",
    title: "One-click comp data cleanup",
    detail:
      "A '🧹 Clean up comp data' button on the Comps page first shows what it would fix (occupancy stored as a decimal, wrong price per SF, numbers in the City column, strategy words in Anchor, anchor names in Type, typos), then asks before writing anything. It also rebuilds KPR's own trades from their deals. Nothing is deleted.",
    where: "Comps page, next to the Sales / Competitive set switch",
    adminOnly: true,
  },
  {
    id: "2026-10-17-comps-quality",
    date: "2026-10-17",
    category: "improved",
    title: "Cleaner sale comps, and only real sales in the averages",
    detail:
      "Comps now always calculate price per SF as price ÷ SF and show occupancy as a percent. Values typed into the wrong column (a number in City, 'Value-Add' in Anchor, an anchor name in Type) are moved or cleared, and known typos are fixed. Rows with no sale price and no sale date are the OMs' nearby competing centers, not sales, so they now sit under their own 'Competitive set' tab and never count in comp stats. Prices carved out of a portfolio purchase (like the Cedar portfolio's 14–17% caps) are left out of averages by default; untick 'Leave out portfolio allocations' to see them. On a deal's Transaction tab you can mark a trade as 'Single asset' or 'Portfolio (allocated price)'. KPR's own trades show the real city instead of the metro area, and a missing cap is filled from our own NOI ÷ price.",
    where: "Comps page; deal page → Transaction tab",
  },
  {
    id: "2026-10-17-upload-duplicates",
    date: "2026-10-17",
    category: "improved",
    title: "Uploads ask before merging into an existing deal",
    detail:
      "When an upload looks like a property already in the library, you now choose what happens: Add to existing deal (fill in the gaps, flag anything that disagrees), Replace existing (the new file's numbers win, but your status, notes and underwriting are kept), or New deal. Nothing merges into a library deal without asking anymore. Two properties with the same name in different states or ZIP codes are no longer treated as the same deal. A supporting file on its own, like a site plan, financial narrative or add-on info, now asks which deal it belongs to instead of becoming its own record. A deal can no longer be saved without a property name. To clean up existing doubles, open Data Audit → Possible duplicate deals and tap 'Merge these'.",
    where: "Upload OMs; Analytics → Data Audit → Possible duplicate deals",
  },
  {
    id: "2026-10-17-sale-stage",
    date: "2026-10-17",
    category: "new",
    title: "Sold means closed",
    detail:
      "A property stays Owned, and keeps counting in every owned total, until its sale closes. Marking a deal Sold now asks for the closing date and won't save without one. Any deal already marked Sold with no closing date shows a red 'no closing date' flag. On the Comps page, KPR's own trades are now tagged KPR BUY or KPR SALE instead of OWNED.",
    where: "Deal page → status tag; Deal Library; Comps",
  },
  {
    id: "2026-10-17-ig-and-brand-names",
    date: "2026-10-17",
    category: "fixed",
    title: "Investment-grade share and top tenants now agree across pages",
    detail:
      "The home page and Portfolio Analytics were working out investment-grade rent two different ways, so one said 27% and the other 11%. They now use the same list, which also gained brands it was missing: Giant and the other Ahold banners, Dick's, Fred Meyer and the other Kroger banners, and plain 'Ross' or 'T.J. Maxx'. Look-alikes such as Giant Eagle are kept out. Tenants whose names differ only in spelling, like 'Giant Food Stores' and 'Giant', or 'HOME DEPOT' and 'The Home Depot', are now counted as one, and all-caps names display normally.",
    where: "Home page, Portfolio Analytics → credit mix and top tenants",
  },
  {
    id: "2026-10-17-one-owned-count",
    date: "2026-10-17",
    category: "fixed",
    title: "The owned property count is now the same on every page",
    detail:
      "The home page, Portfolio Analytics, Tenant Analytics, brand pages, Critical Dates and the rest now share one definition of 'owned': deals marked Owned, not deleted, with each property counted once even if it was entered twice. Sold deals no longer count as owned anywhere. Portfolio Analytics now opens on Owned, and the All view is labelled as the market, so its totals don't read as KPR's own exposure.",
    where: "Home page, Portfolio Analytics, Tenant Analytics",
  },
  {
    id: "2026-10-16-recovery-badge-partial",
    date: "2026-10-16",
    category: "fixed",
    title: "Recovery labels on the roster now match the lease terms",
    detail:
      "A tenant whose CAM, taxes and insurance are all listed as excluded now shows GROSS, even when the rent roll never uses the word 'gross'. Before, it showed no label at all. A tenant that pays some expenses but not others, such as taxes only, now shows a new PARTIAL label instead of NNN. Hover it to see which expenses are and aren't reimbursed.",
    where: "Deal page → Tenants & Sales → Reimb. column",
  },
  {
    id: "2026-10-16-occupancy-cost-by-expense-bucket",
    date: "2026-10-16",
    category: "improved",
    title: "Occupancy cost now works for gross and modified-gross tenants",
    detail:
      "Occupancy cost used to appear only for straight NNN tenants. Now a gross-lease tenant shows base rent ÷ sales, and a modified-gross or fixed-CAM tenant is calculated bucket by bucket (CAM, real estate tax, insurance) from its lease terms and the OM's expense budget. Tap the number to see the working, including what the tenant would pay if it were fully NNN, so you can sanity-check it. When a lease's terms can't be read, or the tenant pays percentage rent we don't have a figure for, it stays blank rather than guessing. And if our numbers would add up to more than the OM says the center collects, they're held back with a note explaining why.",
    where: "Deal page → Tenants & Sales → Occ Cost column (tap a number)",
  },
  {
    id: "2026-10-16-claude-options-from-lease",
    date: "2026-10-16",
    category: "fixed",
    title: "Claude now asks for the lease on option and notice dates",
    detail:
      "Datex's option records don't come through to Claude, so when Claude found nothing there it could wrongly suggest a tenant had no renewal options. Now Claude knows option and notice dates have to come from the signed lease. It will ask you for the lease instead of guessing, and it never treats a blank in Datex as \"no options.\"",
    where: "Any Claude chat that uses the deal library",
  },
  {
    id: "2026-10-16-claude-kpr-instructions",
    date: "2026-10-16",
    category: "new",
    title: "KPR instructions for Claude, in the Claude access setup",
    detail:
      "The Claude access walkthrough has a new step that gives your Claude KPR's standing instructions: when to trust Datex versus the deal library, Datex's quirks, and to ask you for the actual lease or loan document instead of guessing. They're built into the KPR rules download, so one upload gives Claude both. On a Claude plan without Skills, the step shows how to paste them into a Claude Project instead.",
    where: "Top bar → Claude access",
  },
  {
    id: "2026-10-16-claude-access-guided-setup",
    date: "2026-10-16",
    category: "improved",
    title: "Step-by-step setup for connecting Claude to the library",
    detail:
      "Claude access is now a guided walkthrough, one step at a time with a big Next button. Each step shows a picture of the Claude screen with the exact button to click circled, it walks you through Claude's sign-in question (keep \"No sign-in\"), the Connect button and setting the tools to \"Always allow\", there are separate tips for Free and paid Claude plans, and you can copy everything you need with one click. It also adds KPR's rules to your Claude, gives you a test question to confirm it works, and has a 'Stuck?' list for the common snags.",
    where: "Top bar → Claude access",
  },
  {
    id: "2026-10-15-roster-totals-row",
    date: "2026-10-15",
    category: "new",
    title: "Totals row at the bottom of every tenant roster",
    detail:
      "The roster now ends with a totals line: total and leased SF with % leased, total base rent, SF-weighted average rent per SF, WALT, and weighted sales per SF where tenants report sales. It totals whatever you're looking at, so filtering to Anchors or searching re-totals just those rows. On a phone the key figures appear right under 'Totals' so you don't have to scroll sideways.",
    where: "Deal page → Tenants & Sales → Tenant roster",
  },
  {
    id: "2026-10-14-multi-sort-everywhere",
    date: "2026-10-14",
    category: "improved",
    title: "Multi-column sorting on Comps, brand pages and parent-company pages",
    detail:
      "The 'Sorted by' bar now also sits above the comp sales table and every brand and parent-company location list. Try State, then Sale date on Comps to see the latest trade in each market, or State, then Rent/SF on a brand page to read its rents market by market. Comps can also sort by source quality (KPR's own trades first). Blank values, such as deals with no stated cap rate, now always sort to the bottom instead of the top.",
    where: "Comps, and any brand or parent-company page",
  },
  {
    id: "2026-10-14-multi-column-sort",
    date: "2026-10-14",
    category: "new",
    title: "Sort by several columns at once",
    detail:
      "The Deal Library and every tenant roster now show a 'Sorted by' bar above the table, e.g. Status, then Last upload. Use '+ then by…' to add a tiebreaker, tap a level to flip its direction, ↑ to raise its priority, or × to remove it. Rosters can also put anchors first. Your choice is remembered on this device, and 'reset' puts the default back.",
    where: "Deal Library and the Tenants & Sales tab on any deal",
  },
  {
    id: "2026-10-14-library-sort-autopass",
    date: "2026-10-14",
    category: "improved",
    title: "Deal Library lists the newest uploads first in each status, and prospects auto-pass after 6 weeks",
    detail:
      "Within each status group, the most recently uploaded deals now sit at the top instead of being alphabetical. A Prospect now moves to Passed after 6 weeks with no new upload or status change (it was about 2 months from the first upload). Moving a deal back to Prospect, or uploading new material for it, restarts the clock, so it won't be passed again the moment you reopen the site.",
    where: "Deal Library",
  },
  {
    id: "2026-10-14-already-uploaded-warning",
    date: "2026-10-14",
    category: "new",
    title: "A heads-up before you re-upload a property that's already in the library",
    detail:
      "If you drop in an OM for a property someone already uploaded, the site now stops before reading it and tells you who uploaded it and when. Choose Continue to update the existing deal, or Skip to save the time and AI credits. Other files from the same broker package you're uploading together don't trigger it.",
    where: "Upload",
  },
  {
    id: "2026-10-14-rename-members",
    date: "2026-10-14",
    category: "improved",
    title: "Members can be renamed",
    detail:
      "Admins can now change the name anyone is shown as, including their own. The new name appears in the header, on the Members screen and in 'uploaded by' on every deal, including ones uploaded before the change.",
    where: "Members → Rename",
    adminOnly: true,
  },
  {
    id: "2026-10-13-broker-package-combine",
    date: "2026-10-13",
    category: "improved",
    title: "Drop in all the files from a broker package and they become one deal",
    detail:
      "Some brokers, Newmark especially, send a deal as several files: the OM, a tenant underwriting sheet and a financial narrative. Upload them together, in any order, and they now land on a single deal instead of three. Each part comes from the file that's best at it: the tenant list from the tenant sheet, NOI and the cash flow from the financials, the description from the OM. The grade and write-up refresh on their own once everything is combined.",
    where: "Upload → drag in every file from the package at once",
  },
  {
    id: "2026-09-24-transfer-tax-local",
    date: "2026-09-24",
    category: "improved",
    title: "Transfer taxes now include the exact local (county, town and school district) tax",
    detail:
      "The closing-cost estimate now looks up the property's actual county, municipality and school district instead of using a state default. Where we can't confirm a local rate, the card says so in red and shows a range rather than guessing, and rates from a secondary source are marked 'check independently' so you know which numbers to confirm.",
    where: "Closing Costs, and the closing-cost card on each deal",
  },
  {
    id: "2026-09-16-datex-asof-on-roster",
    date: "2026-09-16",
    category: "improved",
    title: "The roster now shows the live Datex date next to the rent-roll date",
    detail:
      "On an owned property the tenant roster is the rent roll as captured at acquisition, and it deliberately stays that way. It now carries a second chip showing Datex's current occupancy and as-of date, so you can see at a glance whether the picture has moved since you bought it.",
    where: "Deal page → Tenants & Sales",
  },
  {
    id: "2026-09-15-datex-live-block",
    date: "2026-09-15",
    category: "new",
    title: "Live occupancy from Datex on every owned deal",
    detail:
      "Owned properties now carry a \"Live from Datex\" card showing current GLA, occupancy and unit counts alongside the original acquisition record. It leads with what has CHANGED since acquisition, and calls out any segment that has gone fully dark. The acquisition record is never overwritten — you keep both, and the gap between them is the finding.",
    where: "Deal page, below the underwriting cards",
  },
  {
    id: "2026-09-15-datex-import",
    date: "2026-09-15",
    category: "new",
    title: "Import a Datex snapshot without touching your deal data",
    detail:
      "You can now drop in a Datex export and refresh every owned property at once. It runs as a dry run first and tells you exactly what will change before anything is written, and it only ever touches the live block — rents, rosters and your own underwriting are left alone.",
    where: "Portfolio Analytics → maintenance menu → Import Datex snapshot",
  },
  {
    id: "2026-09-11-clear-answered-questions",
    date: "2026-09-11",
    category: "improved",
    title: "Clear out review questions the data can now answer itself",
    detail:
      "The review queue had built up to roughly 1,500 open items across the library, which buried the ~60 that were real. A new sweep closes only the questions the current data genuinely settles — a WALT that now recomputes correctly, an as-of date that has since been recorded. Anything that still disagrees stays open, because that disagreement is the finding.",
    where: "Portfolio Analytics → maintenance menu → Clear answered questions",
  },
  {
    id: "2026-09-10-claude-access",
    date: "2026-09-10",
    category: "new",
    title: "Claude can now read the deal library directly",
    detail:
      "You can connect Claude to this site and ask it questions across every deal you have ever reviewed — brand rents, lease precedent, sale comps, portfolio trends. Access is tied to your own login: you mint your own key after signing in, and it stops working the moment your account is removed.",
    where: "Header → Claude access",
  },
  {
    id: "2026-09-10-expired-lease-flag",
    date: "2026-09-10",
    category: "data",
    title: "Leases that expired before their own rent roll are now flagged",
    detail:
      "If a lease shows an expiry date earlier than the as-of date of the rent roll it came from, that is a contradiction in the document rather than just stale data. The audit now catches it. It currently fires on 25 deals.",
    where: "Deal page review questions, and Portfolio Analytics → audit",
  },
  {
    id: "2026-09-10-brand-format-warning",
    date: "2026-09-10",
    category: "data",
    title: "One brand can be several very different stores",
    detail:
      "Bank of America appears in the library both as 4,000 SF branches and as 60 SF ATMs, and rent per SF only compares within a format. Brand rent figures now warn you when the sizes span more than 10x, and give you a like-for-like number alongside the headline one. On Truist the median itself moves 23%.",
  },
  {
    id: "2026-09-08-occupancy-cost-guard",
    date: "2026-09-08",
    category: "fixed",
    title: "A very low occupancy cost is no longer 'corrected' when the sales back it up",
    detail:
      "The cleanup sweep used to treat a sub-1% occupancy cost as an error and rewrite it. Where the tenant's own reported sales support the figure, it is now left alone — a strong performer genuinely can carry an occupancy cost that low.",
  },
  {
    id: "2026-09-03-search-why-matched",
    date: "2026-09-03",
    category: "improved",
    title: "Search results tell you why they matched",
    detail:
      "Every result now shows the field that produced the hit, so a property that surfaced because of a tenant name rather than its own name is obvious rather than confusing.",
    where: "Global search",
  },
  {
    id: "2026-09-03-pdf-excel-export",
    date: "2026-09-03",
    category: "new",
    title: "PDF and Excel export on every table page",
    detail:
      "Comps, tenants, rollover and the analytics tables all export to a shareable PDF or an Excel file. The PDF measures your actual content and fits the columns to it rather than guessing, so wide tables stop running off the page.",
  },
  {
    id: "2026-09-01-cotenancy-x-of-n",
    date: "2026-09-01",
    category: "fixed",
    title: "Co-tenancy clauses that need several anchors dark are read correctly",
    detail:
      "A clause reading \"2 of the following must be open\" was being modelled as though losing any ONE named anchor triggered it. On one deal that overstated the headline exposure by about 15x — $1,015,131 against a true $68,875. The app now reads the count from the clause's own wording, repairs deals imported before the fix, and shows a warning wherever the exposure figures are displayed.",
    where: "Deal page → lease risk",
  },
  {
    id: "2026-08-11-occupancy-cost-by-sector",
    date: "2026-08-11",
    category: "improved",
    title: "Occupancy cost is graded by sector, not one flat threshold",
    detail:
      "A single 15% cutoff flagged healthy restaurants and let weak apparel tenants pass. Health thresholds now follow the tenant's sector, so the warnings mean something.",
  },
  {
    id: "2026-08-11-dba-classification",
    date: "2026-08-11",
    category: "data",
    title: "Tenants are classified by their brand, not their legal entity",
    detail:
      "A rent roll line like \"JRK Holdings LLC (Jersey Mike's)\" is now recognised as Jersey Mike's, so franchisee-held stores stop falling out of brand comparisons.",
  },
  {
    id: "2026-07-28-tax-forecast-chart",
    date: "2026-07-28",
    category: "improved",
    title: "The tax reassessment chart is readable",
    detail:
      "Taller, anchored to a zero baseline, with exact unrounded dollars and the year-over-year percentage labelled on every bar. It also no longer shows a fake DECREASE when an appraised value has been entered where an assessed value belongs.",
    where: "Deal page → Underwriting → tax reassessment",
  },
  {
    id: "2026-07-24-uploaded-by",
    date: "2026-07-24",
    category: "new",
    title: "Deals show who uploaded them",
    detail:
      "Team attribution on the deal page, applied retroactively to deals that predate the upload log so older records are not left blank.",
    where: "Deal page header",
  },
  {
    id: "2026-07-21-bundled-json-upload",
    date: "2026-07-21",
    category: "improved",
    title: "One JSON file can carry a deal plus its lease abstracts",
    detail:
      "A single upload can now load a deal, its lease abstracts and its site agreements together, instead of three separate passes.",
    where: "Upload → Upload JSON",
  },
  {
    id: "2026-07-16-unsupported-doc-advisory",
    date: "2026-07-16",
    category: "improved",
    title: "The uploader tells you when a document is the wrong kind",
    detail:
      "Dropping a raw lease or an REA used to fail quietly. You now get a clear note saying what the file is and what to do with it instead.",
  },
];

/** Newest first, and never a date in the future (a mis-typed entry must not hide everything else). */
export function visibleChangelog(now: Date = new Date(), isAdmin = false): ChangeEntry[] {
  const today = isoDay(now);
  return CHANGELOG.filter(e => e.date <= today && (isAdmin || !e.adminOnly)).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

/**
 * Entries shipped AFTER `cutoff` — the instant this reader was last shown the list
 * (or, if they never have been, their previous sign-in).
 *
 * Compared by DAY, strictly greater. Entries are dated to the day rather than the
 * minute, so a same-day comparison has to round one way or the other: rounding so
 * that dismissing the list also settles everything dated today means the modal
 * never re-opens on you an hour later, at the cost of a same-day entry waiting
 * until tomorrow. The "What's new" button in the header shows the full list at any
 * time, so nothing is actually unreachable.
 *
 * A null cutoff means we have no idea when this person was last here — a brand-new
 * account. They get nothing rather than the entire history.
 */
export function entriesSince(cutoff: string | null | undefined, now: Date = new Date(), isAdmin = false): ChangeEntry[] {
  if (!cutoff) return [];
  const since = isoDay(new Date(cutoff));
  if (!since) return [];
  return visibleChangelog(now, isAdmin).filter(e => e.date > since);
}

function isoDay(d: Date): string {
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
