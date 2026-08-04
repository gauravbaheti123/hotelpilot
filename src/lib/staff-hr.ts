import { istDateISO, istMonthStart, istMonthEnd } from "@/lib/date";
export const ATTENDANCE_STATUSES = [
  "present", "absent", "half_day", "leave", "week_off",
] as const;
export type AttendanceStatus = (typeof ATTENDANCE_STATUSES)[number];

export const ATTENDANCE_LABEL: Record<AttendanceStatus, string> = {
  present: "Present",
  absent: "Absent",
  half_day: "Half day",
  leave: "Leave",
  week_off: "Week off",
};

export const ATTENDANCE_TONE: Record<AttendanceStatus, string> = {
  present: "bg-green-100 text-green-700 border-green-200",
  absent: "bg-red-100 text-red-700 border-red-200",
  half_day: "bg-amber-100 text-amber-700 border-amber-200",
  leave: "bg-blue-100 text-blue-700 border-blue-200",
  week_off: "bg-slate-100 text-slate-700 border-slate-200",
};

// Day weight used for payroll calculation
export const ATTENDANCE_WEIGHT: Record<AttendanceStatus, number> = {
  present: 1,
  half_day: 0.5,
  leave: 0,
  absent: 0,
  week_off: 1, // paid weekly off
};

export function monthStart(d = new Date()): string {
  return istMonthStart(istDateISO(d));
}

export function monthEnd(d = new Date()): string {
  return istMonthEnd(istDateISO(d));
}

export function daysInMonth(periodStart: string): number {
  const d = new Date(periodStart);
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}

export function formatMonth(period: string): string {
  const d = new Date(period);
  return d.toLocaleString("en-IN", { month: "long", year: "numeric" });
}