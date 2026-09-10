# Zero-amount invoices (2007, 2008, 2013) — cause and fix

## What those three bills actually are

They are empty duplicate bills. Each one belongs to a booking whose bill was
**split into two portions** just before check-out:

| Empty bill | Booking | Real bills of that stay |
| --- | --- | --- |
| 2007 | Dattatray Dighe (312) | 2005 ₹3,150 + 2006 ₹854 |
| 2008 | Rahul Jadhav / Rishabh Bharil (209) | 2009 ₹3,360 + 2010 ₹30 |
| 2013 | Harshvardhan / Ganesh (211) | 2011 ₹7,350 + 2012 ₹2,876 |

Every one of them has zero charges and zero payments. No money is missing —
the guests' real amounts are all on the numbered bills next to them. But an
empty bill consumed a real invoice number, which is why the invoice series
shows gaps of ₹0 entries.

## Why they were created (confirmed)

1. When a bill is split, the original bill is voided and two portion bills take
   its place.
2. Afterwards, whenever any screen asks the system for "this booking's bill"
   (opening the bill page, collecting the second payment, the check-out box),
   the lookup only recognises a bill that is *not* a portion. The two portions
   don't qualify, the voided original doesn't qualify — so it silently
   **creates a brand-new empty bill**. The activity trail shows exactly this:
   split at 03:19:42, payment at 03:20:17, empty bill born at 03:20:37.
3. At check-out the system finalises *every* live bill of the booking. The
   empty one has nothing outstanding, so it settles too — and settling is what
   issues an invoice number. Hence a numbered ₹0 invoice.
4. A later automatic recalculation flips a zero-value settled bill back to
   "open", which is why the list tags them REOPENED.

Across the property there are **21** zero-value numbered bills of this kind.

## What I will change

**1. Stop the empty bill from ever being created**
The "find this booking's bill" lookup will recognise split portions. If a
booking already has live portion bills, it returns the right portion instead of
inventing a new bill. Only a booking with genuinely no live bill gets a fresh
one.

**2. Never issue an invoice number to a nil bill at check-out**
Check-out will skip bills that have no charges and no payments — it closes them
quietly (as void/empty) instead of settling and numbering them. Bills with real
charges settle exactly as today, including split portions and event bills.

**3. Stop settled bills bouncing back to "open"**
A zero-value bill that was deliberately settled stays settled; it will no
longer flip back to open and show the REOPENED tag.

**4. Clean up the existing 21**
The empty numbered bills (2007, 2008, 2013 and the older ones) get voided and
removed from the invoice list, with their invoice numbers released for reuse so
the series has no dead entries. Only bills with zero charges, zero payments and
zero amount are touched — nothing with money on it is altered.

## Technical notes

- `public.get_or_create_folio`: predicate `parent_folio_id IS NULL` is the root
  cause; extend it to prefer live child portions (reuse `payableFolios` logic
  server-side) before inserting.
- `public.complete_checkout`: skip folios with no `folio_charges` and no
  `payments` and `total_amount = 0` — mark void instead of calling
  `settle_folio_at_checkout`.
- `tg_folios_balance_before_write`: the final `ELSE` branch resets
  `status = 'open'` for an already-settled zero-total folio; keep `settled`
  when `OLD.status = 'settled'` and `is_reopened` is false.
- Data repair migration: void + `is_deleted` the 21 folios matching
  `total_amount = 0 AND paid_amount = 0` with no charges/payments, and clear
  their `invoice_number` so `generate_bill_number` can reuse the value.
- No UI or layout changes.
