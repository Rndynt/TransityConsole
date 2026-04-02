import { Router, type IRouter } from "express";
import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";
import { ListBookingsQueryParams } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/bookings", async (req, res): Promise<void> => {
  const parsed = ListBookingsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { operatorId, status, page = 1, limit = 20, startDate, endDate } = parsed.data;
  const offset = (page - 1) * limit;

  const conditions = [];
  if (operatorId) conditions.push(eq(bookingsTable.operatorId, operatorId));
  if (status) conditions.push(eq(bookingsTable.status, status));
  if (startDate) conditions.push(gte(bookingsTable.departureDate, startDate));
  if (endDate) conditions.push(lte(bookingsTable.departureDate, endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  let rows;
  let countRows;
  if (whereClause) {
    rows = await db.select().from(bookingsTable).where(whereClause).orderBy(desc(bookingsTable.createdAt)).limit(limit).offset(offset);
    countRows = await db.select({ count: sql<number>`count(*)` }).from(bookingsTable).where(whereClause);
  } else {
    rows = await db.select().from(bookingsTable).orderBy(desc(bookingsTable.createdAt)).limit(limit).offset(offset);
    countRows = await db.select({ count: sql<number>`count(*)` }).from(bookingsTable);
  }

  const total = Number(countRows[0]?.count ?? 0);

  res.json({
    data: rows.map(formatBooking),
    total,
    page,
    limit,
    hasMore: offset + rows.length < total,
  });
});

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

export default router;
