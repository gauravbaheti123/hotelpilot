# Why the "duplicate entry" error appears when punching food

## What is actually happening

The error is not about the food order at all. It comes from the guest bill (folio) attached to Room 304's booking.

Checked the live data: this booking has exactly one bill, and its status is **"due"** (that is the state a bill goes into when it is left with an outstanding amount / on hold — this one shows ₹3,360 outstanding).

When a food charge is punched, the system asks for the booking's bill. That lookup deliberately ignores bills marked "due" (and "refunded"), so it concludes there is no bill and tries to create a fresh one. But the database rule that prevents two live bills per booking counts "due" bills as live — so it blocks the insert, and the raw database message ("duplicate key ... folios_active_per_booking_uniq") is what staff sees.

So: any room whose bill is in "due" state cannot take a food or laundry punch. Right now 3 bookings in the system are in that state.

## The fix

- Make the bill lookup reuse the existing bill whenever one is live for that booking — including "due" and "refunded" ones — instead of skipping it and trying to create a second one. Preference order stays as it is today (open bill with a balance first), so nothing changes for normal bookings.
- As a safety net, if creation still collides, fall back to the existing live bill rather than throwing a database error at the user.
- Show a plain-language message instead of the raw database text if this class of error ever surfaces again.

No change to punch behaviour, bill numbering, printing, GST, or any screen layout.

## Technical notes

- `public.get_or_create_folio(_booking_id)`: the SELECT filter `status NOT IN ('void','refunded','due')` does not match the unique index predicate `is_deleted = false AND status <> 'void' AND parent_folio_id IS NULL`. Align the SELECT to the index predicate (drop `refunded`/`due` from the exclusion, keep `parent_folio_id IS NULL` so split children are not picked as the parent) and wrap the INSERT in an exception handler that re-selects on `unique_violation`.
- Callers (`get_or_create_open_segment_bill`, punch dialog, checkout paths) need no change.
- Verify afterwards: punch a food item on Room 304 (folio `39ab8cc6`, status `due`) and confirm the KOT saves and posts against the existing folio, with no new folio row created.
