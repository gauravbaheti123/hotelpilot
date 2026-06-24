export const SUNDRY_CATEGORIES = [
  { value: "mini_bar", label: "Mini-bar", color: "#f97316" },
  { value: "laundry", label: "Laundry", color: "#3b82f6" },
  { value: "spa", label: "Spa & Wellness", color: "#ec4899" },
  { value: "transport", label: "Transport / Cab", color: "#10b981" },
  { value: "telephone", label: "Telephone", color: "#8b5cf6" },
  { value: "business", label: "Business centre", color: "#0ea5e9" },
  { value: "damage", label: "Damage / Penalty", color: "#dc2626" },
  { value: "other", label: "Other", color: "#64748b" },
];

export function categoryLabel(value: string): string {
  return SUNDRY_CATEGORIES.find((c) => c.value === value)?.label ?? value;
}
export function categoryColor(value: string): string {
  return SUNDRY_CATEGORIES.find((c) => c.value === value)?.color ?? "#64748b";
}

export const SUNDRY_UNITS = [
  { value: "pcs", label: "pcs" },
  { value: "kg", label: "kg" },
  { value: "hr", label: "hr" },
  { value: "km", label: "km" },
  { value: "min", label: "min" },
  { value: "service", label: "service" },
];