import type { FastifyPluginAsync } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db, operatorsTable, terminalHealthTable } from "@workspace/db";
import {
  CreateOperatorBody,
  GetOperatorParams,
  UpdateOperatorParams,
  UpdateOperatorBody,
  DeleteOperatorParams,
  PingOperatorTerminalParams,
  ListOperatorsQueryParams,
} from "@workspace/api-zod";

const operatorsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/operators", async (request, reply) => {
    const parsed = ListOperatorsQueryParams.safeParse(request.query);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const { active, page = 1, limit = 20 } = parsed.data;
    const offset = (page - 1) * limit;
    const whereClause = active !== undefined ? eq(operatorsTable.active, active) : undefined;

    const [rows, countRows] = await Promise.all([
      whereClause
        ? db.select().from(operatorsTable).where(whereClause).orderBy(desc(operatorsTable.createdAt)).limit(limit).offset(offset)
        : db.select().from(operatorsTable).orderBy(desc(operatorsTable.createdAt)).limit(limit).offset(offset),
      whereClause
        ? db.select().from(operatorsTable).where(whereClause)
        : db.select().from(operatorsTable),
    ]);

    const total = countRows.length;
    return {
      data: rows.map(formatOperator),
      total,
      page,
      limit,
      hasMore: offset + rows.length < total,
    };
  });

  fastify.post("/operators", async (request, reply) => {
    const parsed = CreateOperatorBody.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: parsed.error.message });
    }
    const [op] = await db.insert(operatorsTable).values({
      name: parsed.data.name,
      slug: parsed.data.slug,
      apiUrl: parsed.data.apiUrl,
      serviceKey: parsed.data.serviceKey,
      logoUrl: parsed.data.logoUrl ?? null,
      commissionPct: String(parsed.data.commissionPct ?? 0),
      primaryColor: parsed.data.primaryColor ?? null,
      active: true,
    }).returning();
    return reply.status(201).send(formatOperator(op));
  });

  fastify.get("/operators/:id", async (request, reply) => {
    const params = GetOperatorParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: params.error.message });
    }
    const [op] = await db.select().from(operatorsTable).where(eq(operatorsTable.id, params.data.id));
    if (!op) {
      return reply.status(404).send({ error: "Operator not found" });
    }
    return formatOperator(op);
  });

  fastify.patch("/operators/:id", async (request, reply) => {
    const params = UpdateOperatorParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: params.error.message });
    }
    const body = UpdateOperatorBody.safeParse(request.body);
    if (!body.success) {
      return reply.status(400).send({ error: body.error.message });
    }
    const updates: Record<string, unknown> = {};
    if (body.data.name !== undefined) updates.name = body.data.name;
    if (body.data.apiUrl !== undefined) updates.apiUrl = body.data.apiUrl;
    if (body.data.serviceKey !== undefined) updates.serviceKey = body.data.serviceKey;
    if (body.data.active !== undefined) updates.active = body.data.active;
    if (body.data.logoUrl !== undefined) updates.logoUrl = body.data.logoUrl;
    if (body.data.commissionPct !== undefined) updates.commissionPct = String(body.data.commissionPct);
    if (body.data.primaryColor !== undefined) updates.primaryColor = body.data.primaryColor;

    const [op] = await db.update(operatorsTable).set(updates).where(eq(operatorsTable.id, params.data.id)).returning();
    if (!op) {
      return reply.status(404).send({ error: "Operator not found" });
    }
    return formatOperator(op);
  });

  fastify.delete("/operators/:id", async (request, reply) => {
    const params = DeleteOperatorParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: params.error.message });
    }
    const [op] = await db.delete(operatorsTable).where(eq(operatorsTable.id, params.data.id)).returning();
    if (!op) {
      return reply.status(404).send({ error: "Operator not found" });
    }
    return reply.status(204).send();
  });

  fastify.post("/operators/:id/ping", async (request, reply) => {
    const params = PingOperatorTerminalParams.safeParse(request.params);
    if (!params.success) {
      return reply.status(400).send({ error: params.error.message });
    }
    const [op] = await db.select().from(operatorsTable).where(eq(operatorsTable.id, params.data.id));
    if (!op) {
      return reply.status(404).send({ error: "Operator not found" });
    }

    let status: "online" | "offline" | "degraded" = "offline";
    let latencyMs: number | null = null;

    try {
      const start = Date.now();
      const response = await fetch(`${op.apiUrl}/api/health`, {
        signal: AbortSignal.timeout(5000),
        headers: { "X-Service-Key": op.serviceKey },
      });
      const elapsed = Date.now() - start;
      latencyMs = elapsed;
      status = response.ok ? (elapsed > 2000 ? "degraded" : "online") : "degraded";
    } catch {
      status = "offline";
    }

    await db.insert(terminalHealthTable).values({
      operatorId: op.id,
      status,
      latencyMs: latencyMs !== null ? String(latencyMs) : null,
    });

    return { operatorId: op.id, status, latencyMs, checkedAt: new Date().toISOString() };
  });
};

function formatOperator(op: typeof operatorsTable.$inferSelect) {
  return {
    id: op.id,
    name: op.name,
    slug: op.slug,
    apiUrl: op.apiUrl,
    serviceKey: op.serviceKey,
    active: op.active,
    logoUrl: op.logoUrl ?? null,
    commissionPct: parseFloat(String(op.commissionPct)),
    primaryColor: op.primaryColor ?? null,
    createdAt: op.createdAt.toISOString(),
    updatedAt: op.updatedAt.toISOString(),
  };
}

export default operatorsRoutes;
