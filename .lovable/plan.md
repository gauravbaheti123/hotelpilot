# Bill shows "3 Nights" for a 4–29 Aug stay — fix the duration

## What is wrong

On bill 1871 (booking BK-20260802-0005) the stay header reads:

- Check-in: 04 Aug 2026
- Check-out: 29 Aug 2026
- Duration: **3 Nights**

The charges below it correctly list one room line per night, so the money is not
affected — only the "Duration" line is wrong.

## Why it happens

This stay is stored as many one-night room segments (a night-wise tariff edit
splits the stay into per-night rows), plus one older room-301 segment that was
closed when the guest was shifted to room 205. That old, shifted segment happens
to span 3 days.

The bill screen computes the duration as *the longest single room segment*, not
the length of the stay, and it also counts segments that were already shifted
away. So it picks the abandoned 3-day room-301 row and prints "3 Nights".

Any stay that has been night-split or room-shifted will show a short, wrong
night count on the bill; a plain unsplit stay happens to come out right, which
is why this was not noticed earlier.

## The fix

Count the nights actually stayed instead of the longest segment:

- Ignore room segments marked as shifted (unless they are the only ones).
- Collect every distinct night covered by the remaining segments (so a
  night-split stay counts 27 nights, and two rooms occupied on the same night
  count as one night, not two).
- If no usable segments exist, fall back to the booking's own check-in →
  check-out span.
- Keep the minimum of 1 night for same-day/day-use stays.

This is a display-only change on the bill's Stay Details block, which drives
both the on-screen bill and the printed/PDF copy. Room lines, rates, GST,
totals and the existing "nights not billed" warning are untouched.

## Technical note

`src/routes/_authenticated/billing.folio.$bookingId.tsx`, the `nights`
computation at ~line 2111: replace the `reduce`/`Math.max` over per-row
day-differences with a set of night dates built from non-`shifted`
`booking_rooms` rows, falling back to `booking.check_in`/`check_out`.
The separate print template (`src/lib/invoiceTemplates.ts`) already uses the
booking span and needs no change.

## Verification

- Bill 1871: Duration reads 27 Nights, dates and charges unchanged.
- A normal 2-night stay: still 2 Nights.
- A day-use stay: still 1 Night.
- A mid-stay room shift: nights counted once, not doubled.
