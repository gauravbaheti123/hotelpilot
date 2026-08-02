## Goal

Invoices decide CGST+SGST vs IGST from a reliable 2-digit state code instead of a free-text state name that is blank on virtually every record today. When nothing can be determined, fall back silently to the property's own state — no warning on the invoice.

Confirmed current state: `guests` has a state filled on 1 of 2,967 rows, all 759 `billing_companies` have none, GSTIN is never parsed for its state code anywhere, and the comparison is a lowercased text match on state names. So no invoice can currently produce IGST, and the amber note appears on effectively every GST bill.

## 1. State-code reference + GSTIN parsing

- Add a state-name ↔ GST state-code map (all 36 states/UTs) alongside `INDIAN_STATES` in `src/lib/indiaGeo.ts`, plus `stateCodeFromName()` and `stateNameFromCode()`.
- Add `stateCodeFromGstin()` in `src/lib/gstin.ts`: return the first 2 digits when the GSTIN passes the existing format check and the code is a real state code; otherwise null.

## 2. Resolution order (single shared helper)

New `resolveStateCode({ gstin, state })` in `src/lib/gst.ts`, applied to both the bill-to party and the property:

```text
1. state code parsed from that party's GSTIN
2. state code mapped from that party's address state name
3. (bill-to only) fall back to the property's resolved code
```

`resolveTaxType` is reworked to compare codes: IGST only when both codes are known and differ; everything else is CGST+SGST. The `unknownState` flag and both warning messages are removed, since an unresolvable bill-to state now silently inherits the property's state and is correctly intra-state.

Bill-to party priority is unchanged: billing company (when Bill To = Company) → guest.

## 3. Store the code on the parties

- Migration: add `state_code text` to `public.guests` and `public.billing_companies`.
- Database triggers on both tables that fill `state_code` on insert/update using the same order as above (GSTIN first, then state name), so newly entered records stay correct without UI work.
- Fix the property trigger so it prefers the GSTIN code but falls back to the state-name map, instead of leaving a wrong value.

## 4. Backfill existing data

- One-time pass over 759 billing companies and 2,967 guests: set `state_code` from GSTIN where present, else from the state name where present, else leave null (invoices will inherit the property's state).
- Correct **Martand Misal**: its `state_code` is `22` (Chhattisgarh) while its address state is Maharashtra, because its GSTIN is the placeholder `22AAAAA0000A1Z9`. I'll set the code to `27` from the state name and flag the placeholder GSTIN for you to replace in Hotel Settings.

## 5. Invoice surfaces to update

- `src/routes/_authenticated/billing.folio.$bookingId.tsx` — use the new resolver; delete the amber note block (line ~2032).
- `src/lib/invoiceTemplates.ts` — same resolver in `taxContext`; delete the printed note (line ~402). Pass the resolved bill-to GSTIN/state through the invoice context.
- `src/routes/_authenticated/banquet.bill.$id.tsx` — switch to the shared resolver so banquet bills follow the same rule. Its hardcoded 5% GST rate stays as-is per your answer (separate task).
- `src/routes/_authenticated/reports.gst.tsx` and `src/lib/reportExports.ts` — verified they reference state logic; align them so report totals split CGST/SGST/IGST the same way invoices do.

## Technical notes

- No existing invoice amounts change: the total GST is untouched, only its split between CGST+SGST and IGST lines.
- Comparing codes rather than names removes false IGST from spelling/case variants such as "maharastra" vs "Maharashtra".
- Guests and companies keep their free-text `state` field for the printed address; `state_code` is purely the tax key.

## Verification

- Re-query how many guests/companies resolve to a code after backfill.
- Confirm a same-state bill still prints CGST+SGST, a bill with an out-of-state GSTIN now prints a single IGST line, and a bill with no state or GSTIN prints CGST+SGST with no warning text.
