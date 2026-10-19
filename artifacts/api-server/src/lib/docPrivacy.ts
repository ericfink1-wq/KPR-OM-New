// Document-link privacy (Eric, 10/19/26): links and ids pointing into Eric's Google Drive or
// SharePoint are visible ONLY to Eric's own account. Everyone else (Andy, Dan, any member)
// still sees each source's title / type / date / status / used-for — never the url, a Drive
// file id, or a Drive / SharePoint link pasted into free text.
//
// Enforced SERVER-SIDE, in two halves:
//  1. scrubForViewer — every JSON response to a non-owner (a res.json wrapper mounted after
//     the auth gate, plus the MCP tool results) is walked: hidden keys dropped, the url on
//     a debt-record source dropped, Drive/SharePoint links and Drive-style ids in any string
//     replaced with HIDDEN.
//  2. restoreHidden — a non-owner's SAVE is built from that scrubbed copy, so before it is
//     written the hidden values are put back from the stored record. Without this, Andy
//     editing a loan note would silently erase Eric's links.
// Pure; no DB. Tests: __tests__/docPrivacy.test.ts.

export const HIDDEN = "[link hidden]";
/** The seeded owner account (routes/auth.ts ensureUsersTable). */
export const OWNER_USER_ID = "usr_owner";

/** Eric's account(s): the seeded owner id, OWNER_EMAIL (default as in routes/auth.ts), and any extra
 *  address listed in DOC_LINK_OWNER_EMAILS (comma-separated). Nobody else is assumed to be Eric. */
export function ownerEmails(): Set<string> {
  const out = new Set<string>();
  out.add((process.env.OWNER_EMAIL || "efink@kprcenters.com").trim().toLowerCase());
  for (const e of (process.env.DOC_LINK_OWNER_EMAILS ?? "").split(",")) if (e.trim()) out.add(e.trim().toLowerCase());
  return out;
}
export function isDocOwner(u: { userId?: string | null; email?: string | null } | null | undefined): boolean {
  if (!u) return false;
  if (u.userId === OWNER_USER_ID) return true;
  const e = (u.email ?? "").trim().toLowerCase();
  return !!e && ownerEmails().has(e);
}

// Drive / Docs / SharePoint / OneDrive links, with or without the scheme.
const DOC_URL_RE = /(?:https?:\/\/)?(?:[a-z0-9-]+\.)*(?:drive\.google\.com|docs\.google\.com|drive\.usercontent\.google\.com|sharepoint\.com|1drv\.ms|onedrive\.live\.com)(?:[/?#][^\s<>"'()\]]*)?/gi;
// A Drive-style file id: a 25–44 char run of [A-Za-z0-9_-] standing alone, mixing upper, lower and digits
// (random-looking — ordinary words, hex hashes and lowercase UUIDs don't qualify).
const ID_RUN_RE = /(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{25,44}(?![A-Za-z0-9_-])/g;
// A run of ≥3 Capitalised words ("Powell-Center-Lewis-Center-OH-OM_v2", a real OM file name) is a name, not an id;
// a random Drive id practically never contains three "Xxxx" segments. Leaning towards hiding is the safe side.
const looksLikeDriveId = (t: string) => /[A-Z]/.test(t) && /[a-z]/.test(t) && /\d/.test(t)
  && t.split(/[-_]/).filter(seg => /^[A-Z][a-z]{2,}$/.test(seg)).length < 3;
export const isDocUrl = (s: string): boolean => { DOC_URL_RE.lastIndex = 0; const hit = DOC_URL_RE.test(s); DOC_URL_RE.lastIndex = 0; return hit; };

/** The hidden pieces of a string, in order (used to put them back on a save). */
export function hiddenParts(s: string): string[] {
  const out: string[] = [];
  const noUrls = s.replace(DOC_URL_RE, m => { out.push(m); return "\u0000"; });
  const parts = noUrls.split("\u0000");
  // Re-walk in order, collecting ids from the non-url pieces and interleaving with the urls.
  const ordered: string[] = [];
  parts.forEach((p, i) => {
    for (const m of p.match(ID_RUN_RE) ?? []) if (looksLikeDriveId(m)) ordered.push(m);
    if (i < out.length) ordered.push(out[i]);
  });
  return ordered;
}
export function scrubText(s: string): string {
  if (!s || s.startsWith("data:")) return s;
  return s.replace(DOC_URL_RE, HIDDEN).replace(ID_RUN_RE, m => (looksLikeDriveId(m) ? HIDDEN : m));
}

/** Keys whose value IS a Drive / file reference — dropped whole for a non-owner. */
const HIDDEN_KEY_SET = new Set(["sourceDocs", "fileId", "driveId", "driveFileId", "driveFolderId", "folderId", "webViewLink", "webContentLink"]);
/** Any key naming a Drive / SharePoint reference or a file / folder / doc id (driveFileIds, loanDocIds, sharepointUrl…). */
const isHiddenKey = (k: string) => HIDDEN_KEY_SET.has(k) || /drive|sharepoint|onedrive/i.test(k) || /(?:file|folder|doc)_?ids?$/i.test(k);
/** Keys whose string is an identifier the app needs intact (record ids, hashes, credentials shown once). */
// Never exempt a key that names a file / doc / link — "driveFileIds" leaked through the "…Ids" rule (caught live, 10/19/26).
const KEEP_KEY = (k: string) => !/drive|file|folder|doc|link|url|sharepoint|source/i.test(k) && (k === "id" || k === "ids" || /(?:Id|Ids|_id|ID|IDs|Hash|hash|token|Token|secret|Secret|fingerprint|Fingerprint|key|Key)$/.test(k) || /^(?:cover|coverThumb|image|images|logo|thumb)/.test(k));
/** A debt-record provenance entry ({title, docType, status, usedFor, url}) — its url is owner-only whatever the host. */
const isProvenance = (o: Record<string, unknown>) => "docType" in o || "usedFor" in o || ("status" in o && "title" in o);

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep copy with every owner-only link / id removed. Never mutates its input. */
export function scrubForViewer<T>(v: T, key = ""): T {
  if (typeof v === "string") return (KEEP_KEY(key) ? v : scrubText(v)) as unknown as T;
  if (Array.isArray(v)) return v.map(x => scrubForViewer(x, key)) as unknown as T;
  if (isObj(v)) {
    if (v instanceof Date) return v;
    const out: Record<string, unknown> = {};
    const prov = isProvenance(v);
    for (const [k, x] of Object.entries(v)) {
      if (isHiddenKey(k)) continue;
      if ((k === "url" || k === "link" || k === "href" || k === "webUrl") && typeof x === "string" && (prov || isDocUrl(x))) continue;
      out[k] = scrubForViewer(x, k);
    }
    return out as T;
  }
  return v;
}

/** Put a string's hidden pieces back: each HIDDEN in the incoming text takes the stored text's next hidden piece. */
function restoreText(inc: string, sto: string): string {
  if (!inc.includes(HIDDEN)) return inc;
  const parts = hiddenParts(sto);
  if (!parts.length) return inc;
  let i = 0;
  return inc.split(HIDDEN).reduce((acc, seg, j) => (j === 0 ? seg : acc + (i < parts.length ? parts[i++] : HIDDEN) + seg), "");
}
const identity = (o: unknown): string | null => isObj(o) ? String(o.id ?? o.title ?? o.name ?? o.agreementName ?? "") || null : null;

/** A non-owner's save, with every value they couldn't see put back from the stored copy. */
export function restoreHidden<T>(incoming: T, stored: unknown, key = ""): T {
  if (stored === undefined || stored === null) return incoming;
  if (typeof incoming === "string") return (typeof stored === "string" && !KEEP_KEY(key) ? restoreText(incoming, stored) : incoming) as unknown as T;
  if (Array.isArray(incoming)) {
    if (!Array.isArray(stored)) return incoming;
    return incoming.map((x, i) => {
      const id = identity(x);
      const match = id != null ? (identity(stored[i]) === id ? stored[i] : stored.find(s => identity(s) === id)) : stored[i];
      return restoreHidden(x, match, key);
    }) as unknown as T;
  }
  if (isObj(incoming)) {
    if (!isObj(stored)) return incoming;
    const out: Record<string, unknown> = { ...incoming };
    for (const [k, sv] of Object.entries(stored)) {
      if (k in incoming) { out[k] = restoreHidden(incoming[k], sv, k); continue; }
      // Absent because the viewer never saw it → keep the stored value.
      const wasHidden = isHiddenKey(k) || ((k === "url" || k === "link" || k === "href" || k === "webUrl") && typeof sv === "string" && (isProvenance(stored) || isDocUrl(sv)));
      if (wasHidden) out[k] = sv;
    }
    return out as T;
  }
  return incoming;
}

/** For a save: the incoming body as-is from the owner, with hidden values restored from the stored copy for anyone else. */
export function keepHiddenOnSave<T>(session: { userId?: string; userEmail?: string } | undefined, incoming: T, stored: unknown): T {
  return isDocOwner({ userId: session?.userId, email: session?.userEmail }) ? incoming : restoreHidden(incoming, stored);
}

/** Express: wrap res.json so a non-owner's responses are scrubbed. Credential / auth endpoints are left alone. */
const SKIP_PATHS = /^\/(?:auth|mcp-keys|am\/datex-auto\/tokens|datex\/|health)/;
export function docPrivacyMiddleware(req: { path: string; session?: { userId?: string; userEmail?: string } }, res: { json: (b: unknown) => unknown }, next: () => void): void {
  if (SKIP_PATHS.test(req.path) || isDocOwner({ userId: req.session?.userId, email: req.session?.userEmail })) { next(); return; }
  const orig = res.json.bind(res);
  res.json = (body: unknown) => orig(scrubForViewer(body));
  next();
}
