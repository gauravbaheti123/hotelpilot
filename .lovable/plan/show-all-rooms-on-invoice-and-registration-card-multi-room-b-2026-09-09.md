# Show all rooms on invoice and registration card (multi-room bookings)

## Problem

When one booking holds several rooms (bulk / group booking), both the guest registration card and the invoice show only the first room number. The other rooms are invisible on the printed documents.

Confirmed in the code: the registration card reads only `booking_rooms[0]`, and the invoice's Stay Details picks a single room to display.

## What to change

1. **Registration card** — "Room No." lists every room in the booking, separated by commas (e.g. `101, 104, 207`). Category shows the distinct categories the same way when they differ. Check-in / check-out stay as they are.
2. **Invoice (screen + print)** — the Stay Details "Room" and "Category" lines list all rooms of the booking, comma separated, instead of one.
3. **Duplicates and shifted rooms** — each room number appears once. Where a guest moved rooms mid-stay, the room-wise dates block added earlier keeps showing the per-room split; the summary line simply lists all rooms involved.
4. Single-room bookings look exactly as they do today.

No layout or styling changes — only the text inside those two fields.

## Technical notes

- `src/routes/_authenticated/bookings.$bookingId.grc.tsx` — replace the `room0` usage in the Room No. / Category rows with a de-duplicated joined list over `booking.booking_rooms`.
- `src/routes/_authenticated/billing.folio.$bookingId.tsx` — in the Stay Details block, keep `displayRoom` for dates, but render joined room numbers and categories.
- `src/lib/invoiceTemplates.ts` already joins all rooms (line 259); no change needed there.

## Verification

- Open a booking with 2+ rooms: registration card and invoice both list every room number.
- Open a single-room booking: unchanged output.
