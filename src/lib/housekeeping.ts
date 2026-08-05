import { roomStatusColor } from "./roomStatusColors";

export const TASK_TYPES = ["cleaning", "inspection", "maintenance", "laundry", "other"] as const;
export type TaskType = (typeof TASK_TYPES)[number];

export const TASK_STATUSES = ["pending", "in_progress", "done", "skipped"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];

export const TASK_PRIORITIES = ["low", "normal", "high", "urgent"] as const;
export type TaskPriority = (typeof TASK_PRIORITIES)[number];

export const TASK_STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800 border-amber-300",
  in_progress: "bg-sky-100 text-sky-800 border-sky-300",
  done: "bg-emerald-100 text-emerald-800 border-emerald-300",
  skipped: "bg-slate-100 text-slate-700 border-slate-300",
};

export const PRIORITY_TONE: Record<string, string> = {
  low: "bg-slate-100 text-slate-700 border-slate-300",
  normal: "bg-slate-100 text-slate-700 border-slate-300",
  high: "bg-orange-100 text-orange-800 border-orange-300",
  urgent: "bg-rose-100 text-rose-800 border-rose-300",
};

// Badge tones mirror the shared room-status palette
// (white vacant, green occupied, yellow dirty, grey maintenance, pink event).
export const ROOM_STATUS_TONE: Record<string, string> = {
  vacant: "bg-white text-slate-900 border-slate-300",
  occupied: "bg-green-600 text-white border-green-700",
  blocked: "bg-pink-500 text-white border-pink-600",
  maintenance: "bg-gray-500 text-white border-gray-600",
};

export const HK_STATUS_TONE: Record<string, string> = {
  clean: "bg-white text-slate-900 border-slate-300",
  dirty: "bg-yellow-400 text-yellow-950 border-yellow-500",
  inspected: "bg-green-600 text-white border-green-700",
  out_of_order: "bg-gray-500 text-white border-gray-600",
};

export const HK_STATUSES = ["clean", "dirty", "inspected", "out_of_order"] as const;
export type HkStatus = (typeof HK_STATUSES)[number];

/**
 * Inline badge styles derived from the live (override-aware) room-status
 * palette. Prefer these over the Tailwind *_TONE maps above when a property
 * may have customised its colours.
 */
export function roomStatusBadgeStyle(status: string) {
  const c = roomStatusColor(
    status === "occupied" || status === "blocked" || status === "maintenance"
      ? status
      : "vacant",
  );
  return { backgroundColor: c.bg, color: c.fg, borderColor: c.border };
}

export function hkStatusBadgeStyle(hk: string) {
  const kind =
    hk === "dirty" ? "dirty" : hk === "out_of_order" ? "maintenance" : hk === "inspected" ? "occupied" : "vacant";
  const c = roomStatusColor(kind);
  return { backgroundColor: c.bg, color: c.fg, borderColor: c.border };
}