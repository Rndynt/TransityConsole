import { pgTable, text, numeric, timestamp, uuid, date, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bookingsTable = pgTable("bookings", {
  // [A] Identitas & relasi
  id:                      uuid("id").primaryKey().defaultRandom(),
  operatorId:              uuid("operator_id").notNull(),
  operatorName:            text("operator_name").notNull(),
  customerId:              uuid("customer_id"),
  externalBookingId:       text("external_booking_id"),
  idempotencyKey:          text("idempotency_key"),

  // [B] Trip snapshot — disimpan permanen, tidak bergantung trip aktif
  tripId:                  text("trip_id").notNull(),
  serviceDate:             date("service_date"),
  departureDate:           date("departure_date").notNull(),
  origin:                  text("origin").notNull(),
  destination:             text("destination").notNull(),
  originStopId:            text("origin_stop_id"),
  originName:              text("origin_name"),
  originCity:              text("origin_city"),
  departAt:                text("depart_at"),
  destinationStopId:       text("destination_stop_id"),
  destinationName:         text("destination_name"),
  destinationCity:         text("destination_city"),
  arriveAt:                text("arrive_at"),
  patternName:             text("pattern_name"),

  // [C] Data penumpang
  passengerName:           text("passenger_name").notNull(),
  passengerPhone:          text("passenger_phone").notNull(),
  seatNumbers:             text("seat_numbers").array().notNull().default([]),
  passengersJson:          text("passengers_json"),

  // [D] Keuangan
  farePerPerson:           numeric("fare_per_person", { precision: 12, scale: 2 }),
  totalAmount:             numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  commissionAmount:        numeric("commission_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  discountAmount:          numeric("discount_amount", { precision: 12, scale: 2 }),
  finalAmount:             numeric("final_amount", { precision: 12, scale: 2 }),
  voucherCode:             text("voucher_code"),

  // [E] Status & payment flow
  status:                  text("status").notNull().default("pending"),
  paymentMethod:           text("payment_method"),
  providerRef:             text("provider_ref"),
  holdExpiresAt:           timestamp("hold_expires_at", { withTimezone: true }),
  terminalNotified:        boolean("terminal_notified").notNull().default(false),
  terminalNotifyFailedAt:  timestamp("terminal_notify_failed_at", { withTimezone: true }),

  // [F] Metadata
  createdAt:               timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
