# TransityConsole — Dokumentasi Implementasi

> Versi: 1.0 · Tanggal: April 2026 · Status: Living Document

---

## Daftar Isi

1. [Ekosistem Transity](#1-ekosistem-transity)
2. [Peran TransityConsole](#2-peran-transityconsole)
3. [Keputusan Arsitektur](#3-keputusan-arsitektur)
4. [Technology Stack](#4-technology-stack)
5. [Struktur Project](#5-struktur-project)
6. [Domain & Bounded Contexts](#6-domain--bounded-contexts)
7. [Database Schema](#7-database-schema)
8. [API Design](#8-api-design)
9. [Stream Proxy Architecture](#9-stream-proxy-architecture)
10. [Integrasi Antar Produk](#10-integrasi-antar-produk)
11. [Frontend — Dashboard Design](#11-frontend--dashboard-design)
12. [Security & Auth](#12-security--auth)
13. [Observability](#13-observability)
14. [Roadmap Implementasi](#14-roadmap-implementasi)
15. [Migrasi Express → Fastify](#15-migrasi-express--fastify)

---

## 1. Ekosistem Transity

Transity adalah ekosistem produk multi-layer untuk industri travel shuttle Indonesia. Terdiri dari tiga produk yang saling terhubung:

```
┌────────────────────────────────────────────────────────────────────────┐
│                          EKOSISTEM TRANSITY                            │
├────────────────────────────────────────────────────────────────────────┤
│                                                                        │
│   TransityApp (OTA · B2C)                                              │
│   ───────────────────────                                              │
│   Customer booking portal — React/Vite + Fastify                       │
│   Satu platform, semua operator, semua rute                            │
│   Sementara: stream langsung ke 1 operator                             │
│   Target: stream ke TransityConsole (routing otomatis)                 │
│                                                                        │
│              │  stream HTTP / SSE  ↕  forward + routing                │
│                                                                        │
│   TransityConsole (Management + Gateway · Internal)          ◄── KITA  │
│   ────────────────────────────────────────────────                     │
│   Admin dashboard OTA + API Aggregation Gateway                        │
│   Operator registry — routing table ke semua terminal                  │
│   Fan-out search, proxy booking, komisi, analytics                     │
│   Circuit breaker, health monitoring, rate limiting                    │
│                                                                        │
│              │  X-Service-Key  ↕  REST / SSE per operator              │
│                                                                        │
│   TransityTerminal × N  (Whitelabel · Per Operator)                    │
│   ────────────────────────────────────────────────                     │
│   Nusa Shuttle    → nusa-terminal.transity.web.id                      │
│   BusKita         → buskita-terminal.transity.web.id                   │
│   TransExpress    → transexpress-terminal.transity.web.id              │
│   ... (N operator, deploy independen)                                  │
│                                                                        │
└────────────────────────────────────────────────────────────────────────┘
```

### Mengapa Tiga Layer?

| Masalah | Tanpa Console | Dengan Console |
|---|---|---|
| Tambah operator baru | Update kode TransityApp | Daftar di Operator Registry |
| Terminal down | TransityApp ikut error | Circuit breaker, skip otomatis |
| Markup / komisi | Hardcode di App | Konfigurasi per operator di Console |
| Monitoring | Tidak ada | Dashboard real-time semua terminal |
| Analytics lintas operator | Tidak bisa | Aggregated di Console DB |
| Routing stream | App tahu semua URL terminal | App cukup stream ke Console |

---

## 2. Peran TransityConsole

TransityConsole punya **dua peran utama** yang berjalan di satu sistem:

### 2.1 Admin Dashboard (UI)

Interface internal untuk tim Transity mengelola seluruh ekosistem:

- Mendaftarkan dan mengkonfigurasi operator shuttle
- Memantau kesehatan semua terminal secara real-time
- Melihat semua booking lintas operator
- Menganalisis revenue, komisi, dan performa operator
- Mengatur markup/komisi per operator

### 2.2 API Gateway / BFF (Backend)

Lapisan tengah antara TransityApp dan semua TransityTerminal:

```
TransityApp
    │
    │  POST /api/gateway/trips/search
    │  (satu request, tanpa tahu ada berapa operator)
    ▼
TransityConsole API
    ├── Lookup operator registry (aktif)
    ├── Fan-out paralel ke semua terminal
    │     ├── GET nusa-terminal.../api/app/trips/search
    │     ├── GET buskita-terminal.../api/app/trips/search
    │     └── GET transexpress-terminal.../api/app/trips/search
    ├── Apply komisi/markup per operator
    ├── Merge & sort hasil
    └── Return unified response → TransityApp

TransityApp
    │
    │  POST /api/gateway/bookings
    │  (identifikasi operator dari tripId prefix)
    ▼
TransityConsole API
    ├── Parse operatorSlug dari tripId
    ├── Lookup terminal URL + serviceKey dari registry
    ├── Forward booking ke terminal operator yang tepat
    ├── Record booking di Console DB
    └── Return booking result → TransityApp
```

---

## 3. Keputusan Arsitektur

### 3.1 Modular Monolith dengan DDD — Bukan Microservices

**Keputusan: Modular Monolith**

Microservices ditolak karena:

| Faktor | Microservices | Modular Monolith |
|---|---|---|
| Skala operator saat ini | 2–10 operator | Cukup satu proses |
| Tim saat ini | Kecil | Overhead ops terlalu besar |
| Latency internal | Network hop antar service | In-process call |
| Deployment | K8s / Nomad | Single container |
| Debugging | Distributed tracing | Standard logging |
| Database | Satu per service? | Satu PostgreSQL, schema terpisah |

**Kapan di-extract ke microservice?** Ketika salah satu domain butuh scaling independen, misalnya Aggregation Gateway yang menerima ratusan request/detik sementara Admin Dashboard jarang dipakai.

### 3.2 Prinsip DDD yang Diterapkan

Meskipun monolith, setiap domain punya batas yang jelas:

- **Bounded Context** yang terisolasi: tidak ada import silang antar domain
- **Ubiquitous Language**: `Operator`, `Terminal`, `Booking`, `Trip`, `Commission`
- **Domain Events** (Phase 2): `OperatorRegistered`, `TerminalDown`, `BookingConfirmed`
- **Repository Pattern**: domain tidak tahu detail SQL/Drizzle

### 3.3 Request Flow — Saat Ini vs Target

**Saat Ini (Phase 0):**
```
TransityApp → [API_UPSTREAM=nusa-terminal.transity.web.id] → Terminal langsung
```

**Target (Phase 1+):**
```
TransityApp → [CONSOLE_API_URL] → TransityConsole → routing → Terminal yang tepat
```

TransityApp **tidak perlu tahu** ada berapa operator. Cukup update `CONSOLE_API_URL` dan hapus `API_UPSTREAM`.

---

## 4. Technology Stack

### 4.1 Stack Keseluruhan

| Layer | Teknologi | Alasan |
|---|---|---|
| **API Server** | **Fastify 5** | Performant, schema-first, plugin ekosistem kuat, konsisten dengan TransityApp |
| **Frontend** | React 19 + Vite 7 | Hot reload, TypeScript support, sudah ada |
| **UI Library** | Radix UI + Tailwind CSS 4 | Accessible, headless, design system fleksibel |
| **ORM** | Drizzle ORM | Type-safe, ringan, migrasi mudah |
| **Database** | PostgreSQL 16 | Relasional, ACID, sudah ada di Replit |
| **Validation** | Zod v4 | Type inference, konsisten frontend-backend |
| **API Contract** | OpenAPI 3.1 + Orval | Code generation React Query hooks + Zod schemas |
| **Query Client** | TanStack React Query | Caching, invalidation, loading states |
| **Charts** | Recharts | Ringan, React-native, customizable |
| **HTTP Client (fan-out)** | Native `fetch` + `p-limit` | Fan-out paralel ke terminal dengan concurrency control |
| **Cache** | Redis (Phase 2) | Cache hasil search 30 detik, session admin |
| **Circuit Breaker** | `opossum` (Phase 2) | Skip terminal yang tidak respond dalam 3 detik |
| **Auth** | JWT + cookie httpOnly | Admin session, API key per operator |
| **Logger** | `pino` + `pino-http` | Structured JSON logging, low overhead |

### 4.2 Kenapa Fastify (Bukan Express)

```
Benchmark (req/sec, simple JSON response):
  Express 4:  ~15,000 req/sec
  Express 5:  ~16,000 req/sec
  Fastify 5:  ~75,000 req/sec  ✓

Keunggulan Fastify:
  ✓ Schema-based serialization (JSON Schema → faster output)
  ✓ Plugin system dengan encapsulation scope
  ✓ Built-in TypeScript support
  ✓ Lifecycle hooks yang eksplisit
  ✓ Konsisten dengan TransityApp (sudah pakai Fastify)
  ✓ fastify-plugin untuk shared context (DB, config)
```

### 4.3 Monorepo Package Dependencies

```
@workspace/api-server         ← Fastify API (domain logic semua ada di sini)
  depends on: @workspace/db, @workspace/api-zod

@workspace/transity-console   ← React + Vite admin dashboard
  depends on: @workspace/api-client-react

@workspace/api-spec           ← OpenAPI 3.1 source of truth
  generates → @workspace/api-client-react (hooks)
  generates → @workspace/api-zod (schemas)

@workspace/db                 ← Drizzle schema + pool
@workspace/api-zod            ← Generated Zod schemas
@workspace/api-client-react   ← Generated React Query hooks
```

---

## 5. Struktur Project

### 5.1 Monorepo Overview

```
transity-console/                      ← pnpm workspace root
├── artifacts/
│   ├── api-server/                    ← Fastify API (domain logic)
│   │   └── src/
│   │       ├── index.ts               ← Entry point, baca PORT
│   │       ├── app.ts                 ← Fastify instance, register plugins
│   │       ├── plugins/               ← Shared Fastify plugins
│   │       │   ├── db.ts              ← @workspace/db plugin
│   │       │   ├── auth.ts            ← JWT verify plugin
│   │       │   └── cors.ts            ← CORS config
│   │       └── modules/               ← DDD Modules (bounded contexts)
│   │           ├── operators/         ← Operator Registry domain
│   │           │   ├── routes.ts      ← Fastify route handlers
│   │           │   ├── service.ts     ← Business logic
│   │           │   └── repository.ts  ← DB access
│   │           ├── gateway/           ← API Aggregation Gateway domain
│   │           │   ├── routes.ts      ← /api/gateway/* endpoints
│   │           │   ├── aggregator.ts  ← Fan-out + merge logic
│   │           │   ├── proxy.ts       ← Stream proxy ke terminal
│   │           │   └── circuit.ts     ← Circuit breaker per operator
│   │           ├── terminals/         ← Terminal Health domain
│   │           │   ├── routes.ts
│   │           │   ├── service.ts
│   │           │   └── scheduler.ts   ← Background health checker
│   │           ├── bookings/          ← Booking Tracker domain
│   │           │   ├── routes.ts
│   │           │   └── service.ts
│   │           ├── analytics/         ← Analytics Engine domain
│   │           │   ├── routes.ts
│   │           │   └── service.ts
│   │           └── auth/              ← IAM domain
│   │               ├── routes.ts
│   │               └── service.ts
│   │
│   └── transity-console/              ← React + Vite Admin Dashboard
│       └── src/
│           ├── App.tsx
│           ├── pages/
│           │   ├── dashboard.tsx
│           │   ├── operators/
│           │   ├── terminals/
│           │   ├── bookings/
│           │   ├── analytics/
│           │   └── settings/          ← (Phase 2) API keys, config
│           ├── components/
│           │   ├── layout/
│           │   └── ui/                ← Shadcn components
│           └── lib/
│               └── utils.ts
│
├── lib/
│   ├── api-spec/
│   │   └── openapi.yaml              ← Source of truth semua API contract
│   ├── api-client-react/             ← Generated hooks (jangan edit manual)
│   ├── api-zod/                      ← Generated Zod schemas (jangan edit manual)
│   └── db/
│       └── src/
│           ├── index.ts
│           └── schema/
│               ├── operators.ts
│               ├── bookings.ts
│               ├── terminal_health.ts
│               ├── api_keys.ts        ← (Phase 2)
│               └── audit_log.ts      ← (Phase 2)
│
├── scripts/                          ← Utility scripts (seed, migrate, etc.)
├── docs/
│   └── IMPLEMENTATION.md             ← File ini
├── pnpm-workspace.yaml
└── package.json
```

### 5.2 Struktur Module (DDD Pattern)

Setiap module di `src/modules/<domain>/` mengikuti struktur ini:

```
modules/operators/
├── routes.ts       ← HTTP layer: parse request, call service, return response
├── service.ts      ← Business logic: validasi domain, orchestrate repo calls
├── repository.ts   ← Data access: Drizzle queries, tidak ada business logic
└── types.ts        ← Domain types (bisa import dari @workspace/api-zod)
```

**Aturan import:**
- `routes.ts` boleh import `service.ts`
- `service.ts` boleh import `repository.ts`
- Tidak ada import silang antar module (gateway boleh import operators service)
- Tidak ada Drizzle query langsung di `routes.ts`

---

## 6. Domain & Bounded Contexts

### 6.1 Operator Registry

**Tanggung jawab:** Menyimpan dan mengelola semua operator shuttle yang terdaftar di ekosistem Transity.

**Entitas utama:** `Operator`

```typescript
type Operator = {
  id: string;              // UUID
  name: string;            // "Nusa Shuttle"
  slug: string;            // "nusa-shuttle" (dipakai sebagai prefix tripId)
  apiUrl: string;          // "https://nusa-terminal.transity.web.id"
  serviceKey: string;      // X-Service-Key untuk auth ke terminal
  active: boolean;
  logoUrl: string | null;
  commissionPct: number;   // 0-100, persentase markup OTA
  primaryColor: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

**Aturan domain:**
- `slug` harus unik dan immutable setelah dibuat (dipakai sebagai bagian tripId)
- `serviceKey` tidak pernah dikembalikan ke frontend (hanya dipakai server-side)
- Nonaktifkan operator dengan `active: false`, jangan hapus (preservasi data booking)

### 6.2 API Aggregation Gateway

**Tanggung jawab:** Menerima request dari TransityApp, fan-out ke semua terminal aktif, merge hasilnya.

**Entitas utama:** Tidak punya tabel sendiri — orchestrate data dari domain lain.

**Alur kerja:**

```
1. Terima request dari TransityApp
2. Load daftar operator aktif dari Operator Registry
3. Fan-out paralel dengan p-limit(10) ke semua terminal
4. Untuk setiap terminal:
   a. Set timeout 3 detik
   b. Kirim X-Service-Key
   c. Tambahkan prefix "operatorSlug:" ke setiap tripId
   d. Apply commissionPct ke harga
5. Kumpulkan semua hasil (Promise.allSettled — tidak gagal total jika 1 terminal down)
6. Merge, sort by price/departure
7. Return unified response
```

**Konvensi tripId:**
```
Format: {operatorSlug}:{originalTripId}
Contoh: "nusa-shuttle:trip-abc123"

Saat booking, Console parse prefix untuk tahu ke terminal mana diteruskan.
```

### 6.3 Terminal Health Monitor

**Tanggung jawab:** Memantau status konektivitas semua terminal secara berkala.

**Entitas utama:** `TerminalHealth`

```typescript
type TerminalHealth = {
  id: string;
  operatorId: string;
  status: "online" | "offline" | "degraded";
  latencyMs: number | null;
  checkedAt: Date;
};
```

**Mekanisme:**
- Background scheduler ping semua terminal aktif setiap 60 detik
- `online`: response HTTP 200 dalam < 1000ms
- `degraded`: response HTTP 200 tapi latency > 1000ms
- `offline`: timeout, connection refused, atau non-200

### 6.4 Booking Tracker

**Tanggung jawab:** Merekam semua booking yang diproses melalui Console sebagai audit trail.

**Entitas utama:** `Booking`

```typescript
type Booking = {
  id: string;
  operatorId: string;
  operatorName: string;
  passengerName: string;
  passengerPhone: string;
  tripId: string;          // format: {operatorSlug}:{originalTripId}
  origin: string;
  destination: string;
  departureDate: string;   // ISO date
  seatNumbers: string[];
  totalAmount: number;     // sudah include markup/komisi
  commissionAmount: number; // komisi OTA dari booking ini
  status: "pending" | "confirmed" | "cancelled" | "completed";
  externalBookingId: string | null; // booking ID dari terminal operator
  createdAt: Date;
};
```

### 6.5 Analytics Engine

**Tanggung jawab:** Aggregasi data untuk reporting revenue, komisi, dan performa operator.

Tidak punya tabel sendiri — query dari `bookings` + `operators` + `terminal_health`.

**Metrik utama:**
- Total revenue OTA (sum `totalAmount`)
- Total komisi (sum `commissionAmount`)
- Revenue per operator
- Booking funnel (pending → confirmed → completed)
- Uptime per terminal (% waktu online)
- Rute terpopuler

### 6.6 IAM (Identity & Access Management)

**Tanggung jawab:** Auth admin Console + manajemen API key untuk TransityApp.

```typescript
type AdminUser = {
  id: string;
  email: string;
  passwordHash: string;
  role: "super_admin" | "admin" | "viewer";
  createdAt: Date;
};

type ApiKey = {
  id: string;
  name: string;         // "TransityApp Production"
  keyHash: string;      // hashed — tidak disimpan plaintext
  prefix: string;       // "tc_live_..." (first 8 chars untuk identifikasi)
  scopes: string[];     // ["gateway:read", "gateway:write"]
  active: boolean;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
};
```

---

## 7. Database Schema

### 7.1 Tabel yang Sudah Ada

#### `operators`
```sql
CREATE TABLE operators (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name          TEXT NOT NULL,
  slug          TEXT NOT NULL UNIQUE,          -- immutable, dipakai sebagai prefix tripId
  api_url       TEXT NOT NULL,
  service_key   TEXT NOT NULL,                 -- rahasia, tidak pernah ke frontend
  active        BOOLEAN NOT NULL DEFAULT true,
  logo_url      TEXT,
  commission_pct NUMERIC(5,2) NOT NULL DEFAULT 0,
  primary_color TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `terminal_health`
```sql
CREATE TABLE terminal_health (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id UUID NOT NULL REFERENCES operators(id),
  status      TEXT NOT NULL DEFAULT 'offline',  -- online|offline|degraded
  latency_ms  NUMERIC(10,2),
  checked_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_terminal_health_operator_checked ON terminal_health(operator_id, checked_at DESC);
```

#### `bookings`
```sql
CREATE TABLE bookings (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operator_id         UUID NOT NULL REFERENCES operators(id),
  operator_name       TEXT NOT NULL,
  passenger_name      TEXT NOT NULL,
  passenger_phone     TEXT NOT NULL,
  trip_id             TEXT NOT NULL,
  origin              TEXT NOT NULL,
  destination         TEXT NOT NULL,
  departure_date      DATE NOT NULL,
  seat_numbers        TEXT[] NOT NULL DEFAULT '{}',
  total_amount        NUMERIC(12,2) NOT NULL DEFAULT 0,
  status              TEXT NOT NULL DEFAULT 'pending',
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_bookings_operator ON bookings(operator_id);
CREATE INDEX idx_bookings_departure ON bookings(departure_date);
CREATE INDEX idx_bookings_status ON bookings(status);
```

### 7.2 Tabel Baru (Phase 1–2)

#### `bookings` — kolom tambahan
```sql
ALTER TABLE bookings ADD COLUMN commission_amount NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE bookings ADD COLUMN external_booking_id TEXT;  -- ID dari terminal operator
```

#### `api_keys` (Phase 1 — auth TransityApp ke Console)
```sql
CREATE TABLE api_keys (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name         TEXT NOT NULL,
  key_hash     TEXT NOT NULL UNIQUE,      -- bcrypt hash
  prefix       TEXT NOT NULL,            -- 8 char prefix untuk display
  scopes       TEXT[] NOT NULL DEFAULT '{}',
  active       BOOLEAN NOT NULL DEFAULT true,
  last_used_at TIMESTAMPTZ,
  expires_at   TIMESTAMPTZ,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `admin_users` (Phase 1 — login dashboard)
```sql
CREATE TABLE admin_users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'admin',  -- super_admin|admin|viewer
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

#### `audit_log` (Phase 2 — track semua perubahan penting)
```sql
CREATE TABLE audit_log (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor      TEXT NOT NULL,   -- admin email atau "system"
  action     TEXT NOT NULL,   -- "operator.created", "operator.deactivated"
  entity     TEXT NOT NULL,   -- "operators"
  entity_id  TEXT NOT NULL,
  payload    JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

---

## 8. API Design

### 8.1 Konvensi

```
Base URL   : /api
Auth Admin : Bearer {JWT}  (untuk /api/admin/*)
Auth App   : X-Api-Key: {key}  (untuk /api/gateway/*)
Format     : JSON
Errors     : { "error": "message", "code": "ERROR_CODE", "details"?: any }
Pagination : { "data": [], "total": N, "page": N, "limit": N, "hasMore": bool }
```

### 8.2 Admin Endpoints (Dashboard)

#### Operators
```
GET    /api/operators              → List operators (paginated, filter by active)
POST   /api/operators              → Register operator baru
GET    /api/operators/:id          → Detail operator
PATCH  /api/operators/:id          → Update operator
DELETE /api/operators/:id          → Soft delete (set active=false)
POST   /api/operators/:id/ping     → Manual health check ke terminal
POST   /api/operators/:id/sync     → Sinkron operator-info dari terminal
```

#### Terminals
```
GET    /api/terminals/health       → Status semua terminal (latest per operator)
GET    /api/terminals/:operatorId/history  → Riwayat health check (grafik uptime)
```

#### Bookings
```
GET    /api/bookings               → List booking (filter: operatorId, status, date range)
GET    /api/bookings/:id           → Detail booking
```

#### Analytics
```
GET    /api/analytics/summary      → KPI utama (total revenue, operators, terminals, bookings today)
GET    /api/analytics/revenue      → Time-series revenue + komisi (period: 7d|30d|90d)
GET    /api/analytics/operators    → Performa per operator (bookings, revenue, uptime, latency)
GET    /api/analytics/routes       → Rute terpopuler lintas operator
```

#### Auth (Phase 1)
```
POST   /api/auth/login             → { email, password } → JWT
POST   /api/auth/logout
GET    /api/auth/me
POST   /api/admin/api-keys         → Generate API key baru
GET    /api/admin/api-keys         → List API keys
DELETE /api/admin/api-keys/:id     → Revoke API key
```

### 8.3 Gateway Endpoints (untuk TransityApp)

Semua endpoint gateway memerlukan `X-Api-Key` header.

```
POST   /api/gateway/trips/search          → Aggregated search ke semua operator
GET    /api/gateway/trips/:tripId         → Detail trip (tripId = "{slug}:{id}")
GET    /api/gateway/trips/:tripId/seatmap → Seatmap dari terminal operator
POST   /api/gateway/bookings              → Buat booking, routing ke terminal yang tepat
GET    /api/gateway/bookings/:id          → Status booking
GET    /api/gateway/cities                → Kumpulan kota dari semua terminal
```

---

## 9. Stream Proxy Architecture

### 9.1 Konteks: TransityApp Saat Ini

TransityApp saat ini menggunakan Fastify sebagai **reverse proxy transparan**:

```typescript
// server/index.ts — TransityApp (kondisi saat ini)
const API_UPSTREAM = process.env.API_UPSTREAM || 'https://nusa-terminal.transity.web.id';

app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/api/')) {
    const upstream = `${API_UPSTREAM}${req.url}`;
    // proxy langsung ke 1 terminal
    const res = await fetch(upstream, { method: req.method, headers, body });
    reply.status(res.status).send(await res.json());
  }
});
```

**Masalah:** `API_UPSTREAM` hardcode ke 1 operator. Tidak bisa multi-operator.

### 9.2 Target: TransityApp → Console → Terminal

Perubahan yang dibutuhkan di TransityApp sangat minimal:

```typescript
// server/index.ts — TransityApp (setelah integrasi Console)
const CONSOLE_API_URL = process.env.CONSOLE_API_URL;
const CONSOLE_API_KEY = process.env.CONSOLE_API_KEY;

app.addHook('onRequest', async (req, reply) => {
  if (req.url.startsWith('/api/')) {
    // Ganti API_UPSTREAM → CONSOLE_API_URL
    // Tambah X-Api-Key header
    const upstream = `${CONSOLE_API_URL}/gateway${req.url}`;
    const res = await fetch(upstream, {
      method: req.method,
      headers: {
        ...headers,
        'X-Api-Key': CONSOLE_API_KEY,
      },
      body,
    });
    reply.status(res.status).send(await res.json());
  }
});
```

**Catatan:** URL path di TransityApp tidak perlu berubah. Hanya env var yang diganti.

### 9.3 Fan-out Search di Console

```
TransityApp
  POST /api/gateway/trips/search
  body: { origin, destination, date, passengers }
        │
        ▼
Console: Gateway Module — aggregator.ts
  1. Load active operators dari cache/DB
  2. p-limit(10) — max 10 concurrent requests
  3. Promise.allSettled([
       fetch(nusa-terminal.../api/app/trips/search, { signal: AbortSignal.timeout(3000) }),
       fetch(buskita-terminal.../api/app/trips/search, { signal: AbortSignal.timeout(3000) }),
       ...
     ])
  4. Filter fulfilled results saja (rejected = terminal down, skip)
  5. Untuk setiap trip dari terminal X:
       trip.id = `${operator.slug}:${trip.id}`  // prefix slug
       trip.price = trip.price * (1 + operator.commissionPct / 100)
       trip.operatorName = operator.name
       trip.operatorLogo = operator.logoUrl
  6. Merge semua trips → sort by price ASC (default)
  7. Return { trips: [...], meta: { total, operatorsQueried, operatorsFailed } }
```

### 9.4 Booking Routing di Console

```
TransityApp
  POST /api/gateway/bookings
  body: { tripId: "nusa-shuttle:trip-abc123", passengerName, ... }
        │
        ▼
Console: Gateway Module — proxy.ts
  1. Parse slug dari tripId: "nusa-shuttle"
  2. Lookup operator by slug → get apiUrl + serviceKey
  3. Buat originalTripId = tripId.replace("nusa-shuttle:", "")
  4. Forward ke terminal:
       POST {apiUrl}/api/app/bookings
       Headers: X-Service-Key: {serviceKey}
       Body: { tripId: originalTripId, passengerName, ... }
  5. Terima response dari terminal
  6. Hitung commissionAmount
  7. Record di Console DB (bookings table)
  8. Return booking result ke TransityApp (dengan externalBookingId)
```

### 9.5 Circuit Breaker (Phase 2)

```typescript
// modules/gateway/circuit.ts
import CircuitBreaker from 'opossum';

const breakers = new Map<string, CircuitBreaker>();

export function getBreaker(operatorSlug: string, fn: Function) {
  if (!breakers.has(operatorSlug)) {
    breakers.set(operatorSlug, new CircuitBreaker(fn, {
      timeout: 3000,          // 3 detik
      errorThresholdPercentage: 50,  // buka circuit jika 50% request gagal
      resetTimeout: 30000,    // coba lagi setelah 30 detik
    }));
  }
  return breakers.get(operatorSlug)!;
}
```

---

## 10. Integrasi Antar Produk

### 10.1 Contract: Console ↔ TransityTerminal

Console memanggil terminal dengan kontrak yang sudah distandardisasi di Phase 0:

```
Header wajib: X-Service-Key: {operator.serviceKey}

Endpoints yang dipanggil Console:
  GET  {terminal}/api/health                    → { status: "ok" }
  GET  {terminal}/api/app/operator-info         → { name, logo, colors, ... }
  POST {terminal}/api/app/trips/search          → { trips: [...], total, hasMore }
  GET  {terminal}/api/app/trips/:id             → trip detail
  GET  {terminal}/api/app/trips/:id/seatmap     → seatmap
  POST {terminal}/api/app/bookings              → booking result
  GET  {terminal}/api/app/bookings/:id          → booking status

Error format terminal:
  { "error": "string", "code": "ERROR_CODE", "details"?: any }
```

### 10.2 Contract: TransityApp ↔ Console

```
Header wajib: X-Api-Key: {api_key}

Endpoint yang dipanggil TransityApp:
  POST /api/gateway/trips/search    → unified trips dari semua operator
  GET  /api/gateway/trips/:tripId   → detail (tripId pakai prefix slug)
  GET  /api/gateway/trips/:tripId/seatmap
  POST /api/gateway/bookings
  GET  /api/gateway/bookings/:id
  GET  /api/gateway/cities

Response trips/search tambahan field:
  trip.operatorName  → nama operator untuk display di UI
  trip.operatorLogo  → URL logo operator
  trip.operatorSlug  → slug (sudah embedded di tripId tapi exposed untuk filter)
```

### 10.3 Env Variables

#### TransityConsole (api-server)
```env
# Database
DATABASE_URL=postgresql://...

# Auth
JWT_SECRET=...
JWT_EXPIRES_IN=8h

# Server
PORT=8080
NODE_ENV=production

# Optional Phase 2
REDIS_URL=redis://...
HEALTH_CHECK_INTERVAL_MS=60000
```

#### TransityApp (update)
```env
# Ganti dari:
API_UPSTREAM=https://nusa-terminal.transity.web.id

# Menjadi:
CONSOLE_API_URL=https://console.transity.web.id
CONSOLE_API_KEY=tc_live_xxxxxxxxxxxxxxxx
```

#### TransityTerminal (sudah ada, tidak perlu ubah)
```env
TERMINAL_SERVICE_KEY=...
REALMIO_TENANT_ID=nusa-shuttle
```

---

## 11. Frontend — Dashboard Design

### 11.1 Design System

```
Primary   : hsl(170 75% 18%)  → Teal forest green (sidebar, CTA)
Accent    : hsl(16 80% 58%)   → Amber (highlights, alerts)
Background: hsl(0 0% 97%)     → Off-white (light mode)
Surface   : hsl(0 0% 100%)    → Card backgrounds
Text      : hsl(220 13% 18%)  → Dark gray

Fonts     : DM Sans (UI), Outfit (headings/numbers)
Radius    : 0.75rem (card), 0.5rem (input/button)
Theme     : Light + Dark mode (via next-themes)
```

### 11.2 Halaman dan Komponen

#### Dashboard (`/`)
- **KPI Cards**: Total Revenue (MTD), Active Operators, Terminals Online, Bookings Today
- **Revenue Chart**: Area chart 30 hari (revenue + komisi)
- **Terminal Status**: Grid status semua terminal (live ping)
- **Recent Bookings**: Tabel 5 booking terbaru

#### Operators (`/operators`)
- Tabel semua operator dengan status aktif/nonaktif
- Quick action: ping terminal, edit, nonaktifkan
- **Operator Detail** (`/operators/:id`):
  - Form edit semua field
  - Terminal health history chart
  - Booking stats khusus operator ini
  - Commission calculator preview

#### Terminal Health (`/terminals`)
- Grid card setiap terminal: status badge, latency, last checked
- Manual ping button
- Uptime chart 7 hari per terminal

#### Bookings (`/bookings`)
- Tabel dengan filter: operator, status, tanggal
- Export CSV (Phase 2)

#### Analytics (`/analytics`)
- Revenue + komisi time series (7d / 30d / 90d)
- Operator comparison bar chart
- Route popularity heatmap (Phase 2)
- Booking funnel (Phase 2)

#### Settings (`/settings`) — Phase 1
- API Key management (generate/revoke untuk TransityApp)
- Admin user management
- Global configuration (timeout, circuit breaker threshold)

### 11.3 Kolaborasi Design — Shared dengan TransityApp

Karena Console adalah "wajah internal" ekosistem Transity, ada beberapa elemen design yang perlu konsisten dengan TransityApp (B2C):

| Elemen | TransityApp (B2C) | TransityConsole (Internal) |
|---|---|---|
| Brand color | Teal primary | Sama — teal sidebar |
| Operator branding | Logo + warna per operator | Konsisten di badge/card |
| Status indicators | Booking status badges | Terminal status badges (warna sama) |
| Currency format | `Rp X.XXX` | Sama |
| Date format | `DD MMM YYYY` | Sama |

---

## 12. Security & Auth

### 12.1 Dua Layer Auth

```
1. Admin Dashboard
   → Form login (email + password)
   → JWT disimpan di cookie httpOnly, SameSite=Strict
   → Proteksi semua route /api/admin/* dan /api/operators, /api/bookings, dll.

2. TransityApp → Console Gateway
   → API Key (X-Api-Key header)
   → Key di-hash dengan bcrypt, tidak disimpan plaintext
   → Scopes: gateway:read, gateway:write
   → Rate limiting per key: 100 req/menit (Phase 2)
```

### 12.2 Service-to-Service (Console → Terminal)

```
Console menyimpan serviceKey per operator di tabel operators.
serviceKey TIDAK pernah dikembalikan ke frontend (select tanpa kolom serviceKey).
Dipakai hanya di server-side ketika fan-out ke terminal.
```

### 12.3 Tidak Disimpan Plaintext

```
serviceKey   → disimpan plaintext (karena Console perlu kirim as-is ke terminal)
              → mitigasi: kolom ini tidak pernah masuk response API
api_key      → disimpan sebagai bcrypt hash, hanya prefix 8 char yang ditampilkan
password     → bcrypt hash
JWT secret   → env variable, tidak pernah di kode
```

---

## 13. Observability

### 13.1 Logging

Menggunakan `pino` dengan structured JSON:

```typescript
// Setiap request fan-out ke terminal di-log:
log.info({
  module: 'gateway',
  action: 'terminal_request',
  operatorSlug: 'nusa-shuttle',
  endpoint: '/api/app/trips/search',
  durationMs: 234,
  status: 200,
});

// Terminal down:
log.warn({
  module: 'gateway',
  action: 'terminal_timeout',
  operatorSlug: 'buskita',
  durationMs: 3001,
  reason: 'AbortError',
});
```

### 13.2 Health Endpoint

```
GET /api/healthz → {
  status: "ok",
  version: "1.0.0",
  db: "connected",
  uptime: 12345,
  activeOperators: 3,
  terminalsOnline: 2
}
```

### 13.3 Metrics (Phase 2)

- Prometheus endpoint `/api/metrics`
- Metrik: `gateway_requests_total`, `gateway_duration_seconds`, `terminal_health_status`

---

## 14. Roadmap Implementasi

### Phase 0: Foundation ✅ Selesai (Kondisi Saat Ini)

- [x] Monorepo setup (pnpm workspace, TypeScript composite)
- [x] Database schema: `operators`, `bookings`, `terminal_health`
- [x] Express API: CRUD operators, terminal health check, bookings, analytics
- [x] OpenAPI spec + Orval codegen
- [x] React Dashboard: semua halaman dasar
- [x] Design system: teal/amber, dark mode, Radix UI

**Gap:** API server masih Express, belum ada Gateway module untuk TransityApp.

---

### Phase 1: Gateway Layer + Fastify Migration

**Target:** TransityApp bisa mulai routing ke Console untuk multi-operator search.

#### 1.1 Migrasi Express → Fastify
- [ ] Ubah `api-server` dari Express ke Fastify (lihat [Section 15](#15-migrasi-express--fastify))
- [ ] Re-implementasi semua route dengan Fastify syntax
- [ ] Fastify plugin untuk DB (`@workspace/db`)

#### 1.2 Gateway Module
- [ ] `modules/gateway/aggregator.ts` — fan-out search dengan `p-limit`
- [ ] `modules/gateway/proxy.ts` — booking routing berdasarkan tripId prefix
- [ ] Konvensi tripId: `{operatorSlug}:{originalId}`
- [ ] Apply komisi/markup saat merge hasil search
- [ ] `POST /api/gateway/trips/search`
- [ ] `POST /api/gateway/bookings`
- [ ] `GET /api/gateway/trips/:tripId`
- [ ] `GET /api/gateway/cities`

#### 1.3 API Key Auth
- [ ] Tabel `api_keys`
- [ ] Fastify plugin: verify `X-Api-Key` untuk `/api/gateway/*`
- [ ] Generate key di settings dashboard

#### 1.4 Admin Auth (Basic)
- [ ] Tabel `admin_users`
- [ ] `POST /api/auth/login` → JWT
- [ ] Middleware proteksi semua admin routes
- [ ] Halaman login di frontend

#### 1.5 Booking Tracking Update
- [ ] Tambah kolom `commission_amount` + `external_booking_id` ke `bookings`
- [ ] Record booking saat forward ke terminal
- [ ] Update Analytics untuk include commission tracking

---

### Phase 2: Resiliency + Observability

**Target:** Console siap production dengan circuit breaker dan monitoring.

- [ ] Circuit breaker per operator dengan `opossum`
- [ ] Redis cache untuk hasil search (TTL 30 detik)
- [ ] Background scheduler health check (setiap 60 detik)
- [ ] Rate limiting per API key
- [ ] Audit log untuk semua aksi admin
- [ ] Webhook receiver dari terminal (booking confirmed/cancelled)
- [ ] Export CSV untuk bookings dan analytics
- [ ] Settings page: konfigurasi timeout, threshold

---

### Phase 3: Analytics & Monetisasi

- [ ] Commission Engine: kalkulasi otomatis, invoice bulanan per operator
- [ ] Route popularity analytics
- [ ] Booking funnel visualization
- [ ] Operator performance comparison dashboard
- [ ] Featured routes management (konten homepage TransityApp)

---

### Phase 4: Ekosistem Lanjutan

- [ ] Mobile App (TransityApp) Expo React Native
- [ ] Public API untuk third-party OTA
- [ ] Multi-region (luar Jawa)
- [ ] Prometheus + Grafana metrics
- [ ] Ekstrak Gateway ke microservice (jika traffic sudah sangat tinggi)

---

## 15. Migrasi Express → Fastify

### 15.1 Perbandingan Pola

**Express (saat ini):**
```typescript
import { Router } from "express";
const router = Router();

router.get("/operators", async (req, res) => {
  const parsed = ListOperatorsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const data = await operatorsService.list(parsed.data);
  res.json(data);
});
```

**Fastify (target):**
```typescript
import { FastifyPluginAsync } from "fastify";
import { z } from "zod/v4";

const listQuerySchema = z.object({
  active: z.boolean().optional(),
  page:   z.number().int().default(1),
  limit:  z.number().int().default(20),
});

export const operatorsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/operators", {
    schema: {
      querystring: {
        type: "object",
        properties: {
          active: { type: "boolean" },
          page:   { type: "integer", default: 1 },
          limit:  { type: "integer", default: 20 },
        },
      },
    },
  }, async (request, reply) => {
    const parsed = listQuerySchema.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const data = await operatorsService.list(parsed.data);
    return data;
  });
};
```

### 15.2 Setup Fastify App

```typescript
// src/app.ts
import Fastify from "fastify";
import cors from "@fastify/cors";
import { dbPlugin } from "./plugins/db";
import { operatorsRoutes } from "./modules/operators/routes";
import { gatewayRoutes } from "./modules/gateway/routes";
// ... semua routes lain

export async function buildApp() {
  const app = Fastify({
    logger: {
      transport: process.env.NODE_ENV !== "production"
        ? { target: "pino-pretty" }
        : undefined,
    },
  });

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN || true,
  });

  await app.register(dbPlugin);

  // Admin routes (memerlukan JWT auth)
  await app.register(async (adminScope) => {
    // adminScope.addHook("onRequest", verifyJWT);
    await adminScope.register(operatorsRoutes);
    await adminScope.register(terminalsRoutes);
    await adminScope.register(bookingsRoutes);
    await adminScope.register(analyticsRoutes);
  }, { prefix: "/api" });

  // Gateway routes (memerlukan API key)
  await app.register(async (gatewayScope) => {
    // gatewayScope.addHook("onRequest", verifyApiKey);
    await gatewayScope.register(gatewayRoutes);
  }, { prefix: "/api" });

  return app;
}
```

### 15.3 Urutan Migrasi

```
Langkah 1: Install fastify + @fastify/cors + @fastify/cookie
Langkah 2: Buat src/app.ts (Fastify instance)
Langkah 3: Migrasi route satu per satu (operators → terminals → bookings → analytics)
Langkah 4: Hapus express, cors (package express), express types
Langkah 5: Update openapi.yaml jika ada perubahan schema
Langkah 6: Jalankan codegen ulang
Langkah 7: Test semua endpoint
```

---

## Catatan Akhir

TransityConsole bukan sekadar admin panel — ini adalah **urat nadi operasional** seluruh ekosistem Transity. Setiap keputusan arsitektur di dokumen ini dipilih untuk:

1. **Kesederhanaan operasional** — satu service, satu DB, mudah di-deploy dan di-debug
2. **Kemampuan berkembang** — modul yang bisa di-extract ke microservice kapanpun dibutuhkan
3. **Transparansi ke client** — TransityApp tidak perlu tahu ada berapa operator
4. **Ketahanan** — satu terminal down tidak merusak pengalaman pengguna

Fokus Phase 1 adalah: **Fastify migration + Gateway module + API Key auth** — tiga hal ini yang membuka pintu TransityApp untuk jadi platform multi-operator sejati.
