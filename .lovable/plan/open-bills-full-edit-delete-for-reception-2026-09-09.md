# Open bills: full edit + delete for Reception

Goal: while a bill is still open (before checkout), a Reception user can edit or remove
anything on it — every charge line at the top, and every payment row at the bottom.

## What is there today

- Charge lines: only some lines show icons. Food/laundry bill lines and extra charges get
  an edit pencil; room lines get a tariff pencil; the delete bin only appears for users
  with the invoice-delete right; per-night split lines show just the word "Night".
- Payment rows: only a small "Mode" button is shown in your screenshot. "Date" and
  "Delete" already exist in the code and are switched on by the staff-rights grid, which
  currently does grant Reception the delete right — so the screenshot may pre-date the
  last update. This will be re-checked on the live screen before anything else is changed.

## What will change

1. Payment rows (open bill)
   - One clear "Edit" button per payment that opens the existing payment dialog where
     amount, mode, reference and date can all be corrected in one place.
   - One "Delete" button per payment.
   - Both shown to any staff member whose rights allow it while the bill is open; on a
     finalised bill the current Owner-only / 60-minute-window rules stay exactly as they are.
   - Buttons sized like the other action buttons so they are easy to tap.

2. Charge lines (open bill)
   - Every line gets the same action set: discount, edit, delete.
   - Per-night room lines get edit (tariff for that night) and delete instead of the
     plain "Night" label.
   - Food/laundry bill lines keep their bill link and gain a consistent edit + delete.
   - Room lines: edit tariff, plus delete. Note — a room night charge is re-created
     automatically from the booking, so deleting it only makes sense together with
     removing/shortening that night; the delete on a room line will therefore ask for
     confirmation and explain this, and stays available. Tell me if you would rather hide
     delete on room lines completely.

3. Nothing changes after checkout
   - Once the bill is settled/checked out, the existing locks stay: Owner/Manager rights
     or the 60-minute grace window, exactly as now.

## Verification

- Sign in as a Reception account on the live app, open an in-house bill, and confirm:
  edit + delete visible on every charge line and every payment row; totals and balance
  update after each action; a settled bill still shows the locked behaviour.
- Re-check the Room 304 bill in the screenshot (Cash 3,360 + Bill On Hold 3,360) so the
  duplicate entry can be deleted from the screen.

## Technical notes

- File: `src/routes/_authenticated/billing.folio.$bookingId.tsx` — charge row action cell
  and payment row action cell.
- Reuse `ChangePaymentModeDialog` (already supports mode / amount / date / delete with
  server-side guards) instead of the current inline Mode/Date buttons.
- Gating stays permission-driven: `payments/edit_mode|edit_date|edit_amount|delete`,
  `invoices/edit`, `invoices/delete`, plus `isOpen` and `withinGraceWindow`.
- Server guards (`delete_payment`, `change_payment_amount`, `owner_*` RPCs) are unchanged;
  no migration expected unless the live check shows a missing grant in the rights grid.
