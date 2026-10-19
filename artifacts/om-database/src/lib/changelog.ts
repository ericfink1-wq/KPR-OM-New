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
  new:      { fg: "#3e8a2f", bg: "#eef3e6", border: "#b8d49a" },
  improved: { fg: "#1d4ed8", bg: "#eff6ff", border: "#bfdbfe" },
  fixed:    { fg: "#9a5b12", bg: "#fdf4e7", border: "#f0d9b5" },
  data:     { fg: "#0f766e", bg: "#f0fdfa", border: "#99f6e4" },
};

export const CHANGELOG: ChangeEntry[] = [
  {
    id: "2026-10-19-credit-watch",
    date: "2026-10-19",
    category: "improved",
    title: "Credit Watch shows flagged brands first, one row per brand",
    detail: "Credit Watch now opens on brands that need a look — on the watchlist, or with a distress headline — with a switch to see every brand. A headline that only names states where we have no store for that brand (PNC closing Colorado branches) is left out. Store numbers are stripped everywhere (\"Walgreens #5282\" is just Walgreens), and the watchlist card in Portfolio Analytics now uses the same rent as Credit Watch, so a brand's total matches in both places.",
    where: "Asset Mgmt → Credit Watch; Portfolio Analytics → Owned",
  },
  {
    id: "2026-10-19-am-dates-properties",
    date: "2026-10-19",
    category: "improved",
    title: "Key debt deadlines, one row per portfolio covenant, and an owner for every property",
    detail: "The Dates tab now pins rate-cap expirations, extension-notice windows and loans maturing within a year at the top, whatever window you pick. A covenant tested across a whole portfolio loan (Cedar's debt-yield test) shows once instead of on every property. Each property can carry an asset manager, which the Dates tab and the home \"This week\" card use. On Properties, a budget for a property bought mid-year is labelled \"partial-year budget\" and no longer coloured red or green, the ledger basis is shown on every row, and properties that aren't in Datex say so (Fred Meyer Bend is single-tenant; Providence isn't set up in Datex yet).",
    where: "Asset Mgmt → Dates and Properties",
  },
  {
    id: "2026-10-19-debt-floating",
    date: "2026-10-19",
    category: "improved",
    title: "Debt tab prices floating loans, counts rate caps, and fits one line per loan",
    detail: "Floating loans now show an all-in rate estimated from today's 1M Term SOFR (or the loan's index floor, whichever is higher) plus the spread, marked with a ~, so the weighted average rate covers nearly all the debt. Loans under a live rate cap are counted as capped, and the rate tile splits fixed/swapped, capped and floating. Swaps whose terms are now complete (Overland, Pointe Plaza) are priced instead of saying \"terms pending\". The loans table is one line per loan; tap a row to open every field in a side panel.",
    where: "Asset Mgmt → Debt",
  },
  {
    id: "2026-10-19-am-import-match",
    date: "2026-10-19",
    category: "fixed",
    adminOnly: true,
    title: "Importing loans, swaps and covenants updates them instead of adding duplicates",
    detail: "A re-import now recognises a loan by its property and loan label, a swap by its property and swap (or loan) label, and a covenant by its property and type. A corrected maturity, lender, amount or covenant level updates the saved row, and anything the import doesn't include is kept. The preview shows each change as old → new before you save. If a property already has two rows with the same label, the import holds that row back and tells you, so you can delete the extra first.",
    where: "Asset Mgmt → Debt → Import loans & swaps",
  },
  {
    id: "2026-10-18-roster-scrub",
    date: "2026-10-18",
    category: "new",
    title: "Roster scrub: every OM in the same standard format, plus a one-line roster",
    detail: "The Tenants tab now opens with a roster scrub: leased %, in-place rent, investment-grade share, top-5 concentration, WALT, rent rolling in 12/24/36 months, and below- and above-market rent against the library (shown separately, never netted). Proposed or unsigned leases are left out of occupancy, rent and NOI unless you switch them on. Each tenant gets flags you can filter by and a market-rent benchmark. Two new downloads build the same layout for every OM: a KPR Standard Rent Roll in Excel and a one-page KPR OM Summary PDF. The roster itself now fits one line per tenant (recovery chip, next rent step, options, abstract icon). Tap a row for the full detail.",
    where: "Any deal → Tenants & Sales",
  },
  {
    id: "2026-10-18-design-refresh",
    date: "2026-10-18",
    category: "improved",
    title: "A cleaner look across the site, and a new home page",
    detail: "Every page now uses the KPR colors and type, with consistent headers, cards, tables and buttons, and loading placeholders instead of blank screens. The home page opens with today's date and live owned-portfolio figures from Datex: occupancy, NOI vs. budget, total debt and the next maturity. The library tiles show trends, the pipeline cards are larger with photos, and \"This week\" is a timeline colored by urgency. Datex leasing activity is now labelled as applications, not signed deals.",
    where: "Home page and every page",
  },
  {
    id: "2026-10-18-asset-mgmt-polish",
    date: "2026-10-18",
    category: "fixed",
    title: "Clearer Datex figures for owned properties",
    detail: "NOI vs budget now shows whether Datex books the property on a cash or accrual basis, with a note that cash-basis timing can swing year-to-date figures. A/R past 60 and 90 days now counts current tenants only, and lists balances left by tenants who have moved out (such as Big Lots) separately. The rent-roll size check now allows for suites listed twice and signed-but-not-open leases, and only warns when the gap is above 5%. A tenant month that looks like a whole year's sales keyed into one month is now left out of the 12-month total and marked with a \"suspect month\" chip. Flat leases read \"Flat to Mar-30\" instead of showing a step to the same rent, and the deal-page tab menus open only when you click the small arrow.",
    where: "Asset Mgmt → Properties, owned deal pages, and the Tenants & Sales roster",
  },
  {
    id: "2026-10-18-owned-deal-page",
    date: "2026-10-18",
    category: "improved",
    title: "Owned deal pages: a new Asset tab, live covenants, and a cleaner layout",
    detail: "Owned properties now open on an Asset tab. It shows Datex occupancy, base rent, NOI year to date vs. budget, debt, DSCR, debt yield and the next critical date. Below that are a covenant monitor with live headroom, plan vs. actual, a since-acquisition timeline, and a button that drafts the quarterly investor-letter paragraph (one AI call, only when you click). Financing now reads the loan and swap from Asset Mgmt, with interest-only debt service, swap mark-to-market and links to the loan documents. Transaction shows the acquisition details. The page header and tab bar appear once, cap rate and price/SF are computed for owned deals, and the CAM text opens in a side panel. The roster flags holdover leases and passed option notices, and no longer counts utility closets and ATMs as vacancy. Tenant sales flag identical year-over-year figures and tuck former tenants behind a toggle.",
    where: "Any owned property's deal page",
  },
  {
    id: "2026-10-18-asset-mgmt",
    date: "2026-10-18",
    category: "new",
    title: "Asset Mgmt: debt, critical dates, live Datex and tenant credit for owned properties",
    detail: "A new Asset Mgmt section covers KPR's owned properties only. Debt lists every loan and swap with its all-in rate, a maturity wall, a mark-to-market on each swap from today's 1-Month Term SOFR curve, and red or amber flags when maturity is within 12 or 18 months. Dates gathers lease expirations, option notice deadlines, co-tenancy and kick-out dates, and loan and swap maturities, with days remaining and who owns each one. Properties shows each building's latest Datex figures. Credit Watch ranks your tenants by share of rent and checks the news daily for bankruptcies and store closures. Tap Details on any loan or swap to see its covenants, prepayment terms, notes and open questions. Preferred equity has its own section and is kept out of total debt. Each owned deal page now opens with Datex today vs. the OM, A/R, NOI vs. budget, tenant sales and occupancy cost, and the next dates. The home page gets a \"This week\" list.",
    where: "Asset Mgmt (top bar; Analytics on a phone), owned deal pages, and the home page",
  },
  {
    id: "2026-10-18-asset-mgmt-admin",
    date: "2026-10-18",
    category: "new",
    adminOnly: true,
    title: "Asset Mgmt editing: loans, swaps, dates and the Datex building map",
    detail: "Admins can add, edit and delete loans, swaps and critical dates, each with a source note. You can also paste a JSON or CSV file to import many at once; it previews before it saves. A swap whose notional or maturity isn't documented yet saves as \"terms pending\" and stays out of the mark-to-market. The Datex building map that links each owned deal to its Datex building IDs can now be edited on the Properties tab. The import now also takes covenants, acquisitions and option statuses, keeps every column it doesn't recognise, and turns Drive file IDs into links. On an owned deal's Asset tab, \"Detect from loan docs\" proposes covenants for you to review before saving. The Datex snapshot recipe is now a page you can open in the browser. Datex can now refresh itself: create a token under Properties → Datex auto-refresh, and a scheduled Claude task posts only what changed (anything it doesn't send is kept). The last run shows at the top of the Properties tab. The scheduled task can also get its own 3-hour credentials through the KPR Claude connector (admins only, every one logged), and auto-refresh can be switched off in the same window.",
    where: "Asset Mgmt → Debt, Dates and Properties",
  },
  {
    id: "2026-10-17-rates-term-sofr",
    date: "2026-10-17",
    category: "improved",
    title: "Today's Rates: live swap rates on 1-Month Term SOFR, plus a loan sizer",
    detail: "Swap rates now come from the swap trades reported to DTCC's public data and land within about 1 basis point of Chatham's close. The panel leads with 1-Month Term SOFR swaps, which is what KPR's swapped loans use, and keeps the standard SOFR (annual/annual) curve for Daily Simple SOFR loans like Overland. The swap-breakage estimate on deal pages now uses the 1-Month Term curve too. Size a loan off any base rate with your spread, premium and cushion. It tests DSCR, debt yield and LTV and highlights whichever one limits the loan. Star a base rate to make it your default; your inputs are remembered on any device.",
    where: "Today's Rates (top bar, or ☰ on a phone)",
  },
  {
    id: "2026-10-17-site-refresh",
    date: "2026-10-17",
    category: "improved",
    title: "A cleaner, faster site on desktop and phone",
    detail: "The home page has a new look in KPR's colors, with your owned portfolio, pipeline cards and the deals that need attention. On a phone, the main sections are tabs along the bottom and the Deal Library is a list of cards. The less-used items now sit in the ☰ menu. Every page has its own link you can copy and send, and Escape closes any open window. The site also loads much faster, with photos and data a fraction of their old size.",
    where: "Everywhere",
  },
  {
    id: "2026-10-17-ai-writeups",
    date: "2026-10-17",
    category: "improved",
    title: "Every AI write-up redone under the new rules",
    detail: "Every deal has been re-analyzed. Above-market rent is treated as a roll-down risk, never as upside. The write-up's numbers have to match the deal's own figures, and any mismatch shows up as a review question. Office, medical and bank tenants no longer count as anchors, and pending sales are never mentioned. Go-dark figures now name the actual tenant, and opening a deal no longer re-scores it on its own.",
    where: "Deal page → Overview and AI Analysis",
  },
  {
    id: "2026-10-17-owned-datex",
    date: "2026-10-17",
    category: "improved",
    title: "Owned portfolio: one count everywhere, and today's Datex numbers",
    detail: "\"Owned\" now means the same thing on every page, and the investment-grade rent figure agrees everywhere too. Portfolio Analytics opens on Owned. An owned deal with a Datex snapshot shows today's occupancy and rent next to the OM's figures, and the owned rollover and top tenants use Datex's current tenant list. Portfolio Analytics → Owned also shows the rent with watchlist tenants and the rent at risk if a key anchor goes dark.",
    where: "Owned deal pages; Portfolio Analytics → Owned",
  },
  {
    id: "2026-10-17-property-history",
    date: "2026-10-17",
    category: "new",
    title: "Property history: what changed between OMs",
    detail: "When a newer OM or rent roll arrives for a center, the deal page keeps a dated history of what changed: tenants who left, backfills, renewals, anchor rent moves and stores gone dark, plus NOI and occupancy then vs now. The AI write-up uses it as background. Every OM now shows its date.",
    where: "Deal page → Summary → Property History",
  },
  {
    id: "2026-10-17-comps-valuation",
    date: "2026-10-17",
    category: "improved",
    title: "Cleaner comps and valuation",
    detail: "Comp averages now count only real sales. Duplicates are merged, the OMs' nearby competing centers have their own Competitive set tab, and prices carved out of portfolio deals are left out by default. A new chart plots cap rate by sale date. A deal's implied value uses only sales of the same center type. Mark-to-Market compares like-for-like stores and doesn't count dollars from thin samples. Florida closing costs show the right range and who pays for title.",
    where: "Comps; deal page → Market & Comps; Mark-to-Market; Closing Costs",
  },
  {
    id: "2026-10-17-records-uploads",
    date: "2026-10-17",
    category: "improved",
    title: "Sales are recorded when they close, and uploads ask before merging",
    detail: "A property stays Owned until its sale closes. Marking it Sold asks for the closing date, and a Sold deal missing its date or price is flagged. The pending-sale fields are gone. When an upload looks like a property that's already in the library, you choose whether to add to it, replace it or keep it separate. Leftover duplicate and blank deals from failed uploads were merged and moved to Trash, where they can be restored.",
    where: "Deal page → status tag; Upload",
  },
  {
    id: "2026-10-17-admin-tools",
    date: "2026-10-17",
    category: "new",
    adminOnly: true,
    title: "For admins: Chatham marks and comp cleanup",
    detail: "Paste Chatham's rates (the 1M Term SOFR and annual/annual tables) into Today's Rates. You'll see what was read before anything is saved. The mark becomes everyone's swap curve for that day, and the panel keeps a log of how far the free curve was from Chatham. On the Comps page, Clean up comp data shows its fixes and asks before writing anything.",
    where: "Today's Rates → Paste a Chatham mark; Comps page",
  },
  {
    id: "2026-10-16-occupancy-cost",
    date: "2026-10-16",
    category: "improved",
    title: "Occupancy cost for gross and modified-gross tenants",
    detail: "Occupancy cost used to appear only for straight NNN tenants. Now gross and modified-gross tenants get one too, worked out from their lease terms and the OM's expense budget. Tap a number to see the working. When the terms can't be read, the field is left blank rather than guessed. The roster's reimbursement labels now say GROSS or PARTIAL where that's what the lease says.",
    where: "Deal page → Tenants & Sales → Occ Cost and Reimb. columns",
  },
  {
    id: "2026-10-16-claude-access",
    date: "2026-10-16",
    category: "improved",
    title: "Easier Claude access setup, with KPR's rules built in",
    detail: "Claude access is now a step-by-step walkthrough with pictures of each screen. It also gives your Claude KPR's standing instructions: when to trust Datex versus the deal library, and to ask you for the signed lease or loan document instead of guessing. For example, Claude won't take a blank in Datex to mean a tenant has no renewal options.",
    where: "☰ menu → Claude access",
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
    id: "2026-10-14-multi-column-sort",
    date: "2026-10-14",
    category: "new",
    title: "Sort by several columns at once",
    detail: "The Deal Library, tenant rosters, Comps and every brand or parent-company page have a \"Sorted by\" bar. Add tiebreakers (e.g. State, then Sale date to see the latest trade in each market), flip a direction or remove a level. Blank values always sort to the bottom, and your choice is remembered on this device.",
    where: "Deal Library, rosters, Comps, brand pages",
  },
  {
    id: "2026-10-14-library-sort-autopass",
    date: "2026-10-14",
    category: "improved",
    title: "Newest uploads first, and prospects auto-pass after 6 weeks",
    detail: "Within each status group in the Deal Library, the most recently uploaded deals now sit at the top. A Prospect moves to Passed after 6 weeks with no new upload or status change. Reopening it or uploading new material restarts the clock.",
    where: "Deal Library",
  },
  {
    id: "2026-10-14-already-uploaded-warning",
    date: "2026-10-14",
    category: "new",
    title: "A heads-up before you re-upload a property that's already in the library",
    detail: "If you drop in an OM for a property someone already uploaded, the site stops first and tells you who uploaded it and when. Continue to update the existing deal, or Skip to save time and AI credits.",
    where: "Upload",
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
