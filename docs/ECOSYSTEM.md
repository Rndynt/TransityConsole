# Transity Ecosystem Documentation

## Overview

Transity is a shuttle/bus travel platform for Indonesia, composed of three interconnected applications:

```
┌─────────────────────────────────────────────────────────────────────┐
│                      TRANSITY ECOSYSTEM                             │
│                                                                     │
│  ┌──────────────┐     ┌───────────────────┐     ┌────────────────┐ │
│  │ TransityApp  │────▶│ TransityConsole   │────▶│TransityTerminal│ │
│  │ (End-User)   │     │ (Gateway / Admin) │     │ (Per Operator) │ │
│  └──────────────┘     └───────────────────┘     └────────────────┘ │
│                                                                     │
│  Passenger-facing     Central aggregator &      Whitelabel backend  │
│  mobile/web app       admin dashboard           per shuttle company │
└─────────────────────────────────────────────────────────────────────┘
```

| Component | Role | Repository |
|-----------|------|------------|
| **TransityApp** | End-user mobile/web app for passengers | [Rndynt/TransityApp](https://github.com/Rndynt/TransityApp) |
| **TransityConsole** | Central API gateway + admin dashboard | This repository |
| **TransityTerminal** | Per-operator backend (whitelabeled) | [Rndynt/TransityTerminal](https://github.com/Rndynt/TransityTerminal) |

---

## Architecture

### Data Flow

```
Passenger (TransityApp)
    │
    ▼
TransityConsole Gateway (/api/gateway/*)
    │
    ├──▶ Operator A Terminal (TransityTerminal instance)
    ├──▶ Operator B Terminal (TransityTerminal instance)
    └──▶ Operator C Terminal (TransityTerminal instance)
```

### How It Works

1. **TransityApp** is the passenger-facing application. It connects to **TransityConsole** as its single backend.
2. **TransityConsole** acts as an API gateway — it fans out requests to multiple **TransityTerminal** instances (one per shuttle operator).
3. Each **TransityTerminal** is an independent backend managing a single operator's trips, schedules, vehicles, and bookings.
4. TransityConsole aggregates responses from all terminals, providing passengers a unified search experience across all operators.

### Key Concepts

- **Operator**: A registered shuttle/bus company (e.g., "Nusa Shuttle"). Each operator has their own TransityTerminal instance.
- **TripId Format**: `{operatorSlug}:{originalTripId}` — the gateway prefixes every trip ID with the operator slug for routing.
- **Virtual Trips**: Trips with `tripId` starting with `virtual-` are dynamically generated (not in the schedule). They have no seatmap — the frontend renders a static layout based on `vehicleClass`.
- **Service Key**: Each operator has a `serviceKey` used to authenticate requests from TransityConsole to their terminal (`X-Service-Key` header).
- **Webhook Secret**: Per-operator secret used for HMAC-SHA256 signing when forwarding payment webhooks to terminals.

---

## TransityApp Integration

### Connecting TransityApp to TransityConsole

TransityApp needs a single environment variable to connect:

```env
# TransityApp .env
DATABASE_URL=...         # TransityApp's own local database
PORT=5000
API_BASE_URL=https://your-transity-console-domain.com
```

TransityApp calls TransityConsole's gateway endpoints. The API base URL should point to the TransityConsole instance.

### TransityApp User Flow

```
Home Page
  │ (search: originCity, destinationCity, date, passengers)
  ▼
Search Results ──── GET /api/gateway/trips/search
  │ (select trip)
  ▼
Select Stops ────── Trip stops from search result
  │ (pick pickup & drop-off stops)
  ▼
Select Seats ────── GET /api/gateway/trips/{tripId}/seatmap
  │ (choose seats)
  ▼
Booking Confirm ─── POST /api/gateway/bookings
  │ (confirm & pay)
  ▼
Booking Detail ──── GET /api/gateway/bookings/{bookingId}
  │ (view QR codes, payment status)
  ▼
My Trips ────────── Managed by TransityApp's own backend
```

### TransityApp Pages

| Page | Purpose | Gateway Endpoint Used |
|------|---------|----------------------|
| `HomePage` | City search form, popular routes | `GET /api/gateway/cities` |
| `SearchResultsPage` | List matching trips across operators | `GET /api/gateway/trips/search` |
| `SelectStopsPage` | Pick boarding & alighting stops | Uses trip data from search |
| `SelectSeatsPage` | Interactive seat selection | `GET /api/gateway/trips/{tripId}/seatmap` |
| `BookingConfirmPage` | Passenger details, confirm booking | `POST /api/gateway/bookings` |
| `BookingDetailPage` | Booking status, QR codes, payment | `GET /api/gateway/bookings/{bookingId}` |
| `MyTripsPage` | List of all user bookings | TransityApp's own backend (not via gateway) |
| `AuthPage` | Login / register | TransityApp's own auth |

### TransityApp Data Types

**Trip Search Result** (from gateway):
```typescript
{
  tripId: string;          // "nusa-shuttle:abc123"
  serviceDate: string;     // "2026-04-10"
  origin: {
    stopId: string;
    cityName: string;
    stopName: string;
    sequence: number;
    departureTime: string | null;
  };
  destination: { /* same shape */ };
  farePerPerson: number;   // in IDR
  availableSeats: number;
  isVirtual: boolean;
  vehicleClass: string | null;
  operatorName: string;
  operatorSlug: string;
  operatorLogo: string | null;
  operatorColor: string | null;
}
```

**Booking Request** (to gateway):
```typescript
{
  tripId: string;          // "nusa-shuttle:abc123"
  serviceDate: string;     // "2026-04-10"
  originStopId: string;
  destinationStopId: string;
  originSeq: number;
  destinationSeq: number;
  passengers: [
    { fullName: string; phone?: string; seatNo: string }
  ];
  paymentMethod: string;   // "cash", "qr", "ewallet", "bank"
}
```

**Booking Response** (from gateway):
```typescript
{
  bookingId: string;
  status: string;          // "held", "confirmed", "cancelled"
  totalAmount: string;
  holdExpiresAt: string | null;
  paymentIntent: { ... } | null;
  qrData: [
    { passengerId, seatNo, fullName, qrToken, qrPayload }
  ];
  passengers: [ ... ];
  tripId: string;
}
```

---

## TransityConsole API Reference

### Gateway Endpoints (for TransityApp)

These endpoints are what TransityApp consumes. They are public-facing and do not require admin authentication.

#### Trip Search

```
GET /api/gateway/trips/search?originCity={city}&destinationCity={city}&date={YYYY-MM-DD}&passengers={n}
```

Searches all active operator terminals concurrently and returns aggregated results.

**Response:**
```json
{
  "trips": [ /* TerminalTrip[] */ ],
  "errors": [ { "operatorSlug": "...", "error": "..." } ],
  "totalOperators": 3,
  "respondedOperators": 2
}
```

#### Trip Detail

```
GET /api/gateway/trips/{operatorSlug}:{tripId}
```

Fetches full trip detail from the specific operator's terminal.

#### Seatmap

```
GET /api/gateway/trips/{tripId}/seatmap?originSeq={n}&destinationSeq={n}
```

Returns seat layout and availability. Returns 404 for virtual trips.

**Response:**
```json
{
  "layout": {
    "rows": 10,
    "cols": 4,
    "seatMap": [
      { "row": 1, "col": 1, "label": "1A", "type": "seat" }
    ]
  },
  "seatAvailability": {
    "1A": { "available": true, "held": false }
  }
}
```

#### Trip Reviews

```
GET /api/gateway/trips/{tripId}/reviews
```

Proxies trip reviews from the operator's terminal.

#### Cities

```
GET /api/gateway/cities
```

Aggregates available cities from all active operators.

**Response:**
```json
{
  "cities": ["Jakarta", "Bandung", "Semarang"],
  "byOperator": [
    { "operatorSlug": "nusa-shuttle", "cities": ["Jakarta", "Bandung"] }
  ]
}
```

#### Operator Info

```
GET /api/gateway/operators/{operatorSlug}/info
```

Returns branding info for a specific operator.

#### Service Lines

```
GET /api/gateway/service-lines
```

Aggregates service lines/routes across all operators.

#### Create Booking

```
POST /api/gateway/bookings
Content-Type: application/json

{
  "tripId": "nusa-shuttle:abc123",
  "serviceDate": "2026-04-10",
  "originStopId": "stop-jkt-01",
  "destinationStopId": "stop-bdg-01",
  "originSeq": 1,
  "destinationSeq": 3,
  "passengers": [
    { "fullName": "Budi Santoso", "phone": "081234567890", "seatNo": "1A" },
    { "fullName": "Siti Rahayu", "seatNo": "1B" }
  ],
  "paymentMethod": "qr"
}
```

**Response (201):**
```json
{
  "bookingId": "uuid",
  "externalBookingId": "terminal-booking-id",
  "operatorId": "...",
  "operatorName": "Nusa Shuttle",
  "operatorSlug": "nusa-shuttle",
  "status": "held",
  "totalAmount": "190000",
  "holdExpiresAt": "2026-04-10T10:20:00Z",
  "paymentIntent": { "paymentId": "...", "method": "qr", "amount": "190000" },
  "qrData": [ { "passengerId": "...", "seatNo": "1A", "qrToken": "...", "qrPayload": "..." } ],
  "passengers": [ ... ],
  "tripId": "nusa-shuttle:abc123"
}
```

#### Get Booking

```
GET /api/gateway/bookings/{bookingId}
```

#### Payment Webhook

```
POST /api/gateway/payments/webhook
Authorization: Bearer {jwt} or X-Api-Key: {key}
Content-Type: application/json

{
  "providerRef": "payment-provider-reference",
  "status": "success"  // or "failed"
}
```

Requires authentication. Looks up the booking by `providerRef`, updates status, and forwards to the operator's terminal with HMAC-SHA256 signature.

---

### Admin Endpoints (for TransityConsole Dashboard)

All admin endpoints require JWT authentication via `Authorization: Bearer {token}`.

#### Authentication

```
POST /api/auth/login          # { email, password } → { token, user }
GET  /api/auth/me             # Get current user
POST /api/auth/change-password # { currentPassword, newPassword }
```

#### Operators CRUD

```
GET    /api/operators              # List operators (with pagination)
POST   /api/operators              # Create operator
GET    /api/operators/{id}         # Get operator detail
PATCH  /api/operators/{id}         # Update operator
DELETE /api/operators/{id}         # Delete operator
POST   /api/operators/{id}/ping    # Health check operator terminal
```

**Create/Update Operator fields:**
- `name` — Display name
- `slug` — URL-safe identifier (unique)
- `apiUrl` — TransityTerminal base URL (e.g., `https://nusa-terminal.transity.web.id`)
- `serviceKey` — Authentication key for the terminal
- `commissionPct` — Commission percentage
- `logoUrl` — Operator logo URL
- `primaryColor` — Brand color hex
- `webhookSecret` — HMAC signing secret for payment webhooks

#### Terminal Health

```
GET /api/terminals/health     # Latest health status for all operators
```

#### Bookings

```
GET /api/bookings             # List all bookings (admin view)
GET /api/bookings/{id}        # Booking detail
```

#### Analytics

```
GET /api/analytics/summary    # Dashboard summary stats
GET /api/analytics/revenue    # Revenue data with date range
```

#### Health Check

```
GET /api/healthz              # Server health check → { status: "ok" }
```

---

## TransityTerminal Integration

### How TransityConsole Talks to Terminals

TransityConsole communicates with each TransityTerminal using:

| Header | Value | Purpose |
|--------|-------|---------|
| `X-Service-Key` | Operator's `serviceKey` | Authentication |
| `Content-Type` | `application/json` | JSON payloads |

### Terminal API Endpoints Used

TransityConsole calls these TransityTerminal public API endpoints:

```
GET  /api/app/cities                                    → Available cities
GET  /api/app/trips/search?originCity=&destinationCity=&date=&passengers=  → Trip search
GET  /api/app/trips/{tripId}                            → Trip detail
GET  /api/app/trips/{tripId}/seatmap?originSeq=&destinationSeq= → Seatmap
GET  /api/app/trips/{tripId}/reviews                    → Trip reviews
GET  /api/app/operator-info                             → Operator brand info
GET  /api/app/service-lines                             → Routes/patterns
POST /api/app/bookings                                  → Create booking
GET  /api/app/bookings/{id}                             → Get booking (used by TransityApp directly)
POST /api/app/payments/webhook                          → Payment status webhook
```

### Booking Flow (End-to-End)

```
1. TransityApp → POST /api/gateway/bookings → TransityConsole
2. TransityConsole parses tripId → extracts operatorSlug
3. TransityConsole → POST /api/app/bookings → TransityTerminal
   (with X-Service-Key header, passenger data, stops, seats)
4. TransityTerminal creates booking (status: "held")
5. TransityTerminal → responds with booking + paymentIntent + qrData
6. TransityConsole stores booking in local DB
7. TransityConsole → responds to TransityApp
8. Passenger completes payment externally
9. Payment provider → POST /api/gateway/payments/webhook → TransityConsole
10. TransityConsole updates local booking status
11. TransityConsole signs payload with HMAC-SHA256(webhookSecret)
12. TransityConsole → POST /api/app/payments/webhook → TransityTerminal
    (with X-Webhook-Signature header)
13. TransityTerminal confirms/cancels booking
```

### Payment Webhook HMAC Signing

When forwarding payment webhooks to terminals:

```
Signature = HMAC-SHA256(webhookSecret, JSON.stringify(payload))
Header: X-Webhook-Signature: {signature}
```

The terminal verifies this signature to ensure the webhook is authentic.

---

## Operator Setup Guide

### Adding a New Operator

1. **Deploy TransityTerminal** for the operator (see [TransityTerminal docs](https://github.com/Rndynt/TransityTerminal))
2. **Get the Service Key** from the terminal's `.env` (`SERVICE_KEY`)
3. **Register in TransityConsole** via the admin dashboard:
   - Name: "Nusa Shuttle"
   - Slug: "nusa-shuttle" (unique, URL-safe)
   - API URL: `https://nusa-terminal.transity.web.id`
   - Service Key: (from step 2)
   - Commission %: e.g., 5
   - Webhook Secret: (shared secret for payment webhook signing)
4. **Ping the terminal** from the operators page to verify connectivity
5. The operator's trips will now appear in TransityApp search results

### Verifying Connectivity

Use the "Ping" button on the operators page or:

```bash
curl -X POST https://your-console.com/api/operators/{id}/ping \
  -H "Authorization: Bearer {admin-jwt}"
```

Expected result: `{ "status": "online", "latencyMs": 150 }"`

---

## Deployment

### TransityConsole (Docker/VPS)

```bash
cp .env.example .env
# Edit .env:
#   DATABASE_URL=postgresql://...
#   JWT_SECRET=your-secret-key
#   ADMIN_EMAIL=admin@transity.id
#   ADMIN_PASSWORD=your-password

docker compose up -d
```

The container:
- Serves the React frontend as static files
- Runs the API server on port 8080
- Auto-runs DB migrations on startup
- Health check at `GET /api/healthz`

### TransityApp

TransityApp is a React SPA that can be deployed as static files to any CDN or web server. Configure the API base URL to point to TransityConsole.

### TransityTerminal

Each operator gets their own TransityTerminal instance. See [TransityTerminal README](https://github.com/Rndynt/TransityTerminal) for deployment instructions.

---

## Environment Variables

### TransityConsole

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | PostgreSQL connection string |
| `JWT_SECRET` | Yes | Secret for JWT token signing |
| `ADMIN_EMAIL` | Yes | Default admin email |
| `ADMIN_PASSWORD` | Yes | Default admin password |
| `PORT` | No | Server port (default: 8080) |
| `LOG_LEVEL` | No | Log level (default: info) |
| `NODE_ENV` | No | Environment (development/production) |
| `MIGRATIONS_DIR` | No | Custom migrations directory |
| `STATIC_DIR` | No | Custom frontend static files directory |

### TransityApp

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | TransityApp's PostgreSQL connection string |
| `PORT` | No | Server port (default: 5000) |
| `API_BASE_URL` | Yes | TransityConsole gateway URL |

### TransityTerminal (per operator)

| Variable | Required | Description |
|----------|----------|-------------|
| `DATABASE_URL` | Yes | Operator's PostgreSQL connection string |
| `PORT` | No | Server port (default: 3000) |
| `SERVICE_KEY` | Yes | Key for authenticating requests from TransityConsole |
| `WEBHOOK_SECRET` | No | Shared secret for payment webhook HMAC verification |

---

## Database Schema (TransityConsole)

### Tables

| Table | Purpose |
|-------|---------|
| `operators` | Registered shuttle operators |
| `terminal_health` | Health check history per operator |
| `bookings` | Aggregated bookings from all operators |
| `admin_users` | Dashboard admin accounts |
| `api_keys` | API keys for service-to-service auth |

### Key Fields

**operators:**
- `id`, `name`, `slug` (unique), `apiUrl`, `serviceKey`, `active`
- `commissionPct`, `logoUrl`, `primaryColor`
- `webhookSecret` — for HMAC signing payment webhooks

**bookings:**
- `id`, `operatorId`, `externalBookingId` (from terminal)
- `tripId`, `serviceDate`, `status`, `totalAmount`
- `originStopId`, `destinationStopId`
- `providerRef` — payment provider reference for webhook lookup
- `holdExpiresAt` — booking hold expiration
- `paymentMethod`, `passengersJson` — JSON blob of passenger data
