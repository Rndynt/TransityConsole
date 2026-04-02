import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useCreateOperator, getListOperatorsQueryKey } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
  FormDescription,
} from "@/components/ui/form";
import { ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { useToast } from "@/hooks/use-toast";

const schema = z.object({
  name: z.string().min(2, "Name must be at least 2 characters"),
  slug: z.string().min(2, "Slug required").regex(/^[a-z0-9-]+$/, "Slug: lowercase letters, numbers, hyphens only"),
  apiUrl: z.string().url("Must be a valid URL"),
  serviceKey: z.string().min(8, "Service key must be at least 8 characters"),
  commissionPct: z.coerce.number().min(0).max(100).default(0),
  primaryColor: z.string().optional(),
  logoUrl: z.string().url().optional().or(z.literal("")),
});

type FormData = z.infer<typeof schema>;

export default function OperatorNew() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: "",
      slug: "",
      apiUrl: "",
      serviceKey: "",
      commissionPct: 0,
      primaryColor: "#134E4A",
      logoUrl: "",
    },
  });

  const createMutation = useCreateOperator({
    mutation: {
      onSuccess: (op) => {
        queryClient.invalidateQueries({ queryKey: getListOperatorsQueryKey() });
        toast({ title: "Operator registered", description: `${op.name} has been added to the registry.` });
        setLocation("/operators");
      },
      onError: () => {
        toast({ title: "Error", description: "Failed to register operator.", variant: "destructive" });
      },
    },
  });

  function onSubmit(data: FormData) {
    createMutation.mutate({
      data: {
        name: data.name,
        slug: data.slug,
        apiUrl: data.apiUrl,
        serviceKey: data.serviceKey,
        commissionPct: data.commissionPct,
        primaryColor: data.primaryColor || null,
        logoUrl: data.logoUrl || null,
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
        <div>
          <h1 className="text-3xl font-display font-bold tracking-tight">Register Operator</h1>
          <p className="text-muted-foreground mt-1">Add a new shuttle operator to the registry.</p>
        </div>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="font-display">Operator Details</CardTitle>
          <CardDescription>Fill in the operator and terminal connection information.</CardDescription>
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
                      <FormControl>
                        <Input {...field} placeholder="Nusa Shuttle" data-testid="input-operator-name" />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Slug</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="nusa-shuttle" data-testid="input-operator-slug" />
                      </FormControl>
                      <FormDescription>Unique identifier (lowercase, no spaces)</FormDescription>
                      <FormMessage />
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
                    <FormControl>
                      <Input {...field} placeholder="https://nusa-terminal.transity.web.id" data-testid="input-api-url" />
                    </FormControl>
                    <FormDescription>Base URL of the operator&apos;s TransityTerminal instance</FormDescription>
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
                      <Input
                        {...field}
                        type="password"
                        placeholder="TERMINAL_SERVICE_KEY value"
                        data-testid="input-service-key"
                      />
                    </FormControl>
                    <FormDescription>X-Service-Key used to authenticate with the terminal</FormDescription>
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
                      <FormControl>
                        <Input {...field} type="number" min={0} max={100} step={0.5} data-testid="input-commission" />
                      </FormControl>
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
                          <Input {...field} placeholder="#134E4A" data-testid="input-primary-color" />
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
                    <FormControl>
                      <Input {...field} placeholder="https://..." data-testid="input-logo-url" />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex gap-3 pt-2">
                <Button
                  type="submit"
                  disabled={createMutation.isPending}
                  data-testid="button-submit-operator"
                >
                  {createMutation.isPending ? "Registering..." : "Register Operator"}
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
