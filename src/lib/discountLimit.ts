// Per-user / per-role discount limit helpers.
// Backed by the SQL function public.user_discount_limit(_user_id, _property_id).
//
// A "limit" answers two questions:
//   1. Can this user apply any discount at all?  (limit_type = 'none')
//   2. How large may that discount be?           (percentage of base OR flat rupees)
//
// Owner and Superadmin are always {unlimited: true}.

export type DiscountLimitType = "percentage" | "fixed_amount" | "none";

export interface DiscountLimit {
  limitType: DiscountLimitType;
  limitValue: number; // 0-100 for percentage, rupees for fixed_amount, ignored for none
  unlimited: boolean;
}

export const UNLIMITED_DISCOUNT: DiscountLimit = {
  limitType: "percentage",
  limitValue: 100,
  unlimited: true,
};

export const NO_DISCOUNT: DiscountLimit = {
  limitType: "none",
  limitValue: 0,
  unlimited: false,
};

export interface DiscountAttempt {
  /** Positive rupee value of the proposed discount, applied against `base`. */
  discountRupees: number;
  /** Positive rupee value the discount is being applied against. */
  base: number;
}

export interface DiscountCheck {
  allowed: boolean;
  /** Human-readable reason when `allowed = false`. */
  reason?: string;
  /** Maximum rupee value the user could apply against this base. */
  maxRupees: number;
}

/**
 * Check whether the given discount attempt fits the user's limit.
 * Works uniformly for line-item, bill-level, split-bill and rate-override flows —
 * the caller expresses the reduction as (discountRupees, base).
 *
 * For a rate override, pass:
 *   discountRupees = standardRate - proposedRate   (>= 0)
 *   base           = standardRate
 */
export function canApplyDiscount(limit: DiscountLimit, attempt: DiscountAttempt): DiscountCheck {
  const base = Math.max(0, Number(attempt.base) || 0);
  const disc = Math.max(0, Number(attempt.discountRupees) || 0);

  if (limit.unlimited) return { allowed: true, maxRupees: base };
  if (disc <= 0.01) return { allowed: true, maxRupees: maxRupeesFor(limit, base) };

  if (limit.limitType === "none") {
    return { allowed: false, reason: "Your role is not allowed to apply discounts.", maxRupees: 0 };
  }
  if (limit.limitType === "fixed_amount") {
    const cap = Math.max(0, limit.limitValue);
    if (disc > cap + 0.01) {
      return {
        allowed: false,
        reason: `Max discount for your role is ₹${cap.toLocaleString("en-IN")}.`,
        maxRupees: Math.min(cap, base),
      };
    }
    return { allowed: true, maxRupees: Math.min(cap, base) };
  }
  // percentage
  const capPct = Math.max(0, Math.min(100, limit.limitValue));
  const capRupees = (capPct / 100) * base;
  const effectivePct = base > 0 ? (disc / base) * 100 : 0;
  if (effectivePct > capPct + 0.01) {
    return {
      allowed: false,
      reason: `Max discount for your role is ${capPct}%.`,
      maxRupees: capRupees,
    };
  }
  return { allowed: true, maxRupees: capRupees };
}

export function maxRupeesFor(limit: DiscountLimit, base: number): number {
  if (limit.unlimited) return base;
  if (limit.limitType === "none") return 0;
  if (limit.limitType === "fixed_amount") return Math.min(limit.limitValue, base);
  return (Math.max(0, Math.min(100, limit.limitValue)) / 100) * base;
}

export function describeLimit(limit: DiscountLimit): string {
  if (limit.unlimited) return "No discount limit for your role.";
  if (limit.limitType === "none") return "Your role cannot apply discounts.";
  if (limit.limitType === "fixed_amount") {
    return `Max discount for your role: ₹${limit.limitValue.toLocaleString("en-IN")}.`;
  }
  return `Max discount for your role: ${limit.limitValue}%.`;
}