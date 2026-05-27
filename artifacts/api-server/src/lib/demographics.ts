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
  _debug?: Record<string, unknown>;
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

interface TractFeature {
  geoid: string;
  state: string;
  county: string;
  tract: string;
}

interface ACSRow {
  pop: number;
  households: number;
  aggIncome: number;
}

export async function fetchCensusDemographics(address: string): Promise<MarketDemographics> {
  const debug: Record<string, unknown> = { address };

  // ── Guard: API key required ────────────────────────────────────────────────
  if (!process.env.CENSUS_API_KEY) {
    return {
      confidence: "low",
      source: "US Census Bureau ACS 5-Year Estimates",
      asOf: "2020\u20132024",
      note: "Census API key not configured. Set CENSUS_API_KEY in Replit Secrets and re-pull.",
      lookedUpAt: new Date().toISOString(),
      _debug: { reason: "missing_api_key" },
    };
  }

  try {
    // ── Step 1: Geocode ─────────────────────────────────────────────────────
    const geocodeUrl =
      `https://geocoding.geo.census.gov/geocoder/locations/onelineaddress` +
      `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&format=json`;

    let coords: { lat: number; lng: number } | null = null;
    try {
      const resp = await fetchWithTimeout(geocodeUrl);
      const rawText = await resp.text();
      const rawSnippet = rawText.slice(0, 400);
      let json: { result?: { addressMatches?: Array<{ coordinates: { x: number; y: number }; matchedAddress?: string }> } } | null = null;
      try { json = JSON.parse(rawText); } catch { /* leave null */ }
      const match = json?.result?.addressMatches?.[0];
      if (match) {
        coords = { lat: match.coordinates.y, lng: match.coordinates.x };
      }
      debug.geocode = {
        ok: resp.ok,
        status: resp.status,
        lat: coords?.lat ?? null,
        lng: coords?.lng ?? null,
        matchedAddress: match?.matchedAddress ?? null,
        matchCount: json?.result?.addressMatches?.length ?? 0,
        rawResponseSnippet: rawSnippet,
      };
    } catch (err) {
      debug.geocode = {
        ok: false,
        lat: null,
        lng: null,
        matchedAddress: null,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    if (!coords) {
      return {
        confidence: "low",
        source: "US Census Bureau",
        note: "Address could not be geocoded",
        lookedUpAt: new Date().toISOString(),
        _debug: debug,
      };
    }

    // ── Step 2: Tracts for each radius ──────────────────────────────────────
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
          error?: { message?: string };
        };
        if (json.error) throw new Error(json.error.message ?? "TIGERweb error");
        return (json.features ?? []).map(f => ({
          geoid: f.attributes.GEOID,
          state: f.attributes.STATE,
          county: f.attributes.COUNTY,
          tract: f.attributes.TRACT,
        }));
      } catch (err) {
        throw err;
      }
    }

    const tractResults = await Promise.allSettled([
      fetchTractsForRadius(coords.lat, coords.lng, 1),
      fetchTractsForRadius(coords.lat, coords.lng, 3),
      fetchTractsForRadius(coords.lat, coords.lng, 5),
    ]);

    const tracts1 = tractResults[0].status === "fulfilled" ? tractResults[0].value : [];
    const tracts3 = tractResults[1].status === "fulfilled" ? tractResults[1].value : [];
    const tracts5 = tractResults[2].status === "fulfilled" ? tractResults[2].value : [];

    debug.tracts1mi = {
      count: tracts1.length,
      sample: tracts1.slice(0, 3).map(t => t.geoid),
      error: tractResults[0].status === "rejected" ? String((tractResults[0] as PromiseRejectedResult).reason) : undefined,
    };
    debug.tracts3mi = {
      count: tracts3.length,
      sample: tracts3.slice(0, 3).map(t => t.geoid),
      error: tractResults[1].status === "rejected" ? String((tractResults[1] as PromiseRejectedResult).reason) : undefined,
    };
    debug.tracts5mi = {
      count: tracts5.length,
      sample: tracts5.slice(0, 3).map(t => t.geoid),
      error: tractResults[2].status === "rejected" ? String((tractResults[2] as PromiseRejectedResult).reason) : undefined,
    };

    const geoids1 = new Set(tracts1.map(t => t.geoid));
    const geoids3 = new Set(tracts3.map(t => t.geoid));
    const geoids5 = new Set(tracts5.map(t => t.geoid));

    // ── Step 3: County pairs from 5mi superset ───────────────────────────────
    const countyPairs = new Map<string, { state: string; county: string }>();
    for (const t of tracts5) {
      countyPairs.set(`${t.state}-${t.county}`, { state: t.state, county: t.county });
    }

    // ── Step 4: ACS fetch — try 2024 first, fallback to 2023 ────────────────
    const acsDataMap = new Map<string, ACSRow>();
    let vintageUsed = 2024;
    let startYear = 2020;
    let endYear = 2024;

    const acsDebugEntries: unknown[] = [];

    const censusKey = process.env.CENSUS_API_KEY;

    for (const { state, county } of countyPairs.values()) {
      let succeeded = false;
      for (const vintage of [2024, 2023]) {
        const params = new URLSearchParams({
          get: "B01003_001E,B19025_001E,B11001_001E",
          for: "tract:*",
          in: `state:${state} county:${county}`,
        });
        if (censusKey) params.set("key", censusKey);
        const baseUrl = `https://api.census.gov/data/${vintage}/acs/acs5?${params.toString()}`;
        const entry: Record<string, unknown> = { vintage, state, county, endpointBase: `https://api.census.gov/data/${vintage}/acs/acs5` };
        try {
          const resp = await fetchWithTimeout(baseUrl);
          entry.statusCode = resp.status;
          if (!resp.ok) {
            entry.error = `HTTP ${resp.status}`;
            acsDebugEntries.push(entry);
            continue;
          }
          const responseText = await resp.text();
          if (responseText.trim().startsWith("<") || responseText.includes("<html")) {
            throw new Error(`Census API returned HTML (likely auth or rate limit issue). First 200 chars: ${responseText.slice(0, 200)}`);
          }
          const rows = JSON.parse(responseText) as string[][];
          entry.rowsReturned = rows ? rows.length - 1 : 0;
          entry.sample = rows?.[1] ?? null;
          if (!rows || rows.length < 2) {
            entry.error = "Empty response";
            acsDebugEntries.push(entry);
            continue;
          }
          const header = rows[0];
          const popIdx = header.indexOf("B01003_001E");
          const incIdx = header.indexOf("B19025_001E");
          const hhIdx = header.indexOf("B11001_001E");
          const stateIdx = header.indexOf("state");
          const countyIdx = header.indexOf("county");
          const tractIdx = header.indexOf("tract");
          for (let i = 1; i < rows.length; i++) {
            const row = rows[i];
            const geoid = `${row[stateIdx]}${row[countyIdx]}${row[tractIdx]}`;
            acsDataMap.set(geoid, {
              pop: Math.max(0, Number(row[popIdx]) || 0),
              households: Math.max(0, Number(row[hhIdx]) || 0),
              aggIncome: Math.max(0, Number(row[incIdx]) || 0),
            });
          }
          vintageUsed = vintage;
          if (vintage === 2023) { startYear = 2019; endYear = 2023; }
          succeeded = true;
          acsDebugEntries.push(entry);
          break;
        } catch (err) {
          entry.error = err instanceof Error ? err.message : String(err);
          acsDebugEntries.push(entry);
        }
      }
      if (!succeeded) {
        // county failed both vintages — logged above
      }
    }

    debug.acs = {
      vintageTried: vintageUsed,
      countyPairsCount: countyPairs.size,
      totalACSTractsLoaded: acsDataMap.size,
      entries: acsDebugEntries,
    };

    // ── Step 5: Aggregate per ring ───────────────────────────────────────────
    function aggregate(geoids: Set<string>): { pop: number; avgHHI: number | null; households: number } {
      let totalPop = 0;
      let totalHH = 0;
      let totalIncome = 0;
      for (const geoid of geoids) {
        const row = acsDataMap.get(geoid);
        if (row) {
          totalPop += row.pop;
          totalHH += row.households;
          totalIncome += row.aggIncome;
        }
      }
      return {
        pop: Math.round(totalPop),
        avgHHI: totalHH > 0 ? Math.round(totalIncome / totalHH) : null,
        households: totalHH,
      };
    }

    const r1 = aggregate(geoids1);
    const r3 = aggregate(geoids3);
    const r5 = aggregate(geoids5);

    const pop1mi = r1.pop || null;
    const pop3mi = r3.pop || null;
    const pop5mi = r5.pop || null;
    const avgHHI1mi = r1.avgHHI;
    const avgHHI3mi = r3.avgHHI;
    const avgHHI5mi = r5.avgHHI;

    debug.aggregation = {
      pop1mi,
      pop3mi,
      pop5mi,
      avgHHI1mi,
      avgHHI3mi,
      avgHHI5mi,
      totalHouseholds1mi: r1.households,
      totalHouseholds3mi: r3.households,
      totalHouseholds5mi: r5.households,
      acsMapSize: acsDataMap.size,
      geoids1count: geoids1.size,
      geoids3count: geoids3.size,
      geoids5count: geoids5.size,
    };

    // ── Step 6: Confidence ───────────────────────────────────────────────────
    const hasAnyData = [pop1mi, pop3mi, pop5mi, avgHHI1mi, avgHHI3mi, avgHHI5mi]
      .some(v => v != null && v > 0);
    const confidence: "high" | "low" = hasAnyData ? "high" : "low";
    const note = hasAnyData
      ? null
      : `No demographic data returned. Tracts found: ${(debug.tracts3mi as { count: number }).count}. ACS tracts loaded: ${acsDataMap.size}.`;

    return {
      pop1mi,
      pop3mi,
      pop5mi,
      avgHHI1mi,
      avgHHI3mi,
      avgHHI5mi,
      confidence,
      source: "US Census Bureau ACS 5-Year Estimates",
      asOf: `${startYear}\u2013${endYear}`,
      note,
      sources: [
        {
          url: "https://www.census.gov/programs-surveys/acs",
          title: "American Community Survey 5-Year Estimates",
        },
      ],
      lookedUpAt: new Date().toISOString(),
      _debug: debug,
    };
  } catch (err) {
    debug.fatalError = err instanceof Error ? err.message : String(err);
    return {
      confidence: "low",
      source: "US Census Bureau",
      note: err instanceof Error ? `Census fetch failed: ${err.message}` : "Census fetch failed",
      lookedUpAt: new Date().toISOString(),
      _debug: debug,
    };
  }
}
