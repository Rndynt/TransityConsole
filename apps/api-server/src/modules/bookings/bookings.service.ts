import * as repo from "./bookings.repository.js";

export function formatBooking(b: repo.Booking) {
  return {
    id: b.id,
    operatorId: b.operatorId,
    operatorName: b.operatorName,
    customerId: b.customerId ?? null,
    passengerName: b.passengerName,
    passengerPhone: b.passengerPhone,
    tripId: b.tripId,
    origin: b.origin,
    destination: b.destination,
    departureDate: b.departureDate,
    seatNumbers: b.seatNumbers,
    totalAmount: parseFloat(String(b.totalAmount)),
    commissionAmount: parseFloat(String(b.commissionAmount ?? 0)),
    discountAmount: b.discountAmount ? parseFloat(String(b.discountAmount)) : null,
    finalAmount: b.finalAmount ? parseFloat(String(b.finalAmount)) : parseFloat(String(b.totalAmount)),
    voucherCode: b.voucherCode ?? null,
    externalBookingId: b.externalBookingId ?? null,
    status: b.status,
    holdExpiresAt: b.holdExpiresAt?.toISOString() ?? null,
    paymentMethod: b.paymentMethod ?? null,
    serviceDate: b.serviceDate ?? b.departureDate,
    createdAt: b.createdAt.toISOString(),
  };
}

export async function list(
  filters: repo.BookingsFilter,
  pagination: { page: number; limit: number }
) {
  const offset = (pagination.page - 1) * pagination.limit;
  const { rows, total } = await repo.findAll(filters, { limit: pagination.limit, offset });
  return {
    data: rows.map(formatBooking),
    total,
    page: pagination.page,
    limit: pagination.limit,
    hasMore: offset + rows.length < total,
  };
}
