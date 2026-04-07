import type { FastifyPluginAsync } from "fastify";
import * as service from "./customers.service.js";

function extractCustomerToken(request: { headers: Record<string, string | string[] | undefined> }): string | null {
  const auth = request.headers["authorization"];
  if (auth && typeof auth === "string" && auth.startsWith("Bearer ")) {
    return auth.slice(7);
  }
  return null;
}

const customerRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/gateway/auth/register", async (request, reply) => {
    const body = request.body as {
      fullName?: string;
      email?: string;
      phone?: string;
      password?: string;
    } | null;

    if (!body?.fullName || !body.email || !body.phone || !body.password) {
      return reply.status(400).send({
        error: "fullName, email, phone, dan password wajib diisi.",
        code: "VALIDATION_ERROR",
      });
    }

    if (body.password.length < 6) {
      return reply.status(400).send({
        error: "Password minimal 6 karakter.",
        code: "VALIDATION_ERROR",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(body.email)) {
      return reply.status(400).send({
        error: "Format email tidak valid.",
        code: "VALIDATION_ERROR",
      });
    }

    try {
      const result = await service.register({
        fullName: body.fullName,
        email: body.email.toLowerCase().trim(),
        phone: body.phone.trim(),
        password: body.password,
      });
      return reply.status(201).send(result);
    } catch (e) {
      if (e instanceof service.CustomerAuthError) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code });
      }
      throw e;
    }
  });

  fastify.post("/gateway/auth/login", async (request, reply) => {
    const body = request.body as {
      email?: string;
      phone?: string;
      password?: string;
    } | null;

    const identifier = body?.email ?? body?.phone;
    if (!identifier || !body?.password) {
      return reply.status(400).send({
        error: "Email/nomor telepon dan password wajib diisi.",
        code: "VALIDATION_ERROR",
      });
    }

    try {
      const result = await service.login(identifier.toLowerCase().trim(), body.password);
      return result;
    } catch (e) {
      if (e instanceof service.CustomerAuthError) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code });
      }
      throw e;
    }
  });

  fastify.get("/gateway/auth/me", async (request, reply) => {
    const token = extractCustomerToken(request);
    if (!token) {
      return reply.status(401).send({ error: "Authorization diperlukan.", code: "AUTH_ERROR" });
    }

    try {
      const payload = service.verifyCustomerToken(token);
      const profile = await service.getProfile(payload.sub);
      return profile;
    } catch (e) {
      if (e instanceof service.CustomerAuthError) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code });
      }
      throw e;
    }
  });

  fastify.put("/gateway/auth/profile", async (request, reply) => {
    const token = extractCustomerToken(request);
    if (!token) {
      return reply.status(401).send({ error: "Authorization diperlukan.", code: "AUTH_ERROR" });
    }

    const body = request.body as { fullName?: string; phone?: string } | null;
    if (!body || (!body.fullName && !body.phone)) {
      return reply.status(400).send({
        error: "Minimal satu field (fullName atau phone) harus diisi.",
        code: "VALIDATION_ERROR",
      });
    }

    try {
      const payload = service.verifyCustomerToken(token);
      const updated = await service.updateProfile(payload.sub, body);
      return updated;
    } catch (e) {
      if (e instanceof service.CustomerAuthError) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code });
      }
      throw e;
    }
  });

  fastify.post("/gateway/auth/change-password", async (request, reply) => {
    const token = extractCustomerToken(request);
    if (!token) {
      return reply.status(401).send({ error: "Authorization diperlukan.", code: "AUTH_ERROR" });
    }

    const body = request.body as {
      currentPassword?: string;
      newPassword?: string;
    } | null;

    if (!body?.currentPassword || !body.newPassword) {
      return reply.status(400).send({
        error: "currentPassword dan newPassword wajib diisi.",
        code: "VALIDATION_ERROR",
      });
    }

    if (body.newPassword.length < 6) {
      return reply.status(400).send({
        error: "Password baru minimal 6 karakter.",
        code: "VALIDATION_ERROR",
      });
    }

    try {
      const payload = service.verifyCustomerToken(token);
      const result = await service.changePassword(payload.sub, body.currentPassword, body.newPassword);
      return result;
    } catch (e) {
      if (e instanceof service.CustomerAuthError) {
        return reply.status(e.statusCode).send({ error: e.message, code: e.code });
      }
      throw e;
    }
  });
};

export default customerRoutes;
