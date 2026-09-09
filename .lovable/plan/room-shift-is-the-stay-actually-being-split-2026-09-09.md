# Room shift — is the stay actually being split?

## What I checked

I read the live shift routine (`shift_room`), the room-charge seeding logic, the Shift wizard on the booking screen, and every real room shift recorded in the last month.

## What I found

The shift screen offers two types:

- **Same-day correction** — wrong room was assigned; one single room line continues, now showing the new room.
- **Mid-stay shift** — guest really moves on a date; old room keeps the nights already stayed, new room starts a fresh line.

The logic for both is present and correct in the database. **But every real shift in the last month was recorded as a same-day correction — the mid-stay split has never actually been used.**

Clearest example (7-night stay, 02–09 Sep): the guest stayed in room 102, then 304, then 401. The bill carries a single line — "Room 401, 7 night(s), Rs 22,400". Rooms 102 and 304 do not appear at all. The money happened to be right only because all three rooms were the same rate. Had the last room been dearer, every earlier night would have been silently re-priced upward; had it been cheaper, the hotel would have lost money.

So: the split feature works, but nothing stops staff from picking "same-day correction" for a genuine mid-stay move, which is what is happening in practice.

A second, smaller gap: in same-day mode the old room's charge is removed only once the new room's charge exists. If the new charge cannot be created (locked day, zero rate), the old room's line silently stays and the bill still shows the old room, with no warning.

## What to change

1. **Pick the right type automatically.** When the room being shifted started before today and the stay has more than one night, the wizard opens on **Mid-stay shift** with today's date pre-filled, instead of defaulting to same-day.
2. **Warn before a wrong same-day correction.** If someone overrides that and still chooses same-day on a stay that has already run past its first night, show a clear confirmation: "Nights already stayed in the old room will be re-billed at the new room's rate." Only proceed after they confirm.
3. **Never silently mis-bill.** In same-day mode, if the new room's charge could not be created, the shift reports a clear error instead of finishing quietly with the old room still on the bill.
4. **Show room-wise nights on the bill.** Where a stay has more than one room line, the invoice's stay section lists each room with its own dates and nights (this already works for genuine mid-stay splits; it just never had data to display).

No layout or design changes; the wizard steps stay as they are.

## Technical notes

- Wizard: `src/routes/_authenticated/front-desk.booking.$id.tsx` — default `shiftMode`, prefill `shiftEffDate`, add the confirm step before `doShift()`.
- Database: one migration on `public.shift_room` — in `same_day` mode, raise if the new room's room charge is absent after insert; keep all existing validation, audit rows and room-status updates untouched.
- Nothing changes for `mid_stay`; it already shortens the old row first (so its charge re-prices to nights actually stayed) before marking it shifted.

## Verification

- Do a mid-stay shift on a two-night in-house booking and confirm two room lines with correct nights and rates.
- Do a same-day correction on a booking checked in today and confirm one line only, no duplicates.
- Confirm the old room turns dirty/vacant and the new room occupied, and open food bills follow the guest, exactly as today.
