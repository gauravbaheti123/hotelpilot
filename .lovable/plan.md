# Phase 1 — Unified Segment Billing Dashboard

Builds on Phase 0 numbering + `payment_methods`. Food already has a full flow (KOTs, `food_bills`, `tg_assign_food_bill_number`). Laundry has no module yet — this phase introduces a minimal punch flow that mirrors Food.

## 1. Database (single migration)

- **`laundry_bills`** table (mirrors `food_bills`): `id, property_id, booking_id (nullable), folio_id (nullable), laundry_bill_number, total_amount, status ('open'|'settled'|'void'), is_walkin, created_by, created_at, updated_at`. GRANT authenticated + service_role, RLS via `user_has_property` + `has_permission('billing', ...)`.
- **`laundry_bill_items`**: `id, laundry_bill_number ref, description, qty, rate, amount, gst_rate, gst_amount`. Same RLS.
- **`tg_assign_laundry_bill_number`** trigger — copy of `tg_assign_food_bill_number`, uses `generate_bill_number(property_id, 'laundry')` → `BRIJ-L-0001` (legacy `LB-0001` fallback if no short_code).
- Extend **`folio_charges`** with nullable `segment_bill_ref TEXT` column so posted food/laundry lines carry their originating bill number for the consolidated invoice breakup. Backfill existing food charges from `food_bills.food_bill_number` where `source_id` matches.
- Add DB helper **`has_pending_segment_bills(_booking_id uuid)`** returning `TABLE(segment text, bill_number text, amount numeric)` — queried by checkout guard.

## 2. Dashboard segment selector

Edit `src/routes/_authenticated/dashboard.tsx` only (no new page):

- Add a top segment toggle: **Rooms | Food | Laundry** (default Rooms = today's behavior).
- Rooms view unchanged.
- Food/Laundry view: same room grid, but each tile shows that segment's *pending amount for the room's active booking* (sum of unsettled `folio_charges` where segment matches) instead of housekeeping status. Empty rooms are dimmed.
- Tapping a tile opens a **PunchChargeDialog** for the selected segment.

## 3. PunchChargeDialog (new component)

`src/components/PunchChargeDialog.tsx`, one dialog handles both segments:

- Food: reuse existing menu items lookup (from `menu_items`); Laundry: free-text items + rate + qty rows.
- "Walk-in / counter sale" toggle when opened without a booking (or explicitly from a new dashboard "Walk-in Food/Laundry" button in the segment toolbar).
- On save:
  1. Insert parent bill row (`food_bills` or `laundry_bills`) → trigger stamps `BRIJ-F-####` / `BRIJ-L-####`.
  2. Insert item rows.
  3. If **linked to a booking**: also insert into `folio_charges` (`charge_type='food'|'laundry'`, `segment_bill_ref=<bill number>`, `source_table`, `source_id`). Existing `tg_folio_charges_sync` recomputes folio totals.
  4. If **walk-in**: record payment straight into `payments` (folio_id NULL, booking_id NULL, method from `usePaymentMethods`), mark bill `settled`.
  5. Print standalone segment bill via `window.print()` — reuse `printStyles.ts` + a new small template `renderSegmentBillHtml()` in `src/lib/invoiceTemplates.ts`.

## 4. Checkout guard

In `src/components/CheckoutDialog.tsx`:

- On open, call `supabase.rpc('has_pending_segment_bills', { _booking_id })`.
- If any rows returned, block checkout with a listing panel ("Pending Food/Laundry — settle or transfer to folio"). Buttons:
  - **Transfer to folio** → sets those bills' `folio_id` + status remains open, then re-runs check (already posted via section 3, so this is only for stray walk-in-style bills that were tagged to booking but not folio).
  - **Settle now** → opens payment on that segment bill.
  - **Owner override** (owner/superadmin only) → prompt for reason → `log_owner_override('checkout_pending_segment', ...)` → proceed.

## 5. Consolidated lodge invoice

`src/lib/invoiceTemplates.ts` — in the itemized section, group folio charges by segment when `segment_bill_ref` present:
```
Lodge Charges                     ₹X
Food (Ref: BRIJ-F-0001)          ₹Y
Laundry (Ref: BRIJ-L-0002)       ₹Z
```
Rows without a ref keep current behavior. No structural template change.

## 6. Banquet — untouched

Explicitly excluded from segment selector. Verify `tg_assign_banquet_number` still routes bulk-room banquet bookings to `BRIJ-B-####` and confirm no code path in Phase 1 writes into banquet tables.

## Verification checklist (after apply)

- Segment toggle switches grid data source without route change.
- Food punch → creates `food_bills` row `BRIJ-F-####`, `folio_charges` row with matching `segment_bill_ref`, prints bill.
- Laundry punch → same, `BRIJ-L-####`.
- Walk-in Food/Laundry → bill + settled payment, no folio touched.
- Checkout on room with pending segment bill → blocked with listing; owner override logs to `activity_log`.
- Final invoice shows segment-wise ref breakup.
- Banquet checkout still yields `BRIJ-B-####`, no interference.

## Notes / non-goals

- Not adding a new sidebar entry; segment lives inside the dashboard.
- Not migrating historical food bills into the new `segment_bill_ref` column beyond the one-time backfill.
- Laundry master (services catalog) is out of scope — free-text lines are enough for Phase 1.
