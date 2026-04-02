import { useParams, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import {
  useGetOperator,
  getGetOperatorQueryKey,
  useUpdateOperator,
  usePingOperatorTerminal,
  getListOperatorsQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { ArrowLeft, Wifi } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";
import { useEffect } from "react";

const schema = z.object({
  name: z.string().min(2),
  apiUrl: z.string().url(),
  serviceKey: z.string().min(1),
  commissionPct: z.coerce.number().min(0).max(100),
  primaryColor: z.string().optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
  active: z.boolean(),
});
type FormData = z.infer<typeof schema>;

export default function OperatorDetail() {
  const params = useParams<{ id: string }>();
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const id = params.id;

  const { data: op, isLoading } = useGetOperator(id, {
    query: { enabled: !!id, queryKey: getGetOperatorQueryKey(id) },
  });

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { name: "", apiUrl: "", serviceKey: "", commissionPct: 0, primaryColor: "#134E4A", logoUrl: "", active: true },
  });

  useEffect(() => {
    if (op) {
      form.reset({
        name: op.name,
        apiUrl: op.apiUrl,
        serviceKey: op.serviceKey,
        commissionPct: op.commissionPct,
        primaryColor: op.primaryColor ?? "#134E4A",
        logoUrl: op.logoUrl ?? "",
        active: op.active,
      });
    }
  }, [op, form]);

  const updateMutation = useUpdateOperator({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getGetOperatorQueryKey(id) });
        queryClient.invalidateQueries({ queryKey: getListOperatorsQueryKey() });
        toast({ title: "Operator updated", description: "Changes saved successfully." });
        setLocation("/operators");
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to update operator.", variant: "destructive" });
      },
    },
  });

  const pingMutation = usePingOperatorTerminal({
    mutation: {
      onSuccess: (result) => {
        const status = result.status;
        toast({
          title: `Terminal ${status}`,
          description: status === "online" ? `Latency: ${result.latencyMs}ms` : status === "degraded" ? `Slow: ${result.latencyMs}ms` : "Terminal did not respond.",
          variant: status === "offline" ? "destructive" : "default",
        });
      },
    },
  });

  if (isLoading) {
    return (
      <div className="max-w-2xl mx-auto space-y-6">
        <Skeleton className="h-10 w-48" />
        <Card><CardContent className="p-6 space-y-4">{[...Array(5)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</CardContent></Card>
      </div>
    );
  }

  if (!op) {
    return <div className="text-center py-20 text-muted-foreground">Operator not found.</div>;
  }

  function onSubmit(data: FormData) {
    updateMutation.mutate({
      id,
      data: {
        name: data.name,
        apiUrl: data.apiUrl,
        serviceKey: data.serviceKey,
        commissionPct: data.commissionPct,
        primaryColor: data.primaryColor || null,
        logoUrl: data.logoUrl || null,
        active: data.active,
      },
    });
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div className="flex items-center gap-3">
        <Link href="/operators">
          <Button variant="ghost" size="icon" className="h-8 w-8">
            <ArrowLeft className="h-4 w-4" />
          </Button>
        </Link>
        <div className="flex-1">
          <h1 className="text-3xl font-display font-bold tracking-tight">{op.name}</h1>
          <p className="text-muted-foreground mt-1">@{op.slug}</p>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          disabled={pingMutation.isPending}
          onClick={() => pingMutation.mutate({ id })}
          data-testid="button-ping-terminal"
        >
          <Wifi className="h-4 w-4" />
          {pingMutation.isPending ? "Pinging..." : "Ping Terminal"}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Edit Operator</CardTitle>
          <CardDescription>Update operator details and terminal connection settings.</CardDescription>
        </CardHeader>
        <CardContent>
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Operator Name</FormLabel>
                      <FormControl><Input {...field} data-testid="input-operator-name" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="active"
                  render={({ field }) => (
                    <FormItem className="flex flex-col">
                      <FormLabel>Status</FormLabel>
                      <div className="flex items-center gap-3 pt-2">
                        <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-active" />
                        <span className="text-sm text-muted-foreground">{field.value ? "Active" : "Inactive"}</span>
                      </div>
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="apiUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Terminal API URL</FormLabel>
                    <FormControl><Input {...field} data-testid="input-api-url" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="serviceKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Service Key</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" data-testid="input-service-key" />
                    </FormControl>
                    <FormDescription>Leave unchanged to keep current key</FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="commissionPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Commission (%)</FormLabel>
                      <FormControl><Input {...field} type="number" min={0} max={100} step={0.5} data-testid="input-commission" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="primaryColor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Brand Color</FormLabel>
                      <FormControl>
                        <div className="flex gap-2">
                          <Input {...field} data-testid="input-primary-color" />
                          <input
                            type="color"
                            value={field.value ?? "#134E4A"}
                            onChange={(e) => field.onChange(e.target.value)}
                            className="h-10 w-10 rounded-md border border-input cursor-pointer"
                          />
                        </div>
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="logoUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Logo URL <span className="text-muted-foreground font-normal">(optional)</span></FormLabel>
                    <FormControl><Input {...field} data-testid="input-logo-url" /></FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-3 pt-2">
                <Button type="submit" disabled={updateMutation.isPending} data-testid="button-submit-operator">
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Link href="/operators">
                  <Button type="button" variant="outline">Cancel</Button>
                </Link>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
