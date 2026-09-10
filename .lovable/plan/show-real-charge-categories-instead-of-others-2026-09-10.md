# Show real charge categories instead of "Others"

Direct charges posted from the Restaurant screen (Restaurant, Fast Food, Sweets, Food Charges) and laundry lines currently fall into a catch-all bucket. On the bill they appear under "Others", and in reports they land in "Other Revenue" / "Other Charges". They should appear under their own named category.

## What changes

1. One shared category rule used everywhere, so bill and reports always agree:
   - Accommodation (room nights)
   - Early Check-in
   - Extra Bed
   - Food & Beverage (in-house food punches)
   - Laundry
   - Restaurant / Fast Food / Sweets / Food Charges — one line per outlet, taken from the outlet chosen when the charge was posted (falls back to the name typed in the charge when no outlet is set)
   - Sundry / POS
   - Others (only for charges that genuinely fit nowhere else, e.g. key charges)

2. Bill / invoice GST breakup (screen + print): rows are generated from the categories present on that bill rather than the fixed four rows, so a bill with restaurant and fast food charges shows both lines with their own taxable and GST amounts. Totals stay exactly as today.

3. Reports updated to use the same rule:
   - Date-wise Revenue: outlet columns kept out of the table layout; instead restaurant/laundry amounts move out of "Other Revenue" into their proper buckets, with a category summary of the period below the table.
   - Bill-Wise: "Other Charges" no longer absorbs restaurant/laundry; laundry gets its own figure instead of being merged into food.
   - Night Audit revenue split and Sales report section totals use the same categories.
   - Excel and PDF exports carry the same category names.

## Technical notes

- New `src/lib/chargeCategory.ts`: `categoriseCharge(charge, outletByFolioChargeId)` returning `{ key, label }`. Classification order: `charge_type` (`room`, `food`, `laundry`, `early_checkin`, `extra_bed`, `sundry`, `discount`, `tax`), then for `extra` rows a lookup into `restaurant_direct_charges` (`folio_charge_id` -> `outlet_id` -> `restaurant_outlets.name`), then a description-prefix fallback (`Restaurant Charge — <name>`), else Others.
- Invoice page `billing.folio.$bookingId.tsx`: replace the hard-coded `["room","food","sundry","extra"]` GST-breakup rows with grouped categories; charge rows, edit/delete controls, discounts and totals untouched.
- Reports read the outlet map with the existing paged helpers (`pagedIn` on `restaurant_direct_charges` by folio charge ids) so long ranges stay complete.
- No database schema change, no migration, no layout or styling change.
