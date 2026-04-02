import { Router, type IRouter } from "express";
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

const router: IRouter = Router();

router.get("/operators", async (req, res): Promise<void> => {
  const parsed = ListOperatorsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const { active, page = 1, limit = 20 } = parsed.data;
  const offset = (page - 1) * limit;

  const baseQuery = db.select().from(operatorsTable);
  const whereClause = active !== undefined ? eq(operatorsTable.active, active) : undefined;

  let rows;
  if (whereClause) {
    rows = await db.select().from(operatorsTable).where(whereClause).orderBy(desc(operatorsTable.createdAt)).limit(limit).offset(offset);
  } else {
    rows = await db.select().from(operatorsTable).orderBy(desc(operatorsTable.createdAt)).limit(limit).offset(offset);
  }

  let countRows;
  if (whereClause) {
    countRows = await db.select().from(operatorsTable).where(whereClause);
  } else {
    countRows = await db.select().from(operatorsTable);
  }
  const total = countRows.length;

  res.json({
    data: rows.map(formatOperator),
    total,
    page,
    limit,
    hasMore: offset + rows.length < total,
  });
});

router.post("/operators", async (req, res): Promise<void> => {
  const parsed = CreateOperatorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
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
  res.status(201).json(formatOperator(op));
});

router.get("/operators/:id", async (req, res): Promise<void> => {
  const params = GetOperatorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [op] = await db.select().from(operatorsTable).where(eq(operatorsTable.id, params.data.id));
  if (!op) {
    res.status(404).json({ error: "Operator not found" });
    return;
  }
  res.json(formatOperator(op));
});

router.patch("/operators/:id", async (req, res): Promise<void> => {
  const params = UpdateOperatorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const body = UpdateOperatorBody.safeParse(req.body);
  if (!body.success) {
    res.status(400).json({ error: body.error.message });
    return;
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
    res.status(404).json({ error: "Operator not found" });
    return;
  }
  res.json(formatOperator(op));
});

router.delete("/operators/:id", async (req, res): Promise<void> => {
  const params = DeleteOperatorParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [op] = await db.delete(operatorsTable).where(eq(operatorsTable.id, params.data.id)).returning();
  if (!op) {
    res.status(404).json({ error: "Operator not found" });
    return;
  }
  res.sendStatus(204);
});

router.post("/operators/:id/ping", async (req, res): Promise<void> => {
  const params = PingOperatorTerminalParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [op] = await db.select().from(operatorsTable).where(eq(operatorsTable.id, params.data.id));
  if (!op) {
    res.status(404).json({ error: "Operator not found" });
    return;
  }

  let status: "online" | "offline" | "degraded" = "offline";
  let latencyMs: number | null = null;

  try {
    const start = Date.now();
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(`${op.apiUrl}/api/health`, {
      signal: controller.signal,
      headers: { "X-Service-Key": op.serviceKey },
    });
    clearTimeout(timeout);
    const elapsed = Date.now() - start;
    latencyMs = elapsed;
    if (response.ok) {
      status = elapsed > 2000 ? "degraded" : "online";
    } else {
      status = "degraded";
    }
  } catch {
    status = "offline";
  }

  await db.insert(terminalHealthTable).values({
    operatorId: op.id,
    status,
    latencyMs: latencyMs !== null ? String(latencyMs) : null,
  });

  res.json({
    operatorId: op.id,
    status,
    latencyMs,
    checkedAt: new Date().toISOString(),
  });
});

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

export default router;
