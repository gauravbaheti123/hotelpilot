export const SEASON_TYPES = [
  { value: "peak", label: "Peak", color: "#dc2626" },
  { value: "high", label: "High", color: "#f97316" },
  { value: "normal", label: "Normal", color: "#3b82f6" },
  { value: "low", label: "Low", color: "#10b981" },
  { value: "off", label: "Off", color: "#64748b" },
];

export function seasonColor(type: string): string {
  return SEASON_TYPES.find((s) => s.value === type)?.color ?? "#3b82f6";
}

export interface RateSeason {
  id: string;
  name: string;
  season_type: string;
  start_date: string;
  end_date: string;
  multiplier: number;
  priority: number;
  color: string;
  is_active: boolean;
  applies_to_category_id: string | null;
}

/** Pick the highest-priority active season that covers `day` for `categoryId`. */
export function pickSeason(
  seasons: RateSeason[],
  day: string,
  categoryId: string | null,
): RateSeason | null {
  let best: RateSeason | null = null;
  for (const s of seasons) {
    if (!s.is_active) continue;
    if (day < s.start_date || day > s.end_date) continue;
    if (s.applies_to_category_id && s.applies_to_category_id !== categoryId) continue;
    if (!best || s.priority > best.priority) best = s;
  }
  return best;
}

export function effectiveRate(base: number, season: RateSeason | null): number {
  if (!season) return base;
  return Math.round(base * Number(season.multiplier));
}