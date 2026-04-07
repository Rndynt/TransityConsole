# Requirement Update: TransityTerminal — Booking Flow

> Dokumen ini berisi daftar perubahan yang **wajib** dilakukan di TransityTerminal agar booking flow (hold → pay → cancel) dari TransityConsole berfungsi dengan benar.
>
> **Prioritas:** CRITICAL — tanpa perubahan ini, fitur pembayaran dan pembatalan booking dari TransityApp melalui Console tidak akan berjalan.
>
> **Referensi kode Terminal:** https://github.com/Rndynt/TransityTerminal

---

## Flow Booking dari Perspektif Customer TransityApp

```
Customer di TransityApp
    │
    │  1. Cari trip → pilih jadwal → pilih kursi
    │
    │  2. Masuk halaman pembayaran
    │     ↓
    │  Console: POST /api/app/bookings (TANPA paymentMethod)
    │     → Terminal buat booking status "held", kursi ditahan
    │     → Terminal return: { id, status: "held", totalAmount, holdExpiresAt }
    │     → Customer lihat ringkasan booking + pilih metode bayar
    │
    │  3. Customer pilih metode bayar & konfirmasi
    │     ↓
    │  Console: POST /api/app/bookings/:id/pay { paymentMethod, amount }
    │     → Terminal proses pembayaran, update status "confirmed"
    │     → Terminal return: { status, paymentIntent, qrData }
    │     → Customer terima boarding pass / QR code
    │
    │  4. (Opsional) Customer batal sebelum bayar
    │     ↓
    │  Console: POST /api/app/bookings/:id/cancel
    │     → Terminal batalkan booking, lepas kursi
    │     → Terminal return: { status: "cancelled" }
```

**Penting:**
- `customerId` TIDAK dikirim ke Terminal. Itu data pelanggan Transity (Console/App level). Terminal hanya terima data operasional: trip, penumpang, kursi.
- Console yang menyimpan relasi booking ↔ customer di database Console sendiri.
- Diskon dari voucher platform Transity dihitung di Console. Terminal menerima `amount` yang sudah final (bisa lebih kecil dari `totalAmount` asli).

---

## Ringkasan Gap

| # | Masalah | Severity | File Terdampak |
|---|---------|----------|----------------|
| 1 | Endpoint `POST /api/app/bookings/:id/pay` **belum ada** | 🔴 CRITICAL | `app.routes.ts`, `app.controller.ts`, `app.service.ts` |
| 2 | `paymentMethod` di `POST /api/app/bookings` **wajib** (harus opsional) | 🔴 CRITICAL | `app.controller.ts` (createBookingSchema) |
| 3 | `POST /api/app/bookings/:id/cancel` **hanya terima customer JWT**, tidak terima `X-Service-Key` | 🟡 HIGH | `app.routes.ts` |
| 4 | `GET /api/app/bookings/:id` **hanya terima customer JWT**, tidak terima `X-Service-Key` | 🟡 HIGH | `app.routes.ts` |

---

## Detail Perubahan

### 1. 🔴 CRITICAL — Tambah Endpoint `POST /api/app/bookings/:id/pay`

**Masalah:** Console memforward pembayaran dari TransityApp ke Terminal melalui `POST /api/app/bookings/:id/pay`. Endpoint ini **belum ada** di Terminal.

**Yang dibutuhkan:**

```
POST /api/app/bookings/:bookingId/pay
X-Service-Key: <service-key>
Content-Type: application/json
```

**Request Body:**
```json
{
  "paymentMethod": "QRIS",
  "amount": 150000
}
```

| Field | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `paymentMethod` | `string` | ✅ | Metode pembayaran (QRIS, GOPAY, OVO, DANA, SHOPEEPAY, VA_BCA, VA_MANDIRI, VA_BNI, BANK_TRANSFER) |
| `amount` | `number` | ✅ | Jumlah yang dibayar. Bisa lebih kecil dari `totalAmount` jika ada diskon di level Console (voucher platform) |

**Response `200 OK`:**
```json
{
  "status": "confirmed",
  "paymentIntent": {
    "paymentId": "pay-xxx",
    "providerRef": "provider-xxx",
    "method": "QRIS",
    "amount": 150000
  },
  "qrData": [
    {
      "passengerId": "p-001",
      "seatNo": "A1",
      "qrToken": "...",
      "qrPayload": "..."
    }
  ]
}
```

| Field Response | Tipe | Wajib | Keterangan |
|---|---|---|---|
| `status` | `string` | ✅ | Status setelah bayar: `confirmed` atau `pending` |
| `paymentIntent` | `object` | — | Detail pembayaran (paymentId, providerRef, method, amount) |
| `qrData` | `array` | — | QR boarding pass per penumpang (jika ada) |

**Error yang diharapkan:**
- `400` — Booking bukan status `held`, atau hold sudah expired
- `404` — Booking tidak ditemukan

**Implementasi yang disarankan:**

Di `app.routes.ts`:
```typescript
app.post('/api/app/bookings/:id/pay', { preHandler: [bookingAuthMiddleware] },
  async (req, reply) => appController.payBooking(req, reply));
```

Di `app.controller.ts`:
```typescript
const payBookingSchema = z.object({
  paymentMethod: z.string().min(1),
  amount: z.number().positive()
});

async payBooking(req: FastifyRequest, reply: FastifyReply) {
  const parsed = payBookingSchema.safeParse(req.body);
  if (!parsed.success) return reply.code(400).send({ error: "Validation failed", details: parsed.error.flatten() });
  try {
    const result = await this.service.payBooking(req.params.id, parsed.data);
    reply.send(result);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    if (msg.includes('not found')) return reply.code(404).send({ error: msg });
    reply.code(400).send({ error: msg });
  }
}
```

Di `app.service.ts`:
```typescript
async payBooking(bookingId: string, data: { paymentMethod: string; amount: number }) {
  // 1. Cari booking, pastikan status === 'held'
  // 2. Cek holdExpiresAt belum lewat
  // 3. Buat payment record dengan method dan amount dari request
  // 4. Update booking status ke 'confirmed'
  // 5. Generate QR boarding pass
  // 6. Return { status, paymentIntent, qrData }
}
```

---

### 2. 🔴 CRITICAL — `paymentMethod` di Create Booking Harus Opsional

**Masalah:** Di `app.controller.ts`, schema validasi `createBookingSchema` mendefinisikan:
```typescript
paymentMethod: z.enum(['qr', 'ewallet', 'bank'])  // ← WAJIB
```

Console mengirim booking **tanpa** `paymentMethod` agar booking dibuat dalam status `held`. Dengan schema saat ini, request tanpa `paymentMethod` akan ditolak dengan error validasi.

**Yang dibutuhkan:**

Ubah menjadi opsional:
```typescript
paymentMethod: z.enum(['qr', 'ewallet', 'bank']).optional()
```

**Logika di service:**
- Jika `paymentMethod` **ada** → langsung proses pembayaran, status `confirmed`/`pending`
- Jika `paymentMethod` **tidak ada** → booking dibuat dalam status `held`, kembalikan `holdExpiresAt` (misalnya 15-20 menit dari sekarang)

Ini sudah sesuai dengan spesifikasi di `TRANSITY_TERMINAL_SPEC.md` bagian "POST /api/app/bookings — Buat Booking (Hold)".

---

### 3. 🟡 HIGH — Cancel Booking Harus Terima `X-Service-Key`

**Masalah:** Di `app.routes.ts`:
```typescript
app.post('/api/app/bookings/:id/cancel', { preHandler: [appAuthMiddleware] }, ...)
```

Route ini hanya menerima customer JWT (`appAuthMiddleware`). Tapi Console memanggil endpoint ini dengan `X-Service-Key` (karena Console yang memforward request cancel dari TransityApp).

**Yang dibutuhkan:**

Ganti `appAuthMiddleware` dengan `bookingAuthMiddleware` yang sudah ada (fungsi ini menerima baik `X-Service-Key` maupun customer JWT):

```typescript
app.post('/api/app/bookings/:id/cancel', { preHandler: [bookingAuthMiddleware] },
  async (req, reply) => appController.cancelBooking(req, reply));
```

**Catatan:** Di `cancelBooking` controller/service, perlu handle case ketika `req.appUser` tidak ada (karena request via service key tidak punya user context). Misalnya:

```typescript
async cancelBooking(req: FastifyRequest, reply: FastifyReply) {
  try {
    const isServiceClient = (req as any).isServiceClient === true;
    const userId = isServiceClient ? null : req.appUser?.userId;
    await this.service.cancelBooking(req.params.id, userId);
    reply.send({ status: 'cancelled' });
  } catch (e: unknown) {
    reply.code(400).send({ error: errMsg(e) });
  }
}
```

Di service, jika `userId` adalah `null` (service client), skip ownership check:
```typescript
async cancelBooking(bookingId: string, userId: string | null) {
  const booking = await this.getBookingOrThrow(bookingId);
  if (userId && booking.userId !== userId) throw new Error("Unauthorized");
  // ... proses cancel
}
```

---

### 4. 🟡 HIGH — Get Booking Detail Harus Terima `X-Service-Key`

**Masalah:** Di `app.routes.ts`:
```typescript
app.get('/api/app/bookings/:id', { preHandler: [appAuthMiddleware] }, ...)
```

Console perlu mengambil detail booking via `X-Service-Key` untuk sinkronisasi/rekonsiliasi data. Saat ini hanya menerima customer JWT.

**Yang dibutuhkan:**

Sama seperti cancel, ganti dengan `bookingAuthMiddleware`:
```typescript
app.get('/api/app/bookings/:id', { preHandler: [bookingAuthMiddleware] },
  async (req, reply) => appController.getBookingDetail(req, reply));
```

Dan handle service client di controller:
```typescript
async getBookingDetail(req: FastifyRequest, reply: FastifyReply) {
  try {
    const isServiceClient = (req as any).isServiceClient === true;
    const userId = isServiceClient ? null : req.appUser?.userId;
    const detail = await this.service.getBookingDetail(req.params.id, userId);
    reply.send(detail);
  } catch (e: unknown) {
    // ...
  }
}
```

---

## Response Format yang Diharapkan Console

Console mengharapkan response format berikut dari endpoint baru/yang diubah:

### POST /api/app/bookings (tanpa paymentMethod)
```json
{
  "id": "booking-uuid-xxx",
  "status": "held",
  "totalAmount": 200000,
  "holdExpiresAt": "2026-04-15T10:20:00Z",
  "passengers": [
    { "passengerId": "p-001", "fullName": "Budi Santoso", "seatNo": "A1" }
  ]
}
```

### POST /api/app/bookings/:id/pay
```json
{
  "status": "confirmed",
  "paymentIntent": {
    "paymentId": "pay-xxx",
    "providerRef": "provider-xxx",
    "method": "QRIS",
    "amount": 150000
  },
  "qrData": [
    { "passengerId": "p-001", "seatNo": "A1", "qrToken": "...", "qrPayload": "..." }
  ]
}
```

### POST /api/app/bookings/:id/cancel
```json
{
  "status": "cancelled"
}
```

---

## Checklist Implementasi

- [x] Tambah `POST /api/app/bookings/:id/pay` route + controller + service ✅ **DONE by Terminal**
- [x] Ubah `paymentMethod` di `createBookingSchema` dari wajib menjadi opsional ✅ **DONE by Terminal**
- [x] Handle booking tanpa `paymentMethod`: buat status `held` + set `holdExpiresAt` ✅ **DONE by Terminal**
- [x] Ganti middleware di `POST /api/app/bookings/:id/cancel` untuk terima `X-Service-Key` ✅ **DONE by Terminal**
- [x] Ganti middleware di `GET /api/app/bookings/:id` untuk terima `X-Service-Key` ✅ **DONE by Terminal**
- [x] Handle `userId: null` di cancel dan getBookingDetail service ✅ **DONE by Terminal**
- [x] `GET /api/app/payments/methods` — endpoint metode pembayaran ✅ **DONE by Terminal**
- [x] `POST /api/app/vouchers/validate` — endpoint validasi voucher operator ✅ **DONE by Terminal**

## Checklist Adaptasi Console

- [x] Pay endpoint: kirim `{ paymentMethod, voucherCode }` ke Terminal (bukan `{ paymentMethod, amount }`) ✅ **DONE**
- [x] Payment methods: proxy dari Terminal per operator (bukan static list) ✅ **DONE**
- [x] Cancel booking: izinkan status `confirmed` selain `held`/`pending` ✅ **DONE**
- [x] Voucher validation: support platform (Console) + operator (Terminal) dengan fallthrough ✅ **DONE**
- [x] Pay flow: platform voucher di-handle Console, operator voucher di-forward ke Terminal ✅ **DONE**
- [x] Response mapping: gunakan `discountAmount`/`finalAmount` dari Terminal untuk operator voucher ✅ **DONE**

---

## Status

✅ **SELESAI** — Semua perubahan Terminal sudah diimplementasikan. Console sudah diadaptasi sesuai API Terminal terbaru (per 7 April 2026).
