/**
 * Indian mobile number helpers.
 * Only plain 10-digit numeric mobile numbers are accepted (no country code).
 */
export const MOBILE_ERROR = "Enter a valid 10-digit mobile number";

export function sanitizeMobile(v: string): string {
  return (v ?? "").replace(/\D+/g, "").slice(0, 10);
}

export function isValidMobile(v: string | null | undefined): boolean {
  return /^\d{10}$/.test((v ?? "").trim());
}

export function isValidOrEmptyMobile(v: string | null | undefined): boolean {
  const t = (v ?? "").trim();
  return t.length === 0 || isValidMobile(t);
}