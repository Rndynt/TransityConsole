import { db } from "@workspace/db";
import { customersTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type Customer = typeof customersTable.$inferSelect;

export async function findByEmail(email: string): Promise<Customer | null> {
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.email, email));
  return customer ?? null;
}

export async function findById(id: string): Promise<Customer | null> {
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.id, id));
  return customer ?? null;
}

export async function findByPhone(phone: string): Promise<Customer | null> {
  const [customer] = await db.select().from(customersTable).where(eq(customersTable.phone, phone));
  return customer ?? null;
}

export async function create(data: {
  fullName: string;
  email: string;
  phone: string;
  passwordHash: string;
}): Promise<Customer> {
  const [customer] = await db
    .insert(customersTable)
    .values(data)
    .returning();
  return customer;
}

export async function updateLastLogin(id: string): Promise<void> {
  await db
    .update(customersTable)
    .set({ lastLoginAt: new Date() })
    .where(eq(customersTable.id, id));
}

export async function updateProfile(
  id: string,
  data: { fullName?: string; phone?: string; avatarUrl?: string }
): Promise<Customer | null> {
  const [updated] = await db
    .update(customersTable)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(customersTable.id, id))
    .returning();
  return updated ?? null;
}

export async function updatePassword(id: string, passwordHash: string): Promise<void> {
  await db
    .update(customersTable)
    .set({ passwordHash, updatedAt: new Date() })
    .where(eq(customersTable.id, id));
}
