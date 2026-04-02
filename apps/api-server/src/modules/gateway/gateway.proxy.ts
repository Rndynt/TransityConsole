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

export interface BookingRequest {
  tripId: string;
  passengerName: string;
  passengerPhone: string;
  seatNumbers?: string[];
  totalAmount: number;
}

export interface BookingResult {
  bookingId: string;
  externalBookingId: string | null;
  operatorId: string;
  operatorName: string;
  status: string;
  tripId: string;
  passengerName: string;
  passengerPhone: string;
  seatNumbers: string[];
  totalAmount: number;
  createdAt: string;
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

  let externalBookingId: string | null = null;

  try {
    const res = await fetch(`${operator.apiUrl}/api/app/bookings`, {
      method: "POST",
      signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
      headers: {
        "X-Service-Key": operator.serviceKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        tripId: originalTripId,
        passengerName: req.passengerName,
        passengerPhone: req.passengerPhone,
        seatNumbers: req.seatNumbers ?? [],
        totalAmount: req.totalAmount,
      }),
    });

    if (res.ok) {
      const data = (await res.json()) as { id?: string; bookingId?: string };
      externalBookingId = data.id ?? data.bookingId ?? null;
    }
  } catch {
    // Terminal unavailable — still record booking locally as pending
  }

  const booking = await bookingsRepo.create({
    operatorId: operator.id,
    operatorName: operator.name,
    passengerName: req.passengerName,
    passengerPhone: req.passengerPhone,
    tripId: req.tripId,
    origin: "",
    destination: "",
    departureDate: new Date().toISOString().split("T")[0] as string,
    seatNumbers: req.seatNumbers ?? [],
    totalAmount: String(req.totalAmount),
    commissionAmount: "0",
    externalBookingId,
    status: externalBookingId ? "confirmed" : "pending",
  });

  return {
    bookingId: booking.id,
    externalBookingId: booking.externalBookingId ?? null,
    operatorId: operator.id,
    operatorName: operator.name,
    status: booking.status,
    tripId: booking.tripId,
    passengerName: booking.passengerName,
    passengerPhone: booking.passengerPhone,
    seatNumbers: booking.seatNumbers,
    totalAmount: parseFloat(String(booking.totalAmount)),
    createdAt: booking.createdAt.toISOString(),
  };
}

export async function getBookingById(bookingId: string): Promise<BookingResult | null> {
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
    totalAmount: parseFloat(String(booking.totalAmount)),
    createdAt: booking.createdAt.toISOString(),
  };
}
