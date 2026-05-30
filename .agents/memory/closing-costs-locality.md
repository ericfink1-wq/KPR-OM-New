---
name: Closing costs locality/residential architecture
description: How altGroup, altLabel, altDefault, residentialOnly work in closingCosts.ts and ClosingCostsCard.tsx
---

## Data model (`TaxLineItem`)
- `altGroup`: string key grouping mutually-exclusive locality options (e.g. "MD-county", "NY-local", "CA-city")
- `altLabel`: the option label within the group (e.g. "Baltimore City", "NYC", "Los Angeles")
- `altDefault`: true on the option that should be active when the user hasn't made a selection
- `residentialOnly`: true → line is suppressed for commercial deals (inactive in output)

## Resolution in `calculateClosingCosts`
- 4th param is now `opts: CalcOptions | boolean = {}` — boolean still accepted (backward compat)
- `CalcOptions`: `{ includeEntityTaxes?, localities?, residential? }`
- `localities`: `Record<groupKey, chosenLabel>` — explicit user selection overrides `altDefault`
- Inactive lines (wrong locality, residentialOnly) are pushed with `amount/buyer/seller = 0, inactive: true`
- Totals exclude inactive lines (`l.inactive ? 0 : l.buyer`)

## `getLocalityGroups(jurisdiction)` → `LocalityGroup[]`
- Returns `{ group, options: { label, isDefault }[] }` for each altGroup found in transferTaxes
- Used by card to render `<select>` dropdowns

## States with locality groups (as of 2026-05)
| Group | Default | Options |
|---|---|---|
| NY-local | Outside NYC/Yonkers | NYC, Yonkers |
| DE-county | New Castle County | Kent/Sussex County |
| MA-region | Mainland | Cape/Islands |
| MD-county | All Other MD Counties | Baltimore City, Baltimore Co./Howard Co., Prince George's County, Anne Arundel/Montgomery/etc. |
| PA-local | Suburban/Standard | Philadelphia, Pittsburgh/Allegheny, Scranton/Lackawanna, Harrisburg/Dauphin, Allentown/Lehigh |
| VA-region | Rest of VA | NoVA/Hampton Roads |
| NC-county | Other NC Counties | Orange County, Chatham County, Mecklenburg County |
| IL-county | Cook County | Downstate / Outside Cook County |
| IL-city | No City Tax (Suburbs/Downstate) | Chicago, Evanston, Oak Park |
| CA-city | All Other Cities | Los Angeles, San Francisco, Oakland, Berkeley, Santa Monica, Culver City, West Hollywood, San Jose, Palo Alto, Mountain View, Richmond, Stockton |
| NV-county | Clark County (Las Vegas) | Washoe County (Reno), Rural NV / Other Counties |
| CO-resort | Non-Resort / Front Range | Aspen/Vail/Breckenridge tier, Telluride/Crested Butte tier |
| OR-county | All Other OR Counties | Washington County (Portland West) |
| WA-county | Other WA Counties | King County (Seattle), Pierce/Snohomish/Spokane |

## CT fix
- State Conveyance Tax: flat 1.25% (no tiers — commercial is flat)
- Municipal Conveyance Tax: 0.25% (was 0.50% — that was the targeted-city max, not the base)

## Synthetic lines
- Rate-0 lines with `altDefault: true` are the "no local tax" fallback for groups where most deals don't incur the tax (VA Rest of VA, NC Other Counties, OR Other Counties, CO Non-Resort, IL Downstate/No City)
- These show as `"—"` in the rate column when dormant

## Card rendering
- `inactive` flag → opacity 0.45 + "· not applied" badge
- Locality dropdowns generated from `localityGroups` — one `<select>` per group
