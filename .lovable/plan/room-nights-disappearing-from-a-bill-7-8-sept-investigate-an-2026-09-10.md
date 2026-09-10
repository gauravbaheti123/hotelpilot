# Room nights disappearing from a bill (7 & 8 Sept) — investigate and fix

## What the records show

For the bill in your screenshot (Room 302, 7–10 Sept, BK-20260907-0002):

- The stay is one continuous 3-night stay at ₹2,800, and the guest has since been checked out and paid ₹10,290, which does include all 3 nights plus the early check-in. So the money finally collected was right — but the bill on screen was showing only one night at the time, which is unacceptable and can easily cause under-billing.
- That bill had been **split into two bills** (a room bill and a food bill) at 02:18. The split created **three identical ₹8,400 room lines** on the room bill; two were later wiped, leaving one.
- Between 02:13 and 04:20 the stay's checkout date was changed back and forth eight times (10 → 8 → 10 → 11 → 10 …). Every one of those changes rewrites the room nights and re-posts the room charge.
- One extra, completely empty bill was created for this booking at 04:17, during that date-change activity.

So three mechanisms were acting on the same bill at once: bill split, repeated date changes, and per-night tariff edits. Which of them dropped the 7th and 8th from the screen is **not yet proven** — that is step 1 below, not a guess I will build a fix on.

## Step 1 — Reproduce and pin the cause (before any fix)

On a test booking, replay each path and record what happens to the night lines:

1. 3-night stay → split the bill → check the room lines on both resulting bills.
2. 3-night stay → edit only the 2nd night's tariff → check that nights 1 and 3 remain.
3. 3-night stay → shorten checkout, then extend it back → check the night lines.
4. Same as 2 and 3, but on a stay whose bill has already been split.
5. Delete a single night line and confirm only that night goes.

Each run is checked against the stored charge rows, not just the screen.

## Step 2 — Fix the defects already confirmed

- **Split duplicates room nights.** Stop the split from writing the same underlying room charge more than once per resulting bill, and reject a split whose lines do not add up to the original bill.
- **Empty duplicate bills.** Block creation of a bill with no lines during date changes / recalculation, and clear the empty one already sitting on this booking.
- **Date changes on a split bill.** A date change currently recalculates only one of the two split bills and re-posts the room charge into whichever bill the system picks — the room nights can land on the bill you are not looking at. Route the re-posted room charge to the bill that already holds the room lines, and recalculate every live bill of the stay.
- **Silent failures.** When a night charge cannot be posted (day closed, bill settled, permission), the screen currently shows nothing. Surface a clear message instead of a quietly shorter bill.
- **Deleting one night.** Confirm and, if needed, correct the delete action so removing one night never removes the whole room stay line.

## Step 3 — Safety net

- A check that runs when a bill is opened: if the room lines on a stay's live bills do not cover every night between check-in and check-out, show a visible warning on the bill with a one-click "restore missing nights" action, instead of silently printing a short bill.
- A one-off scan of existing stays for the same gap, reported back to you before anything is changed.

## Technical notes

- `split_folio_bill` inserted three identical `folio_charges` rows (source_id = the single `booking_rooms` segment, qty 3, ₹8,400) on child folio `1b42b6e9…`; two are now `is_wiped`. Add a per-child dedupe on (`source_table`, `source_id`) plus a payload-vs-parent total assertion.
- `modifyDatesOp` (src/lib/roomOps.ts) updates last-day `booking_rooms` rows, then calls `seed_room_charge_for_booking_room`, then `recomputeBookingFolioTotals`, which resolves a single folio via `get_or_create_folio`. With live split portions that resolution is ambiguous; seed the charge onto the portion already carrying `source_id` room rows and recompute all live portions.
- `seed_room_charge_for_booking_room` returns NULL silently on `is_day_locked`, settled/void folio, and status filters — return a reason and surface it in the UI.
- `expandRoomNights` night rows carry `source_charge_ids = [parent charge id]`; verify the delete path in `billing.folio.$bookingId.tsx` (~line 2900) does not remove all nights.
- Empty-folio creation: `get_or_create_folio` still inserts a fresh parentless folio when the only live rows are portions in transient states; add a guard and clean up folio `5c30979e…`.
