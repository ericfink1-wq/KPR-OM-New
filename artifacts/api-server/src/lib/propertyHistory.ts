// PROPERTY HISTORY (Eric, 10/17/26): "newer data should win versus the older data, but it's
// also always good to have historical data baked into the analysis — re-tenanting of big
// spaces, bankruptcies, backfills, et cetera — so we keep a running history of what happened
// at the property." The newer document still sets every headline figure; this keeps a dated,
// DETERMINISTIC record (no model, nothing invented) of what changed between the two:
// departures, arrivals, backfills, renewals, anchor rent moves, dark stores, and the headline
// metrics then vs now. Stored on the deal as `propertyHistory`, newest first.

export type HistoryEventKind = "left" | "arrived" | "backfill" | "renewed" | "rent" | "dark" | "metric";
export interface HistoryEvent { kind: HistoryEventKind; text: string }
export interface HistoryMetrics { noi?: number | null; occupancy?: number | null; totalSF?: number | null; walt?: number | null; tenants?: number | null; askingPrice?: number | null }
export interface HistoryEntry {
  id: string;            // stable: dedupes a re-run of the same comparison
  recordedAt: string;    // when the site recorded it
  fromAsOf: string | null; toAsOf: string | null;   // the two documents' dates
  fromSource: string | null; toSource: string | null;
  before: HistoryMetrics; after: HistoryMetrics;
  events: HistoryEvent[];
}

type T = Record<string, unknown>;
const num = (v: unknown): number | null => { const n = typeof v === "string" ? Number(v.replace(/[$,%\s]/g, "")) : Number(v); return v == null || v === "" || !Number.isFinite(n) ? null : n; };
const isVacant = (n: unknown) => /^\s*(vacant|vacancy|available|avail\b|white box|dark space)\b/i.test(String(n ?? ""));
const day = (v: unknown) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
/** Brand key: "Office Depot (GL)" ≡ "Office Depot"; "Lily & Co. Beauty Lounge" ≡ "Lily & Company Beauty Lounge". */
export function brandKey(name: unknown): string {
  return String(name ?? "").toLowerCase()
    .replace(/\([^)]*\)/g, " ").replace(/#\s*\w+/g, " ").replace(/&/g, " and ")
    .replace(/\b(co|company|inc|llc|corp|corporation|the|store|stores)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim();
}
const money = (n: number) => n >= 1e6 ? `$${(n / 1e6).toFixed(2)}M` : `$${Math.round(n).toLocaleString()}`;
const sfTxt = (n: number | null) => n ? `${Math.round(n).toLocaleString()} SF` : "";
// When the document's picture applies: the rent-roll date — unless it's the OM's forward-dated
// ASSUMED closing (common: "as of 1/1/27"), then the OM's own date, then the upload.
const docDate = (d: T) => {
  const roll = day(d.tenantsAsOf);
  if (roll && Date.parse(roll) <= Date.now() + 86400_000) return roll;
  return day(d.omDate) ?? day(d.lastUploadAt) ?? day(d.uploadedAt) ?? roll;
};
const docLabel = (d: T) => (typeof d.fileName === "string" && d.fileName.trim()) ? d.fileName.trim() : null;
const metrics = (d: T, ts: T[]): HistoryMetrics => ({
  noi: num(d.noi), occupancy: num(d.occupancy), totalSF: num(d.totalSF), walt: num(d.walt),
  tenants: ts.filter(t => !isVacant(t.name)).length || null, askingPrice: num(d.askingPrice),
});
const isBig = (t: T) => t.isAnchor === true || (num(t.sf) ?? 0) >= 15000;

/** Pure: what changed from the PRIOR document's picture to the NEW one. */
export function diffSnapshots(prev: T, next: T): HistoryEvent[] {
  const pt = (Array.isArray(prev.tenants) ? prev.tenants as T[] : []).filter(t => t?.name && !isVacant(t.name) && !t.isNAP);
  const nt = (Array.isArray(next.tenants) ? next.tenants as T[] : []).filter(t => t?.name && !isVacant(t.name) && !t.isNAP);
  const events: HistoryEvent[] = [];
  if (pt.length && nt.length) {
    const nByKey = new Map(nt.map(t => [brandKey(t.name), t]));
    const pByKey = new Map(pt.map(t => [brandKey(t.name), t]));
    const gone = pt.filter(t => !nByKey.has(brandKey(t.name)));
    const fresh = nt.filter(t => !pByKey.has(brandKey(t.name)));
    // Backfill: a newcomer in the departed tenant's suite, or (big boxes) a near-identical footprint.
    const used = new Set<T>();
    for (const g of gone) {
      const gs = num(g.sf), gSuite = String(g.suite ?? "").trim().toLowerCase();
      const hit = fresh.find(f => !used.has(f) && (
        (gSuite && String(f.suite ?? "").trim().toLowerCase() === gSuite && (!gs || !num(f.sf) || Math.abs((num(f.sf)! - gs) / gs) <= 0.25))
        || (gs != null && gs >= 10000 && num(f.sf) != null && Math.abs((num(f.sf)! - gs) / gs) <= 0.05)));
      if (hit) {
        used.add(hit);
        events.push({ kind: "backfill", text: `${g.name}${gs ? ` (${sfTxt(gs)})` : ""} replaced by ${hit.name}${num(hit.sf) ? ` (${sfTxt(num(hit.sf))})` : ""}` });
      } else {
        events.push({ kind: "left", text: `${g.name}${gs ? ` (${sfTxt(gs)})` : ""} is no longer on the roster${g.leaseExpiry ? ` — lease was to ${day(g.leaseExpiry) ?? g.leaseExpiry}` : ""}` });
      }
    }
    for (const f of fresh) if (!used.has(f)) events.push({ kind: "arrived", text: `${f.name}${num(f.sf) ? ` (${sfTxt(num(f.sf))})` : ""} added${day(f.leaseStart) ? `, lease from ${day(f.leaseStart)}` : ""}` });
    // Same tenant, both documents.
    for (const n of nt) {
      const p = pByKey.get(brandKey(n.name)); if (!p) continue;
      const pe = day(p.leaseExpiry), ne = day(n.leaseExpiry);
      if (pe && ne && Date.parse(ne) - Date.parse(pe) > 180 * 86400_000) events.push({ kind: "renewed", text: `${n.name} extended: lease to ${pe} → ${ne}` });
      const pr = num(p.rentPerSF), nr = num(n.rentPerSF);
      if (isBig(n) && pr && nr && Math.abs(nr - pr) / pr >= 0.03) events.push({ kind: "rent", text: `${n.name} base rent $${pr.toFixed(2)} → $${nr.toFixed(2)}/SF` });
      if (n.isDark === true && p.isDark !== true) events.push({ kind: "dark", text: `${n.name} has gone dark (closed, lease in place)` });
    }
  }
  const b = metrics(prev, pt), a = metrics(next, nt);
  if (b.noi && a.noi && Math.abs(a.noi - b.noi) / b.noi >= 0.03) events.push({ kind: "metric", text: `NOI ${money(b.noi)} → ${money(a.noi)} (${a.noi > b.noi ? "+" : ""}${Math.round(((a.noi - b.noi) / b.noi) * 1000) / 10}%)` });
  if (b.occupancy != null && a.occupancy != null && Math.abs(a.occupancy - b.occupancy) >= 1) events.push({ kind: "metric", text: `Occupancy ${b.occupancy}% → ${a.occupancy}%` });
  if (b.totalSF && a.totalSF && Math.abs(a.totalSF - b.totalSF) / b.totalSF >= 0.02) events.push({ kind: "metric", text: `GLA ${sfTxt(b.totalSF)} → ${sfTxt(a.totalSF)}` });
  return events;
}

/** Append the prev→next comparison to next.propertyHistory (mutates next). Returns whether an entry was added. */
// A document's PERMANENT identity (its upload stamp), so a later OM-date correction can never
// make the same comparison look new and get recorded twice.
const docKey = (d: T) => String(d.lastUploadAt ?? d.uploadedAt ?? d.omDate ?? d.fileName ?? "?");
export function recordHistory(prev: T, next: T, now = new Date().toISOString(), key?: string): boolean {
  const events = diffSnapshots(prev, next);
  if (!events.length) return false;
  const fromAsOf = docDate(prev), toAsOf = docDate(next);
  const id = key ?? `${docKey(prev)}→${docKey(next)}`;
  const prior = Array.isArray(next.propertyHistory) ? (next.propertyHistory as HistoryEntry[]) : Array.isArray(prev.propertyHistory) ? (prev.propertyHistory as HistoryEntry[]) : [];
  if (prior.some(h => h.id === id)) return false;
  const pt = Array.isArray(prev.tenants) ? prev.tenants as T[] : [], nt = Array.isArray(next.tenants) ? next.tenants as T[] : [];
  const entry: HistoryEntry = { id, recordedAt: now, fromAsOf, toAsOf, fromSource: docLabel(prev), toSource: docLabel(next),
    before: metrics(prev, pt), after: metrics(next, nt), events };
  next.propertyHistory = [entry, ...prior].slice(0, 40);
  return true;
}

/** A NEW document replaced the deal's picture (a fresh upload), as opposed to an ordinary edit. */
export function isNewDocument(prev: T, next: T): boolean {
  const changed = (k: string) => typeof next[k] === "string" && next[k] !== prev[k];
  return Array.isArray(prev.tenants) && (prev.tenants as unknown[]).length > 0 && (changed("lastUploadAt") || changed("tenantsAsOf"));
}

/** Compact form for the AI analysis snapshot. */
export function historyForAnalysis(d: T): Array<{ from: string | null; to: string | null; changes: string[] }> | undefined {
  const h = Array.isArray(d.propertyHistory) ? d.propertyHistory as HistoryEntry[] : [];
  return h.length ? h.slice(0, 5).map(e => ({ from: e.fromAsOf, to: e.toAsOf, changes: e.events.map(x => x.text).slice(0, 15) })) : undefined;
}
