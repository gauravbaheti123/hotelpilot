# Event Room Shift Reliability Fix

## Confirmed root cause

- Checked-in event rooms are stored as live `booking_rooms.status = 'checked_in'`.
- `shift_room` currently accepts only `status = 'active'`, so a valid open event room is rejected with P0001 as “no longer active.”
- This is not a stale screen in the reported case; the database status check itself is incompatible with the event-room workflow.

## Fix plan

1. **Accept every valid live assignment**
   - Update the atomic room-shift routine to accept `active` and `checked_in` assignments.
   - Continue rejecting `shifted`, `cancelled`, `checked_out`, reserved/not-yet-checked-in, settled, and day-locked cases.

2. **Preserve event-room identity through the shift**
   - Move `event_block_id` and `event_booking_id` from the old room segment to the newly created segment atomically.
   - Update the linked event-room record to the new room number/category/rate and current segment dates without allowing its sync trigger to revive or overwrite the old shifted row.
   - Preserve check-in/check-out times and the booking’s real departure date on the new segment.

3. **Harden shift validation**
   - Verify the caller has booking-edit access for that property.
   - Require source room, target room, booking, and event block to belong to the same property.
   - Keep database-level overlap/current-occupancy checks so a stale vacant-room list cannot double-assign a room.

4. **Prevent false success and stale repeat shifts**
   - Return the new current assignment ID from the shift routine.
   - After save, reload the booking/event room data and verify exactly one live assignment exists on the target room before showing success.
   - If another tab already shifted the room, refresh and show the current room instead of leaving the dialog on the old assignment.

5. **Verify all linked effects**
   - Event room tile and event details show the new room.
   - Old room becomes vacant/dirty and new room becomes occupied.
   - Mid-stay billing keeps prior nights on the old room and remaining nights on the new room; same-day correction does not duplicate room charges.
   - Open food bills and selected kitchen orders follow the new room.
   - A second shift uses the newly created live assignment rather than the old shifted row.

## Validation

- Reproduce with a currently checked-in event room and confirm the shift succeeds.
- Test same-day and mid-stay event shifts, including a departure after the shift date.
- Query event-room, booking-room, room-status, charge, food-bill, and shift-history records after each test.
- Confirm normal non-event room shifting and dates-only edits still work.
- Run typecheck/build and check the live screen for errors.
