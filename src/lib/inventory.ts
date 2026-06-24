export const ITEM_CATEGORIES = [
  "general",
  "food",
  "beverage",
  "housekeeping",
  "maintenance",
  "stationery",
  "linen",
] as const;
export type ItemCategory = (typeof ITEM_CATEGORIES)[number];

export const UNITS = ["pcs", "kg", "g", "ltr", "ml", "box", "pack", "dozen"] as const;

export const MOVEMENT_TYPES = ["in", "out", "adjust"] as const;
export type MovementType = (typeof MOVEMENT_TYPES)[number];

export const MOVEMENT_LABEL: Record<MovementType, string> = {
  in: "Stock In (Purchase)",
  out: "Stock Out (Issue)",
  adjust: "Adjustment",
};

export const MOVEMENT_TONE: Record<MovementType, string> = {
  in: "bg-green-100 text-green-700 border-green-200",
  out: "bg-amber-100 text-amber-700 border-amber-200",
  adjust: "bg-blue-100 text-blue-700 border-blue-200",
};

export const DEPARTMENTS = [
  "kitchen",
  "front_desk",
  "housekeeping",
  "maintenance",
  "banquet",
  "office",
] as const;