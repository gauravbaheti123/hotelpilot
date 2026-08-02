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

/** GST state codes in use (mirrors public.gst_state_code_from_gstin in the DB). */
const VALID_STATE_CODES = new Set([
  "01","02","03","04","05","06","07","08","09","10","11","12","13","14","15","16","17","18",
  "19","20","21","22","23","24","25","26","27","29","30","31","32","33","34","35","36","37","38",
]);

/**
 * Place of supply: the first 2 digits of a GSTIN are the state code.
 * Returns null when the GSTIN is malformed or the code isn't a real state.
 * Accepts a leading partial match so provisional/legacy GSTINs still resolve.
 */
export function stateCodeFromGstin(value: string | null | undefined): string | null {
  const v = (value ?? "").trim().toUpperCase();
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}/.test(v)) return null;
  const code = v.slice(0, 2);
  return VALID_STATE_CODES.has(code) ? code : null;
}