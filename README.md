# TransityConsole

> Dashboard manajemen internal + API Gateway untuk ekosistem Transity — platform travel shuttle Indonesia.

---

## Daftar Isi

1. [Tentang Proyek](#tentang-proyek)
2. [Ekosistem Transity](#ekosistem-transity)
3. [Fitur Utama](#fitur-utama)
4. [Tech Stack](#tech-stack)
5. [Struktur Project](#struktur-project)
6. [Memulai Pengembangan](#memulai-pengembangan)
7. [Variabel Lingkungan](#variabel-lingkungan)
8. [Perintah Berguna](#perintah-berguna)
9. [Database & Migrasi](#database--migrasi)
10. [API Overview](#api-overview)
11. [Deploy ke VPS (Docker)](#deploy-ke-vps-docker)
12. [Dokumentasi Integrasi](#dokumentasi-integrasi)

---

## Tentang Proyek

TransityConsole adalah inti operasional ekosistem Transity — sebuah sistem manajemen operator shuttle berbasis web yang menggabungkan dua fungsi utama:

- **Admin Dashboard** — Interface internal untuk tim Transity mengelola operator, memantau terminal, melacak booking lintas operator, dan menganalisis revenue/komisi.
- **API Gateway (BFF)** — Lapisan tengah yang menghubungkan TransityApp dengan semua TransityTerminal secara transparan: fan-out search, routing booking, dan kalkulasi markup/komisi otomatis.

---

## Ekosistem Transity

```
┌────────────────────────────────────────────────────────────────┐
│                       EKOSISTEM TRANSITY                       │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  TransityApp (B2C · Customer Booking Portal)                   │
│  ─────────────────────────────────────────                     │
│  Satu platform, semua operator, semua rute                     │
│  Auth: X-Api-Key header                                        │
│                                                                │
│         │  POST /api/gateway/trips/search                      │
│         │  POST /api/gateway/bookings                          │
│         ▼                                                      │
│                                                                │
│  TransityConsole (Internal · Management + Gateway)   ← KITA   │
│  ─────────────────────────────────────────────────             │
│  Admin dashboard + API aggregation gateway                     │
│  Operator registry, fan-out search, routing booking            │
│  Kalkulasi komisi, health monitoring, analytics                │
│                                                                │
│         │  GET /api/app/trips/search                           │
│         │  POST /api/app/bookings                              │
│         │  Header: X-Service-Key                               │
│         ▼                                                      │
│                                                                │
│  TransityTerminal × N  (Per Operator · Whitelabel)             │
│  ─────────────────────────────────────────────────             │
│  Nusa Shuttle     →  https://nusa.transity.web.id              │
│  BusKita          →  https://buskita.transity.web.id           │
│  TransExpress     →  https://transexpress.transity.web.id      │
│  ... (N operator, deploy independen)                           │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Fitur Utama

| Fitur | Deskripsi |
|---|---|
| **Operator Registry** | CRUD lengkap untuk mendaftarkan operator shuttle baru |
| **Terminal Health Monitor** | Ping otomatis setiap 60 detik, dashboard status real-time |
| **Trip Search Gateway** | Fan-out ke semua terminal aktif, merge + sort hasil |
| **Booking Routing** | Forward booking ke terminal yang tepat berdasarkan tripId prefix |
| **Komisi Otomatis** | Markup per operator dikonfigurasi di Console, dihitung saat search |
| **Booking Tracker** | Semua booking lintas operator tersimpan di satu database |
| **Analytics Dashboard** | Revenue, komisi, booking count, uptime per operator |
| **API Key Management** | Generate/revoke API key untuk akses gateway |
| **Admin Auth** | JWT-based login untuk akses dashboard |
| **Auto Migrasi DB** | Schema otomatis di-apply saat server start (production & dev) |

---

## Tech Stack

| Layer | Teknologi |
|---|---|
| **Runtime** | Node.js 24 |
| **API Framework** | Fastify 5 |
| **Frontend** | React 19 + Vite 7 + Tailwind CSS 4 |
| **UI Components** | Radix UI (via shadcn/ui) + Framer Motion + Recharts |
| **Routing (FE)** | Wouter |
| **Data Fetching** | TanStack React Query |
| **Database** | PostgreSQL 16 + Drizzle ORM |
| **Validasi** | Zod + drizzle-zod |
| **Auth** | JWT (admin) + API Key (gateway) |
| **API Contract** | OpenAPI 3.1 + Orval (codegen) |
| **Build** | esbuild (API) + Vite (frontend) |
| **Package Manager** | pnpm workspaces |
| **Containerization** | Docker multi-stage + docker-compose |

---

## Struktur Project

```
/
├── apps/
│   ├── api-server/              # Fastify API server (port 8080 dev)
│   │   └── src/modules/
│   │       ├── auth/            # JWT login + API key management
│   │       ├── operators/       # CRUD operator registry
│   │       ├── terminals/       # Health monitoring + scheduler
│   │       ├── bookings/        # Booking tracker
│   │       ├── analytics/       # Revenue & performance analytics
│   │       ├── gateway/         # BFF: fan-out search + booking proxy
│   │       └── health/          # Server healthcheck
│   └── transity-console/        # React + Vite admin dashboard (port 3000 dev)
│       └── src/
│           ├── pages/           # Dashboard, Operators, Terminals, Bookings, Analytics
│           └── components/      # UI components
│
├── packages/
│   ├── api-spec/                # OpenAPI 3.1 spec + Orval config
│   ├── api-client-react/        # Generated React Query hooks
│   ├── api-zod/                 # Generated Zod schemas
│   └── db/                      # Drizzle schema + Pool + runMigrations()
│       └── migrations/          # SQL migration files
│
├── docs/
│   ├── IMPLEMENTATION.md        # Arsitektur & keputusan teknis
│   ├── TRANSITY_APP_INTEGRATION.md   # Panduan integrasi untuk TransityApp
│   └── TRANSITY_TERMINAL_SPEC.md     # Spesifikasi API untuk TransityTerminal
│
├── scripts/                     # Utility scripts
├── Dockerfile                   # Multi-stage production build
├── docker-compose.yml           # VPS deployment (postgres + app)
└── .env.example                 # Template environment variables
```

---

## Memulai Pengembangan

### Prasyarat

- Node.js ≥ 24
- pnpm ≥ 10
- PostgreSQL 16 (atau gunakan Replit yang sudah menyediakan)

### Instalasi

```bash
# Clone repositori
git clone <repo-url>
cd transity-console

# Install semua dependensi
pnpm install

# Setup environment variables
cp .env.example .env
# Edit .env sesuai konfigurasi lokal Anda
```

### Jalankan Database Migrations

```bash
# Push schema ke database (development)
pnpm --filter @workspace/db run push
```

### Jalankan Server Development

```bash
# Terminal 1: API Server (port 8080)
PORT=8080 pnpm --filter @workspace/api-server run dev

# Terminal 2: Frontend Dashboard (port 3000)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/transity-console run dev
```

Dashboard tersedia di `http://localhost:3000`  
API tersedia di `http://localhost:8080/api`

### Login Default (Development)

| Field | Nilai |
|---|---|
| Email | `admin@transity.id` |
| Password | `transity-admin-2026` |

> ⚠️ **Wajib diganti** di production via env `ADMIN_EMAIL` dan `ADMIN_PASSWORD`.

---

## Variabel Lingkungan

Salin `.env.example` ke `.env` dan isi semua nilai:

| Variable | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `JWT_SECRET` | ✅ | Secret untuk signing JWT (min 32 karakter) |
| `ADMIN_EMAIL` | — | Email admin default (default: `admin@transity.id`) |
| `ADMIN_PASSWORD` | — | Password admin default (default: `transity-admin-2026`) |
| `PORT` | ✅ | Port server (8080 untuk production) |
| `NODE_ENV` | — | `production` atau `development` |
| `LOG_LEVEL` | — | Level log Pino: `info`, `debug`, `warn` (default: `info`) |
| `MIGRATIONS_DIR` | — | Path folder migrations (auto-set di Docker) |

---

## Perintah Berguna

```bash
# Install dependencies
pnpm install

# Build API server (output: apps/api-server/dist/index.mjs)
pnpm --filter @workspace/api-server run build

# Build frontend (output: apps/transity-console/dist/public/)
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/transity-console run build

# Regenerate API client dari OpenAPI spec
pnpm --filter @workspace/api-spec run codegen

# Push schema database ke development DB
pnpm --filter @workspace/db run push

# Generate migration file baru (setelah mengubah schema)
pnpm --filter @workspace/db run generate

# Typecheck seluruh workspace
pnpm run typecheck

# Build semua packages
pnpm run build
```

---

## Database & Migrasi

### Schema

| Tabel | Keterangan |
|---|---|
| `operators` | Daftar operator shuttle terdaftar |
| `terminal_health` | Riwayat ping + status setiap terminal |
| `bookings` | Semua booking lintas operator |
| `admin_users` | Akun admin dashboard |
| `api_keys` | API key untuk akses gateway |

### Workflow Migrasi

**Development** — gunakan push langsung (idempotent, tidak perlu migration files):
```bash
pnpm --filter @workspace/db run push
```

**Setelah mengubah schema** (untuk production):
```bash
# 1. Buat migration file baru
pnpm --filter @workspace/db run generate

# 2. Apply ke dev DB
pnpm --filter @workspace/db run push
```

**Production** — migrasi berjalan **otomatis** saat server start. Server memanggil `runMigrations()` yang membaca file dari `packages/db/migrations/` dan hanya mengeksekusi migrasi yang belum pernah dijalankan.

---

## API Overview

Base URL: `/api`

### Admin Endpoints

| Method | Path | Keterangan |
|---|---|---|
| `POST` | `/api/auth/login` | Login admin, returns JWT |
| `GET` | `/api/auth/me` | Info user dari JWT |
| `GET` | `/api/auth/api-keys` | List API keys (requires JWT) |
| `POST` | `/api/auth/api-keys` | Generate API key baru (requires JWT) |
| `DELETE` | `/api/auth/api-keys/:id` | Revoke API key (requires JWT) |
| `GET` | `/api/operators` | List semua operator |
| `POST` | `/api/operators` | Daftarkan operator baru |
| `GET` | `/api/operators/:id` | Detail operator |
| `PATCH` | `/api/operators/:id` | Update operator |
| `DELETE` | `/api/operators/:id` | Hapus operator |
| `POST` | `/api/operators/:id/ping` | Ping terminal operator |
| `GET` | `/api/terminals/health` | Status kesehatan semua terminal |
| `GET` | `/api/bookings` | List semua booking (filterable) |
| `GET` | `/api/analytics/summary` | Ringkasan analytics keseluruhan |
| `GET` | `/api/analytics/operators` | Analytics per operator |
| `GET` | `/api/analytics/revenue` | Revenue timeline |
| `GET` | `/api/healthz` | Health check server |

### Gateway Endpoints (untuk TransityApp)

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/api/gateway/cities` | Daftar kota dari semua terminal aktif |
| `POST` | `/api/gateway/trips/search` | Fan-out trip search ke semua operator |
| `GET` | `/api/gateway/trips/:tripId` | Detail trip by ID |
| `POST` | `/api/gateway/bookings` | Buat booking, routing ke operator yang tepat |
| `GET` | `/api/gateway/bookings/:bookingId` | Status booking |

> Lihat [docs/TRANSITY_APP_INTEGRATION.md](docs/TRANSITY_APP_INTEGRATION.md) untuk dokumentasi lengkap Gateway API.

---

## Deploy ke VPS (Docker)

### Persyaratan

- Docker Engine ≥ 24
- docker-compose v2
- VPS dengan minimal 1 vCPU, 512MB RAM

### Langkah Deploy

```bash
# 1. Clone repositori di VPS
git clone <repo-url>
cd transity-console

# 2. Setup environment
cp .env.example .env
nano .env  # isi semua nilai yang diperlukan

# 3. Jalankan
docker compose up -d

# 4. Cek status
docker compose ps
docker compose logs app --tail=50
```

### Struktur Container

| Service | Image | Keterangan |
|---|---|---|
| `postgres` | `postgres:16-alpine` | Database PostgreSQL |
| `app` | Build dari `Dockerfile` | API server + Frontend static |

Container `app` secara otomatis:
1. Menjalankan migrasi database saat pertama kali start
2. Membuat akun admin default jika belum ada
3. Menyajikan frontend React sebagai static files
4. Melayani semua API di `/api/*`

### Health Check

```bash
curl https://your-domain.com/api/healthz
# → {"status":"ok"}
```

### Update ke Versi Baru

```bash
git pull
docker compose build
docker compose up -d
```

---

## Dokumentasi Integrasi

| Dokumen | Untuk Siapa |
|---|---|
| [docs/TRANSITY_APP_INTEGRATION.md](docs/TRANSITY_APP_INTEGRATION.md) | Developer TransityApp yang ingin menggunakan Gateway API |
| [docs/TRANSITY_TERMINAL_SPEC.md](docs/TRANSITY_TERMINAL_SPEC.md) | Developer TransityTerminal tentang endpoint yang harus diimplementasikan |
| [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | Arsitektur, keputusan teknis, dan roadmap |

---

## Lisensi

Internal — milik Transity. Tidak untuk distribusi publik.
