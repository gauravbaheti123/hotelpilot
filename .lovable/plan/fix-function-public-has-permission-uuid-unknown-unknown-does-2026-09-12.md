# Fix "function public.has_permission(uuid, unknown, unknown) does not exist" on settled bill edits

## Root cause (confirmed)

`public.has_permission` exists only with 4 arguments: `(user_id, property_id, module, action)`.

The migration that added full-row editing (`20260910130307`) created two functions —
`owner_update_folio_charge` and `owner_update_folio_header` — whose settled-bill permission
check calls `has_permission(auth.uid(), 'invoices', 'edit_room_rate_locked')` with only
3 arguments (the property id is missing). For a settled bill like Folio 1870 the function
hits that branch and Postgres errors with code 42883 before saving anything.

Open bills don't hit this bug because they use the `staff_can_correct` branch — which is
why the error only appears after checkout.

## What will change

- Recreate `public.owner_update_folio_charge` and `public.owner_update_folio_header`,
  changing only the two broken permission lines to pass the folio's property id:
  `public.has_permission(auth.uid(), _prop, 'invoices', 'edit_room_rate_locked')` /
  `'edit_billto_locked'`.
- Everything else in both functions stays identical: reason required, activity log entry,
  totals recalculation, Manager/Owner-only editing of settled bills.
- Keep the existing grants: revoke from anon/public, grant to authenticated.
- Scan the other recently created functions for the same 3-argument call pattern and fix
  any that have it.

## Result after the fix

- Editing the tariff/description/date on a settled bill works for Manager/Owner (Folio 1870).
- Open-bill editing for all staff is untouched.
