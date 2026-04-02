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
  fastify.post("/gateway/trips/search", async (request, reply) => {
    const body = request.body as { origin?: string; destination?: string; date?: string; passengers?: number } | null;
    if (!body?.origin || !body.destination || !body.date) {
      return reply.status(400).send({ error: "origin, destination, and date are required" });
    }
    const result = await aggregator.searchTrips({
      origin: body.origin,
      destination: body.destination,
      date: body.date,
      passengers: body.passengers,
    });
    return result;
  });

  fastify.get("/gateway/trips/:tripId", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const trip = await aggregator.getTripById(tripId);
    if (!trip) return reply.status(404).send({ error: "Trip not found" });
    return trip;
  });

  fastify.get("/gateway/cities", async (_request, _reply) => {
    return aggregator.getCities();
  });

  fastify.post("/gateway/bookings", async (request, reply) => {
    const body = request.body as { tripId?: string; passengerName?: string; passengerPhone?: string; seatNumbers?: string[]; totalAmount?: number } | null;
    if (!body?.tripId || !body.passengerName || !body.passengerPhone || body.totalAmount === undefined) {
      return reply.status(400).send({ error: "tripId, passengerName, passengerPhone, and totalAmount are required" });
    }
    try {
      const result = await proxy.createBooking({
        tripId: body.tripId,
        passengerName: body.passengerName,
        passengerPhone: body.passengerPhone,
        seatNumbers: body.seatNumbers,
        totalAmount: body.totalAmount,
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
};

export default gatewayRoutes;
