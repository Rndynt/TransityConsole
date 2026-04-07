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
9. [Database](#database)
10. [API Overview](#api-overview)
11. [Setup Operator Baru](#setup-operator-baru)
12. [Deploy ke VPS (Docker)](#deploy-ke-vps-docker)
13. [Dokumentasi Lanjutan](#dokumentasi-lanjutan)

---

## Tentang Proyek

TransityConsole adalah inti operasional ekosistem Transity — sebuah sistem manajemen operator shuttle berbasis web yang menggabungkan dua fungsi utama:

- **Admin Dashboard** — Interface internal untuk tim Transity mengelola operator, memantau terminal, melacak booking lintas operator, dan menganalisis revenue/komisi.
- **API Gateway (BFF)** — Lapisan tengah yang menghubungkan TransityApp dengan semua TransityTerminal secara transparan: fan-out search, routing booking, materialisasi trip virtual, dan kalkulasi markup/komisi otomatis.
- **Customer Auth** — Sistem autentikasi end-user terpusat. Satu akun customer berlaku untuk semua operator.

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
│  Auth: Bearer JWT (customer) + X-Api-Key (service)             │
│                                                                │
│         │  GET  /api/gateway/trips/search                      │
│         │  POST /api/gateway/bookings                          │
│         │  POST /api/gateway/auth/register                     │
│         │  POST /api/gateway/auth/login                        │
│         ▼                                                      │
│                                                                │
│  TransityConsole (Internal · Management + Gateway)   ← KITA   │
│  ─────────────────────────────────────────────────             │
│  Admin dashboard + API aggregation gateway                     │
│  Operator registry, fan-out search, routing booking            │
│  Customer auth, komisi, health monitoring, analytics           │
│                                                                │
│         │  GET  /api/app/trips/search                          │
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

| Komponen | Peran | Repository |
|---|---|---|
| **TransityApp** | Aplikasi end-user untuk penumpang | [Rndynt/TransityApp](https://github.com/Rndynt/TransityApp) |
| **TransityConsole** | API gateway + admin dashboard | Repo ini |
| **TransityTerminal** | Backend per operator (whitelabel) | [Rndynt/TransityTerminal](https://github.com/Rndynt/TransityTerminal) |

---

## Fitur Utama

| Fitur | Deskripsi |
|---|---|
| **Operator Registry** | CRUD lengkap untuk mendaftarkan operator shuttle baru |
| **Terminal Health Monitor** | Ping otomatis setiap 60 detik, dashboard status real-time |
| **Trip Search Gateway** | Fan-out ke semua terminal aktif, merge + sort + deduplikasi hasil |
| **Trip Materialize** | Konversi trip virtual menjadi trip nyata sebelum booking |
| **Seatmap Gateway** | Proxy denah kursi dari terminal operator, dengan cache |
| **Booking Routing** | Forward booking ke terminal yang tepat berdasarkan tripId prefix |
| **Booking Tracker** | Semua booking lintas operator tersimpan di satu database |
| **Payment Webhook** | Forward webhook pembayaran ke terminal dengan HMAC-SHA256 signing |
| **Customer Auth** | Registrasi & login end-user terpusat (JWT 30 hari) |
| **Analytics Dashboard** | Revenue, booking count, uptime per operator |
| **API Key Management** | Generate/revoke API key untuk akses gateway |
| **Admin Auth** | JWT-based login untuk akses dashboard |
| **Error Translation** | Semua error terminal diterjemahkan ke Bahasa Indonesia |
| **Auto Migrasi DB** | Schema otomatis di-apply saat server start |

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
| **Auth** | JWT (admin + customer) + API Key (gateway) + bcrypt |
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
│   │       ├── auth/            # JWT login admin + API key management
│   │       ├── customers/       # Customer auth (register, login, profile)
│   │       ├── operators/       # CRUD operator registry
│   │       ├── terminals/       # Health monitoring + scheduler
│   │       ├── bookings/        # Booking tracker
│   │       ├── analytics/       # Revenue & performance analytics
│   │       ├── gateway/         # BFF: fan-out search, seatmap, booking proxy
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
│   ├── IMPLEMENTATION.md             # Arsitektur & keputusan teknis
│   ├── TRANSITY_APP_INTEGRATION.md   # Panduan integrasi Gateway API untuk TransityApp
│   └── TRANSITY_TERMINAL_SPEC.md     # Spesifikasi API untuk TransityTerminal
│
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
git clone <repo-url>
cd transity-console
pnpm install
cp .env.example .env
```

### Jalankan Database Migrations

```bash
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

> Wajib diganti di production via env `ADMIN_EMAIL` dan `ADMIN_PASSWORD`.

---

## Variabel Lingkungan

Salin `.env.example` ke `.env` dan isi semua nilai:

| Variable | Wajib | Keterangan |
|---|---|---|
| `DATABASE_URL` | Ya | PostgreSQL connection string |
| `JWT_SECRET` | Ya | Secret untuk signing JWT admin & customer (min 32 karakter) |
| `ADMIN_EMAIL` | — | Email admin default (default: `admin@transity.id`) |
| `ADMIN_PASSWORD` | — | Password admin default (default: `transity-admin-2026`) |
| `PORT` | Ya | Port server (8080 untuk production) |
| `NODE_ENV` | — | `production` atau `development` |
| `LOG_LEVEL` | — | Level log Pino: `info`, `debug`, `warn` (default: `info`) |
| `MIGRATIONS_DIR` | — | Path folder migrations (auto-set di Docker) |
| `STATIC_DIR` | — | Path frontend static files (auto-set di Docker) |

---

## Perintah Berguna

```bash
pnpm install                                          # Install dependencies
pnpm --filter @workspace/api-server run build         # Build API server
PORT=3000 BASE_PATH=/ pnpm --filter @workspace/transity-console run build  # Build frontend
pnpm --filter @workspace/api-spec run codegen         # Regenerate API client
pnpm --filter @workspace/db run push                  # Push schema ke dev DB
pnpm --filter @workspace/db run generate              # Generate migration file baru
pnpm run typecheck                                    # Typecheck seluruh workspace
pnpm run build                                        # Build semua packages
```

---

## Database

### Tabel

| Tabel | Keterangan |
|---|---|
| `operators` | Daftar operator shuttle terdaftar (slug, apiUrl, serviceKey, commissionPct, webhookSecret, logoUrl, primaryColor) |
| `terminal_health` | Riwayat ping + status setiap terminal |
| `bookings` | Semua booking lintas operator (tripId, serviceDate, providerRef, holdExpiresAt, paymentMethod, passengersJson, originStopId, destinationStopId) |
| `admin_users` | Akun admin dashboard |
| `api_keys` | API key untuk akses gateway |
| `customers` | Akun end-user/penumpang (fullName, email, phone, passwordHash, avatarUrl, isVerified, lastLoginAt) |

### Workflow Migrasi

**Development** — push langsung (idempotent):
```bash
pnpm --filter @workspace/db run push
```

**Production** — migrasi berjalan otomatis saat server start via `runMigrations()`.

---

## API Overview

Base URL: `/api`

### Admin Endpoints (requires JWT admin)

| Method | Path | Keterangan |
|---|---|---|
| `POST` | `/api/auth/login` | Login admin → `{ token, user }` |
| `GET` | `/api/auth/me` | Info user dari JWT |
| `GET` | `/api/auth/api-keys` | List API keys |
| `POST` | `/api/auth/api-keys` | Generate API key baru |
| `DELETE` | `/api/auth/api-keys/:id` | Revoke API key |
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

### Customer Auth Endpoints (untuk TransityApp end-user)

| Method | Path | Auth | Keterangan |
|---|---|---|---|
| `POST` | `/api/gateway/auth/register` | — | Registrasi (fullName, email, phone, password) |
| `POST` | `/api/gateway/auth/login` | — | Login via email/phone + password → `{ token, user }` |
| `GET` | `/api/gateway/auth/me` | Bearer JWT | Profil customer |
| `PUT` | `/api/gateway/auth/profile` | Bearer JWT | Update nama/phone |
| `POST` | `/api/gateway/auth/change-password` | Bearer JWT | Ganti password |

### Gateway Endpoints (untuk TransityApp)

| Method | Path | Keterangan |
|---|---|---|
| `GET` | `/api/gateway/cities` | Daftar kota dari semua terminal aktif |
| `GET` | `/api/gateway/trips/search` | Fan-out trip search (query: originCity, destinationCity, date, passengers) |
| `GET` | `/api/gateway/trips/:tripId` | Detail trip by ID |
| `GET` | `/api/gateway/trips/:tripId/seatmap` | Denah kursi (query: originSeq, destinationSeq, serviceDate) |
| `GET` | `/api/gateway/trips/:tripId/reviews` | Ulasan trip |
| `POST` | `/api/gateway/trips/materialize` | Materialisasi trip virtual → trip nyata |
| `GET` | `/api/gateway/operators/:slug/info` | Info branding operator |
| `GET` | `/api/gateway/service-lines` | Daftar rute/jalur dari semua operator |
| `POST` | `/api/gateway/bookings` | Buat booking (routing otomatis ke operator) |
| `GET` | `/api/gateway/bookings/:bookingId` | Status booking |
| `POST` | `/api/gateway/payments/webhook` | Payment webhook (requires API key / JWT) |

> Dokumentasi lengkap Gateway API: [docs/TRANSITY_APP_INTEGRATION.md](docs/TRANSITY_APP_INTEGRATION.md)

---

## Setup Operator Baru

1. **Deploy TransityTerminal** untuk operator ([docs](https://github.com/Rndynt/TransityTerminal))
2. **Dapatkan Service Key** dari terminal `.env` (`SERVICE_KEY`)
3. **Daftarkan di TransityConsole** via admin dashboard:
   - Name: "Nusa Shuttle"
   - Slug: "nusa-shuttle" (unique, URL-safe)
   - API URL: `https://nusa-terminal.transity.web.id`
   - Service Key: (dari langkah 2)
   - Commission %: misal 5
   - Webhook Secret: (shared secret untuk HMAC webhook)
4. **Ping terminal** dari halaman operator untuk verifikasi konektivitas
5. Trip operator akan muncul di pencarian TransityApp

---

## Deploy ke VPS (Docker)

### Persyaratan

- Docker Engine ≥ 24
- docker-compose v2
- VPS dengan minimal 1 vCPU, 512MB RAM

### Langkah Deploy

```bash
git clone <repo-url>
cd transity-console
cp .env.example .env
nano .env                  # isi semua nilai
docker compose up -d
docker compose ps          # cek status
docker compose logs app --tail=50
```

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

## Dokumentasi Lanjutan

| Dokumen | Untuk Siapa | Isi |
|---|---|---|
| [docs/TRANSITY_APP_INTEGRATION.md](docs/TRANSITY_APP_INTEGRATION.md) | Developer TransityApp | Panduan lengkap Gateway API + Customer Auth + contoh kode |
| [docs/TRANSITY_TERMINAL_SPEC.md](docs/TRANSITY_TERMINAL_SPEC.md) | Developer TransityTerminal | Spesifikasi endpoint yang wajib diimplementasikan terminal |
| [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | Tim internal | Arsitektur, keputusan teknis, dan roadmap |

---

## Lisensi

Internal — milik Transity. Tidak untuk distribusi publik.
