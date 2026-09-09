# Fix: Receptionist can't change the nightly tariff before checkout

## What is happening

The tariff change is refused by the database with "You do not have permission to edit the tariff".

Verified in the live database:

- The tariff-change routine (`split_room_night`) checks the **Invoices → Edit** right.
- In the role grid, Receptionist has Invoices → Edit set to **No** (Manager and Owner have Yes).
- There is no separate "before checkout" right in the permissions list — the earlier work allowed booking edits, but this one check was never moved over.

So the booking is open and editable, yet this single action still asks for an invoice-level right the Receptionist deliberately doesn't have.

## What to change

Change the rule inside `split_room_night` so it matches the agreed policy:

- Booking still open (status reserved or checked-in, bill still open, date not night-audit locked) → allow anyone with **Bookings → Edit**. Receptionist passes.
- Everything else stays exactly as today: closed/settled bills, cancelled, checked-out and night-audit-locked dates are still refused, and the Invoices → Edit / owner-override paths are untouched.
- Keep the existing clear error messages; no false success.

No UI or layout changes. No changes to how charges are recalculated — the existing trigger keeps refreshing the room charge on the folio.

## Technical detail

Single migration replacing the permission guard in `public.split_room_night`:

```text
IF NOT (
     public.has_permission(auth.uid(), property, 'bookings', 'edit')
  OR public.has_permission(auth.uid(), property, 'invoices', 'edit')
) THEN RAISE EXCEPTION 'You do not have permission to edit the tariff';
```

placed after the existing active-booking and open-bill guards, so the wider grant only ever applies pre-checkout. Function body, signature, slicing logic and audit behaviour otherwise unchanged.

## Verification

- Sign-in state permitting: re-run the Room 101 edit (2800 → 2790) as Receptionist and confirm `booking_rooms.rate` actually changes and the folio room charge follows.
- Confirm a checked-out booking still refuses the tariff edit.
