# GST address is being cut short — fix

## What I checked

I called the GST lookup service directly for the company in your screenshot
(Makemytrip, 06AADCM5146R1ZZ). It returns:

- a short address line: `Building No-5, 19th Floor, Epitome Building, DLF Phase III, Gurgaon`
- separate fields with the rest: city `Gurgaon`, pincode `122002`,
  state code `06` (Haryana), plus a detailed break-up
  (building number, building name, floor, street, locality, pincode)

So the problem is **at our end**, not the GST service. Our screen takes only
the short address line and ignores the extra fields, so the city, pincode and
state never reach the form. That is exactly the "last few words missing"
you're seeing.

The same reason explains the wrong **State** in your screenshot: it shows
Maharashtra (your hotel's state) because the service sends the state as a code
(`06`) and we only look for a state *name*, find none, and leave the old value.

## What I will change

1. Build the full address from all the pieces the service sends — building
   number, building name, floor, street, locality, city, state and pincode —
   instead of the short line alone. When the short line already contains a
   piece, it won't be repeated.
2. Read the state from the state code too, so Haryana fills in correctly
   instead of leaving your hotel's state.
3. Also pick up city and pincode so the saved company record has them.
4. Apply this everywhere the GST lookup is used: the New Booking "Bill To"
   step and the GSTIN verify on the invoice screen.

Result for this company:
`Building No-5, 19th Floor, Epitome Building, DLF Phase III, Gurgaon, Haryana, 122002`,
State: Haryana.

Existing saved companies keep their current address; re-verifying the GSTIN on
the screen will refresh it.

## Technical notes

- `src/lib/gstinProfile.ts`: extend `parseGstinProfile` to merge
  `data.address` with `data.address_details` (`building_number`,
  `building_name`, `floor`, `street`, `locality`, `district`, `city`,
  `landmark`, `pincode`), plus top-level `city`/`pincode`; de-duplicate parts
  case-insensitively; return `city` and `pincode` as new fields; resolve
  `state` via `stateNameFromCode(data.state_code)` from `@/lib/indiaGeo` when
  no state name is present. Also make the value picker accept numbers, not
  only strings.
- Consumers: `src/components/booking-wizard/StepBillTo.tsx` and
  `src/routes/_authenticated/billing.folio.$bookingId.tsx` — pass the new
  city/pincode through to the company record where those fields exist
  (`billing_companies.city`, `.state`, `.state_code`).
- No layout or design changes.
