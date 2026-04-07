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
  customerId?: string;
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

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function validateBookingId(id: string): void {
  if (!UUID_REGEX.test(id)) {
    throw new GatewayError("Booking tidak ditemukan.", "NOT_FOUND", 404);
  }
}

function parseOperatorSlug(tripId: string): { operatorSlug: string; originalTripId: string } {
  const colonIdx = tripId.indexOf(":");
  if (colonIdx === -1) throw new GatewayError("Invalid tripId format — expected {operatorSlug}:{originalId}", "INVALID_TRIP_ID", 400);
  return { operatorSlug: tripId.slice(0, colonIdx), originalTripId: tripId.slice(colonIdx + 1) };
}

async function findOperatorBySlug(operatorSlug: string) {
  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operator = operators.find((o) => o.slug === operatorSlug);
  if (!operator) throw new GatewayError(`Operator "${operatorSlug}" not found or inactive`, "OPERATOR_NOT_FOUND", 404);
  return operator;
}

async function findOperatorById(operatorId: string) {
  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operator = operators.find((o) => o.id === operatorId);
  if (!operator) throw new GatewayError("Operator not found", "OPERATOR_NOT_FOUND", 404);
  return operator;
}

export async function createBooking(req: BookingRequest): Promise<BookingResult> {
  const { operatorSlug, originalTripId } = parseOperatorSlug(req.tripId);
  const operator = await findOperatorBySlug(operatorSlug);

  const terminalPayload: Record<string, unknown> = {
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
    const rawExtId = terminalResponse["id"] ?? terminalResponse["bookingId"];
    externalBookingId = rawExtId ? String(rawExtId) : null;
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

  const bookingStatus = String(terminalResponse["status"] ?? "pending");

  const booking = await bookingsRepo.create({
    operatorId: operator.id,
    operatorName: operator.name,
    customerId: req.customerId ?? null,
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
    status: bookingStatus,
    providerRef: providerRef || null,
    holdExpiresAt: holdExpiresAt ? new Date(holdExpiresAt) : null,
    paymentMethod: null,
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
    status: bookingStatus,
    totalAmount,
    holdExpiresAt,
    paymentIntent,
    qrData,
    passengers: respPassengers,
    tripId: req.tripId,
    raw: terminalResponse,
  };
}

export interface PayBookingRequest {
  paymentMethod: string;
  voucherCode?: string;
  isPlatformVoucher?: boolean;
  discountAmount?: string;
  finalAmount?: string;
}

export interface PayBookingResult {
  bookingId: string;
  externalBookingId: string | null;
  status: string;
  paymentMethod: string;
  totalAmount: string;
  discountAmount: string | null;
  finalAmount: string;
  paymentIntent: Record<string, unknown> | null;
  qrData: unknown[] | null;
  raw: Record<string, unknown> | null;
}

export async function payBooking(
  bookingId: string,
  req: PayBookingRequest,
  customerId?: string
): Promise<PayBookingResult> {
  validateBookingId(bookingId);
  const booking = await bookingsRepo.findById(bookingId);
  if (!booking) throw new GatewayError("Booking tidak ditemukan.", "NOT_FOUND", 404);

  if (customerId && booking.customerId && booking.customerId !== customerId) {
    throw new GatewayError("Booking tidak ditemukan.", "NOT_FOUND", 404);
  }

  if (booking.status !== "held" && booking.status !== "pending") {
    throw new GatewayError(
      `Booking tidak bisa dibayar. Status saat ini: ${booking.status}`,
      "INVALID_STATUS",
      400
    );
  }

  if (booking.holdExpiresAt && new Date() > booking.holdExpiresAt) {
    await bookingsRepo.updateStatus(booking.id, "cancelled");
    throw new GatewayError("Masa hold booking sudah habis.", "HOLD_EXPIRED", 400);
  }

  if (!isValidPaymentMethod(req.paymentMethod)) {
    throw new GatewayError(
      `Metode pembayaran "${req.paymentMethod}" tidak valid. Gunakan salah satu dari: ${CONSOLE_PAYMENT_METHODS.map(m => m.id).join(", ")}`,
      "INVALID_PAYMENT_METHOD",
      400
    );
  }

  const totalAmountNum = parseFloat(String(booking.totalAmount)) || 0;
  const discountAmountNum = req.discountAmount ? parseFloat(req.discountAmount) : 0;
  const finalAmountNum = req.finalAmount ? parseFloat(req.finalAmount) : (totalAmountNum - discountAmountNum);

  const providerRef = `PAY-${crypto.randomUUID().replace(/-/g, "").slice(0, 24).toUpperCase()}`;

  const updated = await bookingsRepo.updatePayment(booking.id, {
    status: "confirmed",
    paymentMethod: req.paymentMethod,
    providerRef,
    discountAmount: discountAmountNum > 0 ? String(discountAmountNum) : null,
    finalAmount: String(finalAmountNum),
    voucherCode: req.voucherCode ?? null,
  }, ["held", "pending"]);

  if (!updated) {
    throw new GatewayError("Booking sudah diproses oleh request lain.", "ALREADY_PROCESSED", 409);
  }

  const operator = await findOperatorById(booking.operatorId);
  notifyTerminalPaid(operator, booking.externalBookingId ?? bookingId, providerRef);

  const paymentMethod = CONSOLE_PAYMENT_METHODS.find(m => m.id === req.paymentMethod);

  return {
    bookingId: booking.id,
    externalBookingId: booking.externalBookingId,
    status: "confirmed",
    paymentMethod: req.paymentMethod,
    totalAmount: String(booking.totalAmount),
    discountAmount: discountAmountNum > 0 ? String(discountAmountNum) : null,
    finalAmount: String(finalAmountNum),
    paymentIntent: {
      paymentId: providerRef,
      providerRef,
      method: paymentMethod?.type ?? req.paymentMethod,
      amount: String(finalAmountNum),
    },
    qrData: null,
    raw: null,
  };
}

function notifyTerminalPaid(
  operator: { apiUrl: string; serviceKey: string; webhookSecret: string | null },
  externalBookingId: string,
  providerRef: string
): void {
  const payload = JSON.stringify({
    bookingId: externalBookingId,
    providerRef,
    status: "success",
  });
  const signature = operator.webhookSecret
    ? crypto.createHmac("sha256", operator.webhookSecret).update(payload).digest("hex")
    : "";

  fetch(`${operator.apiUrl}/api/app/payments/webhook`, {
    method: "POST",
    signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
    headers: {
      "Content-Type": "application/json",
      "X-Service-Key": operator.serviceKey,
      ...(signature ? { "X-Webhook-Signature": signature } : {}),
    },
    body: payload,
  }).catch((err) => {
    console.error(`[gateway] Failed to notify terminal of payment for booking ${externalBookingId}:`, err);
  });
}

export interface CancelBookingResult {
  bookingId: string;
  status: string;
  message: string;
}

export async function cancelBooking(bookingId: string, customerId?: string): Promise<CancelBookingResult> {
  validateBookingId(bookingId);
  const booking = await bookingsRepo.findById(bookingId);
  if (!booking) throw new GatewayError("Booking tidak ditemukan.", "NOT_FOUND", 404);

  if (customerId && booking.customerId && booking.customerId !== customerId) {
    throw new GatewayError("Booking tidak ditemukan.", "NOT_FOUND", 404);
  }

  if (booking.status !== "held" && booking.status !== "pending" && booking.status !== "confirmed") {
    throw new GatewayError(
      `Booking tidak bisa dibatalkan. Status saat ini: ${booking.status}`,
      "INVALID_STATUS",
      400
    );
  }

  const operator = await findOperatorById(booking.operatorId);

  try {
    const res = await fetch(
      `${operator.apiUrl}/api/app/bookings/${encodeURIComponent(booking.externalBookingId ?? bookingId)}/cancel`,
      {
        method: "POST",
        signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
        headers: {
          "X-Service-Key": operator.serviceKey,
          "Content-Type": "application/json",
        },
      }
    );

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg = (errBody as Record<string, unknown>)["message"] ?? (errBody as Record<string, unknown>)["error"] ?? `HTTP ${res.status}`;
      if (res.status !== 404) {
        throw new GatewayError(String(errMsg), "TERMINAL_ERROR", res.status);
      }
    }
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    throw new GatewayError(
      `Gagal menghubungi terminal operator: ${e instanceof Error ? e.message : String(e)}`,
      "TERMINAL_UNAVAILABLE",
      503
    );
  }

  const updated = await bookingsRepo.updateStatusConditional(booking.id, "cancelled", ["held", "pending", "confirmed"]);
  if (!updated) {
    throw new GatewayError("Booking sudah diproses oleh request lain.", "ALREADY_PROCESSED", 409);
  }

  return {
    bookingId: booking.id,
    status: "cancelled",
    message: "Booking berhasil dibatalkan.",
  };
}

export async function getBookingById(bookingId: string, customerId?: string): Promise<Record<string, unknown> | null> {
  validateBookingId(bookingId);
  const booking = await bookingsRepo.findById(bookingId);
  if (!booking) return null;

  if (customerId && booking.customerId && booking.customerId !== customerId) {
    return null;
  }

  return {
    bookingId: booking.id,
    externalBookingId: booking.externalBookingId ?? null,
    operatorId: booking.operatorId,
    operatorName: booking.operatorName,
    customerId: booking.customerId ?? null,
    status: booking.status,
    tripId: booking.tripId,
    passengerName: booking.passengerName,
    passengerPhone: booking.passengerPhone,
    seatNumbers: booking.seatNumbers,
    totalAmount: booking.totalAmount,
    discountAmount: booking.discountAmount ?? null,
    finalAmount: booking.finalAmount ?? booking.totalAmount,
    voucherCode: booking.voucherCode ?? null,
    providerRef: booking.providerRef ?? null,
    holdExpiresAt: booking.holdExpiresAt?.toISOString() ?? null,
    paymentMethod: booking.paymentMethod ?? null,
    passengers: booking.passengersJson ? JSON.parse(booking.passengersJson) : [],
    serviceDate: booking.serviceDate ?? booking.departureDate,
    createdAt: booking.createdAt.toISOString(),
  };
}

export const CONSOLE_PAYMENT_METHODS = [
  { id: "QRIS", name: "QRIS", type: "qr", description: "Pembayaran via QRIS" },
  { id: "GOPAY", name: "GoPay", type: "ewallet", description: "Pembayaran via GoPay" },
  { id: "OVO", name: "OVO", type: "ewallet", description: "Pembayaran via OVO" },
  { id: "DANA", name: "DANA", type: "ewallet", description: "Pembayaran via DANA" },
  { id: "SHOPEEPAY", name: "ShopeePay", type: "ewallet", description: "Pembayaran via ShopeePay" },
  { id: "VA_BCA", name: "VA BCA", type: "va", description: "Virtual Account BCA" },
  { id: "VA_MANDIRI", name: "VA Mandiri", type: "va", description: "Virtual Account Mandiri" },
  { id: "VA_BNI", name: "VA BNI", type: "va", description: "Virtual Account BNI" },
  { id: "BANK_TRANSFER", name: "Bank Transfer", type: "transfer", description: "Transfer bank manual" },
];

export function getPaymentMethods(): Array<Record<string, unknown>> {
  return CONSOLE_PAYMENT_METHODS;
}

const VALID_PAYMENT_METHOD_IDS = new Set(CONSOLE_PAYMENT_METHODS.map((m) => m.id));

export function isValidPaymentMethod(methodId: string): boolean {
  return VALID_PAYMENT_METHOD_IDS.has(methodId);
}

export async function validateOperatorVoucher(
  operatorSlug: string,
  code: string,
  amount?: number
): Promise<Record<string, unknown>> {
  const operator = await findOperatorBySlug(operatorSlug);

  const payload: Record<string, unknown> = { code };
  if (amount !== undefined) payload.amount = amount;

  try {
    const res = await fetch(`${operator.apiUrl}/api/app/vouchers/validate`, {
      method: "POST",
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: {
        "X-Service-Key": operator.serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errBody = await res.json().catch(() => ({}));
      const errMsg = (errBody as Record<string, unknown>)["error"] ?? `HTTP ${res.status}`;
      throw new GatewayError(String(errMsg), "VOUCHER_INVALID", res.status);
    }

    return (await res.json()) as Record<string, unknown>;
  } catch (e) {
    if (e instanceof GatewayError) throw e;
    throw new GatewayError(
      `Gagal menghubungi terminal operator: ${e instanceof Error ? e.message : String(e)}`,
      "TERMINAL_UNAVAILABLE",
      503
    );
  }
}

export interface WebhookPayload {
  providerRef: string;
  status: "success" | "failed";
}

export async function forwardPaymentWebhook(payload: WebhookPayload): Promise<{ success: boolean; bookingId: string; newStatus: string }> {
  const booking = await bookingsRepo.findByProviderRef(payload.providerRef);
  if (!booking) throw new GatewayError("Booking not found for providerRef", "BOOKING_NOT_FOUND", 404);

  const operator = await findOperatorById(booking.operatorId);

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
        "X-Service-Key": operator.serviceKey,
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
