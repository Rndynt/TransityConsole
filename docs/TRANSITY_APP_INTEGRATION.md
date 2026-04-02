# Panduan Integrasi TransityApp → TransityConsole Gateway

> Dokumen ini ditujukan untuk developer **TransityApp** yang ingin menggunakan Gateway API TransityConsole untuk melakukan pencarian trip dan pembuatan booking lintas operator.

---

## Daftar Isi

1. [Gambaran Umum](#gambaran-umum)
2. [Autentikasi](#autentikasi)
3. [Base URL](#base-url)
4. [Endpoint Gateway](#endpoint-gateway)
   - [GET /gateway/cities](#get-gatewaycities)
   - [POST /gateway/trips/search](#post-gatewaytripssearch)
   - [GET /gateway/trips/:tripId](#get-gatewaytripstripid)
   - [POST /gateway/bookings](#post-gatewaybookings)
   - [GET /gateway/bookings/:bookingId](#get-gatewaybookingsbookingid)
5. [Format tripId](#format-tripid)
6. [Penanganan Error](#penanganan-error)
7. [Alur Lengkap (End-to-End)](#alur-lengkap-end-to-end)
8. [Contoh Implementasi (TypeScript/Fetch)](#contoh-implementasi-typescriptfetch)
9. [FAQ](#faq)

---

## Gambaran Umum

TransityConsole bertindak sebagai **BFF (Backend-for-Frontend)** untuk TransityApp. TransityApp tidak perlu tahu ada berapa operator atau bagaimana cara menghubungi masing-masing terminal — cukup satu panggilan ke Gateway, dan hasilnya sudah teragregasi.

```
TransityApp
    │
    │ 1x request
    ▼
TransityConsole Gateway   ──fan-out──►  Nusa Shuttle Terminal
                          ──fan-out──►  BusKita Terminal
                          ──fan-out──►  TransExpress Terminal
                          ──fan-out──►  ... (N operator)
    │
    │ 1x merged response
    ▼
TransityApp
```

**Yang dilakukan Gateway secara otomatis:**
- Mengirim request ke semua terminal aktif secara paralel
- Mengabaikan terminal yang down tanpa mengganggu hasil
- Menerapkan markup/komisi per operator ke harga trip
- Mengurutkan hasil dari harga termurah
- Meneruskan booking ke terminal yang tepat berdasarkan `tripId`
- Menyimpan semua booking untuk keperluan tracking dan analytics

---

## Autentikasi

Semua request ke endpoint `/api/gateway/*` memerlukan salah satu metode autentikasi berikut:

### Opsi 1: API Key (Direkomendasikan untuk TransityApp)

Sertakan API key di header `X-Api-Key`:

```http
X-Api-Key: tc_live_a1b2c3d4e5f6...
```

API key digenerate oleh admin TransityConsole melalui halaman Settings → API Keys, atau via endpoint:

```http
POST /api/auth/api-keys
Authorization: Bearer <admin-jwt>
Content-Type: application/json

{
  "name": "TransityApp Production",
  "scopes": ["gateway:read", "gateway:write"]
}
```

Response:
```json
{
  "key": "tc_live_a1b2c3d4e5f6...",
  "prefix": "tc_live_a1b2c3",
  "id": "uuid-..."
}
```

> ⚠️ **Simpan API key dengan aman.** Nilai penuh hanya ditampilkan sekali saat generate. Jika hilang, generate key baru dan revoke yang lama.

### Opsi 2: JWT Bearer Token

Bisa menggunakan JWT admin yang diperoleh dari login:

```http
Authorization: Bearer <jwt-token>
```

Opsi ini lebih cocok untuk keperluan testing atau akses admin sementara.

---

## Base URL

| Environment | URL |
|---|---|
| **Production** | `https://console.transity.id/api` |
| **Development** | `http://localhost:8080/api` |

---

## Endpoint Gateway

### GET /gateway/cities

Mendapatkan daftar semua kota yang tersedia dari semua terminal aktif.

**Request:**
```http
GET /api/gateway/cities
X-Api-Key: tc_live_...
```

**Response `200 OK`:**
```json
{
  "cities": ["Jakarta", "Bandung", "Surabaya", "Yogyakarta", "Semarang"],
  "byOperator": [
    {
      "operatorSlug": "nusa-shuttle",
      "cities": ["Jakarta", "Bandung", "Surabaya"]
    },
    {
      "operatorSlug": "buskita",
      "cities": ["Jakarta", "Yogyakarta", "Semarang"]
    }
  ]
}
```

**Catatan:** Terminal yang sedang offline tidak akan berkontribusi ke daftar kota, namun tidak menyebabkan error.

---

### POST /gateway/trips/search

Mencari trip ke semua terminal aktif secara fan-out.

**Request:**
```http
POST /api/gateway/trips/search
X-Api-Key: tc_live_...
Content-Type: application/json
```

**Request Body:**
```json
{
  "origin": "Jakarta",
  "destination": "Bandung",
  "date": "2026-04-15",
  "passengers": 2
}
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `origin` | `string` | ✅ | Kota asal |
| `destination` | `string` | ✅ | Kota tujuan |
| `date` | `string` | ✅ | Format `YYYY-MM-DD` |
| `passengers` | `number` | — | Jumlah penumpang (default: 1) |

**Response `200 OK`:**
```json
{
  "trips": [
    {
      "tripId": "nusa-shuttle:trip-001",
      "operatorId": "uuid-...",
      "operatorName": "Nusa Shuttle",
      "operatorSlug": "nusa-shuttle",
      "origin": "Jakarta",
      "destination": "Bandung",
      "departureDate": "2026-04-15",
      "departureTime": "07:00",
      "arrivalTime": "10:30",
      "availableSeats": 8,
      "price": 100000,
      "currency": "IDR"
    },
    {
      "tripId": "buskita:b-trip-9x2",
      "operatorId": "uuid-...",
      "operatorName": "BusKita",
      "operatorSlug": "buskita",
      "origin": "Jakarta",
      "destination": "Bandung",
      "departureDate": "2026-04-15",
      "departureTime": "08:00",
      "arrivalTime": "11:30",
      "availableSeats": 12,
      "price": 95000,
      "currency": "IDR"
    }
  ],
  "errors": [
    {
      "operatorSlug": "transexpress",
      "error": "Terminal timeout after 5000ms"
    }
  ],
  "totalOperators": 3,
  "respondedOperators": 2
}
```

**Detail field trip:**

| Field | Keterangan |
|---|---|
| `tripId` | ID unik trip dalam format `{operatorSlug}:{originalTripId}` — gunakan ini untuk booking |
| `price` | Harga asli dari terminal operator |
| `errors` | Terminal yang gagal merespons — trip dari terminal tersebut tidak muncul, tapi tidak error |

**Catatan performa:** Request ini memiliki timeout 5 detik per terminal. Terminal yang tidak merespons dalam 5 detik akan di-skip dan muncul di `errors`.

---

### GET /gateway/trips/:tripId

Mendapatkan detail spesifik sebuah trip.

**Request:**
```http
GET /api/gateway/trips/nusa-shuttle:trip-001
X-Api-Key: tc_live_...
```

**Response `200 OK`:**
```json
{
  "tripId": "nusa-shuttle:trip-001",
  "operatorId": "uuid-...",
  "operatorName": "Nusa Shuttle",
  "operatorSlug": "nusa-shuttle",
  "origin": "Jakarta",
  "destination": "Bandung",
  "departureDate": "2026-04-15",
  "departureTime": "07:00",
  "arrivalTime": "10:30",
  "availableSeats": 6,
  "price": 100000,
  "currency": "IDR"
}
```

**Response `404 Not Found`:** Trip tidak ditemukan atau terminal tidak aktif.

---

### POST /gateway/bookings

Membuat booking baru. Gateway akan meneruskan ke terminal operator yang sesuai berdasarkan prefix `tripId`.

**Request:**
```http
POST /api/gateway/bookings
X-Api-Key: tc_live_...
Content-Type: application/json
```

**Request Body:**
```json
{
  "tripId": "nusa-shuttle:trip-001",
  "passengerName": "Budi Santoso",
  "passengerPhone": "081234567890",
  "seatNumbers": ["A1", "A2"],
  "totalAmount": 220000
}
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `tripId` | `string` | ✅ | ID trip dari hasil search (`operatorSlug:originalId`) |
| `passengerName` | `string` | ✅ | Nama lengkap penumpang |
| `passengerPhone` | `string` | ✅ | Nomor telepon penumpang |
| `seatNumbers` | `string[]` | — | Nomor kursi yang dipilih |
| `totalAmount` | `number` | ✅ | Total harga yang dibayar (dalam IDR) |

**Response `201 Created`:**
```json
{
  "bookingId": "uuid-booking-...",
  "externalBookingId": "NSH-2026-001234",
  "operatorId": "uuid-...",
  "operatorName": "Nusa Shuttle",
  "status": "confirmed",
  "tripId": "nusa-shuttle:trip-001",
  "passengerName": "Budi Santoso",
  "passengerPhone": "081234567890",
  "seatNumbers": ["A1", "A2"],
  "totalAmount": 220000,
  "createdAt": "2026-04-10T10:30:00.000Z"
}
```

**Detail field response:**

| Field | Keterangan |
|---|---|
| `bookingId` | ID booking di TransityConsole — gunakan ini untuk tracking |
| `externalBookingId` | ID booking di sistem terminal operator (jika terminal merespons) |
| `status` | `confirmed` jika terminal merespons, `pending` jika terminal down saat booking |

**Penting tentang status `pending`:**  
Jika terminal sedang down saat booking dilakukan, booking tetap tersimpan di TransityConsole dengan status `pending`. TransityApp harus:
1. Menampilkan konfirmasi kepada pengguna bahwa booking sedang diproses
2. Menyimpan `bookingId` untuk polling status
3. Polling `GET /api/gateway/bookings/:bookingId` secara berkala hingga status berubah menjadi `confirmed`

---

### GET /gateway/bookings/:bookingId

Mendapatkan status dan detail booking.

**Request:**
```http
GET /api/gateway/bookings/uuid-booking-...
X-Api-Key: tc_live_...
```

**Response `200 OK`:**
```json
{
  "bookingId": "uuid-booking-...",
  "externalBookingId": "NSH-2026-001234",
  "operatorId": "uuid-...",
  "operatorName": "Nusa Shuttle",
  "status": "confirmed",
  "tripId": "nusa-shuttle:trip-001",
  "passengerName": "Budi Santoso",
  "passengerPhone": "081234567890",
  "seatNumbers": ["A1", "A2"],
  "totalAmount": 220000,
  "createdAt": "2026-04-10T10:30:00.000Z"
}
```

**Status booking yang mungkin:**

| Status | Keterangan |
|---|---|
| `pending` | Booking diterima, menunggu konfirmasi dari terminal |
| `confirmed` | Terminal berhasil mengonfirmasi booking |
| `cancelled` | Booking dibatalkan |
| `completed` | Perjalanan sudah selesai |

---

## Format tripId

`tripId` menggunakan format `{operatorSlug}:{originalTripId}`:

```
nusa-shuttle:trip-001
└─────────┘ └──────┘
operator    ID asli dari
slug        terminal operator
```

**Penting:**
- Selalu gunakan `tripId` persis seperti yang dikembalikan dari `/gateway/trips/search`
- Jangan mengubah atau memparsing `tripId` — cukup simpan dan kirimkan kembali saat booking
- Format ini memungkinkan Gateway merutekan booking ke terminal yang tepat secara otomatis

---

## Penanganan Error

Semua error mengikuti format standar:

```json
{
  "error": "Pesan error yang jelas",
  "code": "ERROR_CODE"
}
```

| HTTP Status | Situasi |
|---|---|
| `400 Bad Request` | Field wajib tidak ada, atau format tidak valid |
| `401 Unauthorized` | API key tidak ada atau tidak valid |
| `404 Not Found` | Trip atau booking tidak ditemukan |
| `500 Internal Server Error` | Error internal server |

**Kode error spesifik Gateway:**

| Code | Keterangan |
|---|---|
| `INVALID_TRIP_ID` | Format `tripId` tidak valid (tidak ada `:`) |
| `OPERATOR_NOT_FOUND` | Operator dari prefix `tripId` tidak ditemukan atau tidak aktif |

---

## Alur Lengkap (End-to-End)

### Skenario: Pengguna mencari dan memesan tiket

```
1. Tampilkan form pencarian
   ↓
2. GET /api/gateway/cities
   → Isi dropdown kota asal & tujuan
   ↓
3. POST /api/gateway/trips/search
   body: { origin, destination, date, passengers }
   → Tampilkan daftar trip dari semua operator (diurutkan harga termurah)
   ↓
4. Pengguna pilih trip
   ↓
5. GET /api/gateway/trips/:tripId   (opsional)
   → Tampilkan detail trip terbaru sebelum checkout
   ↓
6. Pengguna isi data penumpang & konfirmasi
   ↓
7. POST /api/gateway/bookings
   body: { tripId, passengerName, passengerPhone, seatNumbers, totalAmount }
   → Simpan bookingId dari response
   ↓
8. Jika status = "confirmed" → Tampilkan halaman sukses booking
   Jika status = "pending"   → Tampilkan "booking sedang diproses"
                               + polling GET /api/gateway/bookings/:bookingId
```

---

## Contoh Implementasi (TypeScript/Fetch)

### Setup client

```typescript
const GATEWAY_BASE = process.env.TRANSITY_CONSOLE_URL + "/api/gateway";
const API_KEY = process.env.TRANSITY_API_KEY;

const headers = {
  "Content-Type": "application/json",
  "X-Api-Key": API_KEY!,
};
```

### Cari trip

```typescript
async function searchTrips(params: {
  origin: string;
  destination: string;
  date: string;
  passengers?: number;
}) {
  const res = await fetch(`${GATEWAY_BASE}/trips/search`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Gagal mencari trip");
  }

  return res.json(); // { trips, errors, totalOperators, respondedOperators }
}
```

### Buat booking

```typescript
async function createBooking(params: {
  tripId: string;
  passengerName: string;
  passengerPhone: string;
  seatNumbers?: string[];
  totalAmount: number;
}) {
  const res = await fetch(`${GATEWAY_BASE}/bookings`, {
    method: "POST",
    headers,
    body: JSON.stringify(params),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(err.error || "Gagal membuat booking");
  }

  return res.json(); // { bookingId, status, ... }
}
```

### Polling status booking (jika pending)

```typescript
async function waitForBookingConfirmation(
  bookingId: string,
  maxAttempts = 10,
  intervalMs = 3000
): Promise<{ status: string }> {
  for (let i = 0; i < maxAttempts; i++) {
    const res = await fetch(`${GATEWAY_BASE}/bookings/${bookingId}`, { headers });
    const booking = await res.json();

    if (booking.status !== "pending") return booking;

    await new Promise((r) => setTimeout(r, intervalMs));
  }
  throw new Error("Booking timeout — status masih pending setelah beberapa percobaan");
}
```

---

## FAQ

**Q: Bagaimana jika semua terminal down?**  
A: Response tetap `200 OK` dengan `trips: []` dan semua operator di array `errors`. Gateway tidak pernah mengembalikan error 5xx untuk kegagalan terminal.

**Q: Berapa lama timeout per terminal?**  
A: Pencarian trip: 5 detik. Booking: 8 detik.

**Q: Apakah `price` di search result sudah final?**  
A: Ya, `price` adalah harga asli dari terminal operator. Tampilkan langsung ke pengguna.

**Q: Bagaimana mendapatkan API key?**  
A: Login ke dashboard TransityConsole sebagai admin, buka halaman Settings → API Keys, lalu klik "Generate API Key". Atau hubungi admin Transity.

**Q: Apakah endpoint gateway memerlukan rate limiting?**  
A: Saat ini belum ada rate limit aktif, tapi akan diterapkan di Phase 2. Implementasikan exponential backoff di sisi TransityApp sebagai persiapan.
