import { useState } from "react";
import {
  useGetOperatorAnalytics,
  getGetOperatorAnalyticsQueryKey,
  useGetRevenueAnalytics,
  getGetRevenueAnalyticsQueryKey,
  useGetAnalyticsSummary,
  getGetAnalyticsSummaryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";

type Period = "7d" | "30d" | "90d";

function formatCurrency(amount: number) {
  if (amount >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}K`;
  return `Rp ${amount}`;
}

export default function AnalyticsDashboard() {
  const [period, setPeriod] = useState<Period>("30d");

  const { data: summary, isLoading: summaryLoading } = useGetAnalyticsSummary({
    query: { queryKey: getGetAnalyticsSummaryQueryKey() },
  });

  const { data: revenueData, isLoading: revenueLoading } = useGetRevenueAnalytics(
    { period },
    { query: { queryKey: getGetRevenueAnalyticsQueryKey({ period }) } }
  );

  const { data: operatorData, isLoading: operatorLoading } = useGetOperatorAnalytics(
    { period },
    { query: { queryKey: getGetOperatorAnalyticsQueryKey({ period }) } }
  );

  const operators = Array.isArray(operatorData) ? operatorData : [];
  const revenue = Array.isArray(revenueData) ? revenueData : [];

  const revenueChartData = revenue.map((r) => ({
    date: r.date.slice(5),
    Revenue: Math.round(r.revenue),
    Commission: Math.round(r.commission),
    Bookings: r.bookingCount,
  }));

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Analytics</h1>
          <p className="text-muted-foreground mt-1">Revenue, commission, and operator performance.</p>
        </div>
        <Select value={period} onValueChange={(v) => setPeriod(v as Period)}>
          <SelectTrigger className="w-36" data-testid="select-period">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="7d">Last 7 days</SelectItem>
            <SelectItem value="30d">Last 30 days</SelectItem>
            <SelectItem value="90d">Last 90 days</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Summary stats */}
      {summaryLoading ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Card key={i}><CardContent className="p-5"><Skeleton className="h-12 w-full" /></CardContent></Card>)}
        </div>
      ) : summary ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Revenue</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold font-display">{formatCurrency(summary.totalRevenue)}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Total Bookings</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold font-display">{summary.totalBookings.toLocaleString()}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Active Operators</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold font-display">{summary.activeOperators}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-1"><CardTitle className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Terminals Online</CardTitle></CardHeader>
            <CardContent><div className="text-2xl font-bold font-display text-emerald-600">{summary.onlineTerminals}</div></CardContent>
          </Card>
        </div>
      ) : null}

      {/* Revenue chart */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Revenue & Commission Trend</CardTitle>
          <CardDescription>Daily breakdown for the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          {revenueLoading ? (
            <Skeleton className="h-64 w-full" />
          ) : (
            <ResponsiveContainer width="100%" height={280}>
              <AreaChart data={revenueChartData}>
                <defs>
                  <linearGradient id="colorRevenue" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(170, 75%, 18%)" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="hsl(170, 75%, 18%)" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="colorCommission" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="hsl(16, 80%, 58%)" stopOpacity={0.15} />
                    <stop offset="95%" stopColor="hsl(16, 80%, 58%)" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(160, 12%, 89%)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tickFormatter={(v) => formatCurrency(v)} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip
                  formatter={(value: number, name: string) => [formatCurrency(value), name]}
                  contentStyle={{ fontSize: 12, borderRadius: 8 }}
                />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Area type="monotone" dataKey="Revenue" stroke="hsl(170, 75%, 18%)" strokeWidth={2} fill="url(#colorRevenue)" />
                <Area type="monotone" dataKey="Commission" stroke="hsl(16, 80%, 58%)" strokeWidth={2} fill="url(#colorCommission)" />
              </AreaChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>

      {/* Per-operator table */}
      <Card>
        <CardHeader>
          <CardTitle className="font-display">Operator Performance</CardTitle>
          <CardDescription>Breakdown by operator for the selected period</CardDescription>
        </CardHeader>
        <CardContent>
          {operatorLoading ? (
            <div className="space-y-2">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
          ) : operators.length === 0 ? (
            <p className="text-muted-foreground text-sm py-8 text-center">No data available.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b">
                    <th className="text-left py-3 px-2 text-muted-foreground font-medium">Operator</th>
                    <th className="text-right py-3 px-2 text-muted-foreground font-medium">Bookings</th>
                    <th className="text-right py-3 px-2 text-muted-foreground font-medium">Revenue</th>
                    <th className="text-right py-3 px-2 text-muted-foreground font-medium">Commission</th>
                    <th className="text-right py-3 px-2 text-muted-foreground font-medium">Uptime</th>
                    <th className="text-right py-3 px-2 text-muted-foreground font-medium">Latency</th>
                  </tr>
                </thead>
                <tbody>
                  {operators.map((op) => (
                    <tr key={op.operatorId} className="border-b last:border-0 hover:bg-muted/30 transition-colors" data-testid={`row-operator-${op.operatorId}`}>
                      <td className="py-3 px-2 font-medium font-display">{op.operatorName}</td>
                      <td className="py-3 px-2 text-right tabular-nums">{op.bookingCount}</td>
                      <td className="py-3 px-2 text-right tabular-nums">{formatCurrency(op.revenue)}</td>
                      <td className="py-3 px-2 text-right tabular-nums text-accent">{formatCurrency(op.commissionEarned)}</td>
                      <td className="py-3 px-2 text-right">
                        <span className={cn("font-medium", op.uptimePct >= 95 ? "text-emerald-600" : op.uptimePct >= 80 ? "text-amber-600" : "text-red-600")}>
                          {op.uptimePct.toFixed(1)}%
                        </span>
                      </td>
                      <td className="py-3 px-2 text-right tabular-nums text-muted-foreground">
                        {op.avgLatencyMs !== null && op.avgLatencyMs !== undefined ? `${Math.round(op.avgLatencyMs)}ms` : "-"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Booking distribution chart */}
      {!revenueLoading && revenueChartData.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="font-display">Daily Booking Volume</CardTitle>
            <CardDescription>Number of bookings per day</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={revenueChartData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(160, 12%, 89%)" />
                <XAxis dataKey="date" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="Bookings" fill="hsl(170, 75%, 18%)" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
