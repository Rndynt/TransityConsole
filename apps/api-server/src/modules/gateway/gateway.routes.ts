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

const SAFE_ERROR_CODES = new Set([
  "NOT_FOUND", "NOT_ELIGIBLE", "SEAT_UNAVAILABLE", "VALIDATION_ERROR",
  "AUTH_ERROR", "TIMEOUT", "TERMINAL_ERROR", "UNKNOWN", "MISSING_SERVICE_DATE",
]);

function sanitizeErrorMessage(msg: string, code?: string): string {
  if (code && SAFE_ERROR_CODES.has(code)) return msg;
  if (/[a-z_]+\.[a-z_]+|uuid|sql|column|table|schema|stack/i.test(msg)) {
    return "Terjadi kesalahan sistem. Coba lagi nanti.";
  }
  return msg;
}

function handleGatewayError(e: unknown, reply: { status: (code: number) => { send: (body: unknown) => unknown } }) {
  if (e instanceof aggregator.GatewayError) {
    const safeMsg = sanitizeErrorMessage(e.message, e.code);
    return reply.status(e.statusCode).send({ error: safeMsg, code: e.code ?? "ERROR" });
  }
  if (e instanceof proxy.GatewayError) {
    const safeMsg = sanitizeErrorMessage(e.message, e.code);
    return reply.status(e.statusCode).send({ error: safeMsg, code: e.code ?? "ERROR" });
  }
  console.error("[gateway] Unexpected error:", e);
  return reply.status(500).send({ error: "Terjadi kesalahan sistem. Coba lagi nanti.", code: "INTERNAL_ERROR" });
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
    try {
      const result = await aggregator.searchTrips({
        originCity: query.originCity,
        destinationCity: query.destinationCity,
        date: query.date,
        passengers: query.passengers ? parseInt(query.passengers, 10) : undefined,
      });
      return result;
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.post("/gateway/trips/materialize", async (request, reply) => {
    const body = request.body as { tripId?: string; baseId?: string; serviceDate?: string };
    const tripId = body.tripId ?? (body.baseId ? `nusa-shuttle:virtual-${body.baseId}` : undefined);
    if (!tripId || !body.serviceDate) {
      return reply.status(400).send({ error: "tripId (atau baseId) dan serviceDate wajib diisi.", code: "VALIDATION_ERROR" });
    }
    try {
      const result = await aggregator.materializeTripPublic(tripId, body.serviceDate);
      return { tripId: result.materializedTripId };
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.get("/gateway/trips/:tripId", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const query = request.query as { serviceDate?: string };
    try {
      const trip = await aggregator.getTripById(tripId, query.serviceDate);
      if (!trip) return reply.status(404).send({ error: "Perjalanan tidak ditemukan. Silakan cari ulang." });
      return trip;
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.get("/gateway/trips/:tripId/seatmap", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    const query = request.query as { originSeq?: string; destinationSeq?: string; serviceDate?: string };
    if (!query.originSeq || !query.destinationSeq) {
      return reply.status(400).send({ error: "originSeq and destinationSeq are required" });
    }
    try {
      const seatmap = await aggregator.getSeatmap(
        tripId,
        parseInt(query.originSeq, 10),
        parseInt(query.destinationSeq, 10),
        query.serviceDate
      );
      if (!seatmap) return reply.status(404).send({ error: "Denah kursi tidak ditemukan." });
      return seatmap;
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.get("/gateway/trips/:tripId/reviews", async (request, reply) => {
    const { tripId } = request.params as { tripId: string };
    try {
      const reviews = await aggregator.getReviews(tripId);
      if (!reviews) return reply.status(404).send({ error: "Ulasan tidak ditemukan." });
      return reviews;
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.get("/gateway/cities", async (_request, reply) => {
    try {
      return await aggregator.getCities();
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.get("/gateway/operators/:operatorSlug/info", async (request, reply) => {
    const { operatorSlug } = request.params as { operatorSlug: string };
    try {
      const info = await aggregator.getOperatorInfo(operatorSlug);
      if (!info) return reply.status(404).send({ error: "Operator tidak ditemukan." });
      return info;
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.get("/gateway/service-lines", async (_request, reply) => {
    try {
      return await aggregator.getServiceLines();
    } catch (e) {
      return handleGatewayError(e, reply);
    }
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

      aggregator.invalidateSeatmapCache(body.tripId);

      return reply.status(201).send(result);
    } catch (e) {
      if (e instanceof proxy.GatewayError) {
        if (e.code === "SEAT_UNAVAILABLE" || (e.message && e.message.includes("seat"))) {
          aggregator.invalidateSeatmapCache(body.tripId);
        }
        return reply.status(e.statusCode).send({ error: e.message, code: e.code });
      }
      return handleGatewayError(e, reply);
    }
  });

  fastify.get("/gateway/bookings/:bookingId", async (request, reply) => {
    const { bookingId } = request.params as { bookingId: string };
    try {
      const booking = await proxy.getBookingById(bookingId);
      if (!booking) return reply.status(404).send({ error: "Booking tidak ditemukan." });
      return booking;
    } catch (e) {
      return handleGatewayError(e, reply);
    }
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
      return handleGatewayError(e, reply);
    }
  });
};

export default gatewayRoutes;
