import type { FastifyPluginAsync } from "fastify";
import * as service from "./auth.service.js";

const authRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/auth/login", async (request, reply) => {
    const { email, password } = request.body as { email?: string; password?: string };
    if (!email || !password) {
      return reply.status(400).send({ error: "email and password are required" });
    }
    try {
      const result = await service.login(email, password);
      return result;
    } catch (e) {
      if (e instanceof service.AuthError) return reply.status(401).send({ error: e.message });
      throw e;
    }
  });

  fastify.post("/auth/setup", async (request, reply) => {
    const { email, password, role } = request.body as { email?: string; password?: string; role?: string };
    if (!email || !password) {
      return reply.status(400).send({ error: "email and password are required" });
    }
    try {
      const user = await service.createAdmin(email, password, role);
      return reply.status(201).send(user);
    } catch (e) {
      if (e instanceof service.AuthError) return reply.status(409).send({ error: e.message });
      throw e;
    }
  });

  fastify.get("/auth/me", async (request, reply) => {
    const token = (request.headers.authorization ?? "").replace("Bearer ", "");
    if (!token) return reply.status(401).send({ error: "Authorization required" });
    try {
      const payload = service.verifyToken(token);
      return { id: payload.sub, email: payload.email, role: payload.role };
    } catch {
      return reply.status(401).send({ error: "Invalid token" });
    }
  });

  fastify.get("/auth/api-keys", async (request, reply) => {
    const token = (request.headers.authorization ?? "").replace("Bearer ", "");
    if (!token) return reply.status(401).send({ error: "Authorization required" });
    try {
      service.verifyToken(token);
    } catch {
      return reply.status(401).send({ error: "Invalid token" });
    }
    return service.listApiKeys();
  });

  fastify.post("/auth/api-keys", async (request, reply) => {
    const token = (request.headers.authorization ?? "").replace("Bearer ", "");
    if (!token) return reply.status(401).send({ error: "Authorization required" });
    try {
      service.verifyToken(token);
    } catch {
      return reply.status(401).send({ error: "Invalid token" });
    }
    const { name, scopes, expiresAt } = request.body as { name?: string; scopes?: string[]; expiresAt?: string };
    if (!name) return reply.status(400).send({ error: "name is required" });

    const result = await service.generateApiKey(
      name,
      scopes ?? ["gateway:read", "gateway:write"],
      expiresAt ? new Date(expiresAt) : null
    );
    return reply.status(201).send(result);
  });

  fastify.delete("/auth/api-keys/:id", async (request, reply) => {
    const token = (request.headers.authorization ?? "").replace("Bearer ", "");
    if (!token) return reply.status(401).send({ error: "Authorization required" });
    try {
      service.verifyToken(token);
    } catch {
      return reply.status(401).send({ error: "Invalid token" });
    }
    const { id } = request.params as { id: string };
    await service.revokeApiKey(id);
    return reply.status(204).send();
  });
};

export default authRoutes;
