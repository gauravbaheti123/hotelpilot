export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = new Date(checkIn);
  const b = new Date(checkOut);
  const ms = b.getTime() - a.getTime();
  return Math.max(1, Math.round(ms / (1000 * 60 * 60 * 24)));
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
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
];