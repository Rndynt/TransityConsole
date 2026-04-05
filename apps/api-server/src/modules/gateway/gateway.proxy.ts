import crypto from "crypto";
import * as operatorsRepo from "../operators/operators.repository.js";
import * as bookingsRepo from "../bookings/bookings.repository.js";

const TERMINAL_TIMEOUT_MS = 8000;

export class GatewayError extends Error {
  constructor(
    message: string,
    public code: string,
    public statusCode = 500
  ) {
    super(message);
    this.name = "GatewayError";
  }
}

export interface PassengerInput {
  fullName: string;
  phone?: string;
  idNumber?: string;
  seatNo: string;
}

export interface BookingRequest {
  tripId: string;
  serviceDate: string;
  originStopId: string;
  destinationStopId: string;
  originSeq: number;
  destinationSeq: number;
  passengers: PassengerInput[];
  paymentMethod: string;
}

export interface BookingResult {
  bookingId: string;
  externalBookingId: string | null;
  operatorId: string;
  operatorName: string;
  operatorSlug: string;
  status: string;
  totalAmount: string;
  holdExpiresAt: string | null;
  paymentIntent: Record<string, unknown> | null;
  qrData: unknown[] | null;
  passengers: unknown[];
  tripId: string;
  raw: Record<string, unknown>;
}

function parseOperatorSlug(tripId: string): { operatorSlug: string; originalTripId: string } {
  const colonIdx = tripId.indexOf(":");
  if (colonIdx === -1) throw new GatewayError("Invalid tripId format — expected {operatorSlug}:{originalId}", "INVALID_TRIP_ID", 400);
  return { operatorSlug: tripId.slice(0, colonIdx), originalTripId: tripId.slice(colonIdx + 1) };
}

export async function createBooking(req: BookingRequest): Promise<BookingResult> {
  const { operatorSlug, originalTripId } = parseOperatorSlug(req.tripId);

  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operator = operators.find((o) => o.slug === operatorSlug);

  if (!operator) throw new GatewayError(`Operator "${operatorSlug}" not found or inactive`, "OPERATOR_NOT_FOUND", 404);

  const terminalPayload = {
    tripId: originalTripId,
    serviceDate: req.serviceDate,
    originStopId: req.originStopId,
    destinationStopId: req.destinationStopId,
    originSeq: req.originSeq,
    destinationSeq: req.destinationSeq,
    passengers: req.passengers.map((p) => ({
      fullName: p.fullName,
      phone: p.phone ?? "",
      idNumber: p.idNumber ?? "",
      seatNo: p.seatNo,
    })),
    paymentMethod: req.paymentMethod,
  };

  let terminalResponse: Record<string, unknown> | null = null;
  let externalBookingId: string | null = null;

  try {
    const res = await fetch(`${operator.apiUrl}/api/app/bookings`, {
      method: "POST",
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: {
        "X-Service-Key": operator.serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(terminalPayload),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg = (errBody as Record<string, unknown>)["message"] ?? (errBody as Record<string, unknown>)["error"] ?? `HTTP ${res.status}`;
      throw new GatewayError(String(errMsg), "TERMINAL_ERROR", res.status);
    }

    terminalResponse = (await res.json()) as Record<string, unknown>;
    externalBookingId = String(terminalResponse["id"] ?? terminalResponse["bookingId"] ?? "");
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    throw new GatewayError(
      `Failed to reach operator terminal: ${e instanceof Error ? e.message : String(e)}`,
      "TERMINAL_UNAVAILABLE",
      503
    );
  }

  const totalAmount = String(terminalResponse["totalAmount"] ?? "0");
  const holdExpiresAt = terminalResponse["holdExpiresAt"] ? String(terminalResponse["holdExpiresAt"]) : null;
  const paymentIntent = (terminalResponse["paymentIntent"] as Record<string, unknown>) ?? null;
  const providerRef = paymentIntent ? String(paymentIntent["providerRef"] ?? "") : null;
  const qrData = (terminalResponse["qrData"] as unknown[]) ?? null;
  const respPassengers = (terminalResponse["passengers"] as unknown[]) ?? [];

  const commissionPct = parseFloat(String(operator.commissionPct ?? "0"));
  const totalAmountNum = parseFloat(totalAmount) || 0;
  const commissionAmount = String(Math.round(totalAmountNum * commissionPct / 100));

  const seatNumbers = req.passengers.map((p) => p.seatNo);
  const primaryPassenger = req.passengers[0];

  const booking = await bookingsRepo.create({
    operatorId: operator.id,
    operatorName: operator.name,
    passengerName: primaryPassenger?.fullName ?? "",
    passengerPhone: primaryPassenger?.phone ?? "",
    tripId: req.tripId,
    origin: "",
    destination: "",
    departureDate: req.serviceDate,
    seatNumbers,
    totalAmount,
    commissionAmount,
    externalBookingId,
    status: "pending",
    providerRef: providerRef || null,
    holdExpiresAt: holdExpiresAt ? new Date(holdExpiresAt) : null,
    paymentMethod: req.paymentMethod,
    passengersJson: JSON.stringify(req.passengers),
    originStopId: req.originStopId,
    destinationStopId: req.destinationStopId,
    serviceDate: req.serviceDate,
  });

  return {
    bookingId: booking.id,
    externalBookingId,
    operatorId: operator.id,
    operatorName: operator.name,
    operatorSlug: operator.slug,
    status: String(terminalResponse["status"] ?? "pending"),
    totalAmount,
    holdExpiresAt,
    paymentIntent,
    qrData,
    passengers: respPassengers,
    tripId: req.tripId,
    raw: terminalResponse,
  };
}

export async function getBookingById(bookingId: string): Promise<Record<string, unknown> | null> {
  const booking = await bookingsRepo.findById(bookingId);
  if (!booking) return null;

  return {
    bookingId: booking.id,
    externalBookingId: booking.externalBookingId ?? null,
    operatorId: booking.operatorId,
    operatorName: booking.operatorName,
    status: booking.status,
    tripId: booking.tripId,
    passengerName: booking.passengerName,
    passengerPhone: booking.passengerPhone,
    seatNumbers: booking.seatNumbers,
    totalAmount: booking.totalAmount,
    providerRef: booking.providerRef ?? null,
    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    paymentMethod: booking.paymentMethod ?? null,
    passengers: booking.passengersJson ? JSON.parse(booking.passengersJson) : [],
    serviceDate: booking.serviceDate ?? booking.departureDate,
    createdAt: booking.createdAt.toISOString(),
  };
}

export interface WebhookPayload {
  providerRef: string;
  status: "success" | "failed";
}

export async function forwardPaymentWebhook(payload: WebhookPayload): Promise<{ success: boolean; bookingId: string; newStatus: string }> {
  const booking = await bookingsRepo.findByProviderRef(payload.providerRef);
  if (!booking) throw new GatewayError("Booking not found for providerRef", "BOOKING_NOT_FOUND", 404);

  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operator = operators.find((o) => o.id === booking.operatorId);
  if (!operator) throw new GatewayError("Operator not found", "OPERATOR_NOT_FOUND", 404);

  const webhookSecret = operator.webhookSecret;
  if (!webhookSecret) throw new GatewayError("Webhook secret not configured for operator", "WEBHOOK_SECRET_MISSING", 500);

  const bodyStr = JSON.stringify(payload);
  const signature = crypto
    .createHmac("sha256", webhookSecret)
    .update(bodyStr)
    .digest("hex");

  try {
    const res = await fetch(`${operator.apiUrl}/api/app/payments/webhook`, {
      method: "POST",
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: {
        "Content-Type": "application/json",
        "X-Webhook-Signature": signature,
      },
      body: bodyStr,
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg = (errBody as Record<string, unknown>)["message"] ?? (errBody as Record<string, unknown>)["error"] ?? `HTTP ${res.status}`;
      if (res.status === 400 && String(errMsg).includes("already processed")) {
        // idempotent — treat as success
      } else {
        throw new GatewayError(`Terminal webhook failed: ${errMsg}`, "WEBHOOK_FAILED", res.status);
      }
    }
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    throw new GatewayError(
      `Failed to reach operator terminal for webhook: ${e instanceof Error ? e.message : String(e)}`,
      "TERMINAL_UNAVAILABLE",
      503
    );
  }

  const newStatus = payload.status === "success" ? "confirmed" : "cancelled";
  await bookingsRepo.updateStatus(booking.id, newStatus);

  return {
    success: true,
    bookingId: booking.id,
    newStatus,
  };
}
