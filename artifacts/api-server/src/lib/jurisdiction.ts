// resolveJurisdiction — pinpoint the exact taxing jurisdiction (county,
// municipality/township, incorporated place, school district) for a street
// address via the free US Census Geocoder "geographies" endpoint (no API key).
//
// This is authoritative for WHERE a parcel sits — a mailing city is NOT the
// taxing jurisdiction. The caller maps the result to local transfer-tax rates.
// Every failure path returns { matched: false } so callers degrade gracefully.

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

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

type GeoLayer = Array<Record<string, unknown>>;
type Geographies = Record<string, GeoLayer>;

// Pull the first feature's NAME (or other field) from the geographies layer whose
// key contains the given lowercase substring.
function pickField(geos: Geographies, substr: string, field = "NAME"): string | null {
  const key = Object.keys(geos).find((k) => k.toLowerCase().includes(substr));
  if (!key) return null;
  const arr = geos[key];
  const v = Array.isArray(arr) && arr[0] ? arr[0][field] : null;
  return typeof v === "string" && v.trim() ? v.trim() : (v != null ? String(v) : null);
}

export async function resolveJurisdiction(address: string): Promise<ResolvedJurisdiction> {
  const addr = (address || "").trim();
  if (!addr) return { matched: false };
  try {
    const url =
      "https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress" +
      `?address=${encodeURIComponent(addr)}` +
      "&benchmark=Public_AR_Current&vintage=Current_Current&format=json";
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return { matched: false };
    const json = (await resp.json()) as {
      result?: { addressMatches?: Array<{
        matchedAddress?: string;
        coordinates?: { x: number; y: number };
        geographies?: Geographies;
      }> };
    };
    const match = json?.result?.addressMatches?.[0];
    if (!match || !match.geographies) return { matched: false };
    const g = match.geographies;
    return {
      matched: true,
      matchedAddress: match.matchedAddress ?? null,
      state: pickField(g, "states", "STUSAB"),
      county: pickField(g, "counties"),
      municipality: pickField(g, "county subdivisions"),
      place: pickField(g, "incorporated places"),
      schoolDistrict: pickField(g, "school districts"),
      lat: match.coordinates?.y ?? null,
      lng: match.coordinates?.x ?? null,
      source: "US Census Geocoder",
    };
  } catch {
    return { matched: false };
  }
}
