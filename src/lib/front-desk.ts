import { istDateISO, istToday } from "@/lib/date";
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

/**
 * Phase 34.1 — compare a stay by full date+time, never by date alone, so a
 * same-date day-use stay (in 08:00 → out 20:00) is valid.
 * Returns true only when the check-out instant is strictly after check-in.
 */
export function isValidStayRange(
  checkInDate: string,
  checkOutDate: string,
  checkInTime = "12:00",
  checkOutTime = "11:00",
): boolean {
  if (!checkInDate || !checkOutDate) return false;
  if (checkOutDate > checkInDate) return true;
  if (checkOutDate < checkInDate) return false;
  return (checkOutTime || "11:00") > (checkInTime || "12:00");
}

export function todayIso(): string {
  return istToday();
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return istDateISO(d);
}

export const BOOKING_STATUS_LABEL: Record<string, string> = {
  reserved: "Reserved",
  checked_in: "Checked-in",
  checked_out: "Checked-out",
  cancelled: "Cancelled",
  no_show: "No-show",
};

export const BOOKING_STATUS_TONE: Record<string, string> = {
  reserved: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  checked_in: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  checked_out: "bg-slate-500/10 text-slate-700 dark:text-slate-300",
  cancelled: "bg-rose-500/10 text-rose-700 dark:text-rose-300",
  no_show: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
};

export const SOURCES = [
  { value: "walk_in", label: "Walk-in" },
  { value: "phone", label: "Phone" },
  { value: "website", label: "Website" },
  { value: "ota", label: "OTA" },
  { value: "agent", label: "Travel Agent" },
  { value: "corporate", label: "Corporate" },
  { value: "other", label: "Other (specify)" },
];