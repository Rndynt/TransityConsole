import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import * as repo from "./auth.repository.js";
import crypto from "crypto";

const JWT_SECRET = process.env.JWT_SECRET ?? "transity-console-dev-secret-change-in-production";
const JWT_EXPIRES_IN = "8h";
const BCRYPT_ROUNDS = 10;

export class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  iat?: number;
  exp?: number;
}

export async function login(email: string, password: string): Promise<{ token: string; user: { id: string; email: string; role: string } }> {
  const user = await repo.findAdminByEmail(email);
  if (!user) throw new AuthError("Invalid credentials");

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new AuthError("Invalid credentials");

  const payload: JwtPayload = { sub: user.id, email: user.email, role: user.role };
  const token = jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });

  return { token, user: { id: user.id, email: user.email, role: user.role } };
}

export async function createAdmin(email: string, password: string, role = "admin") {
  const existing = await repo.findAdminByEmail(email);
  if (existing) throw new AuthError("Email already registered");

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const user = await repo.createAdmin({ email, passwordHash, role });
  return { id: user.id, email: user.email, role: user.role, createdAt: user.createdAt.toISOString() };
}

export async function ensureDefaultAdmin() {
  const count = await repo.countAdmins();
  if (count === 0) {
    const defaultEmail = process.env.ADMIN_EMAIL ?? "admin@transity.id";
    const defaultPassword = process.env.ADMIN_PASSWORD ?? "transity-admin-2026";
    const passwordHash = await bcrypt.hash(defaultPassword, BCRYPT_ROUNDS);
    await repo.createAdmin({ email: defaultEmail, passwordHash, role: "super_admin" });
    console.log(`[auth] Default admin created: ${defaultEmail}`);
  }
}

export function verifyToken(token: string): JwtPayload {
  try {
    return jwt.verify(token, JWT_SECRET) as JwtPayload;
  } catch {
    throw new AuthError("Invalid or expired token");
  }
}

export async function generateApiKey(name: string, scopes: string[], expiresAt?: Date | null): Promise<{ key: string; prefix: string; id: string }> {
  const rawKey = `tc_live_${crypto.randomBytes(32).toString("hex")}`;
  const prefix = rawKey.slice(0, 16);
  const keyHash = await bcrypt.hash(rawKey, BCRYPT_ROUNDS);

  const record = await repo.createApiKey({ name, keyHash, prefix, scopes, expiresAt });
  return { key: rawKey, prefix, id: record.id };
}

export async function verifyApiKey(rawKey: string): Promise<boolean> {
  if (!rawKey || !rawKey.startsWith("tc_live_")) return false;

  const prefix = rawKey.slice(0, 16);
  const candidates = await repo.findApiKeyByPrefix(prefix);

  for (const candidate of candidates) {
    if (!candidate.active) continue;
    if (candidate.expiresAt && candidate.expiresAt < new Date()) continue;

    const valid = await bcrypt.compare(rawKey, candidate.keyHash);
    if (valid) {
      await repo.updateApiKeyLastUsed(candidate.id);
      return true;
    }
  }

  return false;
}

export async function listApiKeys() {
  const keys = await repo.listApiKeys();
  return keys.map((k) => ({
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    scopes: k.scopes,
    active: k.active,
    lastUsedAt: k.lastUsedAt?.toISOString() ?? null,
    expiresAt: k.expiresAt?.toISOString() ?? null,
    createdAt: k.createdAt.toISOString(),
  }));
}

export async function revokeApiKey(id: string) {
  await repo.deactivateApiKey(id);
}
