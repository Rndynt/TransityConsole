import { eq, desc, and, gte, sql } from "drizzle-orm";
import { db, operatorsTable, bookingsTable, terminalHealthTable } from "@workspace/db";

export async function getGlobalSummaryStats(todayStr: string) {
  return Promise.all([
    db.select({
      total: sql<number>`count(*)`,
      active: sql<number>`sum(case when active = true then 1 else 0 end)`,
    }).from(operatorsTable),
    db.select({
      total: sql<number>`count(*)`,
      totalRevenue: sql<number>`coalesce(sum(total_amount::numeric), 0)`,
    }).from(bookingsTable),
    db.select({
      count: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(total_amount::numeric), 0)`,
    }).from(bookingsTable).where(gte(bookingsTable.departureDate, todayStr)),
    db.select({ id: operatorsTable.id }).from(operatorsTable).where(eq(operatorsTable.active, true)),
  ]);
}

export async function getLatestHealthForOperator(operatorId: string) {
  const [record] = await db
    .select()
    .from(terminalHealthTable)
    .where(eq(terminalHealthTable.operatorId, operatorId))
    .orderBy(desc(terminalHealthTable.checkedAt))
    .limit(1);
  return record ?? null;
}

export async function getAllOperators() {
  return db.select().from(operatorsTable);
}

export async function getOperatorBookingStats(operatorId: string, sinceStr: string) {
  const [[stats], [latestHealth], allHealth] = await Promise.all([
    db.select({
      count: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(total_amount::numeric), 0)`,
    }).from(bookingsTable).where(
      and(eq(bookingsTable.operatorId, operatorId), gte(bookingsTable.departureDate, sinceStr))
    ),
    db.select().from(terminalHealthTable)
      .where(eq(terminalHealthTable.operatorId, operatorId))
      .orderBy(desc(terminalHealthTable.checkedAt))
      .limit(1),
    db.select().from(terminalHealthTable).where(eq(terminalHealthTable.operatorId, operatorId)),
  ]);
  return { stats, latestHealth, allHealth };
}

export async function getAvgCommission() {
  const [result] = await db.select({
    avgCommission: sql<number>`coalesce(avg(commission_pct::numeric), 0)`,
  }).from(operatorsTable);
  return parseFloat(String(result?.avgCommission ?? 0));
}

export async function getDailyBookingStats(dateStr: string) {
  const [stats] = await db.select({
    revenue: sql<number>`coalesce(sum(total_amount::numeric), 0)`,
    count: sql<number>`count(*)`,
  }).from(bookingsTable).where(eq(bookingsTable.departureDate, dateStr));
  return stats;
}
