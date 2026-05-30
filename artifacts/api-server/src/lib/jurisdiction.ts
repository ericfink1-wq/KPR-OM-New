// resolveJurisdiction — pinpoint the exact taxing jurisdiction (county,
// municipality/township, incorporated place, school district) for a street
// address via the free US Census Geocoder (no API key).
//
// A mailing city is NOT the taxing jurisdiction. We try the one-shot
// geographies/onelineaddress endpoint first, then fall back to the more lenient
// locations -> coordinates -> geographies/coordinates path (the same locations
// endpoint the demographics feature uses successfully). Every failure path
// returns { matched: false } so callers degrade gracefully.

export interface ResolvedJurisdiction {
  matched: boolean;
  matchedAddress?: string | null;
  state?: string | null;        // 2-letter (STUSAB)
  county?: string | null;       // e.g. "Montgomery County"
  municipality?: string | null; // county subdivision, e.g. "Lower Merion township"
  place?: string | null;        // incorporated place, e.g. "Bala-Cynwyd" / "Philadelphia city"
  schoolDistrict?: string | null;
  lat?: number | null;
  lng?: number | null;
  source?: string;
}

const TIMEOUT_MS = 12_000;
const BASE = "https://geocoding.geo.census.gov/geocoder";

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const resp = await fetch(url, { signal: controller.signal });
    if (!resp.ok) return null;
    const text = await resp.text();
    try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type GeoLayer = Array<Record<string, unknown>>;
type Geographies = Record<string, GeoLayer>;

// First feature's field from the geographies layer whose key contains substr.
function pickField(geos: Geographies, substr: string, field = "NAME"): string | null {
  const key = Object.keys(geos).find((k) => k.toLowerCase().includes(substr));
  if (!key) return null;
  const arr = geos[key];
  const v = Array.isArray(arr) && arr[0] ? arr[0][field] : null;
  if (typeof v === "string") return v.trim() || null;
  return v != null ? String(v) : null;
}

function buildResult(g: Geographies, matchedAddress: string | null, coords: { x?: number; y?: number } | null): ResolvedJurisdiction {
  return {
    matched: true,
    matchedAddress: matchedAddress ?? null,
    state: pickField(g, "states", "STUSAB"),
    county: pickField(g, "counties"),
    municipality: pickField(g, "county subdivisions"),
    place: pickField(g, "incorporated places"),
    schoolDistrict: pickField(g, "school districts"),
    lat: coords?.y ?? null,
    lng: coords?.x ?? null,
    source: "US Census Geocoder",
  };
}

export async function resolveJurisdiction(address: string): Promise<ResolvedJurisdiction> {
  const addr = (address || "").trim();
  if (!addr) return { matched: false };
  const enc = encodeURIComponent(addr);

  // 1) One-shot: geographies from the address directly.
  const j1 = await fetchJson(`${BASE}/geographies/onelineaddress?address=${enc}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`);
  const m1 = (j1 as { result?: { addressMatches?: Array<{ matchedAddress?: string; coordinates?: { x: number; y: number }; geographies?: Geographies }> } })
    ?.result?.addressMatches?.[0];
  if (m1?.geographies) return buildResult(m1.geographies, m1.matchedAddress ?? null, m1.coordinates ?? null);

  // 2) Fallback: lenient locations geocode -> coordinates -> geographies/coordinates.
  const j2 = await fetchJson(`${BASE}/locations/onelineaddress?address=${enc}&benchmark=Public_AR_Current&format=json`);
  const m2 = (j2 as { result?: { addressMatches?: Array<{ matchedAddress?: string; coordinates?: { x: number; y: number } }> } })
    ?.result?.addressMatches?.[0];
  if (m2?.coordinates) {
    const { x, y } = m2.coordinates;
    const j3 = await fetchJson(`${BASE}/geographies/coordinates?x=${x}&y=${y}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`);
    const g3 = (j3 as { result?: { geographies?: Geographies } })?.result?.geographies;
    if (g3) return buildResult(g3, m2.matchedAddress ?? null, m2.coordinates);
  }

  return { matched: false };
}
