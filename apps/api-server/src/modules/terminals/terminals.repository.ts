import { eq, desc } from "drizzle-orm";
import { db, operatorsTable, terminalHealthTable } from "@workspace/db";

export async function findAllActiveOperators() {
  return db.select().from(operatorsTable).where(eq(operatorsTable.active, true));
}

export async function findLatestHealthForOperator(operatorId: string) {
  const [record] = await db
    .select()
    .from(terminalHealthTable)
    .where(eq(terminalHealthTable.operatorId, operatorId))
    .orderBy(desc(terminalHealthTable.checkedAt))
    .limit(1);
  return record ?? null;
}
