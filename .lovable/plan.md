# Receptionist edit access + invoice number reuse after undo checkout

Two changes: (1) reception staff can edit everything on a booking until it is actually checked out, (2) undoing the last checkout releases the bill number so the next checkout gets it.

## Part A — Editing before checkout

What is confirmed today:
- The save routine allows editing only while a booking is `reserved` or `checked_in`, and refuses if any bill on that booking is no longer open.
- Reception already has booking view/create/edit/delete rights in the role grid.
- Correcting the check-in date of an in-house guest is tied to the "delete booking" right.
- Room rate reductions are checked against the staff member's discount limit.

Planned work:
1. Add a short diagnostic step first: reproduce a receptionist save on a `checked_in` booking and capture the exact refusal, so the fix targets the real blocker rather than a guess.
2. Loosen the "already billed" refusal so it applies only after real checkout. A bill that was settled early (guest paid in advance, still in house) will no longer freeze the booking; editing stays blocked once the booking status is `checked_out`, cancelled or no-show, and when the business day is locked by Night Audit.
3. Keep every edit audited exactly as today (guest changes, stay/room changes, reason note for in-house edits).
4. Rate/discount limits stay as they are — reducing a tariff still respects the staff member's discount limit (your choice).
5. Front-desk screen: make sure the "Edit details" button and each field inside the wizard are enabled for reception for the whole pre-checkout period, matching the relaxed backend rule so nothing looks editable but fails on save (and nothing is hidden that is actually allowed).

## Part B — Bill number released on undo checkout

Today undo checkout reopens the bill but keeps the invoice number on it, so that number is consumed even though the bill is no longer final.

Planned work:
1. On undo checkout, clear the invoice number from the reopened bill.
2. If that number was the most recently issued one in its series, step the counter back by one so the next checkout receives the same number — no gap, no duplicate. If it was not the last one (a later bill already exists), the number is simply cleared and left unused, since reusing a middle number would risk duplicates.
3. Record the released number in the existing undo audit entry, so there is a trail of which number was freed and by whom.
4. Re-issue happens through the normal path: the next real checkout that finalises a bill picks the number up again.

## Technical notes

- `public.update_booking_safe_fields`: replace the "settled folio" hard stop with a booking-status check (`reserved`/`checked_in` only) plus the existing day-lock guard; keep the `has_permission(bookings, edit)` gate.
- `public.undo_checkout`: capture `v_folio.invoice_number` before reopening; set it to NULL; when the numeric suffix equals `bill_sequences.last_number` for the matching `sequence_type` and prefix, decrement `last_number` under the existing row lock. Note that `generate_bill_number` also derives a max from existing rows, so clearing the folio number is what makes the rollback effective.
- Include the released number in the `checkout_undo_log` row / activity details.
- Front-end touch points: `StepEditStayRoom.tsx` enable rules, `BookingEditWizard.tsx` save error surfacing, `front-desk.booking.$id.tsx` edit button conditions.
- Verify afterwards: undo a checkout, confirm the bill shows no number, then check out another booking and confirm it receives the released number; confirm the invoice list has no duplicate numbers.
