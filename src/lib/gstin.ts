// Shared GSTIN validation utility.
// Standard 15-char format: 2 digits state code + 5 letters + 4 digits + 1 letter
// + 1 entity code [1-9A-Z] + fixed "Z" + 1 checksum char [0-9A-Z].
export const GSTIN_REGEX =
  /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

export const GSTIN_ERROR = "Invalid GSTIN format (e.g. 27AASFB5351R1ZM)";

export function isValidGSTIN(value: string | null | undefined): boolean {
  if (!value) return false;
  return GSTIN_REGEX.test(value.trim().toUpperCase());
}

// Accepts empty (GSTIN is optional) OR a valid 15-char GSTIN.
export function isValidOrEmptyGSTIN(value: string | null | undefined): boolean {
  const v = (value ?? "").trim();
  if (!v) return true;
  return GSTIN_REGEX.test(v.toUpperCase());
}