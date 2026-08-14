/**
 * Complimentary settlement for Food / Laundry (segment) bills.
 *
 * A complimentary bill is genuinely free — plan-inclusive (MAP/AP), package
 * covered, or an approved goodwill gesture. It is NOT the same as "Bill On
 * Hold": nothing is owed, so it never posts to the folio and never appears in
 * Dues. Every complimentary settlement stores a reason and is audited.
 */
export const COMPLIMENTARY_PRESETS = [
  "Included in MAP Plan",
  "Included in AP Plan",
  "Included in Package/Rate Plan",
  "Complimentary — Guest Relations",
  "Complimentary — Manager Approval",
  "Staff Meal",
] as const;

export const COMPLIMENTARY_OTHER = "Other (specify)";

/** Roles allowed to give away revenue by settling a bill as complimentary. */
export const COMPLIMENTARY_ROLES = ["owner", "manager", "superadmin"] as const;

export function canMarkComplimentary(roles: string[] | undefined | null): boolean {
  return (roles ?? []).some((r) => (COMPLIMENTARY_ROLES as readonly string[]).includes(r));
}

/** Line shown on the receipt / badge tooltip. */
export function complimentaryLabel(reason?: string | null): string {
  const r = (reason ?? "").trim();
  return r ? `Complimentary — ${r}` : "Complimentary";
}
