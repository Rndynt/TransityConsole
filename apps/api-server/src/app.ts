import Fastify from "fastify";
import cors from "@fastify/cors";
import healthRoutes from "./modules/health/health.routes.js";
import operatorsRoutes from "./modules/operators/operators.routes.js";
import terminalsRoutes from "./modules/terminals/terminals.routes.js";
import bookingsRoutes from "./modules/bookings/bookings.routes.js";
import analyticsRoutes from "./modules/analytics/analytics.routes.js";
import gatewayRoutes from "./modules/gateway/gateway.routes.js";

export async function buildApp() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? "info",
      redact: [
        "req.headers.authorization",
        "req.headers.cookie",
        "res.headers['set-cookie']",
      ],
      ...(process.env.NODE_ENV !== "production"
        ? { transport: { target: "pino-pretty", options: { colorize: true } } }
        : {}),
    },
  });

  await app.register(cors, { origin: true });

  await app.register(async (api) => {
    await api.register(healthRoutes);
    await api.register(operatorsRoutes);
    await api.register(terminalsRoutes);
    await api.register(bookingsRoutes);
    await api.register(analyticsRoutes);
    await api.register(gatewayRoutes);
  }, { prefix: "/api" });

  return app;
}
