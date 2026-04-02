import { eq, desc, and, gte, lte, sql } from "drizzle-orm";
import { db, bookingsTable } from "@workspace/db";

export type Booking = typeof bookingsTable.$inferSelect;

export interface BookingsFilter {
  operatorId?: string;
  status?: string;
  startDate?: string;
  endDate?: string;
}

export async function findAll(
  filters: BookingsFilter,
  pagination: { limit: number; offset: number }
) {
  const { limit, offset } = pagination;
  const conditions = [];
  if (filters.operatorId) conditions.push(eq(bookingsTable.operatorId, filters.operatorId));
  if (filters.status) conditions.push(eq(bookingsTable.status, filters.status as "confirmed" | "cancelled" | "pending"));
  if (filters.startDate) conditions.push(gte(bookingsTable.departureDate, filters.startDate));
  if (filters.endDate) conditions.push(lte(bookingsTable.departureDate, filters.endDate));

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const [rows, countRows] = await Promise.all([
    whereClause
      ? db.select().from(bookingsTable).where(whereClause).orderBy(desc(bookingsTable.createdAt)).limit(limit).offset(offset)
      : db.select().from(bookingsTable).orderBy(desc(bookingsTable.createdAt)).limit(limit).offset(offset),
    whereClause
      ? db.select({ count: sql<number>`count(*)` }).from(bookingsTable).where(whereClause)
      : db.select({ count: sql<number>`count(*)` }).from(bookingsTable),
  ]);

  return { rows, total: Number(countRows[0]?.count ?? 0) };
}

export async function findById(id: string): Promise<Booking | null> {
  const [row] = await db.select().from(bookingsTable).where(eq(bookingsTable.id, id));
  return row ?? null;
}

export async function create(data: {
  operatorId: string;
  operatorName: string;
  passengerName: string;
  passengerPhone: string;
  tripId: string;
  origin: string;
  destination: string;
  departureDate: string;
  seatNumbers: string[];
  totalAmount: string;
  commissionAmount: string;
  externalBookingId: string | null;
  status: string;
}): Promise<Booking> {
  const [row] = await db.insert(bookingsTable).values(data).returning();
  return row;
}
