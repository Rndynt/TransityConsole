import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import * as repo from "./customers.repository.js";

const JWT_SECRET = process.env.JWT_SECRET ?? "transity-console-dev-secret-change-in-production";
const CUSTOMER_JWT_EXPIRES_IN = "30d";
const BCRYPT_ROUNDS = 10;

export class CustomerAuthError extends Error {
  statusCode: number;
  code: string;
  constructor(message: string, statusCode = 401, code = "AUTH_ERROR") {
    super(message);
    this.name = "CustomerAuthError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface CustomerJwtPayload {
  sub: string;
  email: string;
  type: "customer";
  iat?: number;
  exp?: number;
}

function sanitizeCustomer(c: repo.Customer) {
  return {
    id: c.id,
    fullName: c.fullName,
    email: c.email,
    phone: c.phone,
    avatarUrl: c.avatarUrl,
    createdAt: c.createdAt.toISOString(),
  };
}

function signToken(customer: repo.Customer): string {
  const payload: CustomerJwtPayload = {
    sub: customer.id,
    email: customer.email,
    type: "customer",
  };
  return jwt.sign(payload, JWT_SECRET, { expiresIn: CUSTOMER_JWT_EXPIRES_IN });
}

export async function register(data: {
  fullName: string;
  email: string;
  phone: string;
  password: string;
}) {
  const existingEmail = await repo.findByEmail(data.email);
  if (existingEmail) {
    throw new CustomerAuthError("Email sudah terdaftar. Silakan login.", 409, "EMAIL_EXISTS");
  }

  const existingPhone = await repo.findByPhone(data.phone);
  if (existingPhone) {
    throw new CustomerAuthError("Nomor telepon sudah terdaftar.", 409, "PHONE_EXISTS");
  }

  const passwordHash = await bcrypt.hash(data.password, BCRYPT_ROUNDS);
  const customer = await repo.create({
    fullName: data.fullName,
    email: data.email,
    phone: data.phone,
    passwordHash,
  });

  const token = signToken(customer);
  return { token, user: sanitizeCustomer(customer) };
}

export async function login(emailOrPhone: string, password: string) {
  let customer = await repo.findByEmail(emailOrPhone);
  if (!customer) {
    customer = await repo.findByPhone(emailOrPhone);
  }
  if (!customer) {
    throw new CustomerAuthError("Email/nomor telepon atau password salah.");
  }

  const valid = await bcrypt.compare(password, customer.passwordHash);
  if (!valid) {
    throw new CustomerAuthError("Email/nomor telepon atau password salah.");
  }

  await repo.updateLastLogin(customer.id);
  const token = signToken(customer);
  return { token, user: sanitizeCustomer(customer) };
}

export function verifyCustomerToken(token: string): CustomerJwtPayload {
  try {
    const payload = jwt.verify(token, JWT_SECRET) as CustomerJwtPayload;
    if (payload.type !== "customer") {
      throw new Error("Not a customer token");
    }
    return payload;
  } catch {
    throw new CustomerAuthError("Token tidak valid atau sudah kedaluwarsa.");
  }
}

export async function getProfile(customerId: string) {
  const customer = await repo.findById(customerId);
  if (!customer) {
    throw new CustomerAuthError("Akun tidak ditemukan.", 404, "NOT_FOUND");
  }
  return sanitizeCustomer(customer);
}

export async function updateProfile(
  customerId: string,
  data: { fullName?: string; phone?: string }
) {
  if (data.phone) {
    const existing = await repo.findByPhone(data.phone);
    if (existing && existing.id !== customerId) {
      throw new CustomerAuthError("Nomor telepon sudah digunakan akun lain.", 409, "PHONE_EXISTS");
    }
  }

  const updated = await repo.updateProfile(customerId, data);
  if (!updated) {
    throw new CustomerAuthError("Akun tidak ditemukan.", 404, "NOT_FOUND");
  }
  return sanitizeCustomer(updated);
}

export async function changePassword(
  customerId: string,
  currentPassword: string,
  newPassword: string
) {
  const customer = await repo.findById(customerId);
  if (!customer) {
    throw new CustomerAuthError("Akun tidak ditemukan.", 404, "NOT_FOUND");
  }

  const valid = await bcrypt.compare(currentPassword, customer.passwordHash);
  if (!valid) {
    throw new CustomerAuthError("Password lama salah.", 400, "WRONG_PASSWORD");
  }

  const passwordHash = await bcrypt.hash(newPassword, BCRYPT_ROUNDS);
  await repo.updatePassword(customerId, passwordHash);
  return { message: "Password berhasil diubah." };
}
