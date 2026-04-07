import Fastify from "fastify";
import cors from "@fastify/cors";
import fastifyStatic from "@fastify/static";
import path from "path";
import { fileURLToPath } from "url";
import healthRoutes from "./modules/health/health.routes.js";
import operatorsRoutes from "./modules/operators/operators.routes.js";
import terminalsRoutes from "./modules/terminals/terminals.routes.js";
import bookingsRoutes from "./modules/bookings/bookings.routes.js";
import analyticsRoutes from "./modules/analytics/analytics.routes.js";
import gatewayRoutes from "./modules/gateway/gateway.routes.js";
import authRoutes from "./modules/auth/auth.routes.js";
import customerRoutes from "./modules/customers/customers.routes.js";
import { startHealthScheduler, stopHealthScheduler } from "./modules/terminals/terminals.scheduler.js";
import { startReconciler, stopReconciler } from "./modules/gateway/gateway.reconciler.js";
import { ensureDefaultAdmin } from "./modules/auth/auth.service.js";
import { runMigrations } from "@workspace/db";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

function getMigrationsDir(): string {
  if (process.env.MIGRATIONS_DIR) {
    return process.env.MIGRATIONS_DIR;
  }
  return path.resolve(__dirname, "../../../packages/db/migrations");
}

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
      ],
      ...(isProduction
        ? {}
        : { transport: { target: "pino-pretty", options: { colorize: true } } }),
    },
  });

  const migrationsDir = getMigrationsDir();
  app.log.info({ migrationsDir }, "Running database migrations...");
  await runMigrations(migrationsDir);
  app.log.info("Database migrations complete.");

  await app.register(cors, { origin: true });

  await app.register(async (api) => {
    await api.register(healthRoutes);
    await api.register(authRoutes);
    await api.register(operatorsRoutes);
    await api.register(terminalsRoutes);
    await api.register(bookingsRoutes);
    await api.register(analyticsRoutes);
    await api.register(gatewayRoutes);
    await api.register(customerRoutes);
  }, { prefix: "/api" });

  if (isProduction) {
    const staticRoot = process.env.STATIC_DIR
      ?? path.resolve(__dirname, "../../apps/transity-console/dist/public");

    await app.register(fastifyStatic, {
      root: staticRoot,
      prefix: "/",
      wildcard: false,
    });

    app.setNotFoundHandler((_req, reply) => {
      reply.sendFile("index.html", staticRoot);
    });
  } else {
    const vitePort = process.env.VITE_DEV_PORT ?? "3000";
    app.setNotFoundHandler(async (request, reply) => {
      try {
        const targetUrl = `http://localhost:${vitePort}${request.url}`;
        const proxyRes = await fetch(targetUrl, {
          method: request.method,
          headers: request.headers as Record<string, string>,
          body: request.method !== "GET" && request.method !== "HEAD" ? request.body as string : undefined,
          signal: AbortSignal.timeout(10000),
        });
        reply.status(proxyRes.status);
        for (const [key, value] of proxyRes.headers.entries()) {
          if (key.toLowerCase() !== "transfer-encoding") {
            reply.header(key, value);
          }
        }
        const body = Buffer.from(await proxyRes.arrayBuffer());
        return reply.send(body);
      } catch {
        return reply.status(502).send({ error: "Frontend dev server unavailable" });
      }
    });
  }

  app.addHook("onReady", async () => {
    await ensureDefaultAdmin();
    startHealthScheduler();
    startReconciler();
  });

  app.addHook("onClose", async () => {
    stopHealthScheduler();
    stopReconciler();
  });

  return app;
}
