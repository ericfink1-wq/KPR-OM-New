// Like-for-like rent benchmarks for Mark-to-Market (Eric, 10/16/26). Comparing every
// store to ONE national brand median produced nonsense — Santander $16.40 vs $40,
// AutoZone $6.50 vs $12.25, Office Depot $5 vs $19.50 — because pads, ground leases
// and very different box sizes were mixed together. Here a store is compared only to
// the same brand, in the same SIZE BAND and REGION (falling back to national within
// the size band when the region is thin), with ground leases / pads / kiosks left out
// on both sides. Medians are recency-weighted by lease commencement (10-yr fade, same
// horizon the connector uses). With fewer than 5 peers the store's PERCENTILE is the
// honest read, not a % gap.
import type { Deal, Tenant } from "./idb";
import { tenantKey, isVacant, isNAPTenant } from "./utils";

export type SizeBand = "<10k" | "10–25k" | "25–50k" | "50k+";
export function sizeBand(sf: number): SizeBand {
  return sf < 10_000 ? "<10k" : sf < 25_000 ? "10–25k" : sf < 50_000 ? "25–50k" : "50k+";
}

const REGION: Record<string, string> = {};
for (const s of ["CT", "ME", "MA", "NH", "RI", "VT", "NJ", "NY", "PA"]) REGION[s] = "Northeast";
for (const s of ["IL", "IN", "MI", "OH", "WI", "IA", "KS", "MN", "MO", "NE", "ND", "SD"]) REGION[s] = "Midwest";
for (const s of ["DE", "DC", "FL", "GA", "MD", "NC", "SC", "VA", "WV", "AL", "KY", "MS", "TN", "AR", "LA", "OK", "TX"]) REGION[s] = "South";
for (const s of ["AZ", "CO", "ID", "MT", "NV", "NM", "UT", "WY", "AK", "CA", "HI", "OR", "WA"]) REGION[s] = "West";
export const regionOf = (state?: string | null) => REGION[String(state || "").trim().toUpperCase()] ?? null;

const n = (v: unknown) => { const x = Number(v); return Number.isFinite(x) ? x : null; };

/** Ground leases, pads/outparcels, ATMs and kiosks don't price like a building lease. */
export function isGroundOrPad(t: Tenant): boolean {
  const s = `${t.name ?? ""} ${t.leaseType ?? ""} ${t.reimbursementMethod ?? ""} ${t.suite ?? ""}`.toLowerCase();
  if (/\bground\b|\bgl\b|\(gl\)|ground lease|land lease|\bpad\b|out ?parcel|\batm\b|kiosk|billboard|cell tower|antenna/.test(s)) return true;
  const sf = n(t.sf);
  return sf != null && sf > 0 && sf < 400;
}

interface PeerRow { rent: number; weight: number; dealId: string; tenantIdx: number }
export interface PeerSet {
  basis: "region" | "national";
  band: SizeBand;
  region: string | null;
  n: number;
  median: number;
  /** 0–100: share of peers paying LESS than this store. */
  percentile: number;
  years: [number | null, number | null];
}

const yearOf = (v: unknown): number | null => { const m = /^(\d{4})/.exec(String(v ?? "")); return m ? Number(m[1]) : null; };
const HORIZON = 10;
function recencyWeight(t: Tenant, d: Deal, now: number): number {
  const y = yearOf(t.leaseStart) ?? yearOf(d.tenantsAsOf) ?? yearOf(d.uploadedAt);
  if (y == null) return 0.5;
  const age = Math.max(0, now - y);
  return Math.max(0, 1 - age / HORIZON);
}
function weightedMedian(rows: PeerRow[]): number {
  const s = [...rows].sort((a, b) => a.rent - b.rent);
  const total = s.reduce((a, r) => a + r.weight, 0);
  if (total <= 0) return s[Math.floor(s.length / 2)].rent;
  let acc = 0;
  for (const r of s) { acc += r.weight; if (acc >= total / 2) return r.rent; }
  return s[s.length - 1].rent;
}

export interface PeerIndex { get(t: Tenant, d: Deal, tenantIdx: number): PeerSet | null }

export function buildPeerIndex(allDeals: Deal[], nowYear = new Date().getFullYear()): PeerIndex {
  const byKey = new Map<string, PeerRow[]>();   // brand|band|region  and  brand|band|*
  const add = (k: string, r: PeerRow) => { const a = byKey.get(k); if (a) a.push(r); else byKey.set(k, [r]); };
  const yearsByKey = new Map<string, number[]>();
  for (const d of allDeals) {
    if (d.trashedAt) continue;
    const region = regionOf(d.state);
    (d.tenants || []).forEach((t, i) => {
      if (!t || isVacant(t.name) || isNAPTenant(t) || isGroundOrPad(t)) return;
      const rent = n(t.rentPerSF), sf = n(t.sf);
      if (rent == null || rent <= 0 || sf == null || sf <= 0) return;
      const brand = tenantKey(t.canonicalName || t.name || "");
      if (!brand) return;
      const band = sizeBand(sf);
      const row = { rent, weight: recencyWeight(t, d, nowYear), dealId: d.id, tenantIdx: i };
      add(`${brand}|${band}|*`, row);
      if (region) add(`${brand}|${band}|${region}`, row);
      const y = yearOf(t.leaseStart);
      if (y != null) { const k = `${brand}|${band}|*`; const a = yearsByKey.get(k); if (a) a.push(y); else yearsByKey.set(k, [y]); }
    });
  }
  return {
    get(t, d, tenantIdx) {
      if (isGroundOrPad(t)) return null;
      const rent = n(t.rentPerSF), sf = n(t.sf);
      if (rent == null || rent <= 0 || sf == null || sf <= 0) return null;
      const brand = tenantKey(t.canonicalName || t.name || "");
      const band = sizeBand(sf);
      const region = regionOf(d.state);
      const others = (k: string) => (byKey.get(k) || []).filter(r => !(r.dealId === d.id && r.tenantIdx === tenantIdx));
      let basis: PeerSet["basis"] = "region";
      let peers = region ? others(`${brand}|${band}|${region}`) : [];
      if (peers.length < 3) { basis = "national"; peers = others(`${brand}|${band}|*`); }
      if (peers.length < 2) return null;
      const below = peers.filter(p => p.rent < rent).length;
      const ys = yearsByKey.get(`${brand}|${band}|*`) || [];
      return {
        basis, band, region: basis === "region" ? region : null, n: peers.length,
        median: Math.round(weightedMedian(peers) * 100) / 100,
        percentile: Math.round((below / peers.length) * 100),
        years: ys.length ? [Math.min(...ys), Math.max(...ys)] : [null, null],
      };
    },
  };
}
