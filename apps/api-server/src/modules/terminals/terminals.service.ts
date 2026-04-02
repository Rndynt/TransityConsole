import * as repo from "./terminals.repository.js";

export async function getHealthSummary() {
  const operators = await repo.findAllActiveOperators();

  const terminals = await Promise.all(
    operators.map(async (op) => {
      const latest = await repo.findLatestHealthForOperator(op.id);
      return {
        operatorId: op.id,
        operatorName: op.name,
        operatorSlug: op.slug,
        status: (latest?.status ?? "offline") as "online" | "offline" | "degraded",
        latencyMs: latest?.latencyMs ? parseFloat(String(latest.latencyMs)) : null,
        lastCheckedAt: latest?.checkedAt?.toISOString() ?? null,
      };
    })
  );

  return {
    total: terminals.length,
    online: terminals.filter((t) => t.status === "online").length,
    offline: terminals.filter((t) => t.status === "offline").length,
    degraded: terminals.filter((t) => t.status === "degraded").length,
    terminals,
  };
}
