import { pgTable, text, numeric, timestamp, uuid, date } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const bookingsTable = pgTable("bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull(),
  operatorName: text("operator_name").notNull(),
  customerId: uuid("customer_id"),
  passengerName: text("passenger_name").notNull(),
  passengerPhone: text("passenger_phone").notNull(),
  tripId: text("trip_id").notNull(),
  origin: text("origin").notNull(),
  destination: text("destination").notNull(),
  departureDate: date("departure_date").notNull(),
  seatNumbers: text("seat_numbers").array().notNull().default([]),
  totalAmount: numeric("total_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  commissionAmount: numeric("commission_amount", { precision: 12, scale: 2 }).notNull().default("0"),
  discountAmount: numeric("discount_amount", { precision: 12, scale: 2 }),
  finalAmount: numeric("final_amount", { precision: 12, scale: 2 }),
  voucherCode: text("voucher_code"),
  externalBookingId: text("external_booking_id"),
  status: text("status").notNull().default("pending"),
  providerRef: text("provider_ref"),
  holdExpiresAt: timestamp("hold_expires_at", { withTimezone: true }),
  paymentMethod: text("payment_method"),
  passengersJson: text("passengers_json"),
  originStopId: text("origin_stop_id"),
  destinationStopId: text("destination_stop_id"),
  serviceDate: date("service_date"),
  idempotencyKey: text("idempotency_key"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBookingSchema = createInsertSchema(bookingsTable).omit({
  id: true,
  createdAt: true,
});
export type InsertBooking = z.infer<typeof insertBookingSchema>;
export type Booking = typeof bookingsTable.$inferSelect;
