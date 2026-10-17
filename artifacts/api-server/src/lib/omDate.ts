// OM DATE (Eric, 10/17/26: "the history feature needs dates on the OMs — about 220 deals had
// none; fill them from the PDF, or from the upload date as a fallback"). Deterministic, no
// model. Tries, in order: the document's own text near the cover, then the file name, then
// the upload date — and always records WHICH, so an upload date is never presented as the
// date the OM printed.
export type OmDateSource = "pdf" | "file-name" | "upload-date";

const MONTHS: Record<string, number> = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12 };
const iso = (y: number, m: number, d = 1) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
const plausible = (y: number, m: number, d: number, now: Date) => {
  if (y < 2005 || m < 1 || m > 12 || d < 1 || d > 31) return false;
  return Date.UTC(y, m - 1, d) <= now.getTime() + 60 * 86400_000; // an OM isn't dated far in the future
};
// A date an OM prints about ITSELF is never AFTER it was uploaded — a later one is the OM's
// assumed closing ("as of 1/1/27", which most OMs use to start the cash flow). It CAN be
// years before: older OMs get recorded too (New Garden's 2021 OM was uploaded in 2026).
const nearUpload = (isoDate: string, uploadedAt: string | null | undefined) => {
  if (!uploadedAt || !/^\d{4}-\d{2}-\d{2}/.test(uploadedAt)) return true;
  return Date.parse(isoDate) <= Date.parse(uploadedAt.slice(0, 10)) + 31 * 86400_000;
};

const MONTH_RE = "(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const DATE_RE = `(${MONTH_RE}\\.? \\d{1,2},? 20\\d{2}|${MONTH_RE}\\.?,? 20\\d{2}|\\d{1,2}/\\d{1,2}/(?:20)?\\d{2}|20\\d{2}-\\d{2}-\\d{2})`;
// Labels that introduce the document's OWN date, weighted by how reliably they mean it.
const LABELS: Array<[RegExp, number]> = [
  [new RegExp(`rent\\s*roll[^.]{0,40}?(?:as of|dated|date)\\W{0,4}${DATE_RE}`, "gi"), 3],
  [new RegExp(`(?:offering memorandum|investment summary|executive summary)[^.]{0,60}?${DATE_RE}`, "gi"), 3],
  [new RegExp(`\\b(?:as of|dated|prepared|updated|published|current as of)\\W{0,4}${DATE_RE}`, "gi"), 2],
];

/** Labelled dates anywhere in the text ("Rent Roll as of October 1, 2026", "as of 9/30/2026").
 *  Each candidate scores by its label; the best-supported date wins, ties to the later one. */
function labelledDate(text: string, now: Date, uploadedAt?: string | null): string | null {
  const t = text.replace(/\s+/g, " ");
  const score = new Map<string, number>();
  for (const [re, w] of LABELS) {
    re.lastIndex = 0;
    for (let m = re.exec(t); m; m = re.exec(t)) {
      const d = scan(m[1], now);
      if (d && nearUpload(d, uploadedAt)) score.set(d, (score.get(d) ?? 0) + w);
    }
  }
  let best: string | null = null, bestScore = 0;
  for (const [d, sc] of score) if (sc > bestScore || (sc === bestScore && best && d > best)) { best = d; bestScore = sc; }
  return best;
}

/** Dates written the way a cover / file name prints them. Returns the first plausible one. */
function scan(text: string, now: Date): string | null {
  const t = text.replace(/\s+/g, " ");
  const tests: Array<[RegExp, (m: RegExpExecArray) => [number, number, number] | null]> = [
    // "February 15, 2021"
    [/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.? (\d{1,2}),? (20\d{2})\b/i,
      m => [Number(m[3]), MONTHS[m[1].toLowerCase().slice(0, 3)], Number(m[2])]],
    // "February 2021", "Sept. 2025"
    [/\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\.?,? (20\d{2})\b/i,
      m => [Number(m[2]), MONTHS[m[1].toLowerCase().slice(0, m[1].toLowerCase().startsWith("sept") ? 4 : 3)] ?? MONTHS[m[1].toLowerCase().slice(0, 3)], 1]],
    // "Oct-25", "Oct 25" (two-digit year — only in a file name / cover, so read as 20YY)
    [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[-' ](\d{2})\b/i, m => [2000 + Number(m[2]), MONTHS[m[1].toLowerCase()], 1]],
    // "2026.10.16", "2026-10-16"
    [/\b(20\d{2})[.\-_](\d{1,2})[.\-_](\d{1,2})\b/, m => [Number(m[1]), Number(m[2]), Number(m[3])]],
    // "10/16/2026", "10.16.26"
    [/\b(\d{1,2})[/.](\d{1,2})[/.](20\d{2}|\d{2})\b/, m => [m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3]), Number(m[1]), Number(m[2])]],
  ];
  for (const [re, f] of tests) {
    const m = re.exec(t);
    if (!m) continue;
    const r = f(m);
    if (r && plausible(r[0], r[1], r[2], now)) return iso(r[0], r[1], r[2]);
  }
  return null;
}

/** Pure. The cover first; then only LABELLED dates elsewhere — a whole OM is full of lease and
 *  sale dates that are not its own, so an unlabelled date past the cover is never taken. */
export function findOmDate(input: { sourceText?: string | null; fileName?: string | null; uploadedAt?: string | null }, now = new Date()): { omDate: string; omDateSource: OmDateSource } | null {
  const cover = (input.sourceText ?? "").slice(0, 1500);
  const fromCover = cover ? scan(cover, now) : null;
  if (fromCover && nearUpload(fromCover, input.uploadedAt)) return { omDate: fromCover, omDateSource: "pdf" };
  // No date on the cover (common): a labelled date anywhere — the rent roll's "as of", a
  // footer "dated …" — still beats the upload date (Eric, 10/17/26).
  const fromBody = input.sourceText ? labelledDate(input.sourceText, now, input.uploadedAt) : null;
  if (fromBody) return { omDate: fromBody, omDateSource: "pdf" };
  const fromName = input.fileName ? scan(input.fileName.replace(/\.(pdf|xlsx?)$/i, ""), now) : null;
  if (fromName) return { omDate: fromName, omDateSource: "file-name" };
  // The upload-date stand-in only for a record that came from a DOCUMENT — a hand-added
  // property (no file, no text) has no OM to date.
  const fromDoc = !!(input.fileName && input.fileName.trim()) || !!(input.sourceText && input.sourceText.trim());
  const up = fromDoc && typeof input.uploadedAt === "string" && /^\d{4}-\d{2}-\d{2}/.test(input.uploadedAt) ? input.uploadedAt.slice(0, 10) : null;
  return up ? { omDate: up, omDateSource: "upload-date" } : null;
}
