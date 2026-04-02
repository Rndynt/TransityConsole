import type { FastifyPluginAsync } from "fastify";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";
import { ListBookingsQueryParams } from "@workspace/api-zod";

const bookingsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/bookings", async (request, reply) => {
    const parsed = ListBookingsQueryParams.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const { operatorId, status, page = 1, limit = 20, startDate, endDate } = parsed.data;
    const offset = (page - 1) * limit;

    const conditions = [];
    if (operatorId) conditions.push(eq(bookingsTable.operatorId, operatorId));
    if (status) conditions.push(eq(bookingsTable.status, status));
    if (startDate) conditions.push(gte(bookingsTable.departureDate, startDate));
    if (endDate) conditions.push(lte(bookingsTable.departureDate, endDate));

    const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

    const [rows, countRows] = await Promise.all([
      whereClause
        ? db.select().from(bookingsTable).where(whereClause).orderBy(desc(bookingsTable.createdAt)).limit(limit).offset(offset)
        : db.select().from(bookingsTable).orderBy(desc(bookingsTable.createdAt)).limit(limit).offset(offset),
      whereClause
        ? db.select({ count: sql<number>`count(*)` }).from(bookingsTable).where(whereClause)
        : db.select({ count: sql<number>`count(*)` }).from(bookingsTable),
    ]);

    const total = Number(countRows[0]?.count ?? 0);
    return {
      data: rows.map(formatBooking),
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
    };
  });
};

function formatBooking(b: typeof bookingsTable.$inferSelect) {
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

export default bookingsRoutes;
