# Workspace

## Overview

pnpm workspace monorepo using TypeScript. Each package manages its own dependencies.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Fastify 5
- **Database**: PostgreSQL 16 + Drizzle ORM
- **Validation**: Zod, drizzle-zod
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (ESM bundle)

## Project: TransityConsole

Internal admin dashboard and API gateway for the Transity ecosystem (Indonesian shuttle industry). Manages shuttle operator registries, aggregates terminal health monitoring, tracks bookings across operators, and shows revenue/commission analytics. Also serves as the central API gateway that fans out requests to multiple TransityTerminal instances (one per shuttle operator), providing TransityApp with a unified backend.

**Ecosystem docs**: See `docs/ECOSYSTEM.md` for comprehensive documentation covering TransityApp integration, TransityTerminal communication, booking flow, payment webhooks, and operator setup.

**Visual style**: Teal forest green primary (`hsl(170 75% 18%)`), amber accent (`hsl(16 80% 58%)`), DM Sans + Outfit fonts, dark sidebar.

**Pages**: Dashboard, Operators (list/new/edit), Terminal Health, Bookings, Analytics (with charts), Login.

**Backend routes**: `/api/operators` (CRUD + ping), `/api/terminals/health`, `/api/bookings`, `/api/analytics/*`, `/api/auth/*`, `/api/gateway/*`

**Gateway endpoints** (TransityTerminal integration):
- `GET /api/gateway/trips/search?originCity=&destinationCity=&date=&passengers=` — aggregated trip search (cached 90s)
- `POST /api/gateway/trips/materialize` — materialize virtual trip; accepts `{ tripId, serviceDate }` or `{ baseId, operatorSlug, serviceDate }`, forwards to terminal's `POST /api/app/trips/materialize`
- `GET /api/gateway/trips/:tripId?serviceDate=` — trip detail; virtual trips auto-materialize, falls back to search data if endpoint not deployed yet
- `GET /api/gateway/trips/:tripId/seatmap?originSeq=&destinationSeq=&serviceDate=` — seatmap (cached 45s); virtual trips materialize first for real seat data
- `GET /api/gateway/trips/:tripId/reviews` — trip reviews proxy
- `GET /api/gateway/cities` — aggregated cities from all operators (cached 5min)
- `GET /api/gateway/operators/:operatorSlug/info` — operator brand info (cached 15min)
- `GET /api/gateway/service-lines` — aggregated service lines (cached 5min)
- `POST /api/gateway/bookings` — create booking (invalidates seatmap cache on success)
- `GET /api/gateway/bookings/:bookingId` — get booking by ID
- `POST /api/gateway/payments/webhook` — forward payment webhook to terminal (HMAC-SHA256 signed)

**Gateway caching** (per REQ_UPDATE_CONSOLE_SEATMAP_CACHE):
- Seatmap: 45s TTL, invalidated on booking success or seat-unavailable error
- Search: 90s TTL
- Cities/Service Lines: 5min TTL
- Operator Info: 15min TTL
- Materialized trip IDs: persisted in-memory (idempotent)

**Error translation**: All terminal errors are translated to user-friendly Bahasa Indonesia messages. Technical details logged server-side only.

**Database tables**: `operators` (+ `webhookSecret`), `terminal_health`, `bookings` (+ `providerRef`, `holdExpiresAt`, `paymentMethod`, `passengersJson`, `originStopId`, `destinationStopId`, `serviceDate`), `admin_users`, `api_keys`

## Structure

```text
/
├── apps/
│   ├── api-server/         # Fastify 5 API server (port 8080)
│   └── transity-console/   # React + Vite admin dashboard (port 3000)
├── packages/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection + migrations
├── scripts/                # Utility scripts
├── Dockerfile              # Multi-stage production build
├── docker-compose.yml      # VPS deployment (postgres + app)
├── .env.example            # Environment variable template
├── pnpm-workspace.yaml     # pnpm workspace config
├── tsconfig.base.json      # Shared TS options
└── tsconfig.json           # Root TS project references
```

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references. This means:

- **Always typecheck from the root** — run `pnpm run typecheck` (which runs `tsc --build --emitDeclarationOnly`). This builds the full dependency graph so that cross-package imports resolve correctly. Running `tsc` inside a single package will fail if its dependencies haven't been built yet.
- **`emitDeclarationOnly`** — we only emit `.d.ts` files during typecheck; actual JS bundling is handled by esbuild/tsx/vite...etc, not `tsc`.
- **Project references** — when package A depends on package B, A's `tsconfig.json` must list B in its `references` array. `tsc --build` uses this to determine build order and skip up-to-date packages.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages that define it
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references

## Packages

### `apps/api-server` (`@workspace/api-server`)

Fastify 5 API server. Logic is organized into domain modules in `src/modules/`:
`analytics/`, `auth/`, `bookings/`, `gateway/`, `health/`, `operators/`, `terminals/`

Each module follows Repository/Service/Routes pattern.

- Entry: `src/index.ts` — reads `PORT`, starts Fastify
- App setup: `src/app.ts` — registers routes, runs DB migrations on startup, serves static frontend in production
- Depends on: `@workspace/db`, `@workspace/api-zod`
- `pnpm --filter @workspace/api-server run build` — esbuild bundle to `dist/index.mjs`
- `pnpm --filter @workspace/api-server run start` — runs `dist/index.mjs`

### `packages/db` (`@workspace/db`)

Database layer using Drizzle ORM with PostgreSQL.

- `src/index.ts` — creates Pool + Drizzle instance, exports `db`, `pool`, `runMigrations(dir)`
- `src/schema/` — table definitions (operators, terminal_health, bookings, admin_users, api_keys)
- `migrations/` — SQL migration files generated by drizzle-kit
- `drizzle.config.ts` — Drizzle Kit config, outputs migrations to `./migrations/`
- Exports: `.` (pool, db, schema, runMigrations), `./schema` (schema only)

### Database Migrations

**Development**: Use `drizzle-kit push` (idempotent, no migration files needed):
```bash
pnpm --filter @workspace/db run push
```

**When schema changes** (to keep production migrations in sync):
```bash
pnpm --filter @workspace/db run generate   # creates new SQL migration file
pnpm --filter @workspace/db run push       # applies to dev DB
```

**Production (Docker)**: The API server automatically runs `runMigrations()` on startup via drizzle's `migrate()` function, reading SQL files from `MIGRATIONS_DIR` (default: `/app/packages/db/migrations`). This is idempotent — already-applied migrations are skipped via the `drizzle.__drizzle_migrations` tracking table.

**Dev DB note**: If tables were previously created via `push` (before migration files existed), you need to mark migration 0000 as applied:
```bash
psql "$DATABASE_URL" -c "
  CREATE SCHEMA IF NOT EXISTS drizzle;
  CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint);
  INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('<hash-of-0000.sql>', <journal-when>);
"
```

### `packages/api-spec` (`@workspace/api-spec`)

Owns the OpenAPI 3.1 spec (`openapi.yaml`) and Orval config (`orval.config.ts`). Running codegen produces output into:

1. `packages/api-client-react/src/generated/` — React Query hooks + fetch client
2. `packages/api-zod/src/generated/` — Zod schemas

Run codegen: `pnpm --filter @workspace/api-spec run codegen`

### `packages/api-zod` (`@workspace/api-zod`)

Generated Zod schemas from the OpenAPI spec. Used by `api-server` for response validation.

### `packages/api-client-react` (`@workspace/api-client-react`)

Generated React Query hooks and fetch client from the OpenAPI spec. Used by the frontend dashboard.

### `scripts` (`@workspace/scripts`)

Utility scripts package. Each script is a `.ts` file in `src/` with a corresponding npm script in `package.json`. Run scripts via `pnpm --filter @workspace/scripts run <script>`.

## Docker / VPS Deployment

The project ships with Docker files for self-hosted VPS deployment:

- `Dockerfile` — multi-stage build: installs deps, builds frontend, builds API, assembles lean production image
- `docker-compose.yml` — orchestrates postgres + app services
- `.env.example` — template for required environment variables

**Deploy to VPS:**
```bash
cp .env.example .env
# Edit .env with your secrets
docker compose up -d
```

The production container:
- Serves the React frontend as static files via `@fastify/static`
- Proxies all `/api/*` requests through Fastify
- Auto-runs DB migrations on startup
- Health check at `GET /api/healthz`
