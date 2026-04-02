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
        toast({ title: "Operator deleted", description: "Operator removed from registry." });
        setDeleteId(null);
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to delete operator.", variant: "destructive" });
      },
    },
  });

  const pingMutation = usePingOperatorTerminal({
    mutation: {
      onSuccess: (result) => {
        setPingId(null);
        const status = result.status;
        toast({
          title: `Terminal ${status}`,
          description:
            status === "online"
              ? `Latency: ${result.latencyMs}ms`
              : status === "degraded"
              ? `Slow response: ${result.latencyMs}ms`
              : "Terminal did not respond.",
          variant: status === "offline" ? "destructive" : "default",
        });
      },
    },
  });

  const operators = data?.data ?? [];

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Operators</h1>
          <p className="text-muted-foreground mt-1">Manage registered shuttle operators in the registry.</p>
        </div>
        <Link href="/operators/new">
          <Button data-testid="button-add-operator" className="gap-2">
            <Plus className="h-4 w-4" />
            Add Operator
          </Button>
        </Link>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <Card key={i}>
              <CardContent className="p-5 flex items-center gap-4">
                <Skeleton className="h-10 w-10 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-64" />
                </div>
                <Skeleton className="h-6 w-16" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : operators.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-20 gap-3">
            <Building2 className="h-12 w-12 text-muted-foreground/30" />
            <p className="text-muted-foreground font-medium">No operators registered yet.</p>
            <Link href="/operators/new">
              <Button size="sm" variant="outline">Register your first operator</Button>
            </Link>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {operators.map((op) => (
            <Card key={op.id} data-testid={`card-operator-${op.id}`}>
              <CardContent className="p-5 flex items-center gap-4">
                <div
                  className="h-10 w-10 rounded-full flex items-center justify-center text-white font-display font-bold text-sm flex-shrink-0"
                  style={{ backgroundColor: op.primaryColor ?? "hsl(170 75% 18%)" }}
                >
                  {op.name.charAt(0)}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold font-display text-sm" data-testid={`text-operator-name-${op.id}`}>
                      {op.name}
                    </span>
                    <span className="text-muted-foreground text-xs">@{op.slug}</span>
                    <Badge variant={op.active ? "default" : "secondary"} className="text-xs">
                      {op.active ? "Active" : "Inactive"}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground text-xs mt-0.5 truncate">
                    {op.apiUrl} &bull; Commission: {op.commissionPct}%
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    className="gap-1.5 text-xs"
                    data-testid={`button-ping-${op.id}`}
                    disabled={pingMutation.isPending && pingId === op.id}
                    onClick={() => {
                      setPingId(op.id);
                      pingMutation.mutate({ id: op.id });
                    }}
                  >
                    <Wifi className="h-3.5 w-3.5" />
                    Ping
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8" data-testid={`button-menu-${op.id}`}>
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
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
                        Delete
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
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Operator?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove this operator and their terminal configuration. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => deleteId && deleteMutation.mutate({ id: deleteId })}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
