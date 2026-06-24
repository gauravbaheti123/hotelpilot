export const PAYMENT_MODES = ["cash", "card", "upi", "bank"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export const PAYMENT_MODE_LABEL: Record<PaymentMode, string> = {
  cash: "Cash",
  card: "Card",
  upi: "UPI",
  bank: "Bank Transfer",
};

export const PAYMENT_MODE_TONE: Record<PaymentMode, string> = {
  cash: "bg-green-100 text-green-700 border-green-200",
  card: "bg-blue-100 text-blue-700 border-blue-200",
  upi: "bg-purple-100 text-purple-700 border-purple-200",
  bank: "bg-slate-100 text-slate-700 border-slate-200",
};

export const DEFAULT_CATEGORIES = [
  "Salaries",
  "Utilities",
  "Repairs & Maintenance",
  "Cleaning Supplies",
  "Food & Groceries",
  "Travel",
  "Office Expenses",
  "Marketing",
  "Commissions",
  "Miscellaneous",
];