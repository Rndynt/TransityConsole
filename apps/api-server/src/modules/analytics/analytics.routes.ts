import type { FastifyPluginAsync } from "fastify";
import { GetOperatorAnalyticsQueryParams, GetRevenueAnalyticsQueryParams } from "@workspace/api-zod";
import * as service from "./analytics.service.js";

const analyticsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/analytics/summary", async () => {
    return service.getSummary();
  });

  fastify.get("/analytics/operators", async (request, reply) => {
    const parsed = GetOperatorAnalyticsQueryParams.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
    return service.getOperatorBreakdown(parsed.data.period ?? "30d");
  });

  fastify.get("/analytics/revenue", async (request, reply) => {
    const parsed = GetRevenueAnalyticsQueryParams.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
    return service.getRevenueTrend(parsed.data.period ?? "30d");
  });
};

export default analyticsRoutes;
