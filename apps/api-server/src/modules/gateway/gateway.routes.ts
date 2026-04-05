import type { FastifyPluginAsync } from "fastify";
import * as aggregator from "./gateway.aggregator.js";
import * as proxy from "./gateway.proxy.js";
import * as authService from "../auth/auth.service.js";

async function verifyApiKeyOrJwt(request: { headers: Record<string, string | string[] | undefined> }): Promise<boolean> {
  const apiKey = request.headers["x-api-key"];
  if (apiKey && typeof apiKey === "string") {
    return authService.verifyApiKey(apiKey);
  }
  const auth = request.headers["authorization"];
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
    try {
      authService.verifyToken(auth.slice(7));
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

const gatewayRoutes: FastifyPluginAsync = async (fastify) => {

  fastify.get("/gateway/trips/search", async (request, reply) => {
    const query = request.query as {
      originCity?: string;
      destinationCity?: string;
      date?: string;
      passengers?: string;
    };
    if (!query.originCity || !query.destinationCity || !query.date) {
      return reply.status(400).send({ error: "originCity, destinationCity, and date are required" });
    }
    const result = await aggregator.searchTrips({
      originCity: query.originCity,
      destinationCity: query.destinationCity,
      date: query.date,
      passengers: query.passengers ? parseInt(query.passengers, 10) : undefined,
    });
    return result;
  });

  fastify.get("/gateway/trips/:tripId", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const trip = await aggregator.getTripById(tripId);
    if (!trip) return reply.status(404).send({ error: "Trip not found" });
    return trip;
  });

  fastify.get("/gateway/trips/:tripId/seatmap", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const query = request.query as { originSeq?: string; destinationSeq?: string };
    if (!query.originSeq || !query.destinationSeq) {
      return reply.status(400).send({ error: "originSeq and destinationSeq are required" });
    }
    try {
      const seatmap = await aggregator.getSeatmap(
        tripId,
        parseInt(query.originSeq, 10),
        parseInt(query.destinationSeq, 10)
      );
      if (!seatmap) return reply.status(404).send({ error: "Seatmap not found (trip may be virtual)" });
      return seatmap;
    } catch (e) {
      if (e instanceof Error) return reply.status(502).send({ error: e.message });
      throw e;
    }
  });

  fastify.get("/gateway/trips/:tripId/reviews", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const reviews = await aggregator.getReviews(tripId);
    if (!reviews) return reply.status(404).send({ error: "Reviews not found" });
    return reviews;
  });

  fastify.get("/gateway/cities", async () => {
    return aggregator.getCities();
  });

  fastify.get("/gateway/operators/:operatorSlug/info", async (request, reply) => {
    const { operatorSlug } = request.params as { operatorSlug: string };
    const info = await aggregator.getOperatorInfo(operatorSlug);
    if (!info) return reply.status(404).send({ error: "Operator not found" });
    return info;
  });

  fastify.get("/gateway/service-lines", async () => {
    return aggregator.getServiceLines();
  });

  fastify.post("/gateway/bookings", async (request, reply) => {
    const body = request.body as {
      tripId?: string;
      serviceDate?: string;
      originStopId?: string;
      destinationStopId?: string;
      originSeq?: number;
      destinationSeq?: number;
      passengers?: proxy.PassengerInput[];
      paymentMethod?: string;
    } | null;

    if (
      !body?.tripId ||
      !body.serviceDate ||
      !body.originStopId ||
      !body.destinationStopId ||
      body.originSeq === undefined ||
      body.destinationSeq === undefined ||
      !body.passengers?.length ||
      !body.paymentMethod
    ) {
      return reply.status(400).send({
        error: "tripId, serviceDate, originStopId, destinationStopId, originSeq, destinationSeq, passengers, and paymentMethod are required",
      });
    }

    for (const p of body.passengers) {
      if (!p.fullName || !p.seatNo) {
        return reply.status(400).send({ error: "Each passenger requires fullName and seatNo" });
      }
    }

    try {
      const result = await proxy.createBooking({
        tripId: body.tripId,
        serviceDate: body.serviceDate,
        originStopId: body.originStopId,
        destinationStopId: body.destinationStopId,
        originSeq: body.originSeq,
        destinationSeq: body.destinationSeq,
        passengers: body.passengers,
        paymentMethod: body.paymentMethod,
      });
      return reply.status(201).send(result);
    } catch (e) {
      if (e instanceof proxy.GatewayError) return reply.status(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });

  fastify.get("/gateway/bookings/:bookingId", async (request, reply) => {
    const { bookingId } = request.params as { bookingId: string };
    const booking = await proxy.getBookingById(bookingId);
    if (!booking) return reply.status(404).send({ error: "Booking not found" });
    return booking;
  });

  fastify.post("/gateway/payments/webhook", async (request, reply) => {
    const authed = await verifyApiKeyOrJwt(request);
    if (!authed) return reply.status(401).send({ error: "Unauthorized" });

    const body = request.body as {
      providerRef?: string;
      status?: string;
    } | null;

    if (!body?.providerRef || !body.status) {
      return reply.status(400).send({ error: "providerRef and status are required" });
    }

    if (body.status !== "success" && body.status !== "failed") {
      return reply.status(400).send({ error: 'status must be "success" or "failed"' });
    }

    try {
      const result = await proxy.forwardPaymentWebhook({
        providerRef: body.providerRef,
        status: body.status,
      });
      return result;
    } catch (e) {
      if (e instanceof proxy.GatewayError) return reply.status(e.statusCode).send({ error: e.message, code: e.code });
      throw e;
    }
  });
};

export default gatewayRoutes;
