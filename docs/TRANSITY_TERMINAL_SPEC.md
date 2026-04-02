# Spesifikasi API TransityTerminal

> Dokumen ini ditujukan untuk developer **TransityTerminal** — sistem whitelabel per operator shuttle. Agar terminal dapat terdaftar dan berfungsi di ekosistem Transity, terminal **wajib** mengimplementasikan semua endpoint yang tercantum di dokumen ini.

---

## Daftar Isi

1. [Gambaran Umum](#gambaran-umum)
2. [Autentikasi (X-Service-Key)](#autentikasi-x-service-key)
3. [Endpoint Wajib](#endpoint-wajib)
   - [GET /api/health — Health Check (Ping/Pong)](#get-apihealth--health-check-pingpong)
   - [GET /api/app/cities — Daftar Kota](#get-apiappcities--daftar-kota)
   - [GET /api/app/trips/search — Pencarian Trip](#get-apiapptripssearch--pencarian-trip)
   - [GET /api/app/trips/:tripId — Detail Trip](#get-apiapptripstripid--detail-trip)
   - [POST /api/app/bookings — Buat Booking](#post-apiappbookings--buat-booking)
4. [Aturan Response](#aturan-response)
5. [Contoh Implementasi](#contoh-implementasi)
6. [Checklist Sebelum Registrasi](#checklist-sebelum-registrasi)
7. [Registrasi ke TransityConsole](#registrasi-ke-transityconsole)

---

## Gambaran Umum

TransityConsole akan melakukan request ke terminal secara berkala (health check) maupun saat ada permintaan dari TransityApp (trip search dan booking). Semua request dikirim oleh Console ke URL dasar yang didaftarkan operator, menggunakan `X-Service-Key` sebagai identifikasi.

```
TransityConsole
    │
    │  GET  {apiUrl}/api/health           ← cek kesehatan (setiap 60 detik)
    │  GET  {apiUrl}/api/app/cities       ← daftar kota tersedia
    │  GET  {apiUrl}/api/app/trips/search ← pencarian jadwal
    │  GET  {apiUrl}/api/app/trips/:id    ← detail satu trip
    │  POST {apiUrl}/api/app/bookings     ← buat booking
    │
    ▼
TransityTerminal (sistem operator)
```

Semua request menggunakan `X-Service-Key` di header yang nilainya dikonfigurasi saat pendaftaran operator.

---

## Autentikasi (X-Service-Key)

Setiap request dari TransityConsole menyertakan header:

```http
X-Service-Key: <service-key-operator>
```

Terminal **wajib memverifikasi** header ini sebelum memproses request. Jika key tidak cocok atau tidak ada, kembalikan:

```http
HTTP 401 Unauthorized
```

```json
{
  "error": "Unauthorized"
}
```

`Service Key` ditetapkan bersama antara tim Transity dan operator saat proses registrasi. Simpan key ini sebagai environment variable di terminal, jangan hardcode ke source code.

---

## Endpoint Wajib

### GET /api/health — Health Check (Ping/Pong)

Ini adalah endpoint **paling kritis**. TransityConsole melakukan ping ke endpoint ini setiap **60 detik** untuk memantau status terminal. Hasil ping menentukan apakah trip dari operator ini akan ditampilkan ke pengguna TransityApp atau tidak.

**Request dari Console:**
```http
GET {apiUrl}/api/health
X-Service-Key: <service-key>
```

**Response yang diharapkan:**

Terminal harus membalas dengan HTTP `200 OK` secepat mungkin. Body response dapat berupa apapun selama status HTTP-nya 200.

**Format yang direkomendasikan:**
```http
HTTP 200 OK
Content-Type: application/json

{
  "status": "ok"
}
```

**Bagaimana Console menentukan status terminal:**

| Kondisi | Status Terminal |
|---|---|
| Response HTTP 200, latency ≤ 1000ms | `online` ✅ |
| Response HTTP 200, latency > 1000ms | `degraded` ⚠️ |
| Response HTTP non-200 | `degraded` ⚠️ |
| Timeout (> 5 detik) atau koneksi gagal | `offline` ❌ |

**Dampak status pada sistem:**
- `online` — Trip dari terminal ini ditampilkan di hasil search
- `degraded` — Trip masih ditampilkan, tetapi ada peringatan di dashboard admin
- `offline` — Terminal di-skip dari fan-out search; trip tidak muncul ke pengguna

**Contoh implementasi minimal (Express):**
```javascript
app.get("/api/health", (req, res) => {
  const serviceKey = req.headers["x-service-key"];
  if (serviceKey !== process.env.SERVICE_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  res.json({ status: "ok" });
});
```

**Contoh implementasi minimal (Fastify):**
```javascript
fastify.get("/api/health", async (request, reply) => {
  if (request.headers["x-service-key"] !== process.env.SERVICE_KEY) {
    return reply.status(401).send({ error: "Unauthorized" });
  }
  return { status: "ok" };
});
```

> **Tips performa:** Endpoint ini tidak boleh melakukan query database atau operasi berat. Idealnya hanya mengecek variabel statis dan langsung membalas.

---

### GET /api/app/cities — Daftar Kota

Mengembalikan daftar kota keberangkatan dan tujuan yang tersedia di terminal ini.

**Request dari Console:**
```http
GET {apiUrl}/api/app/cities
X-Service-Key: <service-key>
```

**Response `200 OK`:**

Bisa menggunakan salah satu dari dua format berikut:

Format objek (direkomendasikan):
```json
{
  "cities": ["Jakarta", "Bandung", "Cirebon", "Tasikmalaya"]
}
```

Format array langsung (juga diterima):
```json
["Jakarta", "Bandung", "Cirebon", "Tasikmalaya"]
```

---

### GET /api/app/trips/search — Pencarian Trip

Mengembalikan jadwal trip yang tersedia berdasarkan parameter pencarian.

**Request dari Console:**
```http
GET {apiUrl}/api/app/trips/search?origin=Jakarta&destination=Bandung&date=2026-04-15&passengers=2
X-Service-Key: <service-key>
```

**Query Parameters:**

| Parameter | Tipe | Keterangan |
|---|---|---|
| `origin` | `string` | Kota asal |
| `destination` | `string` | Kota tujuan |
| `date` | `string` | Format `YYYY-MM-DD` |
| `passengers` | `number` | Jumlah penumpang (opsional) |

**Response `200 OK`:**

Format objek (direkomendasikan):
```json
{
  "trips": [
    {
      "id": "trip-001",
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
      "id": "trip-002",
      "origin": "Jakarta",
      "destination": "Bandung",
      "departureDate": "2026-04-15",
      "departureTime": "10:00",
      "arrivalTime": "13:30",
      "availableSeats": 4,
      "price": 90000,
      "currency": "IDR"
    }
  ]
}
```

Format array langsung (juga diterima):
```json
[
  {
    "id": "trip-001",
    ...
  }
]
```

**Keterangan field:**

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `id` | `string` | ✅ | ID trip unik di sistem terminal |
| `origin` | `string` | ✅ | Kota asal |
| `destination` | `string` | ✅ | Kota tujuan |
| `departureDate` | `string` | ✅ | Format `YYYY-MM-DD` |
| `departureTime` | `string` | ✅ | Format `HH:MM` |
| `arrivalTime` | `string` | ✅ | Format `HH:MM` |
| `availableSeats` | `number` | ✅ | Kursi tersedia |
| `price` | `number` | ✅ | Harga dasar dalam IDR (Console akan menambah markup) |
| `currency` | `string` | — | Default `IDR` |

> **Catatan harga:** Kirimkan harga **sebelum** markup. Console akan menambahkan markup/komisi secara otomatis berdasarkan konfigurasi operator sebelum menampilkan ke pengguna TransityApp.

Jika tidak ada trip yang tersedia, kembalikan array kosong:
```json
{ "trips": [] }
```

---

### GET /api/app/trips/:tripId — Detail Trip

Mengembalikan detail satu trip berdasarkan ID.

**Request dari Console:**
```http
GET {apiUrl}/api/app/trips/trip-001
X-Service-Key: <service-key>
```

**Response `200 OK`:**
```json
{
  "id": "trip-001",
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

**Response `404 Not Found`:** Jika trip tidak ditemukan.
```json
{ "error": "Trip not found" }
```

---

### POST /api/app/bookings — Buat Booking

Menerima dan memproses booking dari Console (yang diteruskan dari TransityApp).

**Request dari Console:**
```http
POST {apiUrl}/api/app/bookings
X-Service-Key: <service-key>
Content-Type: application/json
```

**Request Body:**
```json
{
  "tripId": "trip-001",
  "passengerName": "Budi Santoso",
  "passengerPhone": "081234567890",
  "seatNumbers": ["A1", "A2"],
  "totalAmount": 100000
}
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `tripId` | `string` | ✅ | ID trip di sistem terminal (tanpa prefix operator) |
| `passengerName` | `string` | ✅ | Nama penumpang |
| `passengerPhone` | `string` | ✅ | Nomor telepon penumpang |
| `seatNumbers` | `string[]` | — | Kursi yang dipilih (bisa kosong) |
| `totalAmount` | `number` | ✅ | Total harga yang dibayar penumpang |

> **Catatan `totalAmount`:** Ini adalah harga yang sudah termasuk markup Console. Terminal bisa menyimpannya sebagai referensi atau mengabaikannya.

**Response `200 OK` atau `201 Created`:**

Terminal harus mengembalikan ID booking yang dibuat di sistemnya:

```json
{
  "id": "NSH-2026-001234"
}
```

atau:

```json
{
  "bookingId": "NSH-2026-001234"
}
```

Console menerima kedua field name (`id` atau `bookingId`). ID ini akan disimpan sebagai `externalBookingId` di database Console untuk keperluan rekonsiliasi.

**Jika booking gagal (misal kursi sudah tidak tersedia):**
```http
HTTP 422 Unprocessable Entity

{
  "error": "Seats A1 and A2 are no longer available"
}
```

> **Catatan toleransi kegagalan:** Jika terminal tidak merespons dalam 8 detik atau mengembalikan error, Console tetap menyimpan booking dengan status `pending`. Booking ini bisa direkonsiliasi secara manual melalui dashboard admin TransityConsole.

---

## Aturan Response

Agar terminal dapat berfungsi dengan baik dalam ekosistem Transity, ikuti aturan berikut:

| Aturan | Keterangan |
|---|---|
| **Selalu verifikasi `X-Service-Key`** | Tolak request tanpa key valid dengan HTTP 401 |
| **Content-Type wajib `application/json`** | Semua response harus JSON |
| **Respon cepat untuk `/api/health`** | Target < 200ms, maksimum < 1000ms |
| **Jangan ubah format `id` trip** | ID trip di response search harus sama persis dengan yang diterima di endpoint booking |
| **Kembalikan array kosong jika tidak ada data** | Jangan return `null` atau error 404 untuk pencarian tanpa hasil |
| **Timeout handling** | Console timeout setelah 5 detik (search) dan 8 detik (booking) |

---

## Contoh Implementasi

Berikut contoh implementasi lengkap menggunakan **Express** (TypeScript):

```typescript
import express from "express";

const app = express();
app.use(express.json());

const SERVICE_KEY = process.env.SERVICE_KEY!;

// Middleware verifikasi service key
function requireServiceKey(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (req.headers["x-service-key"] !== SERVICE_KEY) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Health check — WAJIB, harus membalas secepat mungkin
app.get("/api/health", requireServiceKey, (_req, res) => {
  res.json({ status: "ok" });
});

// Daftar kota
app.get("/api/app/cities", requireServiceKey, (_req, res) => {
  res.json({ cities: ["Jakarta", "Bandung", "Cirebon"] });
});

// Pencarian trip
app.get("/api/app/trips/search", requireServiceKey, async (req, res) => {
  const { origin, destination, date } = req.query;
  const trips = await db.searchTrips({ origin, destination, date });
  res.json({ trips });
});

// Detail trip
app.get("/api/app/trips/:tripId", requireServiceKey, async (req, res) => {
  const trip = await db.getTripById(req.params.tripId);
  if (!trip) return res.status(404).json({ error: "Trip not found" });
  res.json(trip);
});

// Buat booking
app.post("/api/app/bookings", requireServiceKey, async (req, res) => {
  const { tripId, passengerName, passengerPhone, seatNumbers } = req.body;
  const booking = await db.createBooking({ tripId, passengerName, passengerPhone, seatNumbers });
  res.status(201).json({ id: booking.id });
});

app.listen(3000);
```

---

## Checklist Sebelum Registrasi

Sebelum mendaftarkan terminal ke TransityConsole, pastikan semua endpoint berikut sudah berfungsi:

- [ ] `GET /api/health` → membalas `200 OK` dalam < 1 detik dengan `X-Service-Key` yang valid
- [ ] `GET /api/health` tanpa `X-Service-Key` → membalas `401 Unauthorized`
- [ ] `GET /api/app/cities` → mengembalikan array kota
- [ ] `GET /api/app/trips/search?origin=X&destination=Y&date=Z` → mengembalikan array trip
- [ ] `GET /api/app/trips/search` tanpa hasil → mengembalikan `{ trips: [] }` bukan error
- [ ] `GET /api/app/trips/:tripId` → mengembalikan detail trip
- [ ] `GET /api/app/trips/id-tidak-ada` → mengembalikan `404`
- [ ] `POST /api/app/bookings` → membuat booking dan mengembalikan `id` atau `bookingId`
- [ ] Semua endpoint menggunakan `Content-Type: application/json`
- [ ] URL dasar terminal dapat diakses dari jaringan publik (bukan localhost)

---

## Registrasi ke TransityConsole

Setelah semua endpoint siap, hubungi tim Transity untuk mendaftarkan operator. Informasi yang dibutuhkan:

| Field | Contoh |
|---|---|
| **Nama Operator** | Nusa Shuttle |
| **Slug** | `nusa-shuttle` (huruf kecil, tanda hubung) |
| **URL Terminal** | `https://nusa.transity.web.id` |
| **Service Key** | Disepakati bersama saat registrasi |
| **Logo URL** | `https://nusa.transity.web.id/logo.png` (opsional) |
| **Persentase Komisi** | `10` (artinya 10% markup dari harga dasar) |
| **Warna Utama** | `#2E7D32` (opsional, untuk branding di dashboard) |

Setelah terdaftar, Console akan langsung memulai health check setiap 60 detik. Status terminal dapat dipantau di dashboard TransityConsole pada halaman **Terminal Health**.
