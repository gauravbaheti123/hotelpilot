/**
 * Bill / invoice number helpers.
 *
 * P0 of the checkout-billing model change made `folios.invoice_number`
 * nullable: a folio that is still being built during the stay ("open") may not
 * carry a number yet. Every read site must therefore tolerate null.
 */

export const PROVISIONAL_BILL_LABEL = "Provisional";

/** Display-safe bill number — never renders "null"/"undefined". */
export function billNo(n?: string | null, fallback: string = PROVISIONAL_BILL_LABEL): string {
  const t = (n ?? "").trim();
  return t.length > 0 ? t : fallback;
}

/** True when the folio has actually been numbered. */
export function hasBillNumber(n?: string | null): boolean {
  return (n ?? "").trim().length > 0;
}

/**
 * Folio statuses that count as a real invoice for listing/reporting.
 * `open` is a running folio, not an invoice. `due` = checked out, amount
 * transferred to the guest ledger — an invoice, just unpaid.
 */
export const INVOICE_STATUSES = ["settled", "due"] as const;

export function isInvoiceStatus(status?: string | null): boolean {
  return status === "settled" || status === "due";
}

/** A 'due' folio is finalised: the booking is checked out. */
export function isClosedFolioStatus(status?: string | null): boolean {
  return status === "settled" || status === "due" || status === "void" || status === "refunded";
}

/**
 * P1 — numbering happens at settlement. Until then a document is provisional
 * and must reference the booking number, never a (missing) tax invoice number.
 */
export const PROVISIONAL_DOC_TITLE = "PROVISIONAL — NOT A TAX INVOICE";

/**
 * True when the document must be printed/displayed as a proforma.
 * Finality is decided by STATUS, not by number presence: an `open` folio is
 * provisional even if it carries a legacy number stamped before the P1
 * trigger-timing change.
 */
export function isProvisional(
  invoiceOrEventNumber?: string | null,
  status?: string | null,
): boolean {
  if (status === "open") return true;
  return !hasBillNumber(invoiceOrEventNumber);
}

/**
 * Event / invoice reference for display.
 * Numbered → the real number. Unnumbered → `Ref: BK-… (provisional)`.
 */
export function eventRef(
  number?: string | null,
  bookingNumber?: string | null,
): string {
  if (hasBillNumber(number)) return (number as string).trim();
  const bk = (bookingNumber ?? "").trim();
  return bk ? `Ref: ${bk} (provisional)` : PROVISIONAL_BILL_LABEL;
}

/** Compact variant for tight table cells / titles. */
/**
 * Legacy placeholder numbers (`<PREFIX>-PENDING-<6 hex>`) were stamped on a
 * handful of open food bills by a since-removed numbering path. They are not
 * real bill numbers, so show them as the un-numbered bills they are.
 */
const PLACEHOLDER_RE = /-PENDING-[0-9a-f]{6}$/i;

export function isPlaceholderBillNo(n?: string | null): boolean {
  return PLACEHOLDER_RE.test((n ?? "").trim());
}

/** Display-safe segment (food/laundry) bill reference. */
export function segmentBillNo(n?: string | null): string {
  const t = (n ?? "").trim();
  if (!t || isPlaceholderBillNo(t)) return PROVISIONAL_BILL_LABEL;
  return t;
}

export function eventRefShort(
  number?: string | null,
  bookingNumber?: string | null,
): string {
  if (hasBillNumber(number)) return (number as string).trim();
  const bk = (bookingNumber ?? "").trim();
  return bk ? `${bk} (prov.)` : PROVISIONAL_BILL_LABEL;
}
