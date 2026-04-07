# Analisis Gap: Requirement TransityApp vs Implementasi TransityConsole

> Dokumen ini menganalisis 6 requirement baru dari `console-api-requirements.md` TransityApp, dibandingkan dengan implementasi aktual TransityConsole saat ini.

---

## Ringkasan Eksekutif

| # | Requirement | Status Console | Perlu Update Terminal? | Kompleksitas |
|---|---|---|---|---|
| 1 | `paymentMethod` opsional di booking | **Perlu diubah** | Tidak (terminal sudah support) | Rendah |
| 2 | `POST /gateway/bookings/{id}/pay` | **Belum ada** | **Ya — endpoint baru** | Tinggi |
| 3 | `GET /gateway/payments/methods` | **Belum ada** | Tidak (Console-level) | Rendah |
| 4 | `POST /gateway/vouchers/validate` | **Belum ada** | Tidak (Console-level) | Sedang |
| 5 | `GET /gateway/bookings` + `holdExpiresAt` | **Belum ada** | Tidak | Sedang |
| 6 | `POST /gateway/bookings/{id}/cancel` | **Belum ada** | **Ya — endpoint baru** | Tinggi |

**Kesimpulan:** 4 dari 6 requirement bisa dikerjakan sepenuhnya di Console tanpa menunggu Terminal. 2 sisanya (pay & cancel) memerlukan endpoint baru di Terminal Spec.

---

## Requirement 1: `paymentMethod` Opsional di POST /gateway/bookings

### Kebutuhan TransityApp
Booking harus bisa dibuat **tanpa** `paymentMethod` — menghasilkan status `held` dengan `holdExpiresAt`. Pembayaran dilakukan terpisah via `/pay`.

### Kondisi Saat Ini

**gateway.routes.ts (line 193):**
```typescript
// paymentMethod WAJIB — reject jika kosong
if (!body?.tripId || ... || !body.paymentMethod) {
  return reply.status(400).send({ error: "... paymentMethod are required" });
}
```

**gateway.proxy.ts (line 33):**
```typescript
export interface BookingRequest {
  // ...
  paymentMethod: string; // WAJIB, bukan optional
}
```

**Terminal payload (proxy line 79):**
```typescript
paymentMethod: req.paymentMethod, // selalu dikirim ke terminal
```

**DB Schema (bookings.ts line 22):**
```typescript
paymentMethod: text("payment_method"), // NULLABLE ✅ — sudah support
```

### Apa yang Perlu Diubah di Console

| File | Perubahan |
|---|---|
| `gateway.routes.ts` | Hapus `!body.paymentMethod` dari validasi required |
| `gateway.proxy.ts` | Ubah `BookingRequest.paymentMethod` jadi `string \| undefined` |
| `gateway.proxy.ts` | Kirim `paymentMethod` ke terminal hanya jika ada: `...(req.paymentMethod ? { paymentMethod: req.paymentMethod } : {})` |

### Dampak ke Terminal
**Tidak ada.** DB schema Console sudah nullable, dan payload ke terminal tinggal dikondisikan. Terminal yang sudah support booking tanpa payment tidak perlu perubahan apapun.

### Risiko
- Rendah. Perubahan backward-compatible — booking dengan `paymentMethod` tetap berfungsi normal.

---

## Requirement 2: POST /gateway/bookings/{bookingId}/pay

### Kebutuhan TransityApp
Endpoint baru untuk membayar booking yang statusnya `held`. Request body:
```json
{
  "paymentMethod": "QRIS",
  "voucherCode": "PROMO50K"
}
```

Expected response:
```json
{
  "bookingId": "uuid-...",
  "status": "confirmed",
  "paymentIntent": { ... },
  "totalAmount": "200000",
  "discountAmount": "50000",
  "finalAmount": "150000"
}
```

### Kondisi Saat Ini
**Endpoint ini BELUM ADA sama sekali.** Saat ini pembayaran hanya bisa terjadi via webhook (`POST /gateway/payments/webhook`) yang diforward dari payment provider ke Terminal.

### Apa yang Perlu Diubah di Console

| Layer | Perubahan |
|---|---|
| `gateway.routes.ts` | Tambah route `POST /gateway/bookings/:bookingId/pay` |
| `gateway.proxy.ts` | Tambah fungsi `payBooking(bookingId, paymentMethod, voucherCode?)` |
| `bookings.repository.ts` | Tambah fungsi `updatePayment(id, { status, paymentMethod, ... })` |
| DB schema | Kemungkinan tambah kolom `discountAmount`, `finalAmount`, `voucherCode` |

**Alur yang harus diimplementasikan:**
```
1. Cari booking di Console DB → validasi status === "held"
2. Cek holdExpiresAt belum lewat → reject jika expired
3. Jika ada voucherCode → validasi voucher (Console-level)
4. Hitung finalAmount = totalAmount - discountAmount
5. Forward ke Terminal: POST {apiUrl}/api/app/bookings/{externalBookingId}/pay
6. Update booking di Console DB (status, paymentMethod, finalAmount, dll)
7. Return response ke TransityApp
```

### Dampak ke Terminal — **ENDPOINT BARU DIBUTUHKAN**

Terminal perlu mengimplementasikan:
```
POST /api/app/bookings/:bookingId/pay
X-Service-Key: <service-key>
Content-Type: application/json

{
  "paymentMethod": "QRIS",
  "amount": 150000
}
```

Response Terminal:
```json
{
  "status": "confirmed",
  "paymentIntent": {
    "paymentId": "...",
    "providerRef": "...",
    "method": "QRIS",
    "amount": 150000
  },
  "qrData": [ ... ]
}
```

**Ini harus ditambahkan ke `TRANSITY_TERMINAL_SPEC.md`.**

### Risiko
- **Tinggi.** Bergantung pada implementasi Terminal. Tanpa endpoint Terminal, Console hanya bisa update status lokal tapi tidak bisa memproses pembayaran di sisi operator.
- **Workaround sementara:** Console bisa mengimplementasikan endpoint ini dengan hanya update status lokal + generate payment intent di level Console (tanpa forward ke Terminal). Terminal dinotifikasi via webhook setelah payment berhasil (alur yang sudah ada).

---

## Requirement 3: GET /gateway/payments/methods

### Kebutuhan TransityApp
List metode pembayaran yang tersedia. Jika endpoint tidak tersedia, TransityApp fallback ke hardcoded list:
- QRIS, GoPay, OVO, DANA, ShopeePay, VA BCA, VA Mandiri, VA BNI, Bank Transfer

### Kondisi Saat Ini
**Endpoint ini BELUM ADA.**

### Apa yang Perlu Diubah di Console

**Opsi A: Static list (direkomendasikan untuk fase awal)**
```typescript
fastify.get("/gateway/payments/methods", async () => {
  return {
    methods: [
      { id: "QRIS", name: "QRIS", type: "qr", icon: "..." },
      { id: "GOPAY", name: "GoPay", type: "ewallet", icon: "..." },
      // ...
    ]
  };
});
```

**Opsi B: DB-driven (untuk fase selanjutnya)**
- Tambah tabel `payment_methods` dengan kolom: `id`, `name`, `type`, `icon`, `active`, `sortOrder`
- Query dari DB saat request masuk

### Dampak ke Terminal
**Tidak ada.** Payment methods adalah concern Console/platform, bukan per-terminal.

### Risiko
- Sangat rendah. Bahkan jika belum diimplementasi, TransityApp sudah punya fallback.

---

## Requirement 4: POST /gateway/vouchers/validate

### Kebutuhan TransityApp
Validasi kode voucher sebelum pembayaran. Request:
```json
{
  "code": "PROMO50K",
  "tripId": "nusa-shuttle:trip-001",
  "totalAmount": 200000
}
```

Expected response (valid):
```json
{
  "valid": true,
  "discountType": "fixed",
  "discountValue": 50000,
  "finalAmount": 150000,
  "message": "Voucher berhasil diterapkan! Diskon Rp50.000"
}
```

Expected response (invalid):
```json
{
  "valid": false,
  "message": "Kode voucher tidak valid atau sudah kadaluarsa"
}
```

### Kondisi Saat Ini
**Endpoint ini BELUM ADA. Tidak ada sistem voucher sama sekali di Console.**

### Apa yang Perlu Diubah di Console

| Layer | Perubahan |
|---|---|
| DB schema | Tabel baru `vouchers`: `id`, `code`, `discountType` (fixed/percentage), `discountValue`, `minPurchase`, `maxDiscount`, `validFrom`, `validUntil`, `usageLimit`, `usedCount`, `operatorId` (nullable, null = all), `active` |
| Repository | `vouchers.repository.ts` — CRUD + `findByCode()` |
| Service | `vouchers.service.ts` — validasi logic (expired? usage limit? min purchase?) |
| Routes | Tambah di `gateway.routes.ts`: `POST /gateway/vouchers/validate` |

**Alur validasi:**
```
1. Cari voucher by code
2. Cek active === true
3. Cek validFrom <= now <= validUntil
4. Cek usedCount < usageLimit
5. Cek totalAmount >= minPurchase (jika ada)
6. Hitung discount: 
   - fixed → discountValue
   - percentage → totalAmount * discountValue / 100 (cap maxDiscount)
7. Return { valid, discountType, discountValue, finalAmount, message }
```

### Dampak ke Terminal
**Tidak ada.** Voucher adalah fitur platform Console. Terminal tidak perlu tahu soal voucher — mereka menerima `amount` final yang sudah di-discount.

### Risiko
- Sedang. Perlu desain DB baru dan admin UI untuk manage voucher.
- **Fase awal:** Bisa implementasi dengan hardcoded/seed data tanpa admin UI.

---

## Requirement 5: GET /gateway/bookings (List) + `holdExpiresAt`

### Kebutuhan TransityApp
List booking milik customer yang sedang login, termasuk field `holdExpiresAt` di setiap item.

Expected response:
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
      "createdAt": "2026-04-15T10:00:00Z"
    }
  ]
}
```

### Kondisi Saat Ini

**Ada 2 endpoint terkait, tapi tidak satupun yang cocok:**

1. **`GET /bookings`** (admin route, bookings.routes.ts) — Ada, tapi:
   - Ini admin route, bukan gateway route
   - Tidak memfilter by customer
   - `formatBooking()` di bookings.service.ts **TIDAK** include `holdExpiresAt`

2. **`GET /gateway/bookings/:bookingId`** (gateway route) — Ada, tapi hanya single booking

**Masalah kritis: Tidak ada `customerId` di tabel bookings.**

```typescript
// bookings.ts schema — TIDAK ADA customerId
export const bookingsTable = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull(),
  // ... TIDAK ADA customer_id
});
```

Artinya saat ini **tidak ada cara untuk mengasosiasikan booking dengan customer**. Booking hanya punya `passengerName` dan `passengerPhone` — tidak ada foreign key ke tabel `customers`.

### Apa yang Perlu Diubah di Console

| Layer | Perubahan |
|---|---|
| DB schema (`bookings.ts`) | Tambah kolom `customerId: uuid("customer_id")` (nullable, for backward compat) |
| DB migration | Alter table add column `customer_id` |
| `gateway.proxy.ts` `createBooking()` | Terima dan simpan `customerId` saat create booking |
| `gateway.routes.ts` POST `/gateway/bookings` | Pass `customerId` dari JWT token ke `createBooking()` |
| `bookings.repository.ts` | Tambah `findByCustomerId(customerId, filters, pagination)` |
| `bookings.service.ts` `formatBooking()` | Tambah `holdExpiresAt` ke output |
| `gateway.routes.ts` | Tambah route `GET /gateway/bookings` yang filter by `customerId` dari JWT |

### Dampak ke Terminal
**Tidak ada.** Customer adalah konsep Console, terminal tidak mengenal customer.

### Risiko
- Sedang. Perlu DB migration untuk menambah kolom `customer_id`.
- Booking lama yang sudah ada tidak punya `customerId` — perlu handle gracefully (null check).
- Alternatif tanpa migration: match by phone number — tapi ini fragile dan tidak reliable.

---

## Requirement 6: POST /gateway/bookings/{bookingId}/cancel

### Kebutuhan TransityApp
Cancel booking yang statusnya `held` atau `pending`. Expected response:
```json
{
  "bookingId": "uuid-...",
  "status": "cancelled",
  "message": "Booking berhasil dibatalkan"
}
```

### Kondisi Saat Ini
**Endpoint ini BELUM ADA.** Status booking hanya berubah via:
- Webhook payment (`confirmed` / `cancelled` via `forwardPaymentWebhook()`)
- Manual admin (tidak ada endpoint tapi bisa via DB langsung)

Fungsi `updateStatus()` di repository sudah ada:
```typescript
export async function updateStatus(id: string, status: string): Promise<Booking | null> {
  const [row] = await db.update(bookingsTable).set({ status }).where(eq(bookingsTable.id, id)).returning();
  return row ?? null;
}
```

### Apa yang Perlu Diubah di Console

| Layer | Perubahan |
|---|---|
| `gateway.routes.ts` | Tambah route `POST /gateway/bookings/:bookingId/cancel` |
| `gateway.proxy.ts` | Tambah fungsi `cancelBooking(bookingId)` |

**Alur cancelBooking:**
```
1. Cari booking di Console DB
2. Validasi status === "held" || status === "pending"
3. Forward cancel ke Terminal: DELETE /api/app/bookings/{externalBookingId}
                             atau POST /api/app/bookings/{externalBookingId}/cancel
4. Update booking status di Console DB → "cancelled"
5. Return response
```

### Dampak ke Terminal — **ENDPOINT BARU DIBUTUHKAN**

Terminal perlu mengimplementasikan salah satu:

**Opsi A (direkomendasikan):**
```
POST /api/app/bookings/:bookingId/cancel
X-Service-Key: <service-key>
```

**Opsi B:**
```
DELETE /api/app/bookings/:bookingId
X-Service-Key: <service-key>
```

Response Terminal:
```json
{
  "status": "cancelled",
  "message": "Booking cancelled"
}
```

**Ini harus ditambahkan ke `TRANSITY_TERMINAL_SPEC.md`.**

### Risiko
- **Tinggi.** Jika Console cancel tapi Terminal tidak di-notify, terjadi data inconsistency.
- **Workaround sementara:** Console cancel di DB lokal saja. Terminal auto-cancel saat hold expired (jika terminal implement TTL). Tapi ini berisiko jika penumpang masuk ke bus dengan tiket yang sudah di-cancel di Console tapi belum di-cancel di Terminal.

---

## Perubahan DB Schema yang Dibutuhkan

### Tabel `bookings` — Kolom Baru

| Kolom | Tipe | Nullable | Keterangan |
|---|---|---|---|
| `customer_id` | `uuid` | Ya | FK ke tabel customers, untuk filter booking by customer |
| `discount_amount` | `numeric(12,2)` | Ya | Jumlah diskon dari voucher |
| `final_amount` | `numeric(12,2)` | Ya | Amount setelah diskon |
| `voucher_code` | `text` | Ya | Kode voucher yang digunakan |

### Tabel Baru: `vouchers`

| Kolom | Tipe | Nullable | Keterangan |
|---|---|---|---|
| `id` | `uuid` PK | Tidak | |
| `code` | `text` UNIQUE | Tidak | Kode voucher |
| `discount_type` | `text` | Tidak | `fixed` atau `percentage` |
| `discount_value` | `numeric(12,2)` | Tidak | Nilai diskon |
| `min_purchase` | `numeric(12,2)` | Ya | Minimum pembelian |
| `max_discount` | `numeric(12,2)` | Ya | Maksimum diskon (untuk percentage) |
| `valid_from` | `timestamptz` | Tidak | Mulai berlaku |
| `valid_until` | `timestamptz` | Tidak | Berakhir |
| `usage_limit` | `integer` | Ya | Batas penggunaan (null = unlimited) |
| `used_count` | `integer` | Tidak | Default 0 |
| `operator_id` | `uuid` | Ya | Null = berlaku untuk semua operator |
| `active` | `boolean` | Tidak | Default true |
| `created_at` | `timestamptz` | Tidak | |

### Tabel Baru (opsional): `payment_methods`

Bisa menggunakan static list di awal, tabel ini untuk fase selanjutnya saat admin perlu manage dari dashboard.

---

## Update Terminal Spec yang Dibutuhkan

Dua endpoint baru perlu ditambahkan ke `TRANSITY_TERMINAL_SPEC.md`:

### 1. POST /api/app/bookings/:bookingId/pay

```markdown
### POST /api/app/bookings/:bookingId/pay — Bayar Booking

Memproses pembayaran untuk booking yang statusnya `held`.

**Request:**
POST {apiUrl}/api/app/bookings/NSH-2026-001234/pay
X-Service-Key: <service-key>
Content-Type: application/json

{
  "paymentMethod": "QRIS",
  "amount": 150000
}

**Response 200 OK:**
{
  "status": "confirmed",
  "paymentIntent": {
    "paymentId": "pay-xxx",
    "providerRef": "provider-xxx",
    "method": "QRIS",
    "amount": 150000
  },
  "qrData": [...]
}

**Response 400:** Booking bukan status "held" atau sudah expired.
**Response 404:** Booking tidak ditemukan.
```

### 2. POST /api/app/bookings/:bookingId/cancel — Batalkan Booking

```markdown
### POST /api/app/bookings/:bookingId/cancel — Batalkan Booking

Membatalkan booking yang statusnya `held` atau `pending`.

**Request:**
POST {apiUrl}/api/app/bookings/NSH-2026-001234/cancel
X-Service-Key: <service-key>

**Response 200 OK:**
{
  "status": "cancelled"
}

**Response 400:** Booking tidak bisa dibatalkan (sudah confirmed/completed).
**Response 404:** Booking tidak ditemukan.
```

---

## Rekomendasi Urutan Implementasi

### Fase 1 — Bisa dikerjakan SEKARANG (tanpa menunggu Terminal)

| Prioritas | Item | Effort |
|---|---|---|
| P0 | Req 1: `paymentMethod` opsional | ~1 jam |
| P0 | Req 5: `GET /gateway/bookings` + `holdExpiresAt` + kolom `customer_id` | ~3 jam |
| P1 | Req 3: `GET /gateway/payments/methods` (static list) | ~30 menit |
| P1 | Req 4: `POST /gateway/vouchers/validate` + tabel vouchers | ~4 jam |

### Fase 2 — Butuh koordinasi dengan tim Terminal

| Prioritas | Item | Effort Console | Effort Terminal |
|---|---|---|---|
| P0 | Req 2: `POST /gateway/bookings/{id}/pay` | ~4 jam | ~4 jam |
| P0 | Req 6: `POST /gateway/bookings/{id}/cancel` | ~2 jam | ~2 jam |

**Workaround Fase 2 (tanpa Terminal ready):**
- `/pay` → Console bisa update status lokal + generate mock payment intent. Setelah Terminal ready, tambahkan forwarding.
- `/cancel` → Console bisa update status lokal saja. Terminal akan auto-expire held bookings berdasarkan TTL.

### Fase 3 — Polish

- Admin dashboard untuk manage vouchers
- Admin dashboard untuk manage payment methods
- Reconciliation logic untuk booking yang cancel di Console tapi belum sync ke Terminal

---

## Pertanyaan untuk Tim TransityApp

1. **Format `holdExpiresAt`:** Apakah selalu dalam UTC ISO 8601? Atau perlu timezone WIB?
2. **Voucher scope:** Apakah voucher berlaku per operator atau platform-wide? Atau keduanya?
3. **Payment di level mana:** Apakah payment processing (generate QR, VA, dll) dilakukan di Console atau di Terminal? Ini menentukan apakah `/pay` perlu forward ke Terminal atau cukup di Console.
4. **Cancel policy:** Apakah booking yang sudah `confirmed` (sudah dibayar) bisa di-cancel? Atau hanya yang `held`?
5. **Booking list scope:** Apakah `GET /gateway/bookings` harus support filter by status, date range, dll? Atau cukup list semua?

## Pertanyaan untuk Tim Terminal

1. **Hold booking:** Apakah Terminal sudah mengimplementasikan booking tanpa paymentMethod (hold-only)?
2. **Pay endpoint:** Apakah bisa menambahkan `POST /api/app/bookings/:id/pay`? Apa timeline-nya?
3. **Cancel endpoint:** Apakah bisa menambahkan `POST /api/app/bookings/:id/cancel`? Apa timeline-nya?
4. **Hold auto-expire:** Apakah Terminal sudah auto-expire held bookings setelah `holdExpiresAt`?
