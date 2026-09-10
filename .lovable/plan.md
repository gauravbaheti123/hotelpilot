# Print all food punches in one go

Right now each punch in the "Food punches — Room 303" list has its own Reprint button, so staff must print them one by one. This adds a single button that prints everything for that room/table together.

## What changes

- A new **Print all KOTs** button at the bottom of the Food punches dialog (next to Close), shown only when there is at least one punch.
- It prints **one consolidated ticket** containing every punch for that room/table, in time order, with for each punch: bill number, status (open/settled), date-time, all items with quantity, note, rate and line amount, punch subtotal — plus a grand total at the end.
- Header shows room/table, guest name, and the printed-on time; the ticket is marked as a consolidated summary (RE-PRINT style label) so it isn't mistaken for a fresh kitchen order.
- Same dropdown style as the existing Reprint: All (kitchen + counter), Kitchen copy only, Counter copy only. Kitchen copies keep the existing item-to-kitchen-printer routing; the consolidated summary with prices goes to the Counter printer.
- If no counter printer is configured, the existing warning is shown instead of failing silently.
- Laundry punches get the same button, printing to the service printer (single copy, no counter split).

## Technical notes

- File: `src/components/KotHistoryDialog.tsx`.
- Add `printAllPunches(mode)` that reuses the existing printer/menu-item lookups from `reprint()` (fetched once, not per punch), builds a combined item list per printer via `buildKotPrintPlan`, and renders the priced consolidated sheet through `renderKotHtml`/`printThermalHtml` for the counter copy.
- Kitchen copies stay item-routed: items from all punches are merged and grouped per kitchen printer so each station gets one sheet.
- No database, permission, or layout changes; only this dialog's footer gains a button.
