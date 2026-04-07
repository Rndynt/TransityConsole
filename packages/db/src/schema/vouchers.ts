import { pgTable, text, numeric, timestamp, uuid, integer, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const vouchersTable = pgTable("vouchers", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  discountType: text("discount_type").notNull(),
  discountValue: numeric("discount_value", { precision: 12, scale: 2 }).notNull(),
  minPurchase: numeric("min_purchase", { precision: 12, scale: 2 }),
  maxDiscount: numeric("max_discount", { precision: 12, scale: 2 }),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  usageLimit: integer("usage_limit"),
  usedCount: integer("used_count").notNull().default(0),
  operatorId: uuid("operator_id"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertVoucherSchema = createInsertSchema(vouchersTable).omit({
  id: true,
  createdAt: true,
  usedCount: true,
});
export type InsertVoucher = z.infer<typeof insertVoucherSchema>;
export type Voucher = typeof vouchersTable.$inferSelect;
