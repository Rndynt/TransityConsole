import { useState } from "react";
import { Link } from "wouter";
import {
  useListOperators,
  getListOperatorsQueryKey,
  useDeleteOperator,
  usePingOperatorTerminal,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Plus, MoreHorizontal, Pencil, Trash2, Wifi, Building2 } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export default function OperatorsList() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [pingId, setPingId] = useState<string | null>(null);

  const { data, isLoading } = useListOperators(undefined, {
    query: { queryKey: getListOperatorsQueryKey() },
  });

  const deleteMutation = useDeleteOperator({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOperatorsQueryKey() });
        toast({ title: "Operator dihapus", description: "Operator telah dihapus dari registry." });
        setDeleteId(null);
      },
      onError: () => {
        toast({ title: "Error", description: "Gagal menghapus operator.", variant: "destructive" });
      },
    },
  });

  const pingMutation = usePingOperatorTerminal({
    mutation: {
      onSuccess: (result) => {
        setPingId(null);
        const s = result.status;
        toast({
          title: s === "online" ? "Terminal Online" : s === "degraded" ? "Terminal Degraded" : "Terminal Offline",
          description:
            s === "online"
              ? `Latency: ${result.latencyMs}ms`
              : s === "degraded"
              ? `Respons lambat: ${result.latencyMs}ms`
              : "Terminal tidak merespons.",
          variant: s === "offline" ? "destructive" : "default",
        });
      },
    },
  });

  const operators = data?.data ?? [];

  return (
    <div className="space-y-5 anim-slide-up">
      {/* Header */}
      <div className="flex items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl sm:text-3xl font-display font-bold tracking-tight">Operators</h1>
          <p className="text-muted-foreground text-sm mt-1">Registry operator shuttle terdaftar.</p>
        </div>
        <Link href="/operators/new">
          <Button className="gap-2 rounded-xl h-10 text-sm shadow-sm" data-testid="button-add-operator">
            <Plus className="h-4 w-4" />
            <span className="hidden sm:inline">Tambah</span>
            <span className="sm:hidden">+</span>
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-2.5">
          {[...Array(4)].map((_, i) => (
            <Card key={i} className="rounded-2xl border-border shadow-sm">
              <CardContent className="p-4 flex items-center gap-3">
                <Skeleton className="h-10 w-10 rounded-xl flex-shrink-0" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-36" />
                  <Skeleton className="h-3 w-52" />
                </div>
                <Skeleton className="h-7 w-16 rounded-lg" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : operators.length === 0 ? (
        <Card className="rounded-2xl border-border shadow-sm">
          <CardContent className="flex flex-col items-center justify-center py-16 gap-3">
            <div className="w-14 h-14 rounded-2xl bg-muted flex items-center justify-center">
              <Building2 className="h-7 w-7 text-muted-foreground/40" />
            </div>
            <div className="text-center">
              <p className="font-semibold text-sm">Belum ada operator</p>
              <p className="text-muted-foreground text-xs mt-0.5">Tambahkan operator pertama kamu</p>
            </div>
            <Link href="/operators/new">
              <Button size="sm" variant="outline" className="rounded-lg mt-1">Register Operator</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-2.5">
          {operators.map((op, i) => (
            <Card
              key={op.id}
              data-testid={`card-operator-${op.id}`}
              className={cn("rounded-2xl border-border shadow-sm hover:shadow-md transition-shadow duration-200 anim-slide-up", `delay-${Math.min(i + 1, 4)}`)}
            >
              <CardContent className="p-4 flex items-center gap-3">
                {/* Avatar */}
                <div
                  className="h-10 w-10 rounded-xl flex items-center justify-center text-white font-display font-bold text-sm flex-shrink-0"
                  style={{ backgroundColor: op.primaryColor ?? "hsl(170,75%,18%)" }}
                >
                  {op.name.charAt(0)}
                </div>

                {/* Info */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="font-semibold font-display text-sm" data-testid={`text-operator-name-${op.id}`}>
                      {op.name}
                    </span>
                    <span className="text-muted-foreground/50 text-xs hidden sm:inline">@{op.slug}</span>
                    <Badge
                      variant={op.active ? "default" : "secondary"}
                      className="text-[10px] px-1.5 py-0 h-4 rounded-full"
                    >
                      {op.active ? "Aktif" : "Nonaktif"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-[11px] sm:text-xs mt-0.5 truncate">
                    {op.apiUrl}
                    <span className="hidden sm:inline"> &bull; Komisi: {op.commissionPct}%</span>
                  </p>
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs rounded-lg h-8 border-border hidden sm:flex"
                    data-testid={`button-ping-${op.id}`}
                    disabled={pingMutation.isPending && pingId === op.id}
                    onClick={() => {
                      setPingId(op.id);
                      pingMutation.mutate({ id: op.id });
                    }}
                  >
                    <Wifi className="h-3 w-3" />
                    Ping
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 rounded-lg" data-testid={`button-menu-${op.id}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="rounded-xl">
                      <DropdownMenuItem
                        className="sm:hidden gap-2 cursor-pointer"
                        onClick={() => { setPingId(op.id); pingMutation.mutate({ id: op.id }); }}
                      >
                        <Wifi className="h-3.5 w-3.5" />
                        Ping Terminal
                      </DropdownMenuItem>
                      <Link href={`/operators/${op.id}`}>
                        <DropdownMenuItem className="cursor-pointer gap-2">
                          <Pencil className="h-3.5 w-3.5" />
                          Edit
                        </DropdownMenuItem>
                      </Link>
                      <DropdownMenuItem
                        className="cursor-pointer gap-2 text-destructive focus:text-destructive"
                        onClick={() => setDeleteId(op.id)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        Hapus
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="rounded-2xl mx-4">
          <AlertDialogHeader>
            <AlertDialogTitle className="font-display">Hapus Operator?</AlertDialogTitle>
            <AlertDialogDescription>
              Operator dan konfigurasi terminalnya akan dihapus permanen. Tindakan ini tidak bisa dibatalkan.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-xl">Batal</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90 rounded-xl"
              onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}
            >
              Hapus
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
