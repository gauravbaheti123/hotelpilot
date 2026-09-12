# Food/Laundry bill View option in Invoices list

## Problem
In Dashboard → Invoices → Food/Laundry tabs, a bill row (e.g. BRIJ-F-0652) cannot be clicked to view. There is only Print/Edit/Delete — staff cannot open the bill to see its items before printing or editing.

## Change (frontend only, no schema changes)

1. **New read-only "View Bill" dialog** in `src/components/InvoiceListPanel.tsx`:
   - Clicking anywhere on a food/laundry bill row (or a new eye/View icon button) opens the dialog.
   - Dialog fetches `segment_bill_items` for that bill and shows:
     - Bill number, segment (Food/Laundry), status badge, walk-in badge, complimentary badge + reason
     - Guest name, room/table (resolved from `room_id`), bill date/time (IST)
     - Item table: description, qty, rate, amount, GST rate/amount
     - Subtotal, GST total, Grand total (matches stored `total_amount`)
     - For room-guest bills: "On room bill" note; for walk-ins: paid/balance
   - "Print bill" button inside the dialog reuses the existing `printSegBill` logic.
   - No edit/delete inside the view dialog — it is view-only.

2. **Row click wiring**: make the food/laundry row body clickable (same pattern as the Lodge tab, which already navigates on row click) to open the view dialog. Keep existing Print/Edit/Delete icon buttons working with `stopPropagation` so they don't trigger the view.

3. No permission changes — anyone who can see the Invoices tab can view a bill; edit/delete buttons remain permission-gated as today.

## Verification
- Typecheck + build.
- Confirm clicking a food bill row opens the itemised bill view, and Print from the dialog produces the same receipt as the list Print button.
