import { eq, desc } from "drizzle-orm";
import { db, operatorsTable, terminalHealthTable } from "@workspace/db";

export type Operator = typeof operatorsTable.$inferSelect;
export type NewOperator = typeof operatorsTable.$inferInsert;

export async function findAll(
  filters: { active?: boolean },
  pagination: { limit: number; offset: number }
) {
  const { active } = filters;
  const { limit, offset } = pagination;
  const whereClause = active !== undefined ? eq(operatorsTable.active, active) : undefined;

  const [rows, all] = await Promise.all([
    whereClause
      ? db.select().from(operatorsTable).where(whereClause).orderBy(desc(operatorsTable.createdAt)).limit(limit).offset(offset)
      : db.select().from(operatorsTable).orderBy(desc(operatorsTable.createdAt)).limit(limit).offset(offset),
    whereClause
      ? db.select().from(operatorsTable).where(whereClause)
      : db.select().from(operatorsTable),
  ]);

  return { rows, total: all.length };
}

export async function findById(id: string): Promise<Operator | null> {
  const [op] = await db.select().from(operatorsTable).where(eq(operatorsTable.id, id));
  return op ?? null;
}

export async function create(data: Omit<NewOperator, "id" | "createdAt" | "updatedAt">): Promise<Operator> {
  const [op] = await db.insert(operatorsTable).values(data).returning();
  return op;
}

export async function update(
  id: string,
  data: Partial<Omit<NewOperator, "id" | "createdAt" | "updatedAt">>
): Promise<Operator | null> {
  const [op] = await db.update(operatorsTable).set(data).where(eq(operatorsTable.id, id)).returning();
  return op ?? null;
}

export async function remove(id: string): Promise<Operator | null> {
  const [op] = await db.delete(operatorsTable).where(eq(operatorsTable.id, id)).returning();
  return op ?? null;
}

export async function recordHealthCheck(
  operatorId: string,
  status: "online" | "offline" | "degraded",
  latencyMs: number | null
): Promise<void> {
  await db.insert(terminalHealthTable).values({
    operatorId,
    status,
    latencyMs: latencyMs !== null ? String(latencyMs) : null,
  });
}
