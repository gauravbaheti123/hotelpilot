# Bill 1985 shows "1 Night" for a 3-night stay — fix the Duration line

## What is wrong

Bill 1985 (booking BK-20260907-0004, Room 304) prints:

- Check-in: 07 Sept 2026, 07:39
- Check-out: 09 Sept 2026, 10:24
- Duration: **1 Night**

while the charges below correctly list three room nights (6, 7 and 8 Sept,
₹3,333.33 each). Only the Duration line is wrong; the money is correct.

## Why it happens (confirmed in the data)

The stay record for this booking still holds its *original booked* range —
06 Sept to 07 Sept, one night. The guest actually stayed until 09 Sept and the
nights were added as room charges, but the room row's dates were never
stretched to match.

The bill's Duration is calculated from that room row's date range, so it prints
1 Night, while the Check-in/Check-out lines above it come from the real arrival
and departure timestamps — hence the contradiction on the same block.

This is not a one-off: a scan of this property found roughly 30 past bookings
where the nights billed exceed the stored room date range (for example
BK-20260908-0013: 1 night stored, 4 nights billed). Every one of those bills
prints a short Duration.

## The fix

Make Duration reflect the nights actually billed and stayed, in this order:

1. Count the distinct night dates of the room charges on the bill (so a
   night-split stay counts each night once, and two rooms on the same night
   count as one night).
2. If the bill has no room charges, fall back to the distinct nights covered by
   the non-shifted room rows (today's behaviour).
3. If those are missing too, fall back to the actual arrival → departure span,
   then the booking's own dates.
4. Keep the minimum of 1 night for same-day/day-use stays.

Display-only change on the Stay Details block, which feeds both the on-screen
bill and the printed/PDF copy. Room lines, rates, GST, totals and the existing
"nights not billed" warning are untouched. No stored data is altered.

## Technical note

`src/routes/_authenticated/billing.folio.$bookingId.tsx`, the `nights` IIFE at
~line 2116: build the night-date set from `charges` where
`charge_type === 'room'` (using each charge's date, expanded by `qty` where a
single line covers several nights), then fall back to the current
`booking_rooms` logic and to `actual_check_in`/`actual_check_out`.

## Verification

- Bill 1985: Duration reads 3 Nights; charges and totals unchanged.
- BK-20260908-0013: reads 4 Nights instead of 1.
- A normal, unextended 2-night stay: still 2 Nights.
- A day-use stay: still 1 Night.
- A mid-stay room shift: nights counted once, not doubled.
