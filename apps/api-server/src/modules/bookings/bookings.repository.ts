import { eq, desc, and, gte, lte, sql, inArray } from "drizzle-orm";
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

export async function findByProviderRef(providerRef: string): Promise<Booking | null> {
  const [row] = await db.select().from(bookingsTable).where(eq(bookingsTable.providerRef, providerRef));
  return row ?? null;
}

export async function findByIdempotencyKey(key: string): Promise<Booking | null> {
  const [row] = await db.select().from(bookingsTable).where(eq(bookingsTable.idempotencyKey, key));
  return row ?? null;
}

export async function findByCustomerId(
  customerId: string,
  filters: { status?: string },
  pagination: { limit: number; offset: number }
) {
  const { limit, offset } = pagination;
  const conditions = [eq(bookingsTable.customerId, customerId)];
  if (filters.status) conditions.push(eq(bookingsTable.status, filters.status));

  const whereClause = and(...conditions);

  const [rows, countRows] = await Promise.all([
    db.select().from(bookingsTable).where(whereClause).orderBy(desc(bookingsTable.createdAt)).limit(limit).offset(offset),
    db.select({ count: sql<number>`count(*)` }).from(bookingsTable).where(whereClause),
  ]);

  return { rows, total: Number(countRows[0]?.count ?? 0) };
}

export async function findUncertainBookings(olderThanMinutes = 60): Promise<Booking[]> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  return db.select().from(bookingsTable).where(
    and(
      eq(bookingsTable.status, "uncertain"),
      gte(bookingsTable.createdAt, cutoff),
    )
  );
}

export async function create(data: {
  operatorId: string;
  operatorName: string;
  customerId?: string | null;
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
  providerRef?: string | null;
  holdExpiresAt?: Date | null;
  paymentMethod?: string | null;
  passengersJson?: string | null;
  originStopId?: string | null;
  destinationStopId?: string | null;
  serviceDate?: string | null;
  idempotencyKey?: string | null;
}): Promise<Booking> {
  const [row] = await db.insert(bookingsTable).values(data).returning();
  return row;
}

export async function updateFromTerminalSuccess(id: string, data: {
  externalBookingId: string | null;
  totalAmount: string;
  commissionAmount: string;
  holdExpiresAt: Date | null;
  status: string;
  providerRef?: string | null;
}): Promise<Booking | null> {
  const [row] = await db.update(bookingsTable).set(data).where(
    and(eq(bookingsTable.id, id), inArray(bookingsTable.status, ["pending", "uncertain"]))
  ).returning();
  return row ?? null;
}

export async function updateStatus(id: string, status: string): Promise<Booking | null> {
  const [row] = await db.update(bookingsTable).set({ status }).where(eq(bookingsTable.id, id)).returning();
  return row ?? null;
}

export async function updateStatusConditional(
  id: string,
  newStatus: string,
  expectedCurrentStatuses: string[]
): Promise<Booking | null> {
  const statusConditions = expectedCurrentStatuses.map(s => eq(bookingsTable.status, s));
  const [row] = await db.update(bookingsTable)
    .set({ status: newStatus })
    .where(and(eq(bookingsTable.id, id), sql`(${sql.join(statusConditions, sql` OR `)})`))
    .returning();
  return row ?? null;
}

export async function updatePayment(id: string, data: {
  status: string;
  paymentMethod: string;
  providerRef?: string | null;
  discountAmount?: string | null;
  finalAmount?: string | null;
  voucherCode?: string | null;
}, expectedCurrentStatuses?: string[]): Promise<Booking | null> {
  const conditions = [eq(bookingsTable.id, id)];
  if (expectedCurrentStatuses?.length) {
    const statusConditions = expectedCurrentStatuses.map(s => eq(bookingsTable.status, s));
    conditions.push(sql`(${sql.join(statusConditions, sql` OR `)})`);
  }
  const [row] = await db.update(bookingsTable).set(data).where(and(...conditions)).returning();
  return row ?? null;
}
