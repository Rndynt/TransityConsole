import { Router, type IRouter } from "express";
import { eq, desc, sql } from "drizzle-orm";
import { db, operatorsTable, terminalHealthTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/terminals/health", async (_req, res): Promise<void> => {
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

  const online = terminals.filter((t) => t.status === "online").length;
  const offline = terminals.filter((t) => t.status === "offline").length;
  const degraded = terminals.filter((t) => t.status === "degraded").length;

  res.json({
    total: terminals.length,
    online,
    offline,
    degraded,
    terminals,
  });
});

export default router;
