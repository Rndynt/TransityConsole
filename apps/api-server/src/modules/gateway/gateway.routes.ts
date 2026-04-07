import type { FastifyPluginAsync } from "fastify";
import * as aggregator from "./gateway.aggregator.js";
import * as proxy from "./gateway.proxy.js";
import * as authService from "../auth/auth.service.js";
import * as customerService from "../customers/customers.service.js";
import * as bookingsRepo from "../bookings/bookings.repository.js";
import * as vouchersService from "../vouchers/vouchers.service.js";

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

function extractCustomerId(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const auth = request.headers["authorization"];
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
    try {
      const payload = customerService.verifyCustomerToken(auth.slice(7));
      return payload.sub;
    } catch {
      return null;
    }
  }
  return null;
}

const SAFE_ERROR_CODES = new Set([
  "NOT_FOUND", "NOT_ELIGIBLE", "SEAT_UNAVAILABLE", "VALIDATION_ERROR",
  "AUTH_ERROR", "TIMEOUT", "TERMINAL_ERROR", "UNKNOWN", "MISSING_SERVICE_DATE",
  "HOLD_EXPIRED", "ALREADY_PROCESSED", "INVALID_STATUS",
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
    const body = request.body as {
      tripId?: string;
      baseId?: string;
      operatorSlug?: string;
      serviceDate?: string;
    };

    let tripId = body.tripId;
    if (!tripId && body.baseId && body.operatorSlug) {
      tripId = `${body.operatorSlug}:virtual-${body.baseId}`;
    }

    if (!tripId || !body.serviceDate) {
      return reply.status(400).send({
        error: "tripId dan serviceDate wajib diisi. Gunakan tripId dari hasil pencarian.",
        code: "VALIDATION_ERROR",
      });
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
      !body.passengers?.length
    ) {
      return reply.status(400).send({
        error: "tripId, serviceDate, originStopId, destinationStopId, originSeq, destinationSeq, dan passengers wajib diisi.",
      });
    }

    for (const p of body.passengers) {
      if (!p.fullName || !p.seatNo) {
        return reply.status(400).send({ error: "Setiap penumpang wajib memiliki fullName dan seatNo." });
      }
    }

    const customerId = extractCustomerId(request);

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
        customerId: customerId ?? undefined,
      });

      aggregator.invalidateSeatmapCache(body.tripId);

      return reply.status(201).send(result);
    } catch (e) {
      if (e instanceof proxy.GatewayError) {
        if (e.code === "SEAT_UNAVAILABLE" || (e.message && e.message.toLowerCase().includes("seat"))) {
          aggregator.invalidateSeatmapCache(body.tripId);
        }
      }
      return handleGatewayError(e, reply);
    }
  });

  fastify.get("/gateway/bookings", async (request, reply) => {
    const customerId = extractCustomerId(request);
    if (!customerId) {
      return reply.status(401).send({ error: "Authorization diperlukan.", code: "AUTH_ERROR" });
    }

    const query = request.query as { status?: string; page?: string; limit?: string };
    const page = parseInt(query.page ?? "1", 10);
    const limit = Math.min(parseInt(query.limit ?? "20", 10), 50);
    const offset = (page - 1) * limit;

    try {
      const { rows, total } = await bookingsRepo.findByCustomerId(
        customerId,
        { status: query.status },
        { limit, offset }
      );

      const data = rows.map((b) => ({
        bookingId: b.id,
        externalBookingId: b.externalBookingId ?? null,
        operatorId: b.operatorId,
        operatorName: b.operatorName,
        tripId: b.tripId,
        status: b.status,
        passengerName: b.passengerName,
        passengerPhone: b.passengerPhone,
        seatNumbers: b.seatNumbers,
        totalAmount: b.totalAmount,
        discountAmount: b.discountAmount ?? null,
        finalAmount: b.finalAmount ?? b.totalAmount,
        paymentMethod: b.paymentMethod ?? null,
        holdExpiresAt: b.holdExpiresAt?.toISOString() ?? null,
        serviceDate: b.serviceDate ?? b.departureDate,
        createdAt: b.createdAt.toISOString(),
      }));

      return { data, total, page, limit, hasMore: offset + rows.length < total };
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.get("/gateway/bookings/:bookingId", async (request, reply) => {
    const { bookingId } = request.params as { bookingId: string };
    const customerId = extractCustomerId(request);
    try {
      const booking = await proxy.getBookingById(bookingId, customerId ?? undefined);
      if (!booking) return reply.status(404).send({ error: "Booking tidak ditemukan." });
      return booking;
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.post("/gateway/bookings/:bookingId/pay", async (request, reply) => {
    const { bookingId } = request.params as { bookingId: string };
    const customerId = extractCustomerId(request);
    const body = request.body as {
      paymentMethod?: string;
      voucherCode?: string;
    } | null;

    if (!body?.paymentMethod) {
      return reply.status(400).send({ error: "paymentMethod wajib diisi.", code: "VALIDATION_ERROR" });
    }

    try {
      let discountAmount: string | undefined;
      let finalAmount: string | undefined;
      let isPlatformVoucher = false;

      if (body.voucherCode) {
        const booking = await bookingsRepo.findById(bookingId);
        if (!booking) {
          return reply.status(404).send({ error: "Booking tidak ditemukan.", code: "NOT_FOUND" });
        }

        const totalAmountNum = parseFloat(String(booking.totalAmount)) || 0;

        try {
          const voucherResult = await vouchersService.validateVoucher(
            body.voucherCode,
            totalAmountNum,
            booking.operatorId
          );

          if (voucherResult.valid) {
            isPlatformVoucher = true;
            discountAmount = String(voucherResult.discountValue ?? 0);
            finalAmount = String(voucherResult.finalAmount ?? totalAmountNum);
          }
        } catch (e) {
          if (e instanceof Error && !e.message.toLowerCase().includes("not found") && !e.message.toLowerCase().includes("tidak ditemukan")) {
            throw e;
          }
        }
      }

      const result = await proxy.payBooking(bookingId, {
        paymentMethod: body.paymentMethod,
        voucherCode: body.voucherCode,
        isPlatformVoucher,
        discountAmount,
        finalAmount,
      }, customerId ?? undefined);

      if (body.voucherCode && isPlatformVoucher) {
        const reserved = await vouchersService.reserveVoucher(body.voucherCode);
        if (!reserved) {
          console.warn(`[gateway] Voucher ${body.voucherCode} could not be reserved after payment for booking ${bookingId}`);
        }
      }

      return result;
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.post("/gateway/bookings/:bookingId/cancel", async (request, reply) => {
    const { bookingId } = request.params as { bookingId: string };
    const customerId = extractCustomerId(request);

    try {
      const result = await proxy.cancelBooking(bookingId, customerId ?? undefined);
      return result;
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.get("/gateway/payments/methods", async (request, reply) => {
    const query = request.query as { operatorSlug?: string; bookingId?: string };

    let operatorSlug = query.operatorSlug;

    if (!operatorSlug && query.bookingId) {
      try {
        const booking = await bookingsRepo.findById(query.bookingId);
        if (booking?.tripId) {
          const colonIdx = booking.tripId.indexOf(":");
          if (colonIdx !== -1) operatorSlug = booking.tripId.slice(0, colonIdx);
        }
      } catch { /* ignore */ }
    }

    if (!operatorSlug) {
      return reply.status(400).send({
        error: "operatorSlug atau bookingId wajib diisi.",
        code: "VALIDATION_ERROR",
      });
    }

    try {
      const methods = await proxy.getPaymentMethods(operatorSlug);
      return { methods };
    } catch (e) {
      return handleGatewayError(e, reply);
    }
  });

  fastify.post("/gateway/vouchers/validate", async (request, reply) => {
    const body = request.body as {
      code?: string;
      tripId?: string;
      totalAmount?: number;
      operatorSlug?: string;
    } | null;

    if (!body?.code) {
      return reply.status(400).send({
        error: "code wajib diisi.",
        code: "VALIDATION_ERROR",
      });
    }

    let operatorSlug: string | undefined = body.operatorSlug;
    let operatorId: string | undefined;
    if (body.tripId) {
      const colonIdx = body.tripId.indexOf(":");
      if (colonIdx !== -1) {
        operatorSlug = body.tripId.slice(0, colonIdx);
        try {
          const { rows } = await (await import("../operators/operators.repository.js")).findAll(
            { active: true },
            { limit: 100, offset: 0 }
          );
          const op = rows.find((o) => o.slug === operatorSlug);
          if (op) operatorId = op.id;
        } catch { /* ignore */ }
      }
    }

    try {
      const platformResult = await vouchersService.validateVoucher(
        body.code,
        body.totalAmount ?? 0,
        operatorId
      );

      if (platformResult.valid) {
        return { ...platformResult, source: "platform" };
      }
    } catch (e) {
      if (e instanceof Error && !e.message.toLowerCase().includes("not found") && !e.message.toLowerCase().includes("tidak ditemukan")) {
        return handleGatewayError(e, reply);
      }
    }

    if (operatorSlug) {
      try {
        const operatorResult = await proxy.validateOperatorVoucher(
          operatorSlug,
          body.code,
          body.totalAmount
        );
        return { ...operatorResult, source: "operator" };
      } catch (e) {
        return handleGatewayError(e, reply);
      }
    }

    return reply.status(400).send({
      error: "Voucher tidak ditemukan atau tidak berlaku.",
      code: "VOUCHER_INVALID",
    });
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
      return handleGatewayError(e, reply);
    }
  });
};

export default gatewayRoutes;
