import type { FastifyPluginAsync } from "fastify";
import { ListBookingsQueryParams } from "@workspace/api-zod";
import * as service from "./bookings.service.js";

const bookingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/bookings", async (request, reply) => {
    const parsed = ListBookingsQueryParams.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
    const { operatorId, status, page = 1, limit = 20, startDate, endDate } = parsed.data;
    return service.list({ operatorId, status, startDate, endDate }, { page, limit });
  });
};

export default bookingsRoutes;
