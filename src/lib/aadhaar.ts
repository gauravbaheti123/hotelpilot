/**
 * Aadhaar helpers — enforce 12-digit numeric input displayed as "4444 8888 9999".
 */

/** True when the selected ID proof type is Aadhaar (handles spelling variants). */
export function isAadhaarType(type: string | null | undefined): boolean {
  const t = (type ?? "").toLowerCase().replace(/[\s_-]/g, "");
  return t === "aadhaar" || t === "aadhar" || t === "uid" || t === "uidai";
}

/**
 * Format an Aadhaar input value: digits only, max 12, grouped 4-4-4 with spaces.
 * Safe to call on every keystroke (idempotent).
 */
export function formatAadhaar(value: string): string {
  const digits = value.replace(/\D/g, "").slice(0, 12);
  return digits.replace(/(\d{4})(?=\d)/g, "$1 ");
}

/** Max visible length of a formatted Aadhaar (12 digits + 2 spaces). */
export const AADHAAR_MAX_LENGTH = 14;
