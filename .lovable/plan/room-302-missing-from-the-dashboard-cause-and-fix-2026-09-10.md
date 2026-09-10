# Room 302 missing from the dashboard — cause and fix

## What actually happened

Room 302 is genuinely occupied: booking BK-20260907-0002 (Shivkumar Mohanlal Mourya, 07–10 Sep, balance ₹4,515) is still checked in and the room row is still active.

Yesterday at 07:56 IST an Owner edit on that booking's stay times (reason "Aaa") saved an **actual check-out time of 10 Sep, 07:56** onto a guest who has not checked out. The dashboard decides which rooms are occupied purely from live stay rows and ignores any row that already carries a check-out time — so 302 immediately dropped off the grid and shows as vacant, even though the guest is in the room and the bill is open.

The Owner stay-time edit form allows this: it accepts a check-out time and writes it straight onto the stay row with no check that the guest is still in-house. Nothing else changes — the booking stays "checked in", the bill stays open, the room silently disappears.

## Checked across the whole property

- 1 stay affected: room 302 (the one reported).
- No rooms shown as occupied without a real guest.
- No other checked-in guest is hidden from the grid.
- No other room shows the opposite mismatch.

## The fix

1. **Repair room 302.** Clear the wrongly stored check-out time on that stay row and put the room back to occupied, so 302 reappears on the dashboard with the guest, dates and balance intact. The guest's real check-in time is left as it is; no bill, payment or date change is touched.

2. **Stop it happening again.** The Owner stay-time edit will refuse a check-out time while the guest is still checked in, with a clear message: "This guest has not checked out yet — use Check-out to close the stay." Editing the check-out time of an already checked-out stay keeps working exactly as today, as does editing check-in time, dates, room and category.

3. **Match the form to the rule.** On a still-in-house stay, the check-out time field in the Owner edit card is shown disabled with a short note pointing to Check-out, so the mistake can't be made in the first place.

Nothing else changes: no layout changes, no changes to check-in, check-out, room shift, billing or reporting.

## Technical notes

- Data repair (one row): `booking_rooms.actual_check_out = NULL` for `278ee8a8-47ed-4ee5-bfae-e8550e078f41`; `rooms.status = 'occupied'` for room 302 (`7a98ccd3-…`). Requires the `app.allow_actual_time_edit` guard flag used by the existing owner override path.
- `public.owner_update_booking_room_details`: after resolving `_booking_status`, raise when `_actual_check_out IS NOT NULL` and the parent booking status is `reserved`/`checked_in` and the stored `actual_check_out` was NULL. Rest of the function unchanged.
- `src/components/OwnerInlineEditCard.tsx`: disable the actual-check-out input when the booking is not `checked_out`, with helper text; keep the existing "did not save as entered" verification.
- Grid source (`dashboard_grid.active_booking_rooms`, filter `actual_check_out IS NULL`) is intentionally left as is — it is the correct read-only derivation.
