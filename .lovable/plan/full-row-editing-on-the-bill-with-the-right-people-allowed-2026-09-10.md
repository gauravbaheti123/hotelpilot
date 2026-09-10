# Full row editing on the bill, with the right people allowed

## What is wrong now

- Clicking the pencil on a room line opens a small "Edit tariff" box with only the
  nightly rate. Date, description, HSN, quantity and GST cannot be touched.
- Food/other lines have a slightly bigger box (description, qty, rate, GST) but
  still no date, no HSN and no direct amount.
- Guest details, GST bill-to details and stay dates/times cannot be corrected
  from the bill page — you have to go elsewhere.
- After check-out, Reception can still change room rates on a finalised bill,
  which should be Manager/Owner only.

## What will change

### One "Edit line" box for every charge row

Clicking the pencil on any row — room night, food/laundry bill line, extra bed,
early check-in, sundry — opens the same box with all of these fields:

- Date
- Description
- HSN / SAC code
- Quantity
- Rate
- GST %
- Amount (auto = Qty x Rate, and can be typed directly; rate re-derives)

Below the fields a live line shows the new amount, GST and the new bill total, so
nothing is a surprise before saving. Saving refreshes the charges, recomputes the
bill totals, GST break-up and balance immediately, and writes an activity-log
entry with the old and new values.

Room-night specifics (as you chose): changing the date changes only what the bill
line shows — the guest's stay dates are untouched. Changing the rate keeps the
current behaviour of applying to that night only (the other nights keep theirs).
Food/laundry combined lines keep spreading the corrected total across their items
exactly, and the "Bill" link stays.

### Guest, bill-to and stay details editable on the bill page

An "Edit details" action on the bill header opens one box covering:

- Guest name, phone, email, address
- GST bill-to: company name, GSTIN, address, state
- Check-in and check-out date and time, and number of adults/children

Saving updates the booking and re-prints/re-renders the bill with the corrected
details. Check-out date/time on an in-house stay stays locked (that must go
through Check-out, as before).

### Who can do it

- Before check-out (bill still open): every staff login with access to the
  property — Reception included — can edit every field above.
- After check-out (bill finalised/settled): only Manager and Owner. Reception
  loses the leftover "change room rent on a finalised bill" right they currently
  have; they will see a clear message instead of a silent failure.
- Every edit after check-out is recorded in the activity log with who changed
  what, from what to what.

## Technical notes

- `src/routes/_authenticated/billing.folio.$bookingId.tsx`
  - Merge `openEditTariff`/`saveEditTariff`/`saveEditNightTariff` and
    `openEditCharge`/`saveEditCharge` into one dialog + one save path
    (`openLineEdit` / `saveLineEdit`), keyed by row kind:
    - `is_night_split` room row: rate change still routes through
      `split_room_night`; date/description/HSN/qty/GST/amount go to the
      resulting `folio_charges` row via `charged_on`, `hsn_code`,
      `description`, `qty`, `gst_rate`, `gst_amount`, `amount`.
    - Multi-night room row: `split_room_night` per affected night when the rate
      changes, otherwise a plain `folio_charges` update.
    - `is_consolidated` food/laundry row: keep the existing
      `distributeWithRemainder` spread across `source_charge_ids`; date/HSN/GST
      applied to every underlying row.
    - Plain row: single `folio_charges` update.
  - Keep the existing discount-limit check (`canApplyDiscount`) on any reduction,
    and keep `persistTotals` + `refetchCharges` + `load()` after save.
  - Post-checkout writes go through the existing owner RPCs
    (`owner_update_folio_charge`) so RLS does not silently drop the update;
    open-bill writes stay on the direct table update.
  - Header "Edit details" reuses `owner_update_guest_name`,
    `owner_update_folio_header` and `owner_update_booking_room_details` for
    settled bills, and direct `guests` / `bookings` / `billing_companies`
    updates while the bill is open. The in-house check-out lock added earlier
    stays.
  - Permission gates: `canEditNow` for open bills becomes "signed-in staff of
    this property"; the finalised path keeps requiring
    `invoices/edit_room_rate_locked` (Manager/Owner) or the grace window.
- Migration: revoke `invoices/edit_room_rate_locked`,
  `invoices/edit_billto_locked` and `bookings/extend_stay_locked` from the
  Receptionist role (Manager/Owner keep them), so "after check-out" really is
  Manager/Owner only. Also allow `charged_on` and `hsn_code` in
  `owner_update_folio_charge` if it does not already accept them.
- No layout or styling changes beyond the fields inside the edit dialogs.
