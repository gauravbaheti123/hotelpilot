/**
 * Invoice document date.
 *
 * The date printed on a bill must be the date the guest actually CHECKED OUT,
 * not when the folio happened to be settled in the system. These diverge for:
 *   - "Mark as Due" checkouts settled days later,
 *   - folios settled administratively / backfilled after the fact,
 *   - reprints (the templates previously stamped `new Date()`, i.e. print time).
 *
 * `folios.settled_at` is left untouched in the database — it still drives the
 * Dues report ordering, the audit trail and the grace-window maths. This is a
 * DISPLAY concern only.
 */

import { IST_TZ, istDateISO } from "@/lib/date";

export interface InvoiceDateFolio {
  status?: string | null;
  settled_at?: string | null;
}

export interface InvoiceDateBooking {
  check_out?: string | null;
  booking_rooms?: Array<{ actual_check_out?: string | null }> | null;
}

export type InvoiceDateSource = "checkout" | "settlement" | "today";

export interface ResolvedInvoiceDate {
  /** YYYY-MM-DD (IST) to print as the document date. */
  iso: string;
  source: InvoiceDateSource;
  /** True when we could not find a real checkout and had to guess. */
  fallback: boolean;
}

/** Latest actual_check_out across the booking's rooms, or null. */
export function checkoutInstant(booking?: InvoiceDateBooking | null): string | null {
  const stamps = (booking?.booking_rooms ?? [])
    .map((br) => br?.actual_check_out)
    .filter((v): v is string => !!v)
    .map((v) => new Date(v).getTime())
    .filter((n) => !Number.isNaN(n));
  if (!stamps.length) return null;
  return new Date(Math.max(...stamps)).toISOString();
}

/** A folio that represents a finalised document (numbered / closed). */
function isFinalised(folio?: InvoiceDateFolio | null): boolean {
  const s = String(folio?.status ?? "").toLowerCase();
  return s === "settled" || s === "due" || s === "paid" || s === "partial";
}

export function resolveInvoiceDate(
  folio?: InvoiceDateFolio | null,
  booking?: InvoiceDateBooking | null,
): ResolvedInvoiceDate {
  // Provisional / draft / open bills are "as of now" documents.
  if (!isFinalised(folio)) return { iso: istDateISO(), source: "today", fallback: false };

  const co = checkoutInstant(booking);
  if (co) return { iso: istDateISO(co), source: "checkout", fallback: false };

  if (folio?.settled_at) {
    // Settled without any recorded checkout — shouldn't happen in the normal
    // flow. Fall back, but make it noisy rather than silently guessing.
    console.warn("[invoiceDate] folio finalised with no actual_check_out; using settled_at", {
      status: folio.status, settled_at: folio.settled_at,
    });
    return { iso: istDateISO(folio.settled_at), source: "settlement", fallback: true };
  }
  console.warn("[invoiceDate] folio finalised with no checkout and no settled_at; using today");
  return { iso: istDateISO(), source: "today", fallback: true };
}

/** "14 Aug 2026" for a YYYY-MM-DD business date. */
export function formatInvoiceDate(iso: string): string {
  if (!iso) return "";
  const d = new Date(`${iso}T12:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: IST_TZ, day: "2-digit", month: "short", year: "numeric",
  }).format(d);
}

/** One-liner used by every print surface. */
export function invoiceDateLabel(
  folio?: InvoiceDateFolio | null,
  booking?: InvoiceDateBooking | null,
): { text: string; note: string } {
  const r = resolveInvoiceDate(folio, booking);
  return {
    text: formatInvoiceDate(r.iso),
    note: r.fallback ? "(settlement date — no checkout recorded)" : "",
  };
}
