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
// the list is the only record the team reads. Newest FIRST.

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
export function visibleChangelog(now: Date = new Date()): ChangeEntry[] {
  const today = isoDay(now);
  return CHANGELOG.filter(e => e.date <= today).sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
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
export function entriesSince(cutoff: string | null | undefined, now: Date = new Date()): ChangeEntry[] {
  if (!cutoff) return [];
  const since = isoDay(new Date(cutoff));
  if (!since) return [];
  return visibleChangelog(now).filter(e => e.date > since);
}

function isoDay(d: Date): string {
  return isNaN(d.getTime()) ? "" : d.toISOString().slice(0, 10);
}
