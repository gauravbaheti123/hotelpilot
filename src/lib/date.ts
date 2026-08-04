/**
 * IST-aware date helpers.
 *
 * The app operates in Asia/Kolkata (UTC+5:30). Using
 * `new Date().toISOString().slice(0, 10)` silently returns the *previous*
 * day between 00:00 and 05:30 IST. Always use these helpers for business
 * dates, report date-pickers and date-input defaults.
 */

export const IST_TZ = "Asia/Kolkata";

const ymdFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: IST_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** YYYY-MM-DD for the given instant, in IST. */
export function istDateISO(d: Date | string | number = new Date()): string {
  const date = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(date.getTime())) return "";
  return ymdFormatter.format(date);
}

/** Today's business date (YYYY-MM-DD) in IST. */
export function istToday(): string {
  return istDateISO(new Date());
}

/** Shift a YYYY-MM-DD business date by N days (calendar-safe, TZ-free). */
export function istAddDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const base = new Date(Date.UTC(y, (m || 1) - 1, d || 1));
  base.setUTCDate(base.getUTCDate() + days);
  return base.toISOString().slice(0, 10);
}

/** Business date N days before today (IST). */
export function istDaysAgo(days: number): string {
  return istAddDays(istToday(), -days);
}

/** First day of the current IST month. */
export function istMonthStart(iso: string = istToday()): string {
  return `${iso.slice(0, 7)}-01`;
}

/** Last day of the IST month containing `iso`. */
export function istMonthEnd(iso: string = istToday()): string {
  const [y, m] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(y, m, 0));
  return d.toISOString().slice(0, 10);
}

/** Current IST wall-clock time as HH:mm. */
export function istTimeHHmm(d: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: IST_TZ,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(d);
}
