import * as bookingsRepo from "../bookings/bookings.repository.js";
import * as operatorsRepo from "../operators/operators.repository.js";

const TERMINAL_TIMEOUT_MS = 8000;
const RECONCILE_INTERVAL_MS = 60_000;
const MAX_UNCERTAIN_AGE_MINUTES = 60;

let reconcilerTimer: ReturnType<typeof setInterval> | null = null;

async function reconcileUncertainBookings(): Promise<void> {
  let uncertain: Awaited<ReturnType<typeof bookingsRepo.findUncertainBookings>>;
  try {
    uncertain = await bookingsRepo.findUncertainBookings(MAX_UNCERTAIN_AGE_MINUTES);
  } catch (e) {
    console.error("[reconciler] Failed to query uncertain bookings:", e);
    return;
  }

  if (uncertain.length === 0) return;

  console.info(`[reconciler] Checking ${uncertain.length} uncertain booking(s)`);

  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operatorMap = new Map(operators.map((o) => [o.id, o]));

  for (const booking of uncertain) {
    const operator = operatorMap.get(booking.operatorId);
    if (!operator) {
      console.warn(`[reconciler] Operator not found for booking ${booking.id}, skipping`);
      continue;
    }

    // If we have an externalBookingId, check that booking's status at the terminal
    if (booking.externalBookingId) {
      try {
        const res = await fetch(
          `${operator.apiUrl}/api/app/bookings/${encodeURIComponent(booking.externalBookingId)}`,
          {
            signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
            headers: { "X-Service-Key": operator.serviceKey },
          }
        );

        if (res.ok) {
          const data = (await res.json()) as Record<string, unknown>;
          const terminalStatus = String(data["status"] ?? "");
          const totalAmount = data["totalAmount"] ? String(data["totalAmount"]) : String(booking.totalAmount);
          const holdExpiresAt = data["holdExpiresAt"] ? new Date(String(data["holdExpiresAt"])) : null;

          // Map terminal status to our status
          const newStatus = terminalStatus === "held" || terminalStatus === "pending" ? terminalStatus : "pending";

          await bookingsRepo.updateFromTerminalSuccess(booking.id, {
            externalBookingId: booking.externalBookingId,
            totalAmount,
            commissionAmount: String(booking.commissionAmount ?? "0"),
            holdExpiresAt,
            status: newStatus,
          });

          console.info(`[reconciler] Booking ${booking.id} reconciled: uncertain → ${newStatus}`);
        } else if (res.status === 404) {
          // Terminal doesn't know this booking — it was likely not processed
          // Cancel it to avoid user confusion
          await bookingsRepo.updateStatus(booking.id, "cancelled");
          console.info(`[reconciler] Booking ${booking.id} not found at terminal, marked cancelled`);
        }
      } catch {
        // Terminal still unavailable — leave as uncertain for next cycle
        console.warn(`[reconciler] Terminal unreachable for booking ${booking.id}, will retry`);
      }
    } else {
      // No externalBookingId means terminal never processed it; safe to cancel
      await bookingsRepo.updateStatus(booking.id, "cancelled");
      console.info(`[reconciler] Booking ${booking.id} has no externalBookingId, marked cancelled`);
    }
  }
}

export function startReconciler(): void {
  if (reconcilerTimer) return;
  // Run once shortly after startup, then on interval
  setTimeout(() => reconcileUncertainBookings().catch(console.error), 15_000);
  reconcilerTimer = setInterval(() => {
    reconcileUncertainBookings().catch(console.error);
  }, RECONCILE_INTERVAL_MS);
  console.info("[reconciler] Uncertain booking reconciler started — interval: 60s");
}

export function stopReconciler(): void {
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
  }
}
