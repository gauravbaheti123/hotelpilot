export const FEEDBACK_SOURCES = [
  { value: "in_person", label: "In-person" },
  { value: "email", label: "Email" },
  { value: "phone", label: "Phone" },
  { value: "google", label: "Google" },
  { value: "tripadvisor", label: "TripAdvisor" },
  { value: "booking_com", label: "Booking.com" },
  { value: "makemytrip", label: "MakeMyTrip" },
  { value: "other", label: "Other" },
];

export const FEEDBACK_STATUSES = [
  { value: "new", label: "New" },
  { value: "acknowledged", label: "Acknowledged" },
  { value: "resolved", label: "Resolved" },
];

export const STATUS_TONE: Record<string, string> = {
  new: "bg-amber-500/10 text-amber-700 dark:text-amber-300",
  acknowledged: "bg-blue-500/10 text-blue-700 dark:text-blue-300",
  resolved: "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
};

export function ratingTone(rating: number | null | undefined): string {
  if (rating == null) return "text-muted-foreground";
  if (rating >= 4) return "text-emerald-700 dark:text-emerald-300";
  if (rating >= 3) return "text-blue-700 dark:text-blue-300";
  if (rating >= 2) return "text-amber-700 dark:text-amber-300";
  return "text-rose-700 dark:text-rose-300";
}

export function ratingLabel(rating: number): string {
  return ["", "Terrible", "Poor", "Average", "Good", "Excellent"][rating] ?? "";
}

export function avg(nums: (number | null | undefined)[]): number | null {
  const list = nums.filter((n): n is number => typeof n === "number");
  if (list.length === 0) return null;
  return list.reduce((a, b) => a + b, 0) / list.length;
}

export function npsCategory(rating: number): "promoter" | "passive" | "detractor" {
  if (rating >= 4) return "promoter";
  if (rating === 3) return "passive";
  return "detractor";
}