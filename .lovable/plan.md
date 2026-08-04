# Delete the Martand Misal outlet and all of its data

Permanent, irreversible removal of the Martand Misal (Latur, code MM) outlet, everything recorded under it, and the three logins that exist only for it. Brij Motel is untouched.

## What gets deleted

The outlet record itself, plus every row linked to it. Confirmed counts today:

- 12 rooms, 2 bookings, 2 guests, 4 staff, 1 food order, 3 role assignments
- All other outlet-scoped records: room categories, tariffs, menus, printers, folios, payments, bills and bill counters, halls, banquet data, housekeeping, inventory, vendors, expenses, attendance, payroll, feedback, templates, WhatsApp messages, labels, activity log, settings

Every one of these tables is already wired to delete automatically when the outlet is removed, so a single delete of the outlet clears all of it. Wipe-log rows are the one exception — they detach rather than delete; those get removed explicitly first.

## Login accounts

These three sign-ins are linked to Martand Misal only and will be permanently deleted, along with their profile records:

- owner@demohotel.com (Owner)
- manager@demohotel.com (Manager)
- support@demohotel.com (Receptionist)

No other user in the system loses access.

## Bill numbering

Martand Misal's own bill counters disappear with it. Brij Motel's numbering (BRIJ-LDG-, BRIJ-F-, etc.) is stored separately and is not affected.

## Technical notes

1. Migration step: delete `wipe_logs` rows for property `ac0d2840-afe3-4818-92bc-a9295a75a70f` (its FK is `ON DELETE SET NULL`, so it would otherwise be orphaned), then `DELETE FROM public.properties WHERE id = '...'`. All 70+ dependent tables use `ON DELETE CASCADE`, so no manual table-by-table ordering is needed.
2. Auth users: delete the three `auth.users` rows via the admin API using a one-off superadmin server call (`supabaseAdmin.auth.admin.deleteUser`), which also clears their `profiles`, `user_roles`, `user_mfa_settings`, and `user_totp_secrets` rows by cascade.
3. Post-delete verification: confirm zero rows remain in `properties`, `user_roles`, `bookings`, `rooms`, `guests`, `staff`, `kot_orders`, `bill_sequences` for that property id, and that the three emails are gone from `auth.users`.
4. Front-end: no code changes needed. The property selector and all queries are property-scoped and read live data, so the outlet simply stops appearing. Any browser still holding `hp.currentPropertyId` for the deleted outlet falls back to the first visible property via existing auto-pick logic.

## Not reversible

There is no undo for this. If you want a safety copy first, say so and I will export the outlet's tables to CSV before deleting.
