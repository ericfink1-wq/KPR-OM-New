// fetchCensusDemographics — free US Census Bureau APIs, no key required.

export interface MarketDemographics {
  pop1mi?: number | null;
  pop3mi?: number | null;
  pop5mi?: number | null;
  avgHHI1mi?: number | null;
  avgHHI3mi?: number | null;
  avgHHI5mi?: number | null;
  confidence?: "high" | "medium" | "low";
  source?: string;
  asOf?: string;
  note?: string | null;
  sources?: { url: string; title?: string }[];
  lookedUpAt?: string;
}

const TIMEOUT_MS = 10_000;

async function fetchWithTimeout(url: string): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function geocodeAddress(address: string): Promise<{ lat: number; lng: number } | null> {
  const url =
    `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` +
    `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;
  try {
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return null;
    const json = await resp.json() as {
      result?: { addressMatches?: Array<{ coordinates: { x: number; y: number } }> };
    };
    const match = json?.result?.addressMatches?.[0];
    if (!match) return null;
    return { lat: match.coordinates.y, lng: match.coordinates.x };
  } catch {
    return null;
  }
}

interface TractFeature {
  geoid: string;
  state: string;
  county: string;
  tract: string;
}

async function fetchTractsForRadius(lat: number, lng: number, miles: number): Promise<TractFeature[]> {
  const url =
    `https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/Tracts_Blocks/MapServer/0/query` +
    `?geometry=${lng},${lat}&geometryType=esriGeometryPoint&distance=${miles}` +
    `&units=esriSRUnit_StatuteMile&inSR=4326&spatialRel=esriSpatialRelIntersects` +
    `&outFields=GEOID,STATE,COUNTY,TRACT&returnGeometry=false&f=json`;
  try {
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return [];
    const json = await resp.json() as {
      features?: Array<{ attributes: { GEOID: string; STATE: string; COUNTY: string; TRACT: string } }>;
    };
    return (json.features ?? []).map(f => ({
      geoid: f.attributes.GEOID,
      state: f.attributes.STATE,
      county: f.attributes.COUNTY,
      tract: f.attributes.TRACT,
    }));
  } catch {
    return [];
  }
}

interface ACSRow {
  pop: number;
  households: number;
  aggIncome: number;
}

async function fetchACSData(
  state: string,
  county: string,
  vintage: number,
): Promise<Map<string, ACSRow>> {
  const url =
    `https://api.census.gov/data/${vintage}/acs/acs5` +
    `?get=B01003_001E,B19025_001E,B11001_001E&for=tract:*&in=state:${state}+county:${county}`;
  const resp = await fetchWithTimeout(url);
  if (!resp.ok) throw new Error(`ACS ${vintage} returned ${resp.status}`);
  const rows = await resp.json() as string[][];
  if (!rows || rows.length < 2) return new Map();

  const header = rows[0];
  const popIdx = header.indexOf("B01003_001E");
  const incIdx = header.indexOf("B19025_001E");
  const hhIdx = header.indexOf("B11001_001E");
  const stateIdx = header.indexOf("state");
  const countyIdx = header.indexOf("county");
  const tractIdx = header.indexOf("tract");

  const result = new Map<string, ACSRow>();
  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const geoid = `${row[stateIdx]}${row[countyIdx]}${row[tractIdx]}`;
    result.set(geoid, {
      pop: Math.max(0, Number(row[popIdx]) || 0),
      households: Math.max(0, Number(row[hhIdx]) || 0),
      aggIncome: Math.max(0, Number(row[incIdx]) || 0),
    });
  }
  return result;
}

export async function fetchCensusDemographics(address: string): Promise<MarketDemographics> {
  try {
    // Step 1: Geocode
    const coords = await geocodeAddress(address);
    if (!coords) {
      return {
        confidence: "low",
        source: "US Census Bureau",
        note: "Address could not be geocoded",
        lookedUpAt: new Date().toISOString(),
      };
    }

    // Step 2: Get tracts for each radius (nested — 5mi is the superset)
    const [tracts1, tracts3, tracts5] = await Promise.all([
      fetchTractsForRadius(coords.lat, coords.lng, 1),
      fetchTractsForRadius(coords.lat, coords.lng, 3),
      fetchTractsForRadius(coords.lat, coords.lng, 5),
    ]);

    const geoids1 = new Set(tracts1.map(t => t.geoid));
    const geoids3 = new Set(tracts3.map(t => t.geoid));
    const geoids5 = new Set(tracts5.map(t => t.geoid));

    // Step 3: Collect unique state+county combos from 5mi set (superset)
    const countyPairs = new Map<string, { state: string; county: string }>();
    for (const t of tracts5) {
      countyPairs.set(`${t.state}-${t.county}`, { state: t.state, county: t.county });
    }

    // Step 4: Fetch ACS — try 2024 vintage, fallback to 2023
    const acsDataMap = new Map<string, ACSRow>();
    let vintage = 2024;
    let startYear = 2020;
    let endYear = 2024;

    for (const { state, county } of countyPairs.values()) {
      try {
        const data = await fetchACSData(state, county, 2024);
        for (const [geoid, vals] of data) acsDataMap.set(geoid, vals);
      } catch {
        try {
          const data = await fetchACSData(state, county, 2023);
          for (const [geoid, vals] of data) acsDataMap.set(geoid, vals);
          vintage = 2023;
          startYear = 2019;
          endYear = 2023;
        } catch {
          // Skip this county on error
        }
      }
    }

    // Step 5: Aggregate per radius ring
    function aggregate(geoids: Set<string>): { pop: number; avgHHI: number | null } {
      let totalPop = 0;
      let totalHH = 0;
      let totalIncome = 0;
      for (const geoid of geoids) {
        const d = acsDataMap.get(geoid);
        if (d) {
          totalPop += d.pop;
          totalHH += d.households;
          totalIncome += d.aggIncome;
        }
      }
      return {
        pop: Math.round(totalPop),
        avgHHI: totalHH > 0 ? Math.round(totalIncome / totalHH) : null,
      };
    }

    const r1 = aggregate(geoids1);
    const r3 = aggregate(geoids3);
    const r5 = aggregate(geoids5);

    // Suppress vintage warning — only used for type narrowing
    void vintage;

    return {
      pop1mi: r1.pop || null,
      pop3mi: r3.pop || null,
      pop5mi: r5.pop || null,
      avgHHI1mi: r1.avgHHI,
      avgHHI3mi: r3.avgHHI,
      avgHHI5mi: r5.avgHHI,
      confidence: "high",
      source: "US Census Bureau ACS 5-Year Estimates",
      asOf: `${startYear}\u2013${endYear}`,
      note: null,
      sources: [
        {
          url: "https://www.census.gov/programs-surveys/acs",
          title: "American Community Survey 5-Year Estimates",
        },
      ],
      lookedUpAt: new Date().toISOString(),
    };
  } catch (err) {
    return {
      confidence: "low",
      source: "US Census Bureau",
      note: err instanceof Error ? `Census fetch failed: ${err.message}` : "Census fetch failed",
      lookedUpAt: new Date().toISOString(),
    };
  }
}
