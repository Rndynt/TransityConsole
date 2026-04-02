import { pgTable, text, numeric, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const terminalHealthTable = pgTable("terminal_health", {
  id: uuid("id").primaryKey().defaultRandom(),
  operatorId: uuid("operator_id").notNull(),
  status: text("status").notNull().default("offline"), // online | offline | degraded
  latencyMs: numeric("latency_ms", { precision: 10, scale: 2 }),
  checkedAt: timestamp("checked_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTerminalHealthSchema = createInsertSchema(terminalHealthTable).omit({
  id: true,
  checkedAt: true,
});
export type InsertTerminalHealth = z.infer<typeof insertTerminalHealthSchema>;
export type TerminalHealth = typeof terminalHealthTable.$inferSelect;
