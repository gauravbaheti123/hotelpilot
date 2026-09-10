# Complimentary bills: fix the error and add it to "Settle bill"

## What is wrong now

1. Marking a food bill complimentary while punching a new order fails with a red
   error ("function ... does not exist"). Nothing gets marked, the bill stays open.
2. For an existing food punch, the only choice is "Settle food bill", which always
   asks for a payment mode. There is no way to close an already-punched bill as
   complimentary.

## Cause of the error

The permission check inside the complimentary action asks the property-access
helper the wrong way (it is called without the details it needs), so the whole
action crashes before it looks at the bill. This happens for every login,
including Owner — nobody can mark a bill complimentary today.

## What will change

- Fix the permission check so "Confirm Complimentary" works. Any signed-in staff
  member with access to the property can do it (as intended earlier); a reason
  stays mandatory and every complimentary settlement is still recorded in the
  activity log with who did it and why.
- Add "Mark Complimentary" to the Settle food/laundry bill window, next to
  Cancel/Collect. Choosing it shows the same reason list (MAP plan, AP plan,
  package, guest relations, manager approval, staff meal, or a typed reason)
  and closes the bill at zero — nothing is added to the room bill and no cash
  is recorded.
- This works for room bills and for walk-in/table bills; for a table, the table
  is freed just like a paid settlement, and the printed receipt shows
  "COMPLIMENTARY — <reason> / No amount collected" instead of a payment line.
- When more than one open bill is on the same table, all of them are marked
  complimentary together, matching how paid settlement already behaves.
- Correct the misleading message "Only a Manager or Owner can mark a bill
  complimentary".

## Technical notes

- Migration: recreate `public.settle_segment_bill_complimentary` — replace
  `b.property_id IN (SELECT unnest(public.permitted_property_ids()))` (invalid:
  the function requires `_user_id, _module, _action`) with a superadmin check
  plus `user_roles` membership for `uid` on `b.property_id`. Rest of the body
  (item totals, folio charge removal, folio recompute, bill update, activity_log
  insert) unchanged. Re-grant execute to `authenticated`, revoke from anon/public.
- `SettleFoodBillDialog.tsx`: add a reason step + `markComplimentary()` that loops
  the same `targets` array used by `submit()`, calls
  `settle_segment_bill_complimentary(_bill_id, _reason, _actor)`, skips
  `no_items` duplicates when several targets exist, prints via `printSegmentBill`
  with `complimentaryReason` for walk-ins, then calls `onSettled()`/`onClose()`.
- Reuse `COMPLIMENTARY_PRESETS`, `COMPLIMENTARY_OTHER`, `canMarkComplimentary`
  from `src/lib/complimentary.ts`; no new copies of the reason list.
- `PunchChargeDialog.tsx`: fix the `not_allowed` toast text only.
- No layout or styling changes to existing controls.
