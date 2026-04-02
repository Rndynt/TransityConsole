import { useState } from "react";
import {
  useListBookings,
  getListBookingsQueryKey,
  useListOperators,
  getListOperatorsQueryKey,
} from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Input } from "@/components/ui/input";
import { Ticket } from "lucide-react";
import { cn } from "@/lib/utils";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400",
  confirmed: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400",
  completed: "bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400",
  cancelled: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400",
};

function formatCurrency(amount: number) {
  return new Intl.NumberFormat("id-ID", { style: "currency", currency: "IDR", minimumFractionDigits: 0 }).format(amount);
}

export default function BookingsList() {
  const [page, setPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState<string>("");
  const [operatorFilter, setOperatorFilter] = useState<string>("");
  const [startDate, setStartDate] = useState<string>("");
  const [endDate, setEndDate] = useState<string>("");

  const params = {
    page,
    limit: 15,
    ...(statusFilter && statusFilter !== "all" ? { status: statusFilter as "pending" | "confirmed" | "cancelled" | "completed" } : {}),
    ...(operatorFilter && operatorFilter !== "all" ? { operatorId: operatorFilter } : {}),
    ...(startDate ? { startDate } : {}),
    ...(endDate ? { endDate } : {}),
  };

  const { data, isLoading } = useListBookings(params, {
    query: { queryKey: getListBookingsQueryKey(params) },
  });

  const { data: operatorsData } = useListOperators(undefined, {
    query: { queryKey: getListOperatorsQueryKey() },
  });

  const bookings = data?.data ?? [];
  const total = data?.total ?? 0;
  const hasMore = data?.hasMore ?? false;
  const operators = operatorsData?.data ?? [];

  function resetFilters() {
    setStatusFilter("");
    setOperatorFilter("");
    setStartDate("");
    setEndDate("");
    setPage(1);
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-display font-bold tracking-tight">Bookings</h1>
        <p className="text-muted-foreground mt-1">All bookings across registered operators.</p>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <Select value={statusFilter || "all"} onValueChange={(v) => { setStatusFilter(v); setPage(1); }}>
          <SelectTrigger className="w-40" data-testid="select-status-filter">
            <SelectValue placeholder="All statuses" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All statuses</SelectItem>
            <SelectItem value="pending">Pending</SelectItem>
            <SelectItem value="confirmed">Confirmed</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="cancelled">Cancelled</SelectItem>
          </SelectContent>
        </Select>

        <Select value={operatorFilter || "all"} onValueChange={(v) => { setOperatorFilter(v); setPage(1); }}>
          <SelectTrigger className="w-48" data-testid="select-operator-filter">
            <SelectValue placeholder="All operators" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All operators</SelectItem>
            {operators.map((op) => (
              <SelectItem key={op.id} value={op.id}>{op.name}</SelectItem>
            ))}
          </SelectContent>
        </Select>

        <Input
          type="date"
          value={startDate}
          onChange={(e) => { setStartDate(e.target.value); setPage(1); }}
          className="w-40"
          data-testid="input-start-date"
        />
        <Input
          type="date"
          value={endDate}
          onChange={(e) => { setEndDate(e.target.value); setPage(1); }}
          className="w-40"
          data-testid="input-end-date"
        />

        {(statusFilter || operatorFilter || startDate || endDate) && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>Clear filters</Button>
        )}

        <span className="ml-auto text-sm text-muted-foreground self-center">
          {total} booking{total !== 1 ? "s" : ""}
        </span>
      </div>

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(5)].map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-12 w-full" /></CardContent></Card>
          ))}
        </div>
      ) : bookings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-20 gap-3">
            <Ticket className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">No bookings found for the selected filters.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2">
          {bookings.map((b) => (
            <Card key={b.id} data-testid={`card-booking-${b.id}`}>
              <CardContent className="p-4 flex items-center gap-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="font-semibold text-sm font-display">{b.passengerName}</span>
                    <span className="text-muted-foreground text-xs">{b.passengerPhone}</span>
                    <span
                      className={cn("inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium", STATUS_COLORS[b.status] ?? "")}
                      data-testid={`status-booking-${b.id}`}
                    >
                      {b.status.charAt(0).toUpperCase() + b.status.slice(1)}
                    </span>
                  </div>
                  <div className="text-xs text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-0.5">
                    <span>{b.origin} → {b.destination}</span>
                    <span>{b.departureDate}</span>
                    <span>Seat: {b.seatNumbers.join(", ")}</span>
                    <span className="text-primary font-medium">{formatCurrency(b.totalAmount)}</span>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <div className="text-xs text-muted-foreground">{b.operatorName}</div>
                  <div className="text-xs text-muted-foreground/60 mt-0.5">{new Date(b.createdAt).toLocaleDateString("id-ID")}</div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {(bookings.length > 0 || page > 1) && (
        <div className="flex items-center justify-between pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
            data-testid="button-prev-page"
          >
            Previous
          </Button>
          <span className="text-sm text-muted-foreground">Page {page}</span>
          <Button
            variant="outline"
            size="sm"
            disabled={!hasMore}
            onClick={() => setPage(page + 1)}
            data-testid="button-next-page"
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
