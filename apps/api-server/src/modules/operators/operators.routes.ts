import type { FastifyPluginAsync } from "fastify";
import {
  CreateOperatorBody,
  GetOperatorParams,
  UpdateOperatorParams,
  UpdateOperatorBody,
  DeleteOperatorParams,
  PingOperatorTerminalParams,
  ListOperatorsQueryParams,
} from "@workspace/api-zod";
import * as service from "./operators.service.js";

const operatorsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/operators", async (request, reply) => {
    const parsed = ListOperatorsQueryParams.safeParse(request.query);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
    const { active, page = 1, limit = 20 } = parsed.data;
    return service.list({ active }, { page, limit });
  });

  fastify.post("/operators", async (request, reply) => {
    const parsed = CreateOperatorBody.safeParse(request.body);
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.message });
    const op = await service.create(parsed.data);
    return reply.status(201).send(op);
  });

  fastify.get("/operators/:id", async (request, reply) => {
    const params = GetOperatorParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: params.error.message });
    try {
      return await service.getById(params.data.id);
    } catch (e) {
      if (e instanceof service.NotFoundError) return reply.status(404).send({ error: e.message });
      throw e;
    }
  });

  fastify.patch("/operators/:id", async (request, reply) => {
    const params = UpdateOperatorParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: params.error.message });
    const body = UpdateOperatorBody.safeParse(request.body);
    if (!body.success) return reply.status(400).send({ error: body.error.message });
    try {
      return await service.update(params.data.id, body.data);
    } catch (e) {
      if (e instanceof service.NotFoundError) return reply.status(404).send({ error: e.message });
      throw e;
    }
  });

  fastify.delete("/operators/:id", async (request, reply) => {
    const params = DeleteOperatorParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: params.error.message });
    try {
      await service.remove(params.data.id);
      return reply.status(204).send();
    } catch (e) {
      if (e instanceof service.NotFoundError) return reply.status(404).send({ error: e.message });
      throw e;
    }
  });

  fastify.post("/operators/:id/ping", async (request, reply) => {
    const params = PingOperatorTerminalParams.safeParse(request.params);
    if (!params.success) return reply.status(400).send({ error: params.error.message });
    try {
      return await service.ping(params.data.id);
    } catch (e) {
      if (e instanceof service.NotFoundError) return reply.status(404).send({ error: e.message });
      throw e;
    }
  });
};

export default operatorsRoutes;
