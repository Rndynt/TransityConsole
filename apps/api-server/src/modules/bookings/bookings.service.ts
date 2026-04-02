import * as repo from "./bookings.repository.js";

export function formatBooking(b: repo.Booking) {
  return {
    id: b.id,
    operatorId: b.operatorId,
    operatorName: b.operatorName,
    passengerName: b.passengerName,
    passengerPhone: b.passengerPhone,
    tripId: b.tripId,
    origin: b.origin,
    destination: b.destination,
    departureDate: b.departureDate,
    seatNumbers: b.seatNumbers,
    totalAmount: parseFloat(String(b.totalAmount)),
    status: b.status,
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
