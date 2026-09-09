# Food re-print: counter copy is missing

## What is wrong today

Checked all three re-print paths for food:

1. **View KOT / punch history re-print** (the button staff use most) — builds the print plan in "kitchen" mode and passes no counter printer, so only the kitchen station tickets print. No counter copy is ever produced, and no warning is shown.
2. **Edit KOT re-print** — after editing a printed KOT, it prints one ticket, always badged "KITCHEN COPY", to the first active KOT printer. It ignores per-item station routing and never prints a counter copy.
3. **KOT detail page re-print** — this one is correct: it offers Re-print All / Kitchen / Counter and resolves the "Counter Copy" printer properly. Used as the reference behaviour.

So the complaint matches path 1 (and 2): a re-print only reaches the kitchen.

## What will change

- **Punch/KOT history re-print prints both copies.** It will fetch the property's "Counter Copy" printer along with the station printers and print kitchen tickets plus the priced counter copy — the same as a fresh punch. The success toast will name every printer it went to.
- **Choice when needed.** The re-print button gets a small dropdown: Re-print All (default), Kitchen only, Counter only — same wording as the KOT detail page, so staff can send just one copy when a single ticket is lost.
- **Edit KOT re-print follows the same routing.** After editing a printed KOT, the re-print will route items to their own station printers and also send the counter copy, instead of one generic kitchen ticket.
- **Clear message when no counter printer is set.** If the property has no printer with the "Counter Copy" role, a visible warning explains where to set it (Master Data → Printers) instead of silently skipping it.
- **Laundry stays as is** — laundry tickets have no counter copy concept and keep printing to the laundry printer.

No change to ticket layout, table/dashboard design, billing, or any other logic.

## Technical notes

- `src/components/KotHistoryDialog.tsx`: fetch the `Counter Copy` printer (active, `printer_role = 'Counter Copy'`) alongside the active printer list; pass it into `buildKotPrintPlan` with mode from the new dropdown (default `kitchen+counter`) instead of the hard-coded `"kitchen"` and `null`. Surface `warnings` as today.
- `src/components/EditKotDialog.tsx`: replace the single-printer `renderKotHtml` + `printThermalHtml` call with `buildKotPrintPlan` + `runKotPrintJobs`, resolving each item's printer via `menu_items.kitchen_printer_id` → `menu_categories.kot_printer_id`, plus the counter printer. Keep the "(RE-PRINT)" suffix on the KOT number.
- `src/lib/kotPrint.ts` and `src/routes/_authenticated/food.kot.$id.tsx` unchanged — they already handle both copies.
- Verify after the change: re-print from an occupied table's View KOT sends one ticket per station and one priced counter copy.
