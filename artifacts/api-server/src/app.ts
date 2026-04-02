import Fastify from "fastify";
import cors from "@fastify/cors";
import healthRoutes from "./routes/health.js";
import operatorsRoutes from "./routes/operators.js";
import terminalsRoutes from "./routes/terminals.js";
import bookingsRoutes from "./routes/bookings.js";
import analyticsRoutes from "./routes/analytics.js";

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
  }, { prefix: "/api" });

  return app;
}
