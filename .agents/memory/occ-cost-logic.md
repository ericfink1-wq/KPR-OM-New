---
name: Occupancy cost logic
description: Precedence rules, new Tenant fields, and display components for occ cost capability.
---

## Rule
1. If `tenant.occupancyCost` is set → show as "stated" (green badge).
2. Else if `annualRent` AND `expenseReimbursements` are both non-null AND `salesPSF × SF > 0` → compute `(base + reimb + pctRent + other) / sales * 100`, show as "computed" (grey badge).
3. Otherwise show "—". **Never compute from base rent alone** (missing reimbursements = no number).

**Why:** Computing occ cost with only base rent severely underestimates the true occupancy burden and misleads underwriting.

## New Tenant fields (idb.ts + DB)
- `expenseReimbursements?: number | null` — annual CAM + RE-tax + insurance recoveries
- `percentageRent?: number | null` — annual overage/percentage rent in dollars (≠ the string clause field renamed to `percentageRentClause` in the extract prompt)
- `otherRent?: number | null` — annual marketing fund, storage, specialty, other

DB columns in `tenant_index`: `expense_reimbursements`, `percentage_rent`, `other_rent`.

## Display components
- `OccTip` component defined in both TenantSalesPanel.tsx and TenantRoster.tsx — hover/tap to see breakdown card (Base / + Recoveries / + % Rent / + Other / = Total / ÷ Sales / = %).
- Breakdown card: `position absolute, bottom: calc(100% + 6px), right: 0`, `maxWidth: min(280px, calc(100vw - 32px))`.

## Editing
- TenantRoster has `onUpdateTenant?: (index, patch) => void` prop.
- ✏ icon appears in the Occ Cost column when `onUpdateTenant` is passed (wired in DetailView.tsx).
- Clicking ✏ opens a portal modal with 3 number inputs (Recoveries, % Rent, Other). Blank = null (clears the value).
- `percentageRent` from old extractions may be a string (clause text) — guard with `typeof t.percentageRent === "number"` before using as a number.

## Extraction prompt
- `percentageRentClause` (string) = the clause text description.
- `percentageRent` (number) = annual dollar amount — only populate when OM explicitly discloses.
- `annualRent` description updated to "BASE rent only".
