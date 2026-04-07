# Panduan Integrasi TransityApp → TransityConsole Gateway

> Dokumen ini ditujukan untuk developer **TransityApp** yang ingin menggunakan Gateway API dan Customer Auth TransityConsole.

---

## Daftar Isi

1. [Gambaran Umum](#gambaran-umum)
2. [Base URL](#base-url)
3. [Autentikasi](#autentikasi)
4. [Customer Auth Endpoints](#customer-auth-endpoints)
5. [Gateway Endpoints](#gateway-endpoints)
   - [Pencarian Trip & Info](#get-gatewaycities)
   - [Booking](#post-gatewaybookings)
   - [Pembayaran](#post-gatewaybookingsbookingidpay)
   - [Cancel](#post-gatewaybookingsbookingidcancel)
   - [Payment Methods](#get-gatewaypaymentsmethods)
   - [Voucher Validation](#post-gatewayvouchersvalidate)
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
Authorization: Bearer <customer-jwt>
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
  ]
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
| `paymentMethod` | `string` | — | **Jangan kirim.** Biarkan kosong agar booking masuk status `pending` (kursi di-hold 15 menit). User pilih metode bayar dan bayar via `/pay` terpisah. Jika tetap dikirim, Terminal akan langsung proses pembayaran |

**Response `201 Created`:**
```json
{
  "bookingId": "uuid-...",
  "externalBookingId": "terminal-booking-id",
  "operatorId": "uuid-...",
  "operatorName": "Nusa Shuttle",
  "operatorSlug": "nusa-shuttle",
  "status": "pending",
  "totalAmount": "200000",
  "holdExpiresAt": "2026-04-15T10:15:00Z",
  "qrData": [
    {
      "passengerId": "pax-uuid-1",
      "seatNo": "1A",
      "fullName": "Budi Santoso",
      "qrToken": "TRN-K-00000123-1A",
      "qrPayload": "{...}"
    },
    {
      "passengerId": "pax-uuid-2",
      "seatNo": "1C",
      "fullName": "Siti Rahayu",
      "qrToken": "TRN-K-00000123-1C",
      "qrPayload": "{...}"
    }
  ],
  "passengers": [
    { "passengerId": "pax-uuid-1", "fullName": "Budi Santoso", "seatNo": "1A" },
    { "passengerId": "pax-uuid-2", "fullName": "Siti Rahayu", "seatNo": "1C" }
  ],
  "tripId": "nusa-shuttle:trip-001"
}
```

| Field Response | Tipe | Keterangan |
|---|---|---|
| `bookingId` | `string` | ID booking di Console (UUID) — gunakan untuk pay, cancel, get |
| `externalBookingId` | `string` | ID booking di Terminal (untuk referensi) |
| `status` | `string` | Status awal: `"pending"` (tanpa paymentMethod) atau `"confirmed"` (dengan paymentMethod) |
| `holdExpiresAt` | `string \| null` | Batas waktu hold. Tampilkan countdown ke user. `null` jika sudah confirmed |
| `totalAmount` | `string` | Total harga yang harus dibayar (Rupiah) |
| `qrData` | `array` | QR boarding pass per penumpang — tampilkan setelah pembayaran berhasil |

**Status booking:**

| Status | Keterangan |
|---|---|
| `pending` | Booking baru dibuat, kursi di-hold 15 menit, menunggu pembayaran via `/pay` |
| `held` | Alias dari pending (beberapa operator menggunakan istilah ini) |
| `confirmed` | Pembayaran berhasil, booking terkonfirmasi, QR valid untuk boarding |
| `cancelled` | Booking dibatalkan (user cancel, hold expired, atau pembayaran gagal) |
| `completed` | Perjalanan sudah selesai |

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

Membayar booking yang statusnya `held` atau `pending`. Console memforward ke Terminal operator.

Voucher bisa dari dua sumber:
- **Platform voucher** (Transity) — Console validasi dan terapkan diskon sendiri
- **Operator voucher** (Terminal) — Console forward `voucherCode` ke Terminal, Terminal validasi dan hitung diskon

Console otomatis mendeteksi sumber voucher: cek di platform dulu, jika tidak ditemukan maka forward ke operator.

**Request:**
```http
POST /api/gateway/bookings/uuid-booking-.../pay
Authorization: Bearer <customer-jwt>
Content-Type: application/json

{
  "paymentMethod": "qr",
  "voucherCode": "DISKON10"
}
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `paymentMethod` | `string` | Ya | Kode metode pembayaran dari `/gateway/payments/methods` (contoh: `"qr"`, `"ewallet"`, `"bank"`) |
| `voucherCode` | `string` | — | Kode voucher (opsional). Bisa voucher platform Transity atau voucher operator |

**Response `200 OK`:**
```json
{
  "bookingId": "uuid-...",
  "externalBookingId": "terminal-booking-id",
  "status": "confirmed",
  "paymentMethod": "qr",
  "totalAmount": "200000",
  "discountAmount": "17000",
  "finalAmount": "183000",
  "paymentIntent": {
    "paymentId": "payment-uuid-1",
    "providerRef": "PAY-ABC123DEF456GHI7890ABCD",
    "method": "qr",
    "amount": "183000"
  },
  "qrData": [
    {
      "passengerId": "pax-uuid-1",
      "seatNo": "1A",
      "fullName": "Budi Santoso",
      "qrToken": "TRN-K-00000123-1A",
      "qrPayload": "{...}"
    }
  ]
}
```

| Field Response | Tipe | Keterangan |
|---|---|---|
| `status` | `string` | `"confirmed"` jika berhasil |
| `totalAmount` | `string` | Total asli sebelum diskon (Rupiah) |
| `discountAmount` | `string \| null` | Jumlah diskon yang diterapkan. `null` jika tanpa voucher |
| `finalAmount` | `string` | Jumlah yang benar-benar dibayar: `totalAmount - discountAmount` |
| `paymentIntent.providerRef` | `string` | Referensi pembayaran unik (`PAY-XXXX`) — simpan untuk rekonsiliasi |

**Error:**

| Status | Code | Keterangan |
|---|---|---|
| `400` | `INVALID_STATUS` | Booking bukan status `held`/`pending` |
| `400` | `HOLD_EXPIRED` | Hold sudah kadaluarsa, booking otomatis dibatalkan |
| `400` | `VOUCHER_INVALID` | Voucher tidak valid, expired, atau sudah habis |
| `404` | `NOT_FOUND` | Booking tidak ditemukan |
| `502` | `TERMINAL_ERROR` | Terminal operator error saat memproses pembayaran |

---

### POST /gateway/bookings/:bookingId/cancel

Membatalkan booking yang statusnya `held`, `pending`, atau `confirmed`. Console memforward ke Terminal operator.

**Request:**
```http
POST /api/gateway/bookings/uuid-booking-.../cancel
Authorization: Bearer <customer-jwt>
```

**Response `200 OK`:**
```json
{
  "bookingId": "uuid-...",
  "status": "cancelled",
  "message": "Booking berhasil dibatalkan."
}
```

**Error:**

| Status | Code | Keterangan |
|---|---|---|
| `400` | `INVALID_STATUS` | Booking sudah `cancelled` atau `completed` |
| `404` | `NOT_FOUND` | Booking tidak ditemukan |
| `502` | `TERMINAL_ERROR` | Terminal operator error saat memproses pembatalan |

---

### GET /gateway/payments/methods

Daftar metode pembayaran yang tersedia dari operator. Setiap operator bisa punya metode pembayaran berbeda.

**Request (dengan `operatorSlug`):**
```http
GET /api/gateway/payments/methods?operatorSlug=nusa-shuttle
```

**Request (dengan `bookingId` — otomatis deteksi operator):**
```http
GET /api/gateway/payments/methods?bookingId=uuid-booking-...
```

| Parameter | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `operatorSlug` | `string` | * | Slug operator dari search result. Wajib jika `bookingId` tidak disertakan |
| `bookingId` | `string` | * | ID booking — operator dideteksi otomatis dari data booking |

> Salah satu dari `operatorSlug` atau `bookingId` **wajib** diisi.

**Response `200 OK`:**

Response diproxy langsung dari Terminal operator. Format bisa bervariasi antar operator, tapi umumnya:

```json
{
  "methods": [
    { "code": "qr", "name": "QRIS", "description": "Pembayaran via QRIS" },
    { "code": "ewallet", "name": "E-Wallet", "description": "Pembayaran via e-wallet (GoPay, OVO, DANA)" },
    { "code": "bank", "name": "Bank Transfer", "description": "Transfer bank (VA)" }
  ]
}
```

> **Catatan:** Response diproxy langsung dari Terminal — schema bisa berbeda antar operator. Field `code` dan `name` umumnya selalu ada. Gunakan nilai `code` sebagai `paymentMethod` saat bayar.

**Catatan:** Daftar metode pembayaran bersifat **dinamis per operator**. Selalu ambil dari endpoint ini sebelum menampilkan pilihan bayar ke user. Jangan hardcode daftar metode di frontend.

---

### POST /gateway/vouchers/validate

Validasi kode voucher sebelum pembayaran. Mendukung **dua jenis voucher**:

1. **Voucher platform Transity** — dikelola oleh TransityConsole (berlaku lintas operator)
2. **Voucher operator** — dikelola oleh masing-masing Terminal (khusus operator tertentu)

Console akan otomatis mencari di platform dulu. Jika tidak ditemukan, akan dicek di operator (jika `tripId` atau `operatorSlug` disertakan).

**Request:**
```http
POST /api/gateway/vouchers/validate
Content-Type: application/json

{
  "code": "DISKON10",
  "tripId": "nusa-shuttle:trip-001",
  "totalAmount": 200000
}
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `code` | `string` | Ya | Kode voucher (case-insensitive) |
| `tripId` | `string` | — | ID trip — digunakan untuk mendeteksi operator jika voucher bukan dari platform |
| `operatorSlug` | `string` | — | Slug operator. Alternatif jika tidak punya `tripId` |
| `totalAmount` | `number` | — | Total harga sebelum diskon. Jika dikirim, response akan menyertakan `calculatedDiscount` |

**Response `200 OK` (voucher platform valid):**
```json
{
  "valid": true,
  "discountType": "fixed",
  "discountValue": 50000,
  "finalAmount": 150000,
  "message": "Voucher berhasil diterapkan! Diskon Rp50.000",
  "source": "platform"
}
```

**Response `200 OK` (voucher operator valid):**
```json
{
  "valid": true,
  "code": "DISKON10",
  "discountType": "percentage",
  "discountValue": "10",
  "minPurchase": "50000",
  "maxDiscount": "25000",
  "calculatedDiscount": 20000,
  "source": "operator"
}
```

| Field | Tipe | Keterangan |
|---|---|---|
| `valid` | `boolean` | `true` jika voucher valid |
| `source` | `string` | `"platform"` = voucher Transity, `"operator"` = voucher dari operator |
| `discountType` | `string` | `"fixed"` (nominal tetap) atau `"percentage"` (persentase) |
| `discountValue` | `number \| string` | Nilai diskon |
| `minPurchase` | `string \| null` | Minimal pembelian (hanya operator voucher) |
| `maxDiscount` | `string \| null` | Batas maksimal diskon (hanya operator voucher, tipe percentage) |
| `calculatedDiscount` | `number \| null` | Jumlah diskon dihitung dari `totalAmount` (jika dikirim) |
| `finalAmount` | `number` | Total setelah diskon (hanya platform voucher) |

**Response (tidak valid):**

Jika voucher tidak ditemukan di platform maupun operator:
```json
{
  "error": "Voucher tidak ditemukan atau tidak berlaku.",
  "code": "VOUCHER_INVALID"
}
```

Jika terjadi error saat cek ke Terminal operator:
```json
{
  "error": "Gagal memvalidasi voucher di operator.",
  "code": "TERMINAL_ERROR"
}
```

**Catatan untuk UI:**
- Tampilkan informasi diskon ke user sebelum mereka konfirmasi pembayaran
- Jika `source: "operator"`, gunakan `calculatedDiscount` untuk tampilkan potongan harga
- Jika `source: "platform"`, gunakan `finalAmount` untuk tampilkan harga akhir

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
  │
  ▼
GET /api/gateway/trips/search ──── Tampilkan daftar trip
  │ (user pilih trip)
  ▼
[Jika isVirtual: true]
  POST /api/gateway/trips/materialize ──── Dapatkan tripId nyata
  │
  ▼
GET /api/gateway/trips/{tripId}/seatmap ──── Tampilkan denah kursi
  │ (user pilih kursi + isi data penumpang)
  ▼
POST /api/gateway/bookings ──── Buat booking (TANPA paymentMethod)
  │                               → status "held"/"pending", kursi ditahan 15 menit
  │                               → simpan bookingId + holdExpiresAt
  ▼
Halaman Pembayaran
  │
  ├── GET /api/gateway/payments/methods?operatorSlug=... ──── Tampilkan pilihan bayar
  │
  ├── [Jika user punya voucher]
  │   POST /api/gateway/vouchers/validate ──── Tampilkan info diskon
  │
  │ (user pilih metode bayar + konfirmasi)
  ▼
POST /api/gateway/bookings/{bookingId}/pay ──── Bayar booking
  │   → { paymentMethod: "qr", voucherCode?: "DISKON10" }
  │   → status "confirmed"
  ▼
Tampilkan QR boarding pass + konfirmasi pembayaran
  │
  ▼
[Opsional] GET /api/gateway/bookings/{bookingId} ──── Cek status booking
  │
  ▼
[Opsional] POST /api/gateway/bookings/{bookingId}/cancel ──── Batalkan booking
```

> **Penting:** Jangan kirim `paymentMethod` saat create booking. Biarkan booking masuk status `held` dulu. User pilih metode bayar dan konfirmasi di halaman pembayaran, baru panggil `/pay`.

### Alur Teknis (Console ↔ Terminal)

**Alur 1: Hold → Pay (Direkomendasikan)**
```
1.  TransityApp → POST /api/gateway/bookings (tanpa paymentMethod) → Console
2.  Console parse tripId → extract operatorSlug → cari operator
3.  Console → POST /api/app/bookings → Terminal (+ X-Service-Key, tanpa paymentMethod)
4.  Terminal buat booking status "pending", hold kursi 15 menit
5.  Console simpan booking di DB lokal (status "pending", customerId, holdExpiresAt)
6.  Console → response ke TransityApp (bookingId, status, holdExpiresAt, qrData)
7.  TransityApp tampilkan halaman pembayaran + countdown holdExpiresAt
8.  TransityApp → GET /api/gateway/payments/methods → Console → Terminal
9.  [Opsional] TransityApp → POST /api/gateway/vouchers/validate → Console
10. User pilih metode bayar → TransityApp → POST /api/gateway/bookings/{id}/pay → Console
11. Console → POST /api/app/bookings/{id}/pay → Terminal (+ paymentMethod, voucherCode?)
12. Terminal proses pembayaran, update status "confirmed", lock kursi
13. Console update DB lokal (status, paymentMethod, finalAmount, discountAmount)
14. Console → response ke TransityApp (status "confirmed", paymentIntent, finalAmount)
```

**Alur 2: Payment Webhook (Alternatif)**
```
1-6. Sama seperti Alur 1
7.  TransityApp arahkan user ke payment gateway eksternal
8.  Payment gateway → POST /api/gateway/payments/webhook → Console
9.  Console update status booking lokal
10. Console sign payload dengan HMAC-SHA256(webhookSecret)
11. Console → POST /api/app/payments/webhook → Terminal (+ X-Webhook-Signature)
12. Terminal konfirmasi/batalkan booking berdasarkan status webhook
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

### Buat Booking (Hold)

```typescript
async function createBooking(params: {
  tripId: string;
  serviceDate: string;
  originStopId: string;
  destinationStopId: string;
  originSeq: number;
  destinationSeq: number;
  passengers: Array<{ fullName: string; phone?: string; seatNo: string }>;
}) {
  // JANGAN kirim paymentMethod — biarkan booking masuk status "held"/"pending"
  const res = await fetch(`${API_BASE}/gateway/bookings`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify(params),
  });
  if (!res.ok) throw await res.json();
  return res.json();
  // { bookingId, status: "pending", holdExpiresAt, totalAmount, qrData, passengers, ... }
}
```

### Ambil Metode Pembayaran

```typescript
async function getPaymentMethods(operatorSlug: string) {
  const res = await fetch(
    `${API_BASE}/gateway/payments/methods?operatorSlug=${encodeURIComponent(operatorSlug)}`,
    { headers: gatewayHeaders() }
  );
  if (!res.ok) throw await res.json();
  const data = await res.json();
  // Response diproxy dari Terminal — schema bisa bervariasi per operator
  // Umumnya: { methods: [{ code, name, description?, active? }] }
  return data.methods ?? data;
}
```

### Validasi Voucher

```typescript
async function validateVoucher(code: string, tripId: string, totalAmount: number) {
  const res = await fetch(`${API_BASE}/gateway/vouchers/validate`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify({ code, tripId, totalAmount }),
  });
  if (!res.ok) {
    const err = await res.json();
    return { valid: false, error: err.error };
  }
  return res.json();
  // Platform voucher:  { valid: true, discountType, discountValue, finalAmount, source: "platform" }
  // Operator voucher:  { valid: true, discountType, discountValue, calculatedDiscount, source: "operator" }
}
```

### Bayar Booking

```typescript
async function payBooking(bookingId: string, paymentMethod: string, voucherCode?: string) {
  const body: Record<string, string> = { paymentMethod };
  if (voucherCode) body.voucherCode = voucherCode;

  const res = await fetch(`${API_BASE}/gateway/bookings/${bookingId}/pay`, {
    method: "POST",
    headers: gatewayHeaders(),
    body: JSON.stringify(body),
  });
  if (!res.ok) throw await res.json();
  return res.json();
  // { bookingId, status: "confirmed", totalAmount, discountAmount, finalAmount, paymentIntent, qrData }
}
```

### Batalkan Booking

```typescript
async function cancelBooking(bookingId: string) {
  const res = await fetch(`${API_BASE}/gateway/bookings/${bookingId}/cancel`, {
    method: "POST",
    headers: gatewayHeaders(),
  });
  if (!res.ok) throw await res.json();
  return res.json();
  // { bookingId, status: "cancelled", message: "Booking berhasil dibatalkan." }
}
```

### Contoh Flow Lengkap

```typescript
async function fullBookingFlow() {
  // 1. Login
  const auth = await login("budi@gmail.com", "rahasia123");
  customerToken = auth.token;

  // 2. Cari trip
  const searchResult = await searchTrips("Jakarta", "Bandung", "2026-04-15", 2);
  const trip = searchResult.trips[0];

  // 3. Materialize jika virtual
  let tripId = trip.tripId;
  if (trip.isVirtual) {
    const materialized = await materializeTrip(tripId, trip.serviceDate);
    tripId = materialized.tripId;
  }

  // 4. Ambil seatmap
  const seatmap = await getSeatmap(tripId, trip.origin.sequence, trip.destination.sequence);
  // Tampilkan seatmap ke user, user pilih kursi

  // 5. Buat booking (TANPA paymentMethod — hold saja)
  const booking = await createBooking({
    tripId,
    serviceDate: trip.serviceDate,
    originStopId: trip.origin.stopId,
    destinationStopId: trip.destination.stopId,
    originSeq: trip.origin.sequence,
    destinationSeq: trip.destination.sequence,
    passengers: [
      { fullName: "Budi Santoso", phone: "081234567890", seatNo: "1A" },
      { fullName: "Siti Rahayu", seatNo: "1C" },
    ],
  });
  // booking.status === "pending", booking.holdExpiresAt = "2026-04-15T10:15:00Z"
  // Tampilkan countdown dari holdExpiresAt

  // 6. Ambil metode pembayaran (dari operator)
  const methods = await getPaymentMethods(trip.operatorSlug);
  // Tampilkan pilihan ke user

  // 7. (Opsional) Validasi voucher
  const voucher = await validateVoucher("DISKON10", tripId, parseFloat(booking.totalAmount));
  // Tampilkan info diskon ke user

  // 8. Bayar
  const payResult = await payBooking(booking.bookingId, "qr", "DISKON10");
  // payResult.status === "confirmed"
  // payResult.finalAmount === jumlah yang dibayar setelah diskon
  // Tampilkan QR boarding pass dari payResult.qrData
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

**Q: Apa perbedaan voucher platform dan voucher operator?**
A: Voucher platform dikelola oleh Transity (berlaku lintas operator). Voucher operator dikelola oleh masing-masing terminal (khusus untuk operator itu). Saat validasi atau pembayaran, Console otomatis mendeteksi sumber voucher. Response menyertakan `source: "platform"` atau `"operator"`.

**Q: Apakah booking yang sudah confirmed bisa dibatalkan?**
A: Ya. Booking berstatus `held`, `pending`, atau `confirmed` bisa dibatalkan via `POST /api/gateway/bookings/{id}/cancel`. Hanya `cancelled` dan `completed` yang tidak bisa dibatalkan.

**Q: Kenapa `paymentMethod` tidak dikirim saat create booking?**
A: Supaya kursi bisa di-hold dulu (15 menit) sementara user memilih metode pembayaran. Ini mencegah user kehilangan kursi saat masih browsing opsi pembayaran. Pembayaran dilakukan terpisah via `POST /gateway/bookings/{id}/pay`.

**Q: Bagaimana jika hold expired sebelum user bayar?**
A: Kursi otomatis dilepas oleh Terminal. Jika user mencoba bayar setelah expired, response error `400 HOLD_EXPIRED` dan booking otomatis dibatalkan di Console. User harus buat booking baru.

**Q: Format `paymentMethod` seperti apa yang harus dikirim?**
A: Gunakan nilai `code` dari response `GET /gateway/payments/methods` (contoh: `"qr"`, `"ewallet"`, `"bank"`). Jangan hardcode — selalu ambil dari endpoint karena setiap operator bisa punya metode berbeda.
