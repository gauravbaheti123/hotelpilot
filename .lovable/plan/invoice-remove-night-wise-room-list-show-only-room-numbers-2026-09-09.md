# Invoice: remove night-wise room list, show only room numbers

## What changes

On the bill's Stay Details block, the "Rooms occupied:" list that repeats one line per night (Room 301 · 2026-09-04 → 2026-09-05 · 1 Night, and so on) is removed completely.

The top "Room:" line keeps showing every room the guest used, separated by commas (for example `301, 302`). Category behaves the same way. Check-in, Check-out and Duration stay as they are.

This applies to both the on-screen bill and the printed/PDF bill, since they render from the same block.

## Technical note

In `src/routes/_authenticated/billing.folio.$bookingId.tsx`, delete the `rows.length > 1` "Rooms occupied" JSX block (lines ~2816-2840). The existing `allRoomNos` / `allCats` joins already drive the Room and Category lines, so no other change is needed.

## Verification

- Bill with a room shift: single "Room: 301, 302" line, no per-night list.
- Single-room bill: unchanged.
