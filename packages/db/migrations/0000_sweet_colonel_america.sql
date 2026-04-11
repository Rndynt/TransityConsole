-- =============================================================================
-- TransityConsole — Migration Utama
-- Urutan: berdasarkan dependensi FK dan prioritas operasional
-- 1. operators          — master data operator (tidak ada FK ke tabel lain)
-- 2. admin_users        — akun admin dashboard (tidak ada FK)
-- 3. api_keys           — API key untuk akses gateway (tidak ada FK)
-- 4. customers          — akun end-user TransityApp (tidak ada FK)
-- 5. terminal_health    — monitoring kesehatan terminal (FK → operators)
-- 6. bookings           — transaksi booking OTA (FK → operators, customers)
-- 7. vouchers           — voucher & promo (FK → operators)
-- =============================================================================


-- -----------------------------------------------------------------------------
-- 1. operators
--    Master data operator shuttle. Tabel pertama karena jadi FK di tabel lain.
--    webhook_secret: untuk HMAC signing notifikasi Console → terminal.
-- -----------------------------------------------------------------------------
CREATE TABLE "operators" (
	"id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name"           text NOT NULL,
	"slug"           text NOT NULL,
	"api_url"        text NOT NULL,
	"service_key"    text NOT NULL,
	"active"         boolean DEFAULT true NOT NULL,
	"logo_url"       text,
	"commission_pct" numeric(5, 2) DEFAULT '0' NOT NULL,
	"primary_color"  text,
	"webhook_secret" text,
	"created_at"     timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at"     timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "operators_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 2. admin_users
--    Akun login admin dashboard Console. Role: super_admin | admin | viewer.
-- -----------------------------------------------------------------------------
CREATE TABLE "admin_users" (
	"id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email"         text NOT NULL,
	"password_hash" text NOT NULL,
	"role"          text DEFAULT 'admin' NOT NULL,
	"created_at"    timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 3. api_keys
--    API key untuk TransityApp mengakses gateway endpoint Console.
--    key_hash: bcrypt hash — plaintext tidak disimpan.
--    prefix: 8 karakter pertama untuk identifikasi di dashboard.
--    scopes: array permission, misal ['gateway:read', 'gateway:write'].
-- -----------------------------------------------------------------------------
CREATE TABLE "api_keys" (
	"id"           uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name"         text NOT NULL,
	"key_hash"     text NOT NULL,
	"prefix"       text NOT NULL,
	"scopes"       text[] DEFAULT '{}' NOT NULL,
	"active"       boolean DEFAULT true NOT NULL,
	"last_used_at" timestamp with time zone,
	"expires_at"   timestamp with time zone,
	"created_at"   timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "api_keys_key_hash_unique" UNIQUE("key_hash")
);
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 4. customers
--    Akun end-user penumpang TransityApp. Satu akun berlaku untuk semua operator.
--    is_verified: text bukan boolean untuk fleksibilitas ('true'/'false'/'pending').
-- -----------------------------------------------------------------------------
CREATE TABLE "customers" (
	"id"            uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"full_name"     text NOT NULL,
	"email"         text NOT NULL,
	"phone"         text NOT NULL,
	"password_hash" text NOT NULL,
	"avatar_url"    text,
	"is_verified"   text DEFAULT 'false' NOT NULL,
	"last_login_at" timestamp with time zone,
	"created_at"    timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at"    timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "customers_email_unique" UNIQUE("email")
);
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 5. terminal_health
--    Riwayat ping kesehatan setiap terminal operator.
--    status: 'online' | 'offline' | 'degraded'
--    Diisi oleh scheduler background setiap 60 detik.
-- -----------------------------------------------------------------------------
CREATE TABLE "terminal_health" (
	"id"          uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id" uuid NOT NULL,
	"status"      text DEFAULT 'offline' NOT NULL,
	"latency_ms"  numeric(10, 2),
	"checked_at"  timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "terminal_health_operator_id_fk"
		FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE CASCADE
);
--> statement-breakpoint

CREATE INDEX "idx_terminal_health_operator_checked"
	ON "terminal_health" ("operator_id", "checked_at" DESC);
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 6. bookings
--    Semua transaksi booking yang diproses Console sebagai OTA gateway.
--    Dikelompokkan per blok fungsional:
--
--    [A] Identitas & relasi
--    [B] Trip snapshot (disimpan permanen, tidak bergantung trip aktif)
--    [C] Data penumpang
--    [D] Keuangan
--    [E] Status & payment flow
--    [F] Metadata teknis
--
--    Status lifecycle:
--      pending    : booking dibuat di terminal, belum dibayar (hold aktif)
--      confirmed  : pembayaran dikonfirmasi Console & terminal
--      cancelled  : dibatalkan oleh user atau sistem
--      expired    : hold habis tanpa pembayaran (di-set reconciler)
--      uncertain  : terminal timeout saat create, perlu reconciliation
-- -----------------------------------------------------------------------------
CREATE TABLE "bookings" (

	-- [A] Identitas & relasi
	"id"                        uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"operator_id"               uuid NOT NULL,
	"operator_name"             text NOT NULL,
	"customer_id"               uuid,
	"external_booking_id"       text,
	"idempotency_key"           text,

	-- [B] Trip snapshot
	"trip_id"                   text NOT NULL,
	"service_date"              date,
	"departure_date"            date NOT NULL,
	"origin"                    text NOT NULL,
	"destination"               text NOT NULL,
	"origin_stop_id"            text,
	"origin_name"               text,
	"origin_city"               text,
	"depart_at"                 text,
	"destination_stop_id"       text,
	"destination_name"          text,
	"destination_city"          text,
	"arrive_at"                 text,
	"pattern_name"              text,

	-- [C] Data penumpang
	"passenger_name"            text NOT NULL,
	"passenger_phone"           text NOT NULL,
	"seat_numbers"              text[] DEFAULT '{}' NOT NULL,
	"passengers_json"           text,

	-- [D] Keuangan
	"fare_per_person"           numeric(12, 2),
	"total_amount"              numeric(12, 2) DEFAULT '0' NOT NULL,
	"commission_amount"         numeric(12, 2) DEFAULT '0' NOT NULL,
	"discount_amount"           numeric(12, 2),
	"final_amount"              numeric(12, 2),
	"voucher_code"              text,

	-- [E] Status & payment flow
	"status"                    text DEFAULT 'pending' NOT NULL,
	"payment_method"            text,
	"provider_ref"              text,
	"hold_expires_at"           timestamp with time zone,
	"terminal_notified"         boolean DEFAULT false NOT NULL,
	"terminal_notify_failed_at" timestamp with time zone,

	-- [F] Metadata
	"created_at"                timestamp with time zone DEFAULT now() NOT NULL,

	CONSTRAINT "bookings_operator_id_fk"
		FOREIGN KEY ("operator_id") REFERENCES "operators"("id"),
	CONSTRAINT "bookings_customer_id_fk"
		FOREIGN KEY ("customer_id") REFERENCES "customers"("id")
);
--> statement-breakpoint

CREATE INDEX "idx_bookings_operator_id"
	ON "bookings" ("operator_id");
--> statement-breakpoint

CREATE INDEX "idx_bookings_customer_id"
	ON "bookings" ("customer_id");
--> statement-breakpoint

CREATE INDEX "idx_bookings_status"
	ON "bookings" ("status");
--> statement-breakpoint

CREATE INDEX "idx_bookings_departure_date"
	ON "bookings" ("departure_date");
--> statement-breakpoint

CREATE INDEX "idx_bookings_service_date"
	ON "bookings" ("service_date");
--> statement-breakpoint

-- Index parsial: reconciler cari pending yang hold-nya expired
CREATE INDEX "idx_bookings_pending_hold_expires"
	ON "bookings" ("hold_expires_at")
	WHERE "status" = 'pending';
--> statement-breakpoint

-- Index parsial: reconciler cari booking uncertain
CREATE INDEX "idx_bookings_uncertain_created"
	ON "bookings" ("created_at")
	WHERE "status" = 'uncertain';
--> statement-breakpoint

-- Index parsial: retry notifikasi terminal yang gagal
CREATE INDEX "idx_bookings_terminal_not_notified"
	ON "bookings" ("id")
	WHERE "status" = 'confirmed' AND "terminal_notified" = false;
--> statement-breakpoint

-- Unique parsial: idempotency key (hanya jika tidak null)
CREATE UNIQUE INDEX "idx_bookings_idempotency_key"
	ON "bookings" ("idempotency_key")
	WHERE "idempotency_key" IS NOT NULL;
--> statement-breakpoint

-- Index untuk lookup webhook berdasarkan provider_ref
CREATE INDEX "idx_bookings_provider_ref"
	ON "bookings" ("provider_ref")
	WHERE "provider_ref" IS NOT NULL;
--> statement-breakpoint


-- -----------------------------------------------------------------------------
-- 7. vouchers
--    Voucher & promo platform-level yang dikelola Console (bukan per-Terminal).
--    operator_id nullable: null = berlaku semua operator.
--    discount_type: 'percentage' | 'fixed'
-- -----------------------------------------------------------------------------
CREATE TABLE "vouchers" (
	"id"             uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code"           text NOT NULL,
	"discount_type"  text NOT NULL,
	"discount_value" numeric(12, 2) NOT NULL,
	"min_purchase"   numeric(12, 2),
	"max_discount"   numeric(12, 2),
	"valid_from"     timestamp with time zone NOT NULL,
	"valid_until"    timestamp with time zone NOT NULL,
	"usage_limit"    integer,
	"used_count"     integer DEFAULT 0 NOT NULL,
	"operator_id"    uuid,
	"active"         boolean DEFAULT true NOT NULL,
	"created_at"     timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vouchers_code_unique" UNIQUE("code"),
	CONSTRAINT "vouchers_operator_id_fk"
		FOREIGN KEY ("operator_id") REFERENCES "operators"("id") ON DELETE SET NULL
);
--> statement-breakpoint

CREATE INDEX "idx_vouchers_code"
	ON "vouchers" ("code");
--> statement-breakpoint

CREATE INDEX "idx_vouchers_active_valid"
	ON "vouchers" ("active", "valid_from", "valid_until")
	WHERE "active" = true;
