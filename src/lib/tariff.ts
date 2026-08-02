import { supabase } from "@/integrations/supabase/client";

/**
 * Phase 27b — Tariff Plans are the single source of truth for room pricing.
 *
 * Every pricing read path (New Booking, Room Shift, Assign Room, Extra Bed,
 * Banquet bulk rooms, Rate Calendar) must resolve its rate through
 * `pickTariffPlan` / `resolveTariffForCategory` here. Reading
 * `room_categories.base_rate` or `.extra_bed_rate` is no longer allowed —
 * those columns are dormant and kept only for historical reference.
 */

export interface TariffPlan {
  id: string;
  category_id: string | null;
  name: string;
  meal_plan: string;
  rate: number;
  extra_adult_rate: number | null;
  extra_child_rate: number | null;
  valid_from: string | null;
  valid_to: string | null;
  is_default: boolean | null;
  is_active: boolean | null;
  updated_at: string | null;
}

export const TARIFF_PLAN_SELECT =
  "id,category_id,name,meal_plan,rate,extra_adult_rate,extra_child_rate,valid_from,valid_to,is_default,is_active,updated_at";

export const NO_TARIFF_PLAN_ERROR =
  "No active tariff plan for this category — set one up in Master Data → Tariff Plans";

/**
 * A plan is valid on `date` when the date falls inside [valid_from, valid_to].
 * NULL valid_from means "-infinity", NULL valid_to means "+infinity" — i.e. an
 * "Always" plan that applies to every date.
 */
export function isPlanValidOn(plan: TariffPlan, date: string): boolean {
  if (plan.valid_from && date < plan.valid_from) return false;
  if (plan.valid_to && date > plan.valid_to) return false;
  return true;
}

/** True when the plan carries an explicit (seasonal/specific) validity window. */
function hasWindow(plan: TariffPlan): boolean {
  return !!plan.valid_from || !!plan.valid_to;
}

export interface PickTariffOptions {
  categoryId: string | null | undefined;
  /** Stay date the rate is being determined for — normally the check-in date. */
  date: string;
  /** Optional meal-plan filter (EP/CP/MAP/AP). Omit to consider all plans. */
  mealPlan?: string | null;
}

/**
 * Resolves the applicable plan for a category on a given date.
 *
 * Precedence: a plan with a specific validity window beats an "Always" plan,
 * then `is_default`, then the most recently updated plan.
 * Returns null when no active plan matches — callers must surface that as a
 * data problem, never fall back to `room_categories.base_rate`.
 */
export function pickTariffPlan(
  plans: TariffPlan[],
  { categoryId, date, mealPlan }: PickTariffOptions,
): TariffPlan | null {
  if (!categoryId) return null;
  let matches = plans.filter(
    (p) =>
      p.category_id === categoryId &&
      p.is_active !== false &&
      isPlanValidOn(p, date),
  );
  if (mealPlan) {
    const byMeal = matches.filter((p) => p.meal_plan === mealPlan);
    // Fall back to all plans for the category when the requested meal plan has
    // no configured tariff, rather than returning nothing.
    if (byMeal.length > 0) matches = byMeal;
  }
  if (matches.length === 0) return null;

  const ranked = [...matches].sort((a, b) => {
    const win = Number(hasWindow(b)) - Number(hasWindow(a));
    if (win !== 0) return win;
    const def = Number(b.is_default === true) - Number(a.is_default === true);
    if (def !== 0) return def;
    return String(b.updated_at ?? "").localeCompare(String(a.updated_at ?? ""));
  });
  return ranked[0] ?? null;
}

/** Loads every active tariff plan for a property. */
export async function fetchTariffPlans(propertyId: string): Promise<TariffPlan[]> {
  const { data, error } = await supabase
    .from("tariff_plans")
    .select(TARIFF_PLAN_SELECT)
    .eq("property_id", propertyId)
    .eq("is_active", true)
    .order("name");
  if (error) throw error;
  return ((data ?? []) as unknown as TariffPlan[]).map((p) => ({
    ...p,
    rate: Number(p.rate) || 0,
  }));
}

/** One-shot fetch + resolve, for flows that don't already hold the plan list. */
export async function resolveTariffForCategory(
  propertyId: string,
  categoryId: string | null | undefined,
  date: string,
  mealPlan?: string | null,
): Promise<TariffPlan | null> {
  if (!categoryId) return null;
  const plans = await fetchTariffPlans(propertyId);
  return pickTariffPlan(plans, { categoryId, date, mealPlan });
}

/**
 * Extra bed rate for a resolved plan. The extra-bed UI does not distinguish
 * adult vs child beds, so the adult rate is the generic per-bed rate.
 */
export function extraBedRateFor(plan: TariffPlan | null | undefined): number {
  return Number(plan?.extra_adult_rate ?? 0) || 0;
}
