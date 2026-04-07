# Panduan Integrasi TransityApp → TransityConsole Gateway

> Dokumen ini ditujukan untuk developer **TransityApp** yang ingin menggunakan Gateway API dan Customer Auth TransityConsole.

---

## Daftar Isi

1. [Gambaran Umum](#gambaran-umum)
2. [Base URL](#base-url)
3. [Autentikasi](#autentikasi)
4. [Customer Auth Endpoints](#customer-auth-endpoints)
5. [Gateway Endpoints](#gateway-endpoints)
6. [Format tripId](#format-tripid)
7. [Virtual Trip & Materialisasi](#virtual-trip--materialisasi)
8. [Alur Booking End-to-End](#alur-booking-end-to-end)
9. [Payment Webhook](#payment-webhook)
10. [Penanganan Error](#penanganan-error)
11. [Contoh Implementasi (TypeScript)](#contoh-implementasi-typescript)
12. [FAQ](#faq)

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
- Deduplikasi trip virtual vs materialized
- Menerapkan markup/komisi per operator ke harga trip
- Mengurutkan hasil dari harga termurah
- Meneruskan booking ke terminal yang tepat berdasarkan `tripId`
- Menerjemahkan semua error terminal ke Bahasa Indonesia

**Customer auth** (registrasi, login, profil) **terpusat di Console** — satu akun berlaku untuk semua operator. TransityApp tidak perlu mengelola auth sendiri untuk fitur-fitur yang berhubungan dengan booking.

---

## Base URL

| Environment | URL |
|---|---|
| **Production** | `https://console.transity.id/api` |
| **Development** | `http://localhost:8080/api` |

---

## Autentikasi

### Untuk Customer (End-User)

Endpoint customer auth (`/api/gateway/auth/*`) menggunakan JWT Bearer token:

```http
Authorization: Bearer <customer-jwt-token>
```

Token diperoleh dari endpoint `/api/gateway/auth/login` atau `/api/gateway/auth/register`, berlaku 30 hari.

### Untuk Service-to-Service (Gateway)

Endpoint gateway (`/api/gateway/*` selain auth) dapat diakses dengan salah satu:

**Opsi 1: API Key (Direkomendasikan)**
```http
X-Api-Key: tc_live_a1b2c3d4e5f6...
```

API key digenerate oleh admin TransityConsole melalui Settings → API Keys.

**Opsi 2: JWT Admin**
```http
Authorization: Bearer <admin-jwt-token>
```

---

## Customer Auth Endpoints

### POST /gateway/auth/register

Registrasi akun customer baru.

**Request:**
```http
POST /api/gateway/auth/register
Content-Type: application/json

{
  "fullName": "Budi Santoso",
  "email": "budi@gmail.com",
  "phone": "081234567890",
  "password": "rahasia123"
}
```

| Field | Tipe | Wajib | Validasi |
|---|---|---|---|
| `fullName` | `string` | Ya | — |
| `email` | `string` | Ya | Format email valid, unique |
| `phone` | `string` | Ya | Unique |
| `password` | `string` | Ya | Minimal 6 karakter |

**Response `201 Created`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid-...",
    "fullName": "Budi Santoso",
    "email": "budi@gmail.com",
    "phone": "081234567890",
    "avatarUrl": null,
    "createdAt": "2026-04-07T10:00:00.000Z"
  }
}
```

**Error:**

| Status | Code | Keterangan |
|---|---|---|
| `409` | `EMAIL_EXISTS` | Email sudah terdaftar |
| `409` | `PHONE_EXISTS` | Nomor telepon sudah terdaftar |
| `400` | `VALIDATION_ERROR` | Field wajib kosong atau format tidak valid |

---

### POST /gateway/auth/login

Login dengan email atau nomor telepon.

**Request:**
```http
POST /api/gateway/auth/login
Content-Type: application/json

{
  "email": "budi@gmail.com",
  "password": "rahasia123"
}
```

Bisa juga login dengan nomor telepon:
```json
{
  "phone": "081234567890",
  "password": "rahasia123"
}
```

**Response `200 OK`:**
```json
{
  "token": "eyJhbGciOiJIUzI1NiIs...",
  "user": {
    "id": "uuid-...",
    "fullName": "Budi Santoso",
    "email": "budi@gmail.com",
    "phone": "081234567890",
    "avatarUrl": null,
    "createdAt": "2026-04-07T10:00:00.000Z"
  }
}
```

**Error:** `401` jika email/phone atau password salah.

---

### GET /gateway/auth/me

Mendapatkan profil customer yang sedang login.

**Request:**
```http
GET /api/gateway/auth/me
Authorization: Bearer <customer-jwt>
```

**Response `200 OK`:** Object `user` (sama seperti di response login).

---

### PUT /gateway/auth/profile

Update profil customer (nama dan/atau nomor telepon).

**Request:**
```http
PUT /api/gateway/auth/profile
Authorization: Bearer <customer-jwt>
Content-Type: application/json

{
  "fullName": "Budi S. Pratama",
  "phone": "081234567891"
}
```

Minimal satu field harus diisi. Nomor telepon baru tidak boleh sudah dipakai akun lain.

**Response `200 OK`:** Object `user` yang sudah diupdate.

---

### POST /gateway/auth/change-password

Ganti password customer.

**Request:**
```http
POST /api/gateway/auth/change-password
Authorization: Bearer <customer-jwt>
Content-Type: application/json

{
  "currentPassword": "rahasia123",
  "newPassword": "rahasia456"
}
```

**Response `200 OK`:**
```json
{
  "message": "Password berhasil diubah."
}
```

**Error:** `400 WRONG_PASSWORD` jika password lama salah.

---

## Gateway Endpoints

### GET /gateway/cities

Daftar semua kota yang tersedia dari semua terminal aktif.

**Request:**
```http
GET /api/gateway/cities
```

**Response `200 OK`:**
```json
{
  "cities": ["Jakarta", "Bandung", "Surabaya", "Yogyakarta"],
  "byOperator": [
    {
      "operatorSlug": "nusa-shuttle",
      "cities": ["Jakarta", "Bandung", "Surabaya"]
    }
  ]
}
```

Terminal yang offline tidak berkontribusi ke daftar, tetapi tidak menyebabkan error.

---

### GET /gateway/trips/search

Mencari trip ke semua terminal aktif secara fan-out.

**Request:**
```http
GET /api/gateway/trips/search?originCity=Jakarta&destinationCity=Bandung&date=2026-04-15&passengers=2
```

| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `originCity` | `string` | Ya | Kota asal |
| `destinationCity` | `string` | Ya | Kota tujuan |
| `date` | `string` | Ya | Format `YYYY-MM-DD` |
| `passengers` | `number` | — | Jumlah penumpang (default: 1) |

**Response `200 OK`:**
```json
{
  "trips": [
    {
      "tripId": "nusa-shuttle:trip-001",
      "serviceDate": "2026-04-15",
      "origin": {
        "stopId": "stop-jkt-01",
        "name": "Jakarta",
        "sequence": 1,
        "departAt": "07:00"
      },
      "destination": {
        "stopId": "stop-bdg-01",
        "name": "Bandung",
        "sequence": 3,
        "arriveAt": "10:30"
      },
      "farePerPerson": 100000,
      "availableSeats": 8,
      "isVirtual": false,
      "vehicleClass": "executive",
      "operatorName": "Nusa Shuttle",
      "operatorSlug": "nusa-shuttle",
      "operatorLogo": "https://...",
      "operatorColor": "#2563EB"
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

**Catatan:**
- Timeout per terminal: 5 detik. Terminal yang tidak merespons muncul di `errors`.
- Jika semua terminal down, response tetap `200 OK` dengan `trips: []`.
- Trip diurutkan dari harga termurah.
- Duplikat (trip virtual vs materialized yang sama) otomatis dideduplikasi.

---

### GET /gateway/trips/:tripId

Detail spesifik sebuah trip.

**Request:**
```http
GET /api/gateway/trips/nusa-shuttle:trip-001?serviceDate=2026-04-15
```

| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `serviceDate` | `string` | — | Format `YYYY-MM-DD`, direkomendasikan untuk akurasi |

**Response `200 OK`:** Object trip (format sama seperti item di search result).

**Response `404`:** Trip tidak ditemukan atau terminal tidak aktif.

---

### GET /gateway/trips/:tripId/seatmap

Denah kursi dan ketersediaan.

**Request:**
```http
GET /api/gateway/trips/nusa-shuttle:trip-001/seatmap?originSeq=1&destinationSeq=3&serviceDate=2026-04-15
```

| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `originSeq` | `number` | Ya | Sequence stop asal (dari trip data) |
| `destinationSeq` | `number` | Ya | Sequence stop tujuan (dari trip data) |
| `serviceDate` | `string` | — | Format `YYYY-MM-DD` |

**Response `200 OK`:**
```json
{
  "layout": {
    "rows": 10,
    "cols": 4,
    "seatMap": [
      { "row": 1, "col": 1, "label": "1A", "type": "seat" },
      { "row": 1, "col": 2, "label": "1B", "type": "seat" },
      { "row": 1, "col": 3, "label": "", "type": "aisle" },
      { "row": 1, "col": 4, "label": "1C", "type": "seat" }
    ]
  },
  "seatAvailability": {
    "1A": { "available": true, "held": false },
    "1B": { "available": false, "held": true },
    "1C": { "available": true, "held": false }
  }
}
```

**Response `404`:** Trip virtual tidak memiliki seatmap — gunakan `vehicleClass` untuk render layout statis di frontend.

---

### GET /gateway/trips/:tripId/reviews

Ulasan trip dari terminal operator.

**Request:**
```http
GET /api/gateway/trips/nusa-shuttle:trip-001/reviews
```

**Response:** Proxy langsung dari terminal — format tergantung implementasi terminal.

---

### POST /gateway/trips/materialize

Materialisasi trip virtual menjadi trip nyata. Wajib dilakukan sebelum booking trip virtual.

**Request:**
```http
POST /api/gateway/trips/materialize
Content-Type: application/json

{
  "tripId": "nusa-shuttle:virtual-base123",
  "serviceDate": "2026-04-15"
}
```

Atau format alternatif:
```json
{
  "baseId": "base123",
  "operatorSlug": "nusa-shuttle",
  "serviceDate": "2026-04-15"
}
```

> `baseId` tanpa `operatorSlug` **ditolak** untuk mencegah konflik antar operator.

**Response `200 OK`:**
```json
{
  "tripId": "nusa-shuttle:trip-real-456"
}
```

Gunakan `tripId` dari response ini untuk booking berikutnya.

---

### GET /gateway/operators/:operatorSlug/info

Info branding operator.

**Request:**
```http
GET /api/gateway/operators/nusa-shuttle/info
```

**Response `200 OK`:** Object berisi informasi branding operator (nama, logo, warna, deskripsi, dll).

---

### GET /gateway/service-lines

Daftar rute/jalur layanan dari semua operator aktif.

**Request:**
```http
GET /api/gateway/service-lines
```

**Response:** Agregasi service lines dari semua terminal.

---

### POST /gateway/bookings

Membuat booking baru. Gateway meneruskan ke terminal operator yang sesuai berdasarkan prefix `tripId`.

**Request:**
```http
POST /api/gateway/bookings
Content-Type: application/json

{
  "tripId": "nusa-shuttle:trip-001",
  "serviceDate": "2026-04-15",
  "originStopId": "stop-jkt-01",
  "destinationStopId": "stop-bdg-01",
  "originSeq": 1,
  "destinationSeq": 3,
  "passengers": [
    { "fullName": "Budi Santoso", "phone": "081234567890", "seatNo": "1A" },
    { "fullName": "Siti Rahayu", "seatNo": "1C" }
  ],
  "paymentMethod": "qr"
}
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `tripId` | `string` | Ya | ID trip dari hasil search (format `operatorSlug:originalId`) |
| `serviceDate` | `string` | Ya | Format `YYYY-MM-DD` |
| `originStopId` | `string` | Ya | ID stop keberangkatan |
| `destinationStopId` | `string` | Ya | ID stop tujuan |
| `originSeq` | `number` | Ya | Sequence stop asal |
| `destinationSeq` | `number` | Ya | Sequence stop tujuan |
| `passengers` | `array` | Ya | Minimal 1 penumpang, masing-masing wajib `fullName` dan `seatNo` |
| `paymentMethod` | `string` | — | Opsional. Jika tidak diisi, booking dibuat dalam status `held`. Contoh: `"QRIS"`, `"GOPAY"`, `"OVO"`, `"DANA"` |

**Response `201 Created`:**
```json
{
  "bookingId": "uuid-...",
  "externalBookingId": "terminal-booking-id",
  "operatorId": "uuid-...",
  "operatorName": "Nusa Shuttle",
  "operatorSlug": "nusa-shuttle",
  "status": "held",
  "totalAmount": "200000",
  "holdExpiresAt": "2026-04-15T10:20:00Z",
  "paymentIntent": {
    "paymentId": "...",
    "method": "qr",
    "amount": "200000"
  },
  "qrData": [
    {
      "passengerId": "...",
      "seatNo": "1A",
      "fullName": "Budi Santoso",
      "qrToken": "...",
      "qrPayload": "..."
    }
  ],
  "passengers": [ ... ],
  "tripId": "nusa-shuttle:trip-001"
}
```

**Status booking:**

| Status | Keterangan |
|---|---|
| `held` | Booking ditahan, menunggu pembayaran. Ada batas waktu (`holdExpiresAt`). |
| `confirmed` | Pembayaran berhasil, booking terkonfirmasi. |
| `cancelled` | Booking dibatalkan (hold expired atau pembayaran gagal). |
| `completed` | Perjalanan sudah selesai. |

---

### GET /gateway/bookings

List booking milik customer yang sedang login. Memerlukan JWT customer di header Authorization.

**Request:**
```http
GET /api/gateway/bookings?status=held&page=1&limit=20
Authorization: Bearer <customer-jwt>
```

| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `status` | `string` | — | Filter by status: `held`, `pending`, `confirmed`, `cancelled` |
| `page` | `number` | — | Halaman (default: 1) |
| `limit` | `number` | — | Jumlah per halaman (default: 20, max: 50) |

**Response `200 OK`:**
```json
{
  "data": [
    {
      "bookingId": "uuid-...",
      "tripId": "nusa-shuttle:trip-001",
      "status": "held",
      "totalAmount": "200000",
      "holdExpiresAt": "2026-04-15T10:20:00Z",
      "passengerName": "Budi Santoso",
      "seatNumbers": ["1A", "1C"],
      "serviceDate": "2026-04-15",
      "paymentMethod": null,
      "createdAt": "2026-04-15T10:00:00Z"
    }
  ],
  "total": 5,
  "page": 1,
  "limit": 20,
  "hasMore": false
}
```

---

### GET /gateway/bookings/:bookingId

Status dan detail booking.

**Request:**
```http
GET /api/gateway/bookings/uuid-booking-...
```

**Response `200 OK`:** Object booking (format sama seperti response create, ditambah `holdExpiresAt`, `discountAmount`, `finalAmount`).

---

### POST /gateway/bookings/:bookingId/pay

Membayar booking yang statusnya `held`. Console memforward ke Terminal operator.

**Request:**
```http
POST /api/gateway/bookings/uuid-booking-.../pay
Content-Type: application/json

{
  "paymentMethod": "QRIS",
  "voucherCode": "PROMO50K"
}
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `paymentMethod` | `string` | Ya | Metode pembayaran (dari `/gateway/payments/methods`) |
| `voucherCode` | `string` | — | Kode voucher (opsional, divalidasi otomatis) |

**Response `200 OK`:**
```json
{
  "bookingId": "uuid-...",
  "status": "confirmed",
  "paymentMethod": "QRIS",
  "totalAmount": "200000",
  "discountAmount": "50000",
  "finalAmount": "150000",
  "paymentIntent": { ... },
  "qrData": [ ... ]
}
```

**Error:**

| Status | Code | Keterangan |
|---|---|---|
| `400` | `INVALID_STATUS` | Booking bukan status `held`/`pending` |
| `400` | `HOLD_EXPIRED` | Hold sudah kadaluarsa |
| `400` | `VOUCHER_INVALID` | Voucher tidak valid |
| `404` | `NOT_FOUND` | Booking tidak ditemukan |

---

### POST /gateway/bookings/:bookingId/cancel

Membatalkan booking yang statusnya `held` atau `pending`. Console memforward ke Terminal operator.

**Request:**
```http
POST /api/gateway/bookings/uuid-booking-.../cancel
```

**Response `200 OK`:**
```json
{
  "bookingId": "uuid-...",
  "status": "cancelled",
  "message": "Booking berhasil dibatalkan."
}
```

**Error:** `400` jika booking sudah `confirmed`/`completed`. `404` jika tidak ditemukan.

---

### GET /gateway/payments/methods

Daftar metode pembayaran yang tersedia.

**Request:**
```http
GET /api/gateway/payments/methods
```

**Response `200 OK`:**
```json
{
  "methods": [
    { "id": "QRIS", "name": "QRIS", "type": "qr" },
    { "id": "GOPAY", "name": "GoPay", "type": "ewallet" },
    { "id": "OVO", "name": "OVO", "type": "ewallet" },
    { "id": "DANA", "name": "DANA", "type": "ewallet" },
    { "id": "SHOPEEPAY", "name": "ShopeePay", "type": "ewallet" },
    { "id": "VA_BCA", "name": "VA BCA", "type": "va" },
    { "id": "VA_MANDIRI", "name": "VA Mandiri", "type": "va" },
    { "id": "VA_BNI", "name": "VA BNI", "type": "va" },
    { "id": "BANK_TRANSFER", "name": "Bank Transfer", "type": "transfer" }
  ]
}
```

---

### POST /gateway/vouchers/validate

Validasi kode voucher sebelum pembayaran. Voucher ini dari platform Transity (bukan dari operator).

**Request:**
```http
POST /api/gateway/vouchers/validate
Content-Type: application/json

{
  "code": "PROMO50K",
  "tripId": "nusa-shuttle:trip-001",
  "totalAmount": 200000
}
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `code` | `string` | Ya | Kode voucher |
| `tripId` | `string` | — | ID trip (untuk cek voucher per-operator) |
| `totalAmount` | `number` | Ya | Total harga sebelum diskon |

**Response `200 OK` (valid):**
```json
{
  "valid": true,
  "discountType": "fixed",
  "discountValue": 50000,
  "finalAmount": 150000,
  "message": "Voucher berhasil diterapkan! Diskon Rp50.000"
}
```

**Response `200 OK` (tidak valid):**
```json
{
  "valid": false,
  "message": "Kode voucher tidak valid atau sudah kadaluarsa."
}
```

---

## Format tripId

`tripId` menggunakan format `{operatorSlug}:{originalTripId}`:

```
nusa-shuttle:trip-001
└─────────┘ └──────┘
operator    ID asli dari
slug        terminal operator
```

- Selalu gunakan `tripId` persis seperti dikembalikan dari search result.
- Jangan mengubah atau memparsing `tripId` — cukup simpan dan kirimkan saat booking.
- Format ini memungkinkan Gateway merutekan ke terminal yang tepat secara otomatis.

---

## Virtual Trip & Materialisasi

Trip dengan `tripId` yang mengandung `virtual-` (misalnya `nusa-shuttle:virtual-base123`) adalah trip yang dibuat dinamis berdasarkan jadwal rutin, belum terdaftar di database terminal.

**Karakteristik trip virtual:**
- `isVirtual: true` di search result
- Tidak memiliki seatmap (404) — frontend harus render layout statis berdasarkan `vehicleClass`
- **Tidak bisa langsung di-booking** — harus dimaterialisasi dulu

**Alur materialisasi:**

```
1. Search result mengembalikan trip virtual
   tripId: "nusa-shuttle:virtual-base123"
   isVirtual: true

2. User pilih trip → TransityApp panggil materialize:
   POST /api/gateway/trips/materialize
   { "tripId": "nusa-shuttle:virtual-base123", "serviceDate": "2026-04-15" }

3. Response:
   { "tripId": "nusa-shuttle:trip-real-456" }

4. Gunakan tripId baru untuk seatmap dan booking
```

---

## Alur Booking End-to-End

### Alur di TransityApp

```
Home Page
  │ (cari: kota asal, kota tujuan, tanggal, penumpang)
  ▼
GET /api/gateway/cities ──── Isi dropdown kota

POST /api/gateway/trips/search ──── Tampilkan daftar trip
  │ (pilih trip)
  ▼
[Jika trip virtual] POST /api/gateway/trips/materialize ──── Dapatkan tripId nyata
  │
  ▼
GET /api/gateway/trips/{tripId}/seatmap ──── Pilih kursi
  │
  ▼
POST /api/gateway/bookings ──── Buat booking
  │
  ▼
Tampilkan QR code + status pembayaran
  │
  ▼
GET /api/gateway/bookings/{bookingId} ──── Polling status
```

### Alur Teknis (Console ↔ Terminal)

```
1. TransityApp → POST /api/gateway/bookings → TransityConsole
2. Console parse tripId → extract operatorSlug
3. Console → POST /api/app/bookings → TransityTerminal (+ X-Service-Key)
4. Terminal buat booking (status: "held") → response + paymentIntent + qrData
5. Console simpan booking di database lokal
6. Console → response ke TransityApp
7. Penumpang bayar melalui payment provider
8. Payment provider → POST /api/gateway/payments/webhook → Console
9. Console update status booking lokal
10. Console sign payload dengan HMAC-SHA256(webhookSecret)
11. Console → POST /api/app/payments/webhook → Terminal (+ X-Webhook-Signature)
12. Terminal konfirmasi/batalkan booking
```

---

## Payment Webhook

### Forward ke Console

```http
POST /api/gateway/payments/webhook
Authorization: Bearer {jwt} atau X-Api-Key: {key}
Content-Type: application/json

{
  "providerRef": "payment-provider-reference-id",
  "status": "success"
}
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `providerRef` | `string` | Ya | Reference dari payment provider, cocok dengan booking |
| `status` | `string` | Ya | `"success"` atau `"failed"` |

Endpoint ini memerlukan autentikasi (API Key atau JWT admin).

### HMAC Signing ke Terminal

Saat Console meneruskan webhook ke terminal operator:

```
Signature = HMAC-SHA256(webhookSecret, JSON.stringify(payload))
Header: X-Webhook-Signature: {signature}
```

Terminal memverifikasi signature ini untuk memastikan webhook autentik.

---

## Penanganan Error

Semua error mengikuti format standar:

```json
{
  "error": "Pesan error dalam Bahasa Indonesia",
  "code": "ERROR_CODE"
}
```

| HTTP Status | Situasi |
|---|---|
| `400 Bad Request` | Field wajib tidak ada atau format tidak valid |
| `401 Unauthorized` | Token/API key tidak ada atau tidak valid |
| `404 Not Found` | Trip atau booking tidak ditemukan |
| `409 Conflict` | Data sudah ada (email/phone sudah terdaftar) |
| `500 Internal Server Error` | Error internal (detail teknis di-strip, hanya "Terjadi kesalahan sistem") |

**Error code Gateway:**

| Code | Keterangan |
|---|---|
| `INVALID_TRIP_ID` | Format `tripId` tidak valid (tidak ada `:`) |
| `OPERATOR_NOT_FOUND` | Operator dari prefix `tripId` tidak aktif |
| `SEAT_UNAVAILABLE` | Kursi tidak tersedia |
| `HOLD_EXPIRED` | Masa hold booking sudah habis |
| `ALREADY_PROCESSED` | Booking sudah diproses sebelumnya |
| `NOT_ELIGIBLE` | Tidak memenuhi syarat (misal: trip sudah lewat) |
| `MISSING_SERVICE_DATE` | `serviceDate` wajib untuk operasi ini |
| `VALIDATION_ERROR` | Validasi input gagal |
| `AUTH_ERROR` | Autentikasi gagal |

**Error code Customer Auth:**

| Code | Keterangan |
|---|---|
| `EMAIL_EXISTS` | Email sudah terdaftar |
| `PHONE_EXISTS` | Nomor telepon sudah terdaftar |
| `WRONG_PASSWORD` | Password lama salah (change-password) |
| `NOT_FOUND` | Akun tidak ditemukan |

---

## Contoh Implementasi (TypeScript)

### Setup Client

```typescript
const API_BASE = process.env.TRANSITY_CONSOLE_URL + "/api";
const API_KEY = process.env.TRANSITY_API_KEY;

function gatewayHeaders(customerToken?: string): Record<string, string> {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (customerToken) {
    h["Authorization"] = `Bearer ${customerToken}`;
  }
  if (API_KEY) {
    h["X-Api-Key"] = API_KEY;
  }
  return h;
}
```

### Registrasi Customer

```typescript
async function registerCustomer(data: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}) {
  const res = await fetch(`${API_BASE}/gateway/auth/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw await res.json();
  return res.json(); // { token, user }
}
```

### Login Customer

```typescript
async function loginCustomer(emailOrPhone: string, password: string) {
  const isEmail = emailOrPhone.includes("@");
  const res = await fetch(`${API_BASE}/gateway/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      [isEmail ? "email" : "phone"]: emailOrPhone,
      password,
    }),
  });
  if (!res.ok) throw await res.json();
  return res.json(); // { token, user }
}
```

### Cari Trip

```typescript
async function searchTrips(params: {
  originCity: string;
  destinationCity: string;
  date: string;
  passengers?: number;
}) {
  const qs = new URLSearchParams({
    originCity: params.originCity,
    destinationCity: params.destinationCity,
    date: params.date,
    ...(params.passengers ? { passengers: String(params.passengers) } : {}),
  });

  const res = await fetch(`${API_BASE}/gateway/trips/search?${qs}`, {
    headers: gatewayHeaders(),
  });
  if (!res.ok) throw await res.json();
  return res.json(); // { trips, errors, totalOperators, respondedOperators }
}
```

### Materialisasi Trip Virtual

```typescript
async function materializeTrip(tripId: string, serviceDate: string) {
  const res = await fetch(`${API_BASE}/gateway/trips/materialize`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify({ tripId, serviceDate }),
  });
  if (!res.ok) throw await res.json();
  return res.json(); // { tripId: "nusa-shuttle:trip-real-456" }
}
```

### Buat Booking

```typescript
async function createBooking(params: {
  tripId: string;
  serviceDate: string;
  originStopId: string;
  destinationStopId: string;
  originSeq: number;
  destinationSeq: number;
  passengers: Array<{ fullName: string; phone?: string; seatNo: string }>;
  paymentMethod: string;
}) {
  const res = await fetch(`${API_BASE}/gateway/bookings`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify(params),
  });
  if (!res.ok) throw await res.json();
  return res.json(); // { bookingId, status, qrData, ... }
}
```

---

## FAQ

**Q: Bagaimana jika semua terminal down?**
A: Response tetap `200 OK` dengan `trips: []` dan semua operator di array `errors`. Gateway tidak mengembalikan 5xx untuk kegagalan terminal.

**Q: Berapa lama timeout per terminal?**
A: Pencarian trip: 5 detik. Booking: 8 detik.

**Q: Apakah `farePerPerson` di search result sudah final?**
A: Ya, harga sudah termasuk komisi. Tampilkan langsung ke pengguna.

**Q: Bagaimana mendapatkan API key?**
A: Login ke dashboard TransityConsole sebagai admin → Settings → API Keys → "Generate API Key". Atau hubungi admin Transity.

**Q: Apa bedanya customer auth dan admin auth?**
A: Customer auth (`/api/gateway/auth/*`) untuk penumpang di TransityApp. Admin auth (`/api/auth/*`) untuk tim internal di dashboard. Keduanya menggunakan JWT terpisah dengan field `type` berbeda, sehingga token tidak bisa tertukar.

**Q: Apakah trip virtual bisa langsung di-booking?**
A: Tidak. Trip virtual harus dimaterialisasi dulu via `POST /api/gateway/trips/materialize`. Response mengembalikan `tripId` nyata yang bisa dipakai untuk seatmap dan booking.

**Q: Apakah seatmap tersedia untuk trip virtual?**
A: Tidak. Trip virtual mengembalikan 404 untuk seatmap. Gunakan field `vehicleClass` untuk menampilkan layout statis di frontend.
