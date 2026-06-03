import type { Deal } from "./idb";
import { apiAiMessages, lessonGuidanceClient } from "./api";
import { robustParseJSON, isVacant } from "./utils";

// A leasing flyer is a marketing one-pager for a center's available space. It is
// NOT a sale OM and NOT a rent roll: it carries property facts, demographics,
// co-tenancy, available space, and good imagery — but no in-place rents/financials.
// We extract it to ENRICH a property (never to seed or alter the rent-roll roster).
export interface FlyerResult {
  propertyName: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  totalSF: number | null;
  yearBuilt: number | null;
  pop1mi: number | null;
  pop3mi: number | null;
  pop5mi: number | null;
  avgHHI1mi: number | null;
  avgHHI3mi: number | null;
  avgHHI5mi: number | null;
  medianHHI3mi: number | null;
  anchors: string[];
  coTenants: string[];
  shadowAnchors: string[];
  availableSpaces: { suite: string | null; sf: number | null }[];
  narrative: string | null;
}

export async function extractFlyer(text: string): Promise<FlyerResult> {
  const prompt = `You are a CRE data extraction engine. This is a LEASING FLYER (a marketing one-pager advertising available space at a retail shopping center). Extract the property's background facts — NOT a rent roll. It has no in-place rents or sale financials; do not invent any.

Return ONLY JSON (no markdown, no prose):
{
  "propertyName": string|null,
  "address": string|null, "city": string|null, "state": string|null, "zip": string|null,
  "totalSF": number|null, "yearBuilt": number|null,
  "pop1mi": number|null, "pop3mi": number|null, "pop5mi": number|null,
  "avgHHI1mi": number|null, "avgHHI3mi": number|null, "avgHHI5mi": number|null, "medianHHI3mi": number|null,
  "anchors": [string], "coTenants": [string], "shadowAnchors": [string],
  "availableSpaces": [{"suite": string|null, "sf": number|null}],
  "narrative": string|null
}

Rules:
- Numbers as plain integers (no $ or commas). null when not shown.
- Demographics: flyers usually show a 1 / 3 / 5-mile table of Population, Households, Average and Median Household Income. Map population and household income for each ring; capture median HH income at 3 miles when shown.
- anchors: the center's anchor / largest-tenant brands (e.g. grocer, major box).
- coTenants: the other notable named retailers AT this center (the tenant lineup, e.g. a stacking-plan / "retailers include" list). Brand names only. Mark a unit labeled "Available"/"Vacant" as available space, NOT a co-tenant.
- shadowAnchors: nearby/adjacent draws that are NOT part of this property (e.g. "adjacent Walmart Supercenter", a neighboring mall). Keep these OUT of coTenants.
- availableSpaces: each unit advertised as available/vacant, with its suite and SF.
- narrative: 1–3 sentence positioning summary if the flyer has marketing copy; else null.

${await lessonGuidanceClient("flyer")}
LEASING FLYER TEXT:
${text.slice(0, 30000)}`;

  const res = await apiAiMessages({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 3000,
    messages: [{ role: "user", content: prompt }],
  });
  const raw = res.content?.[0]?.text ?? "";
  let p: Record<string, unknown>;
  try { p = robustParseJSON(raw) as Record<string, unknown>; }
  catch { throw new Error("Couldn't parse the leasing flyer. Try a clearer file."); }

  const s = (v: unknown) => typeof v === "string" && v.trim() ? v.trim() : null;
  const n = (v: unknown) => (v == null || v === "" || isNaN(Number(v))) ? null : Number(v);
  const arr = (v: unknown) => Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : [];
  const spaces = Array.isArray(p.availableSpaces)
    ? (p.availableSpaces as unknown[]).map(x => {
        const o = x as Record<string, unknown>;
        return { suite: s(o.suite), sf: n(o.sf) };
      }).filter(x => x.suite || x.sf)
    : [];

  return {
    propertyName: s(p.propertyName), address: s(p.address), city: s(p.city), state: s(p.state), zip: s(p.zip),
    totalSF: n(p.totalSF), yearBuilt: n(p.yearBuilt),
    pop1mi: n(p.pop1mi), pop3mi: n(p.pop3mi), pop5mi: n(p.pop5mi),
    avgHHI1mi: n(p.avgHHI1mi), avgHHI3mi: n(p.avgHHI3mi), avgHHI5mi: n(p.avgHHI5mi), medianHHI3mi: n(p.medianHHI3mi),
    anchors: arr(p.anchors), coTenants: arr(p.coTenants), shadowAnchors: arr(p.shadowAnchors),
    availableSpaces: spaces, narrative: s(p.narrative),
  };
}

// ENRICH-ONLY patch from a leasing flyer. Gap-fills property facts, demographics,
// and co-tenancy onto an existing deal — and NEVER touches tenants, rent, NOI,
// cap rate, or any verified field. Safe to drop on an owned asset that already
// has an authoritative rent-roll roster.
export function buildFlyerPatch(deal: Deal, r: FlyerResult): Partial<Deal> {
  const patch: Record<string, unknown> = {};
  const ex = deal as unknown as Record<string, unknown>;
  const blank = (v: unknown) => v == null || v === "";
  const fill = (key: string, val: unknown) => { if (!blank(val) && blank(ex[key])) patch[key] = val; };

  if (blank(deal.propertyName)) fill("propertyName", r.propertyName);
  fill("address", r.address); fill("city", r.city); fill("state", r.state); fill("zip", r.zip);
  fill("totalSF", r.totalSF); fill("yearBuilt", r.yearBuilt);

  // If the flyer supplies the total SF a rent-roll-seeded deal was missing,
  // compute occupancy from the existing roster (derived metric — safe to set;
  // never an edit to the roster itself, and respects a verified lock).
  if (patch.totalSF != null && (deal.tenants?.length ?? 0) > 0 && !deal.verified?.occupancy) {
    const occSF = (deal.tenants || []).reduce((s, t) => {
      const sf = Number((t as Record<string, unknown>).sf);
      return s + (isVacant((t as Record<string, unknown>).name) || isNaN(sf) ? 0 : sf);
    }, 0);
    const occ = Math.round(occSF / Number(patch.totalSF) * 1000) / 10;
    if (occ > 0 && occ <= 100) patch.occupancy = occ;
  }
  fill("population3mi", r.pop3mi);
  fill("medianHHIncome3mi", r.medianHHI3mi);
  fill("avgHHIncome3mi", r.avgHHI3mi);

  const cot = [...r.anchors, ...r.coTenants].filter(Boolean);
  if (cot.length) fill("retailCotenants", Array.from(new Set(cot)).join(", "));
  if (r.shadowAnchors.length) fill("shadowAnchors", r.shadowAnchors.join(", "));

  // Trade-area demographics object (only when the deal has none — never clobber a
  // pulled/verified demographics block).
  if (blank(ex.marketDemographics) && (r.pop1mi || r.pop3mi || r.pop5mi || r.avgHHI3mi)) {
    patch.marketDemographics = {
      pop1mi: r.pop1mi, pop3mi: r.pop3mi, pop5mi: r.pop5mi,
      avgHHI1mi: r.avgHHI1mi, avgHHI3mi: r.avgHHI3mi, avgHHI5mi: r.avgHHI5mi,
      source: "Leasing flyer", asOf: new Date().toISOString().slice(0, 10), confidence: "medium",
    };
  }

  // Background narrative + available-space note — only when notes are empty, so we
  // never overwrite an OM's underwriting narrative.
  if (blank(deal.notes)) {
    const avail = r.availableSpaces
      .map(a => `${a.suite ? a.suite + " – " : ""}${a.sf ? a.sf.toLocaleString() + " SF" : ""}`.trim())
      .filter(Boolean);
    const parts = [r.narrative, avail.length ? `Available space (per leasing flyer): ${avail.join("; ")}.` : ""].filter(Boolean);
    if (parts.length) patch.notes = parts.join(" ");
  }

  return patch as Partial<Deal>;
}
