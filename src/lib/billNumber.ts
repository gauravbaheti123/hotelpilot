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
