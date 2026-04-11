import * as bookingsRepo from "../bookings/bookings.repository.js";
import * as operatorsRepo from "../operators/operators.repository.js";

const TERMINAL_TIMEOUT_MS = 8000;
const RECONCILE_INTERVAL_MS = 60_000;
const MAX_UNCERTAIN_AGE_MINUTES = 60;

let reconcilerTimer: ReturnType<typeof setInterval> | null = null;

// Expire booking pending yang holdExpiresAt-nya sudah lewat
async function expireExpiredPendingBookings(): Promise<void> {
  let expired: Awaited<ReturnType<typeof bookingsRepo.findExpiredPendingBookings>>;
  try {
    expired = await bookingsRepo.findExpiredPendingBookings();
  } catch (e) {
    console.error("[reconciler] Failed to query expired pending bookings:", e);
    return;
  }

  if (expired.length === 0) return;
  console.info(`[reconciler] Expiring ${expired.length} pending booking(s) past holdExpiresAt`);

  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operatorMap = new Map(operators.map((o) => [o.id, o]));

  for (const booking of expired) {
    const updated = await bookingsRepo.updateStatusConditional(booking.id, "expired", ["pending"]);
    if (!updated) continue; // race condition — sudah diproses thread lain

    console.info(`[reconciler] Booking ${booking.id} expired (hold deadline passed)`);

    // Lepas kursi di terminal (best-effort, tidak blocking)
    const operator = operatorMap.get(booking.operatorId);
    if (operator && booking.externalBookingId) {
      fetch(
        `${operator.apiUrl}/api/app/bookings/${encodeURIComponent(booking.externalBookingId)}/cancel`,
        {
          method: "POST",
          signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
          headers: { "X-Service-Key": operator.serviceKey, "Content-Type": "application/json" },
        }
      ).catch((err) => {
        console.warn(
          `[reconciler] Failed to release expired seats at terminal for booking ${booking.id}:`,
          err instanceof Error ? err.message : err
        );
      });
    }
  }
}

// Reconcile booking uncertain: cek ke terminal apakah booking berhasil dibuat
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
      console.warn(`[reconciler] Operator not found for booking ${booking.id}, cancelling`);
      await bookingsRepo.updateStatus(booking.id, "cancelled");
      continue;
    }

    if (booking.externalBookingId) {
      // Terminal sempat menerima booking — cek statusnya
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

          // Terminal punya booking → reconcile ke pending
          await bookingsRepo.updateFromTerminalSuccess(booking.id, {
            externalBookingId: booking.externalBookingId,
            totalAmount,
            commissionAmount: String(booking.commissionAmount ?? "0"),
            holdExpiresAt,
            status: "pending",
          });

          console.info(`[reconciler] Booking ${booking.id} reconciled: uncertain → pending (terminal: ${terminalStatus})`);
        } else if (res.status === 404) {
          // Terminal tidak punya booking → batalkan
          await bookingsRepo.updateStatus(booking.id, "cancelled");
          console.info(`[reconciler] Booking ${booking.id} not found at terminal → cancelled`);
        }
        // Jika terminal masih error (5xx) → biarkan uncertain, coba lagi cycle berikutnya
      } catch {
        console.warn(`[reconciler] Terminal unreachable for booking ${booking.id}, will retry next cycle`);
      }
    } else {
      // Tidak ada externalBookingId → terminal tidak sempat memproses → batalkan
      await bookingsRepo.updateStatus(booking.id, "cancelled");
      console.info(`[reconciler] Booking ${booking.id} has no externalBookingId → cancelled`);
    }
  }
}

// Retry notifikasi terminal yang gagal setelah payment confirmed
async function retryFailedTerminalNotifications(): Promise<void> {
  let unnotified: Awaited<ReturnType<typeof bookingsRepo.findUnnotifiedConfirmedBookings>>;
  try {
    unnotified = await bookingsRepo.findUnnotifiedConfirmedBookings();
  } catch (e) {
    console.error("[reconciler] Failed to query unnotified bookings:", e);
    return;
  }

  if (unnotified.length === 0) return;
  console.info(`[reconciler] Retrying terminal notification for ${unnotified.length} confirmed booking(s)`);

  const { rows: operators } = await operatorsRepo.findAll({ active: true }, { limit: 100, offset: 0 });
  const operatorMap = new Map(operators.map((o) => [o.id, o]));

  for (const booking of unnotified) {
    if (!booking.externalBookingId || !booking.providerRef || !booking.paymentMethod) continue;

    const operator = operatorMap.get(booking.operatorId);
    if (!operator) continue;

    try {
      const res = await fetch(
        `${operator.apiUrl}/api/app/bookings/${encodeURIComponent(booking.externalBookingId)}/confirm-paid`,
        {
          method: "POST",
          signal: AbortSignal.timeout(TERMINAL_TIMEOUT_MS),
          headers: {
            "X-Service-Key": operator.serviceKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            providerRef: booking.providerRef,
            paymentMethod: booking.paymentMethod,
          }),
        }
      );

      if (res.ok || res.status === 400) {
        await bookingsRepo.markTerminalNotified(booking.operatorId, booking.externalBookingId);
        console.info(`[reconciler] Terminal notified for booking ${booking.id}`);
      }
    } catch (err) {
      console.warn(
        `[reconciler] Retry notification failed for booking ${booking.id}:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

export function startReconciler(): void {
  if (reconcilerTimer) return;

  // Jalankan pertama kali setelah 15 detik (tunggu server fully up)
  setTimeout(() => {
    expireExpiredPendingBookings().catch(console.error);
    reconcileUncertainBookings().catch(console.error);
    retryFailedTerminalNotifications().catch(console.error);
  }, 15_000);

  reconcilerTimer = setInterval(() => {
    expireExpiredPendingBookings().catch(console.error);
    reconcileUncertainBookings().catch(console.error);
    retryFailedTerminalNotifications().catch(console.error);
  }, RECONCILE_INTERVAL_MS);

  console.info("[reconciler] Started — interval: 60s (expire pending + reconcile uncertain + retry notifications)");
}

export function stopReconciler(): void {
  if (reconcilerTimer) {
    clearInterval(reconcilerTimer);
    reconcilerTimer = null;
  }
}
