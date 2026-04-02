import { db } from "@workspace/db";
import { adminUsersTable, apiKeysTable } from "@workspace/db";
import { eq } from "drizzle-orm";

export type AdminUser = typeof adminUsersTable.$inferSelect;
export type ApiKey = typeof apiKeysTable.$inferSelect;

export async function findAdminByEmail(email: string): Promise<AdminUser | null> {
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.email, email));
  return user ?? null;
}

export async function findAdminById(id: string): Promise<AdminUser | null> {
  const [user] = await db.select().from(adminUsersTable).where(eq(adminUsersTable.id, id));
  return user ?? null;
}

export async function createAdmin(data: {
  email: string;
  passwordHash: string;
  role?: string;
}): Promise<AdminUser> {
  const [user] = await db
    .insert(adminUsersTable)
    .values({ email: data.email, passwordHash: data.passwordHash, role: data.role ?? "admin" })
    .returning();
  return user;
}

export async function countAdmins(): Promise<number> {
  const all = await db.select().from(adminUsersTable);
  return all.length;
}

export async function findApiKeyByPrefix(prefix: string): Promise<ApiKey[]> {
  return db.select().from(apiKeysTable).where(eq(apiKeysTable.prefix, prefix));
}

export async function findAllActiveApiKeys(): Promise<ApiKey[]> {
  return db.select().from(apiKeysTable).where(eq(apiKeysTable.active, true));
}

export async function createApiKey(data: {
  name: string;
  keyHash: string;
  prefix: string;
  scopes: string[];
  expiresAt?: Date | null;
}): Promise<ApiKey> {
  const [key] = await db
    .insert(apiKeysTable)
    .values({
      name: data.name,
      keyHash: data.keyHash,
      prefix: data.prefix,
      scopes: data.scopes,
      expiresAt: data.expiresAt ?? null,
    })
    .returning();
  return key;
}

export async function updateApiKeyLastUsed(id: string): Promise<void> {
  await db.update(apiKeysTable).set({ lastUsedAt: new Date() }).where(eq(apiKeysTable.id, id));
}

export async function deactivateApiKey(id: string): Promise<void> {
  await db.update(apiKeysTable).set({ active: false }).where(eq(apiKeysTable.id, id));
}

export async function listApiKeys(): Promise<ApiKey[]> {
  return db.select().from(apiKeysTable);
}
