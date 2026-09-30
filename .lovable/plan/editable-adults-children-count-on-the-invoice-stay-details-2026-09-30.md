# Editable Adults/Children count on the invoice Stay Details

## Current state (verified)

- The invoice Stay Details shows `Duration: 2 Nights · 1 Adult` — rendered at line 3316 of `src/routes/_authenticated/billing.folio.$bookingId.tsx` from `bookings.adults` / `bookings.children`. No edit control exists.
- The printed template (`src/lib/invoiceTemplates.ts` line 333) shows the same Pax from the same fields, so it updates automatically.
- RLS on `bookings` UPDATE requires `bookings.edit` permission. Receptionist, Manager, Owner, Executive have it; Accounts, Housekeeping, Label Operator do NOT. The user wants this edit available to **all** login IDs.
- The folio page already has `logActivity` in use and a `booking` state object that can be refreshed after save.

## Changes

### 1. Database (one migration)

- New SECURITY DEFINER function `update_booking_pax(_booking_id uuid, _adults int, _children int) returns void`:
  - Caller must be able to see the booking: `is_superadmin(auth.uid())` OR `is_global_owner(auth.uid())` OR `permitted_property_ids(auth.uid(), 'bookings', 'view')` contains the booking's property — this makes the edit work for every staff login on that property.
  - Clamps values: adults = GREATEST(1, _adults), children = GREATEST(0, _children).
  - Updates only `bookings.adults` and `bookings.children` (nothing else — dates, totals, charges untouched).
  - `GRANT EXECUTE ... TO authenticated`.
  - Bypasses RLS on the UPDATE (SECURITY DEFINER) so all IDs can use it, while still enforcing property visibility.

### 2. Folio page UI (`billing.folio.$bookingId.tsx`)

- On the Duration line (screen only, `print:hidden`), add a small pencil "Edit" button next to the adults/children text.
- Clicking it turns the line into two small number inputs (Adults, Children) with Save / Cancel.
- Save calls the new `update_booking_pax` RPC via supabase, then refreshes the booking query so the invoice and the printed template both show the new count.
- Logs an activity entry (booking module, pax updated: old → new values) using the existing `logActivity` helper.
- Shows an error toast if the RPC fails; no other behavior changes.

## Out of scope / untouched

- No changes to charges, totals, dates, or the early-checkout fix already in place.
- Duration (nights) itself stays computed from dates — only the Adults/Children counts become editable.
