import { eq, and, sql } from "drizzle-orm";
import { db, vouchersTable } from "@workspace/db";

export type Voucher = typeof vouchersTable.$inferSelect;

export async function findByCode(code: string): Promise<Voucher | null> {
  const [row] = await db.select().from(vouchersTable).where(eq(vouchersTable.code, code.toUpperCase().trim()));
  return row ?? null;
}

export async function atomicIncrementUsedCount(id: string, currentUsageLimit: number | null): Promise<boolean> {
  const conditions = [eq(vouchersTable.id, id)];
  if (currentUsageLimit !== null) {
    conditions.push(sql`${vouchersTable.usedCount} < ${currentUsageLimit}`);
  }

  const result = await db.update(vouchersTable)
    .set({ usedCount: sql`${vouchersTable.usedCount} + 1` })
    .where(and(...conditions))
    .returning({ id: vouchersTable.id });

  return result.length > 0;
}
