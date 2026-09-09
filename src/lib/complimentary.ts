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

/**
 * Roles allowed to settle a bill as complimentary: every staff role.
 *
 * MAP/AP plan-inclusive settlement is routine daily food service, not an
 * exceptional approval. Accountability lives in the mandatory reason +
 * activity_log audit entry, not in role gating.
 */
export const COMPLIMENTARY_ROLES = [
  "owner",
  "manager",
  "superadmin",
  "receptionist",
  "kitchen",
  "housekeeping",
] as const;

/** Any signed-in staff member may mark a bill complimentary. */
export function canMarkComplimentary(roles: string[] | undefined | null): boolean {
  return (roles ?? []).length > 0;
}


/** Line shown on the receipt / badge tooltip. */
export function complimentaryLabel(reason?: string | null): string {
  const r = (reason ?? "").trim();
  return r ? `Complimentary — ${r}` : "Complimentary";
}
