import { Link } from "wouter";
import {
  useGetAnalyticsSummary,
  getGetAnalyticsSummaryQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DollarSign,
  Ticket,
  Building2,
  ActivitySquare,
  ArrowRight,
  TrendingUp,
  Wifi,
} from "lucide-react";
import { cn } from "@/lib/utils";

function formatCurrency(amount: number) {
  if (amount >= 1_000_000) return `Rp ${(amount / 1_000_000).toFixed(1)}M`;
  if (amount >= 1_000) return `Rp ${(amount / 1_000).toFixed(0)}K`;
  return new Intl.NumberFormat("id-ID", {
    style: "currency",
    currency: "IDR",
    minimumFractionDigits: 0,
  }).format(amount);
}

const QUICK_LINKS = [
  { href: "/operators", label: "Manage Operators", icon: Building2, desc: "Add, edit, ping operators" },
  { href: "/terminals", label: "Terminal Health", icon: Wifi, desc: "Live status monitoring" },
  { href: "/bookings", label: "All Bookings", icon: Ticket, desc: "Browse & filter bookings" },
  { href: "/analytics", label: "Analytics", icon: TrendingUp, desc: "Revenue & performance" },
];

export default function Dashboard() {
  const { data: summary, isLoading } = useGetAnalyticsSummary({
    query: { queryKey: getGetAnalyticsSummaryQueryKey() },
  });

  const stats = summary
    ? [
        {
          label: "Total Revenue",
          value: formatCurrency(summary.totalRevenue),
          sub: `${formatCurrency(summary.revenueToday)} today`,
          icon: DollarSign,
          color: "text-primary",
          bg: "bg-primary/8",
        },
        {
          label: "Total Bookings",
          value: summary.totalBookings.toLocaleString(),
          sub: `${summary.bookingsToday} today`,
          icon: Ticket,
          color: "text-accent",
          bg: "bg-accent/8",
        },
        {
          label: "Active Operators",
          value: summary.activeOperators,
          sub: `of ${summary.totalOperators} registered`,
          icon: Building2,
          color: "text-primary",
          bg: "bg-primary/8",
        },
        {
          label: "Terminals Online",
          value: summary.onlineTerminals,
          sub: "real-time status",
          icon: ActivitySquare,
          color: "text-emerald-600",
          bg: "bg-emerald-50 dark:bg-emerald-900/20",
        },
      ]
    : [];

  return (
    <div className="space-y-6 anim-slide-up">
      {/* Page header */}
      <div>
        <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">Dashboard</h1>
        <p className="text-muted-foreground text-sm mt-1">Overview operasi OTA dan status terminal.</p>
      </div>

      {/* Stats grid */}
      {isLoading ? (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="rounded-2xl border-border shadow-sm">
              <CardContent className="p-4 sm:p-5 space-y-3">
                <Skeleton className="h-9 w-9 rounded-xl" />
                <Skeleton className="h-6 w-20" />
                <Skeleton className="h-3 w-28" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
          {stats.map((s, i) => (
            <Card
              key={i}
              className={cn(
                "rounded-2xl border-border shadow-sm hover:shadow-md transition-shadow duration-200 anim-slide-up",
                `delay-${i + 1}`
              )}
            >
              <CardContent className="p-4 sm:p-5">
                <div className={cn("w-9 h-9 rounded-xl flex items-center justify-center mb-3", s.bg)}>
                  <s.icon className={cn("h-4 w-4", s.color)} />
                </div>
                <div className="font-display font-bold text-xl sm:text-2xl leading-none">{s.value}</div>
                <p className="text-[11px] sm:text-xs text-muted-foreground mt-1.5">{s.label}</p>
                <p className="text-[10px] sm:text-[11px] text-muted-foreground/60 mt-0.5">{s.sub}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Quick links */}
      <div>
        <h2 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Menu Cepat</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {QUICK_LINKS.map((link, i) => (
            <Link key={link.href} href={link.href}>
              <div
                className={cn(
                  "flex items-center gap-4 p-4 rounded-2xl border border-border bg-card",
                  "hover:border-primary/20 hover:bg-primary/[0.03] hover:shadow-sm",
                  "transition-all duration-200 cursor-pointer group anim-slide-up",
                  `delay-${i + 1}`
                )}
              >
                <div className="w-10 h-10 rounded-xl bg-primary/8 flex items-center justify-center flex-shrink-0">
                  <link.icon className="h-5 w-5 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold font-display text-sm">{link.label}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">{link.desc}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground/40 group-hover:text-primary group-hover:translate-x-0.5 transition-all" />
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
