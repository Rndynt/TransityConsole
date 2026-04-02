import * as operatorsRepo from "../operators/operators.repository.js";

const CHECK_INTERVAL_MS = 60_000;
const PING_TIMEOUT_MS = 5000;

async function pingTerminal(operator: {
  id: string;
  slug: string;
  apiUrl: string;
  serviceKey: string;
}): Promise<{ status: "online" | "offline" | "degraded"; latencyMs: number | null }> {
  try {
    const start = Date.now();
    const res = await fetch(`${operator.apiUrl}/api/health`, {
      signal: AbortSignal.timeout(PING_TIMEOUT_MS),
      headers: { "X-Service-Key": operator.serviceKey },
    });
    const latencyMs = Date.now() - start;

    if (!res.ok) return { status: "degraded", latencyMs };
    if (latencyMs > 1000) return { status: "degraded", latencyMs };
    return { status: "online", latencyMs };
  } catch {
    return { status: "offline", latencyMs: null };
  }
}

async function runHealthChecks() {
  try {
    const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });

    await Promise.allSettled(
      operators.map(async (op) => {
        const { status, latencyMs } = await pingTerminal(op);
        await operatorsRepo.recordHealthCheck(op.id, status, latencyMs);
      })
    );
  } catch (err) {
    console.error("[scheduler] Health check failed:", err);
  }
}

let intervalId: ReturnType<typeof setInterval> | null = null;

export function startHealthScheduler() {
  if (intervalId) return;

  console.log(`[scheduler] Terminal health checks started — interval: ${CHECK_INTERVAL_MS / 1000}s`);

  runHealthChecks();

  intervalId = setInterval(() => {
    runHealthChecks();
  }, CHECK_INTERVAL_MS);
}

export function stopHealthScheduler() {
  if (intervalId) {
    clearInterval(intervalId);
    intervalId = null;
    console.log("[scheduler] Terminal health checks stopped");
  }
}
