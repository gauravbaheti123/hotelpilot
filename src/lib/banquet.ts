export const BANQUET_STATUS_TONE: Record<string, string> = {
  reserved: "bg-amber-100 text-amber-800 border-amber-300",
  confirmed: "bg-blue-100 text-blue-800 border-blue-300",
  in_progress: "bg-indigo-100 text-indigo-800 border-indigo-300",
  completed: "bg-emerald-100 text-emerald-800 border-emerald-300",
  cancelled: "bg-rose-100 text-rose-800 border-rose-300",
};

export const FUNCTION_TYPES = [
  "Wedding",
  "Birthday",
  "Anniversary",
  "Corporate",
  "Conference",
  "Other",
];

export function computeBanquetTotal(p: {
  hall_charge?: number; fb_charge?: number; extra_charge?: number;
  package_rate?: number; pax?: number; discount_amount?: number;
}) {
  const pkg = Number(p.package_rate ?? 0) * Number(p.pax ?? 0);
  const sub = Number(p.hall_charge ?? 0) + Number(p.fb_charge ?? 0) + Number(p.extra_charge ?? 0) + pkg;
  const total = Math.max(0, sub - Number(p.discount_amount ?? 0));
  return Math.round(total * 100) / 100;
}