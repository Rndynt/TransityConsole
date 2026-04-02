import type { FastifyPluginAsync } from "fastify";

/**
 * Gateway Module — Phase 1
 *
 * These endpoints are consumed by TransityApp (OTA).
 * The gateway aggregates requests and routes them to the correct
 * TransityTerminal instance based on the tripId prefix convention:
 *   tripId format: {operatorSlug}:{originalTripId}
 *
 * See docs/IMPLEMENTATION.md § Gateway Module for full design.
 */
const gatewayRoutes: FastifyPluginAsync = async (fastify) => {
  const NOT_IMPLEMENTED = {
    error: "Gateway not yet implemented",
    code: "GATEWAY_NOT_IMPLEMENTED",
    phase: "Phase 1 — planned",
  } as const;

  fastify.post("/gateway/trips/search", async (_request, reply) => {
    return reply.status(501).send(NOT_IMPLEMENTED);
  });

  fastify.get("/gateway/trips/:tripId", async (_request, reply) => {
    return reply.status(501).send(NOT_IMPLEMENTED);
  });

  fastify.get("/gateway/cities", async (_request, reply) => {
    return reply.status(501).send(NOT_IMPLEMENTED);
  });

  fastify.post("/gateway/bookings", async (_request, reply) => {
    return reply.status(501).send(NOT_IMPLEMENTED);
  });

  fastify.get("/gateway/bookings/:bookingId", async (_request, reply) => {
    return reply.status(501).send(NOT_IMPLEMENTED);
  });
};

export default gatewayRoutes;
