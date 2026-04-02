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
import { startHealthScheduler, stopHealthScheduler } from "./modules/terminals/terminals.scheduler.js";
import { ensureDefaultAdmin } from "./modules/auth/auth.service.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const isProduction = process.env.NODE_ENV === "production";

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

  await app.register(cors, { origin: true });

  await app.register(async (api) => {
    await api.register(healthRoutes);
    await api.register(authRoutes);
    await api.register(operatorsRoutes);
    await api.register(terminalsRoutes);
    await api.register(bookingsRoutes);
    await api.register(analyticsRoutes);
    await api.register(gatewayRoutes);
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
  }

  app.addHook("onReady", async () => {
    await ensureDefaultAdmin();
    startHealthScheduler();
  });

  app.addHook("onClose", async () => {
    stopHealthScheduler();
  });

  return app;
}
