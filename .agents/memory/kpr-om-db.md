---
name: KPR OM Database
description: Architecture decisions, gotchas, and migration notes for the KPR Deal Intelligence full-stack app.
---

## Stack
- Frontend: React+Vite at `artifacts/om-database`, routes under `/`
- Backend: Express 5 at `artifacts/api-server`, routes under `/api`
- DB: PostgreSQL + Drizzle ORM (`lib/db`), schema in `lib/db/src/schema/deals.ts`
- Auth: express-session + APP_PASSWORD secret (shared team password)

## Session / Auth quirks
- `import "./types/session"` must NOT be in app.ts — esbuild cannot resolve `.d.ts` files
- Session type augmentation lives in `src/types/session.d.ts` using `import "express-session"` (module-style, not reference directive)
- `esModuleInterop: true` must be in `artifacts/api-server/tsconfig.json` — base tsconfig has `esModuleInterop` omitted and `types: []`
- Session cookie uses `sameSite: "lax"`, `secure: false` (proxied dev environment)

## Express 5 typing
- `req.params.id` is typed as `string | string[]` in Express 5 — always cast: `const id = req.params.id as string`

## idb → API migration
- All IndexedDB calls replaced with fetch calls in `artifacts/om-database/src/lib/api.ts`
- Affected files: App.tsx, DetailView.tsx, AnalystChat.tsx, PortfolioMontage.tsx, DealTiles.tsx, Header.tsx, UploadQueue.tsx
- `idb.ts` still exists (has Deal and ImageBundle type definitions imported by many components)

## DB tables
- `deals`: id TEXT PK, data JSONB, createdAt, updatedAt
- `deal_images`: id TEXT PK, cover TEXT, coverThumb TEXT, sitePlan JSONB (string[]), pagePicks JSONB, needsSitePlanPick BOOLEAN
- `deal_sources`: id TEXT PK, sourceText TEXT

**Why:** Images stored as base64 TEXT — large payloads, JSON body limit set to 50mb in Express.
