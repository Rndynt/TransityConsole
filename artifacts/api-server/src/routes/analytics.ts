import { Router, type IRouter } from "express";
import { eq, desc, sql, and, gte } from "drizzle-orm";
import { db, operatorsTable, bookingsTable, terminalHealthTable } from "@workspace/db";
import { GetOperatorAnalyticsQueryParams, GetRevenueAnalyticsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/analytics/summary", async (_req, res): Promise<void> => {
  const [opStats] = await db.select({
    total: sql<number>`count(*)`,
    active: sql<number>`sum(case when active = true then 1 else 0 end)`,
  }).from(operatorsTable);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const [bookingStats] = await db.select({
    total: sql<number>`count(*)`,
    totalRevenue: sql<number>`coalesce(sum(total_amount::numeric), 0)`,
  }).from(bookingsTable);

  const [bookingToday] = await db.select({
    count: sql<number>`count(*)`,
    revenue: sql<number>`coalesce(sum(total_amount::numeric), 0)`,
  }).from(bookingsTable).where(gte(bookingsTable.departureDate, todayStr));

  // Count online terminals (latest health entry per operator)
  const operators = await db.select({ id: operatorsTable.id }).from(operatorsTable).where(eq(operatorsTable.active, true));
  let onlineCount = 0;
  let totalLatency = 0;
  let latencyCount = 0;
  for (const op of operators) {
    const [latest] = await db
      .select()
      .from(terminalHealthTable)
      .where(eq(terminalHealthTable.operatorId, op.id))
      .orderBy(desc(terminalHealthTable.checkedAt))
      .limit(1);
    if (latest?.status === "online") onlineCount++;
    if (latest?.latencyMs) {
      totalLatency += parseFloat(String(latest.latencyMs));
      latencyCount++;
    }
  }

  res.json({
    totalOperators: Number(opStats?.total ?? 0),
    activeOperators: Number(opStats?.active ?? 0),
    onlineTerminals: onlineCount,
    totalBookings: Number(bookingStats?.total ?? 0),
    bookingsToday: Number(bookingToday?.count ?? 0),
    totalRevenue: parseFloat(String(bookingStats?.totalRevenue ?? 0)),
    revenueToday: parseFloat(String(bookingToday?.revenue ?? 0)),
    avgLatencyMs: latencyCount > 0 ? totalLatency / latencyCount : null,
  });
});

router.get("/analytics/operators", async (req, res): Promise<void> => {
  const parsed = GetOperatorAnalyticsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const period = parsed.data.period ?? "30d";
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];

  const operators = await db.select().from(operatorsTable);

  const result = await Promise.all(operators.map(async (op) => {
    const [stats] = await db.select({
      count: sql<number>`count(*)`,
      revenue: sql<number>`coalesce(sum(total_amount::numeric), 0)`,
    }).from(bookingsTable).where(
      and(eq(bookingsTable.operatorId, op.id), gte(bookingsTable.departureDate, sinceStr))
    );

    const [latestHealth] = await db
      .select()
      .from(terminalHealthTable)
      .where(eq(terminalHealthTable.operatorId, op.id))
      .orderBy(desc(terminalHealthTable.checkedAt))
      .limit(1);

    const allHealth = await db
      .select()
      .from(terminalHealthTable)
      .where(eq(terminalHealthTable.operatorId, op.id));
    const uptimePct = allHealth.length > 0
      ? (allHealth.filter(h => h.status === "online").length / allHealth.length) * 100
      : 0;

    const revenue = parseFloat(String(stats?.revenue ?? 0));
    const commissionEarned = revenue * (parseFloat(String(op.commissionPct)) / 100);

    return {
      operatorId: op.id,
      operatorName: op.name,
      operatorSlug: op.slug,
      bookingCount: Number(stats?.count ?? 0),
      revenue,
      commissionEarned,
      avgLatencyMs: latestHealth?.latencyMs ? parseFloat(String(latestHealth.latencyMs)) : null,
      uptimePct: Math.round(uptimePct * 10) / 10,
    };
  }));

  res.json(result);
});

router.get("/analytics/revenue", async (req, res): Promise<void> => {
  const parsed = GetRevenueAnalyticsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const period = parsed.data.period ?? "30d";
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;

  const result = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const dateStr = d.toISOString().split("T")[0];

    const [stats] = await db.select({
      revenue: sql<number>`coalesce(sum(total_amount::numeric), 0)`,
      count: sql<number>`count(*)`,
    }).from(bookingsTable).where(eq(bookingsTable.departureDate, dateStr));

    const revenue = parseFloat(String(stats?.revenue ?? 0));
    // Approximate commission (average of all operators)
    const [opStats] = await db.select({
      avgCommission: sql<number>`coalesce(avg(commission_pct::numeric), 0)`,
    }).from(operatorsTable);
    const avgCommPct = parseFloat(String(opStats?.avgCommission ?? 0));
    const commission = revenue * (avgCommPct / 100);

    result.push({
      date: dateStr,
      revenue,
      commission,
      bookingCount: Number(stats?.count ?? 0),
    });
  }

  res.json(result);
});

export default router;
