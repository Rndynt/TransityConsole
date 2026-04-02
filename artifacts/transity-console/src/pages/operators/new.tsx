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
  name: z.string().min(2, "Minimal 2 karakter"),
  slug: z.string().min(2, "Slug wajib diisi").regex(/^[a-z0-9-]+$/, "Huruf kecil, angka, dan tanda hubung saja"),
  apiUrl: z.string().url("Harus berupa URL yang valid"),
  serviceKey: z.string().min(8, "Minimal 8 karakter"),
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
        toast({ title: "Operator berhasil didaftarkan", description: `${op.name} telah ditambahkan ke registry.` });
        setLocation("/operators");
      },
      onError: () => {
        toast({ title: "Error", description: "Gagal mendaftarkan operator.", variant: "destructive" });
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
    <div className="max-w-xl mx-auto space-y-5 anim-slide-up">
      {/* Back header */}
      <div className="flex items-center gap-3">
        <Link href="/operators">
          <button className="w-9 h-9 rounded-xl flex items-center justify-center text-muted-foreground hover:bg-muted transition-colors">
            <ArrowLeft className="h-4 w-4" />
          </button>
        </Link>
        <div>
          <h1 className="text-xl sm:text-2xl font-display font-bold tracking-tight">Register Operator</h1>
          <p className="text-muted-foreground text-xs sm:text-sm mt-0.5">Tambah operator shuttle ke registry.</p>
        </div>
      </div>

      <Card className="rounded-2xl border-border shadow-sm">
        <CardHeader className="pb-0">
          <CardTitle className="font-display text-base">Detail Operator</CardTitle>
          <CardDescription className="text-xs">Isi informasi operator dan koneksi terminal.</CardDescription>
        </CardHeader>
        <CardContent className="p-5">
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="name"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold">Nama Operator</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="Nusa Shuttle" className="rounded-xl h-10" data-testid="input-operator-name" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="slug"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold">Slug</FormLabel>
                      <FormControl>
                        <Input {...field} placeholder="nusa-shuttle" className="rounded-xl h-10" data-testid="input-operator-slug" />
                      </FormControl>
                      <FormDescription className="text-[10px]">Unik, huruf kecil, tanpa spasi</FormDescription>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="apiUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">Terminal API URL</FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://nusa-terminal.transity.web.id" className="rounded-xl h-10" data-testid="input-api-url" />
                    </FormControl>
                    <FormDescription className="text-[10px]">URL base instance TransityTerminal operator</FormDescription>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <FormField
                control={form.control}
                name="serviceKey"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">Service Key</FormLabel>
                    <FormControl>
                      <Input {...field} type="password" placeholder="TERMINAL_SERVICE_KEY" className="rounded-xl h-10" data-testid="input-service-key" />
                    </FormControl>
                    <FormDescription className="text-[10px]">X-Service-Key untuk autentikasi ke terminal</FormDescription>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={form.control}
                  name="commissionPct"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold">Komisi (%)</FormLabel>
                      <FormControl>
                        <Input {...field} type="number" min={0} max={100} step={0.5} className="rounded-xl h-10" data-testid="input-commission" />
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
                <FormField
                  control={form.control}
                  name="primaryColor"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel className="text-xs font-semibold">Warna Brand</FormLabel>
                      <FormControl>
                        <div className="flex gap-2">
                          <Input {...field} placeholder="#134E4A" className="rounded-xl h-10" data-testid="input-primary-color" />
                          <input
                            type="color"
                            value={field.value ?? "#134E4A"}
                            onChange={(e) => field.onChange(e.target.value)}
                            className="h-10 w-10 rounded-xl border border-input cursor-pointer p-0.5"
                          />
                        </div>
                      </FormControl>
                      <FormMessage className="text-xs" />
                    </FormItem>
                  )}
                />
              </div>

              <FormField
                control={form.control}
                name="logoUrl"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel className="text-xs font-semibold">
                      URL Logo <span className="text-muted-foreground font-normal">(opsional)</span>
                    </FormLabel>
                    <FormControl>
                      <Input {...field} placeholder="https://..." className="rounded-xl h-10" data-testid="input-logo-url" />
                    </FormControl>
                    <FormMessage className="text-xs" />
                  </FormItem>
                )}
              />

              <div className="flex gap-2.5 pt-1">
                <Button type="submit" disabled={createMutation.isPending} className="rounded-xl h-10" data-testid="button-submit-operator">
                  {createMutation.isPending ? "Mendaftarkan..." : "Daftarkan Operator"}
                </Button>
                <Link href="/operators">
                  <Button type="button" variant="outline" className="rounded-xl h-10">Batal</Button>
                </Link>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}
