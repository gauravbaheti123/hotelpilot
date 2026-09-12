# Invoice list: Food / Laundry totals shown with and without GST

## What is wrong

In the Invoices tab, some Food/Laundry bills show the final amount including GST and others show the amount before GST. Verified against live data:

- BRIJ-F-0685: items 640.00 + GST 32.00, stored total 672.00 (correct, GST included)
- BRIJ-F-0686: items 140.00 + GST 7.00, stored total 147.00 (correct)
- BRIJ-F-0682: items 480.00 + GST 24.00, stored total 480.00 (wrong, GST missing)
- BRIJ-F-0681 / 0678 / 0689 / 0660 and others: same problem

## Root cause

A food/laundry bill's total is saved by several different routines, and they do not agree:

- Settlement from the counter, auto close at day end, and punching items all save total = items + GST.
- The routine that posts a room guest's bill onto their room folio (`post_segment_bill_to_folio`) saves total = items only, dropping GST.

So whichever way a bill was closed decides whether the list shows the GST-inclusive figure. The charge lines posted to the room folio are correct in both cases, so guest billing and GST reports are unaffected — only the stored bill total and the list display are wrong.

## Fix

1. Correct `post_segment_bill_to_folio` so the saved total is items + GST, matching every other path. No other logic in it changes.
2. One-time correction of existing bills: recompute `total_amount` for every food/laundry bill as the sum of its item amounts plus item GST. This touches only the bill header figure, never items, folio charges, payments or bill numbers.
3. Invoice list: show the final GST-inclusive amount derived from the bill's own stored sub-total and GST, so a future mismatch cannot silently display a pre-GST figure.

## Also visible in the screenshot

BRIJ-F-0682 is marked SETTLED yet shows "Bal ₹480.00". That is because the money for a room guest's food bill sits on the room folio, not on the food bill, so the food bill's paid amount stays zero. The list will show "On room bill" for such bills instead of a misleading balance. Counter/walk-in bills keep showing a real balance.

## Technical notes

- Migration: replace `total_amount = sum_amount` with `total_amount = sum_amount + sum_gst` in `public.post_segment_bill_to_folio`; keep the existing grants (revoke anon, grant authenticated).
- Backfill update on `public.segment_bills` from an aggregate over `public.segment_bill_items` (amount + gst_amount), restricted to segments food and laundry.
- `src/components/InvoiceListPanel.tsx`: segment rows render the GST-inclusive total and replace the balance line with "On room bill" when `is_walkin = false` and `booking_id` is set.
- Lodge (folio) invoices are unchanged: their totals already include GST except for bills deliberately created in cash mode.
