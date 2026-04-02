import * as repo from "./analytics.repository.js";

export async function getSummary() {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const todayStr = today.toISOString().split("T")[0];

  const [[opStats], [bookingStats], [bookingToday], operators] = await repo.getGlobalSummaryStats(todayStr);

  let onlineCount = 0;
  let totalLatency = 0;
  let latencyCount = 0;

  for (const op of operators) {
    const latest = await repo.getLatestHealthForOperator(op.id);
    if (latest?.status === "online") onlineCount++;
    if (latest?.latencyMs) {
      totalLatency += parseFloat(String(latest.latencyMs));
      latencyCount++;
    }
  }

  return {
    totalOperators: Number(opStats?.total ?? 0),
    activeOperators: Number(opStats?.active ?? 0),
    onlineTerminals: onlineCount,
    totalBookings: Number(bookingStats?.total ?? 0),
    bookingsToday: Number(bookingToday?.count ?? 0),
    totalRevenue: parseFloat(String(bookingStats?.totalRevenue ?? 0)),
    totalCommission: parseFloat(String((bookingStats as { totalCommission?: number } | undefined)?.totalCommission ?? 0)),
    revenueToday: parseFloat(String(bookingToday?.revenue ?? 0)),
    avgLatencyMs: latencyCount > 0 ? totalLatency / latencyCount : null,
  };
}

export async function getOperatorBreakdown(period: "7d" | "30d" | "90d") {
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const since = new Date();
  since.setDate(since.getDate() - days);
  const sinceStr = since.toISOString().split("T")[0];

  const operators = await repo.getAllOperators();

  return Promise.all(operators.map(async (op) => {
    const { stats, latestHealth, allHealth } = await repo.getOperatorBookingStats(op.id, sinceStr);
    const uptimePct = allHealth.length > 0
      ? (allHealth.filter(h => h.status === "online").length / allHealth.length) * 100
      : 0;
    const revenue = parseFloat(String(stats?.revenue ?? 0));
    const commissionEarned = parseFloat(String((stats as { commission?: number } | undefined)?.commission ?? 0));

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
}

export async function getRevenueTrend(period: "7d" | "30d" | "90d") {
  const days = period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const avgCommPct = await repo.getAvgCommission();

  const dateRange = Array.from({ length: days }, (_, i) => {
    const d = new Date();
    d.setDate(d.getDate() - (days - 1 - i));
    return d.toISOString().split("T")[0];
  });

  return Promise.all(dateRange.map(async (dateStr) => {
    const stats = await repo.getDailyBookingStats(dateStr);
    const revenue = parseFloat(String(stats?.revenue ?? 0));
    return {
      date: dateStr,
      revenue,
      commission: revenue * (avgCommPct / 100),
      bookingCount: Number(stats?.count ?? 0),
    };
  }));
}
