/**
 * Time-windowed grace period.
 *
 * For 60 minutes after a checkout (`bookings.checked_out_at`) or after a bill
 * is settled (`folios.settled_at`), ANY role at that property may perform the
 * otherwise Owner/Manager-only correction actions (undo checkout, payment
 * amount edit, payment delete, room-rate edit, Bill-To edit).
 *
 * This is mirrored server-side (RPC guards + RLS policies), so hiding/showing
 * in the UI is purely cosmetic — the database is the enforcement point.
 */
export const GRACE_WINDOW_MS = 60 * 60 * 1000;

/** True when `ts` is within the last 60 minutes. */
export function withinGraceWindow(ts?: string | null, now: number = Date.now()): boolean {
  if (!ts) return false;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return false;
  const elapsed = now - t;
  return elapsed >= -60_000 && elapsed <= GRACE_WINDOW_MS;
}

/** Whole minutes left in the grace window (0 when expired). */
export function graceMinutesLeft(ts?: string | null, now: number = Date.now()): number {
  if (!ts) return 0;
  const t = new Date(ts).getTime();
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((GRACE_WINDOW_MS - (now - t)) / 60000));
}
