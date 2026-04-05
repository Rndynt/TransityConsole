import * as repo from "./operators.repository.js";

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export function formatOperator(op: repo.Operator) {
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
    hasWebhookSecret: !!op.webhookSecret,
    createdAt: op.createdAt.toISOString(),
    updatedAt: op.updatedAt.toISOString(),
  };
}

export async function list(
  filters: { active?: boolean },
  pagination: { page: number; limit: number }
) {
  const offset = (pagination.page - 1) * pagination.limit;
  const { rows, total } = await repo.findAll(filters, { limit: pagination.limit, offset });
  return {
    data: rows.map(formatOperator),
    total,
    page: pagination.page,
    limit: pagination.limit,
    hasMore: offset + rows.length < total,
  };
}

export async function getById(id: string) {
  const op = await repo.findById(id);
  if (!op) throw new NotFoundError("Operator not found");
  return formatOperator(op);
}

export async function create(data: {
  name: string;
  slug: string;
  apiUrl: string;
  serviceKey: string;
  logoUrl?: string | null;
  commissionPct?: number;
  primaryColor?: string | null;
  webhookSecret?: string | null;
}) {
  const op = await repo.create({
    name: data.name,
    slug: data.slug,
    apiUrl: data.apiUrl,
    serviceKey: data.serviceKey,
    logoUrl: data.logoUrl ?? null,
    commissionPct: String(data.commissionPct ?? 0),
    primaryColor: data.primaryColor ?? null,
    webhookSecret: data.webhookSecret ?? null,
    active: true,
  });
  return formatOperator(op);
}

export async function update(
  id: string,
  data: {
    name?: string;
    apiUrl?: string;
    serviceKey?: string;
    active?: boolean;
    logoUrl?: string | null;
    commissionPct?: number;
    primaryColor?: string | null;
    webhookSecret?: string | null;
  }
) {
  const updates: Record<string, unknown> = {};
  if (data.name !== undefined) updates.name = data.name;
  if (data.apiUrl !== undefined) updates.apiUrl = data.apiUrl;
  if (data.serviceKey !== undefined) updates.serviceKey = data.serviceKey;
  if (data.active !== undefined) updates.active = data.active;
  if (data.logoUrl !== undefined) updates.logoUrl = data.logoUrl;
  if (data.commissionPct !== undefined) updates.commissionPct = String(data.commissionPct);
  if (data.primaryColor !== undefined) updates.primaryColor = data.primaryColor;
  if (data.webhookSecret !== undefined) updates.webhookSecret = data.webhookSecret;

  const op = await repo.update(id, updates);
  if (!op) throw new NotFoundError("Operator not found");
  return formatOperator(op);
}

export async function remove(id: string): Promise<void> {
  const op = await repo.remove(id);
  if (!op) throw new NotFoundError("Operator not found");
}

export async function ping(id: string) {
  const op = await repo.findById(id);
  if (!op) throw new NotFoundError("Operator not found");

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

  await repo.recordHealthCheck(op.id, status, latencyMs);
  return { operatorId: op.id, status, latencyMs, checkedAt: new Date().toISOString() };
}
