import { useState } from "react";
import {
  useListTerminalHealth,
  getListTerminalHealthQueryKey,
  usePingOperatorTerminal,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Wifi, RefreshCw, CheckCircle2, XCircle, AlertTriangle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

type Status = "online" | "offline" | "degraded";

function StatusBadge({ status }: { status: Status }) {
  const config = {
    online: { label: "Online", icon: CheckCircle2, className: "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400" },
    degraded: { label: "Degraded", icon: AlertTriangle, className: "bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400" },
    offline: { label: "Offline", icon: XCircle, className: "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400" },
  }[status];
  const Icon = config.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium", config.className)}>
      <Icon className="h-3.5 w-3.5" />
      {config.label}
    </span>
  );
}

export default function TerminalsList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [pingingId, setPingingId] = useState<string | null>(null);

  const { data, isLoading, refetch, isFetching } = useListTerminalHealth({
    query: { queryKey: getListTerminalHealthQueryKey() },
  });

  const pingMutation = usePingOperatorTerminal({
    mutation: {
      onSuccess: (result, vars) => {
        setPingingId(null);
        queryClient.invalidateQueries({ queryKey: getListTerminalHealthQueryKey() });
        toast({
          title: `${result.status === "online" ? "Terminal online" : result.status === "degraded" ? "Terminal degraded" : "Terminal offline"}`,
          description: result.latencyMs ? `Latency: ${result.latencyMs}ms` : "No response received.",
          variant: result.status === "offline" ? "destructive" : "default",
        });
      },
    },
  });

  const overview = data;
  const terminals = data?.terminals ?? [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Terminal Health</h1>
          <p className="text-muted-foreground mt-1">Real-time health status of all registered operator terminals.</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={isFetching}
          onClick={() => refetch()}
          data-testid="button-refresh-health"
        >
          <RefreshCw className={cn("h-4 w-4", isFetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => <Card key={i}><CardContent className="p-5"><Skeleton className="h-16 w-full" /></CardContent></Card>)}
        </div>
      ) : overview ? (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-muted-foreground font-medium">Total</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-bold font-display">{overview.total}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-emerald-600 font-medium">Online</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-bold font-display text-emerald-600">{overview.online}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-amber-600 font-medium">Degraded</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-bold font-display text-amber-600">{overview.degraded}</div></CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm text-red-600 font-medium">Offline</CardTitle></CardHeader>
            <CardContent><div className="text-3xl font-bold font-display text-red-600">{overview.offline}</div></CardContent>
          </Card>
        </div>
      ) : null}

      {isLoading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => <Card key={i}><CardContent className="p-5"><Skeleton className="h-12 w-full" /></CardContent></Card>)}</div>
      ) : terminals.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center py-20 gap-3">
            <Activity className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground">No terminals registered. Add an operator first.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {terminals.map((t) => (
            <Card key={t.operatorId} data-testid={`card-terminal-${t.operatorId}`}>
              <CardContent className="p-5 flex items-center gap-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-semibold font-display text-sm">{t.operatorName}</span>
                    <span className="text-muted-foreground text-xs">@{t.operatorSlug}</span>
                    <StatusBadge status={t.status as Status} />
                  </div>
                  <div className="flex items-center gap-4 text-xs text-muted-foreground">
                    {t.latencyMs !== null && t.latencyMs !== undefined && (
                      <span>Latency: <span className={cn("font-medium", t.latencyMs > 1000 ? "text-amber-600" : "text-emerald-600")}>{Math.round(t.latencyMs)}ms</span></span>
                    )}
                    {t.lastCheckedAt && (
                      <span>Last checked: {new Date(t.lastCheckedAt).toLocaleString("id-ID")}</span>
                    )}
                    {!t.lastCheckedAt && <span>Never checked</span>}
                  </div>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="gap-2 text-xs"
                  disabled={pingMutation.isPending && pingingId === t.operatorId}
                  onClick={() => {
                    setPingingId(t.operatorId);
                    pingMutation.mutate({ id: t.operatorId });
                  }}
                  data-testid={`button-ping-${t.operatorId}`}
                >
                  <Wifi className="h-3.5 w-3.5" />
                  {pingingId === t.operatorId && pingMutation.isPending ? "Pinging..." : "Ping"}
                </Button>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
