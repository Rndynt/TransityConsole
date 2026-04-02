import type { FastifyPluginAsync } from "fastify";
import { eq, desc } from "drizzle-orm";
import { db, operatorsTable, terminalHealthTable } from "@workspace/db";

const terminalsRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/terminals/health", async () => {
    const operators = await db.select().from(operatorsTable).where(eq(operatorsTable.active, true));

    const terminals = await Promise.all(
      operators.map(async (op) => {
        const [latest] = await db
          .select()
          .from(terminalHealthTable)
          .where(eq(terminalHealthTable.operatorId, op.id))
          .orderBy(desc(terminalHealthTable.checkedAt))
          .limit(1);

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
  });
};

export default terminalsRoutes;
