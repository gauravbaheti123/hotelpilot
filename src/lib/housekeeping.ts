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

export const ROOM_STATUS_TONE: Record<string, string> = {
  vacant: "bg-emerald-100 text-emerald-800 border-emerald-300",
  occupied: "bg-sky-100 text-sky-800 border-sky-300",
  blocked: "bg-purple-100 text-purple-800 border-purple-300",
  maintenance: "bg-rose-100 text-rose-800 border-rose-300",
};

export const HK_STATUS_TONE: Record<string, string> = {
  clean: "bg-emerald-100 text-emerald-800 border-emerald-300",
  dirty: "bg-rose-100 text-rose-800 border-rose-300",
  inspected: "bg-sky-100 text-sky-800 border-sky-300",
  out_of_order: "bg-slate-200 text-slate-800 border-slate-300",
};

export const HK_STATUSES = ["clean", "dirty", "inspected", "out_of_order"] as const;
export type HkStatus = (typeof HK_STATUSES)[number];