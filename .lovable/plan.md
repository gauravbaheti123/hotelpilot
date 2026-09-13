# Remove the pre-filled "Latur" city + full address / GST editing

## What changes for you

1. **No more default city.** New guest forms currently open with City "Latur" and State "Maharashtra" already filled in. Those will start blank, so staff type the real city each time. Because the guest's company details are copied to the Billing Companies list, this also stops "Latur, Maharashtra" from appearing on companies that never had a real address.

2. **Billing Companies stay fully editable.** The list already has an edit (pencil) action with GSTIN, address, city, state and nation fields. The edit form gets the same smart City / State pickers used elsewhere (searchable list, free typing for new towns) instead of a plain text box and a long dropdown, so correcting a wrong "Latur" is quick.

3. **Hotel's own address and GSTIN.** These already exist on the Hotel Settings screen (address lines, city, state, PIN, GSTIN, PAN, FSSAI, state code). They are only greyed out for staff without the business-settings right. No change to who can edit — confirm the admin account has that right if the fields look locked; if you want another role allowed, tell me and I'll enable it.

Existing saved addresses are not touched — nothing is rewritten in the database. Only new entries stop defaulting to Latur.

## Technical notes

- `src/lib/bookingWizard.ts`: set `DEFAULT_CITY` / `DEFAULT_STATE` to empty strings (both are used in `emptyGuest()` and the second guest factory at lines ~195 and ~282). Keep `DEFAULT_NATION` = India.
- Verify nothing else relies on those constants being non-empty (only the two factory call sites use them today).
- `src/routes/_authenticated/billing.companies.tsx`: swap the `city` text field and `state` select for the shared `CityInput` / `StateSelect` from `src/components/AddressFields.tsx` via a custom field renderer, keeping CSV import/export columns unchanged.
- No database migration, no data backfill, no change to GST lookup behaviour.
