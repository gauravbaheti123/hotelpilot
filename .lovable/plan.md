# Fix "Settle as Complimentary" and open it to every staff login

## What is wrong now

Marking a food/laundry bill as complimentary always fails with a red error
("function does not exist"). The bill stays open, so the table stays occupied.

Cause: the rule that checks who is allowed to mark a bill complimentary calls a
role-check helper the wrong way, so the whole action crashes before it even
looks at the reason or the bill. This happens for every login, including Owner.

## What will change

- Fix the crash so "Confirm Complimentary" works.
- Remove the role restriction entirely: any signed-in staff member of the
  property (Owner, Manager, Receptionist, Kitchen, Housekeeping, any role) can
  settle a bill as complimentary.
- Keep the safeguards that matter: a reason is still mandatory, the bill still
  closes at zero with nothing posted to the folio, and every complimentary
  settlement is still written to the activity log with who did it and why.
- The "Mark Complimentary" button will now show for all logins, not just
  Owner/Manager.

## Technical notes

- Migration: recreate `public.settle_segment_bill_complimentary` — replace the
  broken `public.is_owner_or_super()` (called with no argument) role block with
  a simple authenticated + property-access check (`uid IS NOT NULL` plus
  membership via the existing property permission helper). Everything else in
  the function (item totals, folio charge removal, folio recompute, bill update,
  activity_log insert) stays byte-identical.
- `src/lib/complimentary.ts`: `canMarkComplimentary` returns true for any
  non-empty role list, so the UI gate matches the backend.
- No UI/layout changes; button styling and dialog stay as-is.
