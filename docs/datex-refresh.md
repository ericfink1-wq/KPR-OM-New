# Refreshing live Datex data into the deal library

The deal library holds the **acquisition-era snapshot** for every deal — the figures taken
from the offering documents at the time. Those are deliberately frozen; they are the record
of what was marketed. Datex holds what the owned assets are doing **today**. This brings the
second one alongside the first without disturbing it.

## Why it works by file rather than automatically

Datex's MCP endpoint is OAuth-only, and its authorization server offers
`authorization_code`, `refresh_token` and token-exchange — **no machine-to-machine grant** —
with no dynamic client registration. A background job on the site has no browser and no user,
so it cannot obtain a token. Asking Datex to issue KPR an OAuth client was declined.

So the pull happens in a Claude session, where a person is already authenticated, and the
result is imported as a file. Everything that protects the data lives on the SERVER
(`artifacts/api-server/src/lib/datexImport.ts`), not in these instructions — the payload is
treated as untrusted regardless of what produced it.

## To refresh

1. In a Claude session with the Datex connector, ask for a Datex snapshot for the library.
2. Save the JSON it produces.
3. In the app: **Portfolio Analytics → maintenance menu → 📡 Import Datex snapshot (JSON)**.
4. It dry-runs, shows what would change and the notable differences, and waits. Nothing is
   written until you accept; the library is snapshotted first, so it is reversible.

## Generating the payload

Latest period first — one cheap aggregate rather than scanning:
`aggregate_records` on `Occupancy`, `groupBy: ["Period"]`, ordered descending, `first: 1`.

Then **one call** covers every building:
`read_records` on `Occupancy`, filtered `Period eq <latest>`, `first: 60`, selecting
`BuildingId, BuildingName, TotalGLA, TotalGLAOccupied, TotalGLAVacant, TotalUnits,
TotalOccupiedUnits, TotalVacantUnits, ShopGLA, ShopOccupiedGLA, MajorGLA, MajorOccupiedGLA,
PadGLA, PadOccupiedGLA, GroundLeaseGLA, GroundLeaseOccupiedGLA`.

Map each `dealId` from `artifacts/api-server/src/data/datex-deal-map.json`, summing every
building for a deal that has more than one (Rockaway Centers has three).

```json
{
  "source": "datex",
  "asOf": "YYYY-MM-DD",
  "deals": [
    { "dealId": "...", "bldgIds": ["..."], "period": "YYYYMM",
      "totalGLA": 0, "occupiedGLA": 0, "vacantGLA": 0, "occupancyPct": 0,
      "totalUnits": 0, "occupiedUnits": 0, "vacantUnits": 0,
      "segments": { "shop": { "gla": 0, "occupiedGLA": 0 } } }
  ]
}
```

Per-tenant rent and sales are optional; add them from `TenantsMetrics` for one property at a
time when they are actually needed, since that table is ~2,100 rows per month.

## Five rules, each verified against live Datex on 2026-09-15

**Occupancy comes from the `Occupancy` entity.** Not from summing `TenantsMetrics` — that
returned 340,824 SF for a 300,386 SF building, because it carries rows that are not leasable
area. `Occupancy` already reports totals, unit counts and the segment split.

**Never source GLA from `Buildings`.** `BLDGGLA` is 0 on 46 buildings, and `OCCGLA` is the
SHOP-occupied figure rather than the total. Dividing one by the other is where a reported
"48.9% occupancy" at Cooks Corner came from; the true figure is 67.2% against a 67.6%
acquisition snapshot — a move of 0.4 points, not nineteen.

**A superseded lease generation is marked by a DOT in `TenantId`,** not by any one suffix.
Real examples: `t0000062.1.30`, `t0000069.2.6`, `t0000070.2.70`. These repeat a tenant's
square footage at zero dollars, so leaving them in roughly doubles GLA and unit counts.

**Do not filter zero-rent rows when computing area.** Big Lots occupies 40,000 SF at $0 rent
with no dot suffix — a real dark anchor. A rent filter silently deletes it. (For rent
*averages* the opposite holds: exclude zero-rent rows, or duplicates halve the average.)

**Filter `BLDGID` with `contains`, never `eq`.** Datex character fields are fixed-width and
carry trailing spaces, so `eq` silently matches nothing.

## What the server refuses

Only the `datexLive` block is ever written; the merge is built so no other field can change.
Beyond that it rejects a deal that is not in the map, a deal that is not `Owned`, a payload
whose building ids disagree with the map, occupied GLA above total GLA, and a missing or
future `asOf`. A null is treated as unknown and omitted — never written as zero. The deal
that is not yet set up in Datex is skipped by name rather than erroring.

`datexLive` is in `USER_PRESERVED_KEYS`, so re-importing an OM does not wipe it.

## Reading the result

The deal page shows a **Live from Datex** card beside the acquisition figures, leading with
the differences. A segment standing at zero occupancy is called out explicitly, because a
healthy headline occupancy hides it — Cooks Corner reads 67% occupied while a 29,000 SF major
box is empty.

Two differences are expected rather than alarming: a deal whose library record was built from
part of a multi-building property will show a large GLA jump on refresh (Rockaway Centers,
302,289 → 535,571 SF across its three buildings), and a Datex building that covers more than
the deal does will do the same. Check the map note before treating either as a data error.
