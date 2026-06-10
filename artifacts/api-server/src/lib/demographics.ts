// fetchCensusDemographics — free US Census Bureau APIs, no key required.
import { fetchWithTimeout } from "./http";

// ── Address → market (MSA/metro) + submarket ─────────────────────────────────
// Derives the metro market and a submarket proxy from an address using the free
// US Census GEOGRAPHIES geocoder. The geocoder needs NO API key (only the ACS
// data API does), so this works even when CENSUS_API_KEY isn't configured. It's
// authoritative public data, not an AI guess — but still surfaced as "derived
// from address" so it's never confused with an OM-stated value.
export interface MarketGeo {
  market?: string | null;       // CBSA / metro, e.g. "Lancaster, PA Metro Area"
  submarket?: string | null;    // place/township proxy, e.g. "Lititz borough"
  county?: string | null;
  matchedAddress?: string | null;
  source?: string;
  lookedUpAt?: string;
}

export async function fetchAddressMarket(address: string): Promise<MarketGeo | null> {
  try {
    const url =
      `https://geocoding.geo.census.gov/geocoder/geographies/onelineaddress` +
      `?address=${encodeURIComponent(address)}&benchmark=Public_AR_Current&vintage=Current_Current&format=json`;
    const resp = await fetchWithTimeout(url);
    if (!resp.ok) return null;
    const text = await resp.text();
    if (text.trim().startsWith("<")) return null; // HTML error page, not JSON
    const json = JSON.parse(text) as {
      result?: { addressMatches?: Array<{ matchedAddress?: string; geographies?: Record<string, Array<Record<string, unknown>>> }> };
    };
    const match = json?.result?.addressMatches?.[0];
    const geos = match?.geographies;
    if (!geos) return null;

    // First non-empty NAME under any geography layer whose key matches the predicate.
    const nameFrom = (pred: (k: string) => boolean): string | null => {
      for (const k of Object.keys(geos)) {
        if (!pred(k)) continue;
        const f = geos[k]?.[0];
        const n = f && typeof f.NAME === "string" ? f.NAME.trim() : "";
        if (n) return n;
      }
      return null;
    };
    // Metro = Metropolitan/Micropolitan Statistical Area (CBSA). Note "Combined
    // Statistical Areas" is intentionally NOT matched (too broad for a market).
    const market = nameFrom(k => /metropolitan.*statistical|micropolitan.*statistical|core based statistical|\bcbsa\b/i.test(k));
    // Submarket proxy: the incorporated place / CDP (city), else the county subdivision (township).
    const submarket =
      nameFrom(k => /incorporated place|census designated place/i.test(k)) ||
      nameFrom(k => /county subdivision/i.test(k));
    const county = nameFrom(k => /count(y|ies)/i.test(k) && !/subdivision/i.test(k));
    if (!market && !submarket && !county) return null;

    return {
      market: market ?? null,
      submarket: submarket ?? county ?? null,
      county: county ?? null,
      matchedAddress: match?.matchedAddress ?? null,
      source: "US Census Bureau geocoder (TIGER)",
      lookedUpAt: new Date().toISOString(),
    };
  } catch {
    return null;
  }
}

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
      };
    }

    // ── Preferred method: block-group centroid apportionment ────────────────
    // Block groups are ~3× finer than census tracts. We take every block group
    // whose polygon touches the 5-mile ring, then assign each to the 1/3/5-mile
    // rings by whether its CENTROID falls inside that radius. Counting only the
    // centroids that land inside the circle apportions population far better than
    // summing whole tracts that merely clip the ring (the old method's overcount,
    // which inflated the 1-mile ring ~3×). Falls back to the tract method below
    // if anything here returns no usable data.
    const center = coords;
    const bgResult = await (async (): Promise<MarketDemographics | null> => {
      function milesBetween(aLat: number, aLng: number, bLat: number, bLng: number): number {
        const R = 3958.7613, toRad = (d: number) => (d * Math.PI) / 180;
        const dLat = toRad(bLat - aLat), dLng = toRad(bLng - aLng);
        const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
      }

      // Block groups touching the 5-mile ring (superset), with centroids
      let features: Array<{ geoid: string; state: string; county: string; lat: number; lng: number }> = [];
      try {
        const url =
          `https://tigerweb.geo.census.gov/arcgis/rest/services/Census2020/Tracts_Blocks/MapServer/1/query` +
          `?geometry=${center.lng},${center.lat}&geometryType=esriGeometryPoint&distance=5` +
          `&units=esriSRUnit_StatuteMile&inSR=4326&spatialRel=esriSpatialRelIntersects` +
          `&outFields=GEOID,STATE,COUNTY,CENTLAT,CENTLON&returnGeometry=false&f=json`;
        const resp = await fetchWithTimeout(url);
        if (!resp.ok) return null;
        const json = await resp.json() as { features?: Array<{ attributes: Record<string, string> }>; error?: { message?: string } };
        if (json.error || !json.features?.length) return null;
        features = json.features.map(f => ({
          geoid: f.attributes.GEOID,
          state: f.attributes.STATE,
          county: f.attributes.COUNTY,
          lat: Number(f.attributes.CENTLAT),
          lng: Number(f.attributes.CENTLON),
        })).filter(b => b.geoid && isFinite(b.lat) && isFinite(b.lng));
      } catch {
        return null;
      }
      if (features.length === 0) return null;

      // Ring membership by centroid distance from the property
      const g1 = new Set<string>(), g3 = new Set<string>(), g5 = new Set<string>();
      for (const b of features) {
        const dist = milesBetween(center.lat, center.lng, b.lat, b.lng);
        if (dist <= 5) g5.add(b.geoid);
        if (dist <= 3) g3.add(b.geoid);
        if (dist <= 1) g1.add(b.geoid);
      }
      if (g5.size === 0) return null;

      // Counties to query ACS for (any block group with a centroid within 5 mi)
      const counties = new Map<string, { state: string; county: string }>();
      for (const b of features) if (g5.has(b.geoid)) counties.set(`${b.state}-${b.county}`, { state: b.state, county: b.county });

      // ACS at the block-group level — 2024 first, fall back to 2023. Tries both
      // valid "in" forms (with and without an explicit tract wildcard) so we work
      // regardless of the endpoint's hierarchy requirement.
      const acs = new Map<string, { pop: number; households: number; aggIncome: number }>();
      let vStart = 2020, vEnd = 2024;
      for (const { state, county } of counties.values()) {
        let got = false;
        for (const vintage of [2024, 2023]) {
          if (got) break;
          for (const inClause of [`state:${state} county:${county}`, `state:${state} county:${county} tract:*`]) {
            const params = new URLSearchParams({ get: "B01003_001E,B19025_001E,B11001_001E", for: "block group:*", in: inClause });
            if (process.env.CENSUS_API_KEY) params.set("key", process.env.CENSUS_API_KEY);
            try {
              const resp = await fetchWithTimeout(`https://api.census.gov/data/${vintage}/acs/acs5?${params.toString()}`);
              if (!resp.ok) continue;
              const text = await resp.text();
              if (text.trim().startsWith("<")) continue;
              const rows = JSON.parse(text) as string[][];
              if (!rows || rows.length < 2) continue;
              const h = rows[0];
              const pI = h.indexOf("B01003_001E"), iI = h.indexOf("B19025_001E"), hI = h.indexOf("B11001_001E");
              const sI = h.indexOf("state"), cI = h.indexOf("county"), tI = h.indexOf("tract"), bI = h.indexOf("block group");
              if (bI < 0 || tI < 0) continue;
              for (let i = 1; i < rows.length; i++) {
                const r = rows[i];
                const geoid = `${r[sI]}${r[cI]}${r[tI]}${r[bI]}`;
                acs.set(geoid, {
                  pop: Math.max(0, Number(r[pI]) || 0),
                  households: Math.max(0, Number(r[hI]) || 0),
                  aggIncome: Math.max(0, Number(r[iI]) || 0),
                });
              }
              if (vintage === 2023) { vStart = 2019; vEnd = 2023; }
              got = true;
              break;
            } catch { /* try next variant/vintage */ }
          }
        }
      }
      if (acs.size === 0) return null;

      const agg = (set: Set<string>): { pop: number; avgHHI: number | null } => {
        let pop = 0, hh = 0, inc = 0;
        for (const g of set) { const r = acs.get(g); if (r) { pop += r.pop; hh += r.households; inc += r.aggIncome; } }
        return { pop: Math.round(pop), avgHHI: hh > 0 ? Math.round(inc / hh) : null };
      };
      const a1 = agg(g1), a3 = agg(g3), a5 = agg(g5);
      if (![a1.pop, a3.pop, a5.pop].some(v => v > 0)) return null;

      debug.method = "blockgroup-centroid";
      debug.blockGroups = { fetched: features.length, in1: g1.size, in3: g3.size, in5: g5.size, acsLoaded: acs.size, counties: counties.size };

      return {
        pop1mi: a1.pop || null,
        pop3mi: a3.pop || null,
        pop5mi: a5.pop || null,
        avgHHI1mi: a1.avgHHI,
        avgHHI3mi: a3.avgHHI,
        avgHHI5mi: a5.avgHHI,
        confidence: "high",
        source: "US Census Bureau ACS 5-Year Estimates",
        asOf: `${vStart}–${vEnd}`,
        note: null,
        sources: [{ url: "https://www.census.gov/programs-surveys/acs", title: "American Community Survey 5-Year Estimates" }],
        lookedUpAt: new Date().toISOString(),
      };
    })();
    if (bgResult) return bgResult;
    // Block-group method unavailable — fall through to the legacy tract method.

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
