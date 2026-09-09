# Walk-in (table) food sales — settle, free the table, and fix related issues

## What is wrong today

Checked the live data for Table 1: the bill BRIJ-EVT-F-0070 (Rs 30.01) is still **open** with zero paid. The table card only turns Vacant when the bill is no longer open, so the table stays "Occupied" — correct display, wrong cause: the bill was never actually settled.

Reason: from an occupied table there is **no way to settle**. The table menu offers only View KOT / New KOT / View Invoice, and the "Settle food bill" button inside View KOT is switched on only for room bills, never for table walk-ins. The only settle path is opening a new order and pressing "Print bill".

## What will change

1. **Settle from the table card** — occupied table menu gets "Print bill & settle" with payment mode. On success the table instantly shows Vacant.
2. **Settle inside View KOT** — the existing "Settle food bill" button will also work for table/walk-in bills (amount + payment mode + confirm), same as room bills.
3. **Table frees itself immediately** — after settling, the food dashboard refreshes the table map right away (it already listens for bill changes; the settle action will also trigger a local refresh so there is no delay).
4. **Fix settled amount losing GST** — when a bill is settled the stored total is currently set to the item amount only, dropping GST, while paid amount is stored including GST. So a settled walk-in bill looks part-paid/overpaid and reports understate revenue. The settle routine will store total = items + GST.
5. **Walk-in cash reaches the cash reports** — today the counter tender is only stamped on the bill row, so walk-in cash does not appear as a payment entry for cash collection / shift handover. Walk-in settlement will also record a proper payment entry (mode as chosen), without double counting in food revenue.
6. **Guard against orphan walk-ins** — walk-ins without a table are matched by typed customer name; if the name differs even slightly a second bill opens for the same customer. The punch screen will show today's running walk-in bills so staff pick the existing one instead of starting a duplicate.
7. **Existing open Table 1 bill** — left as-is; you can settle it from the new button once live (or tell me to close it and I will).

Not changing: bill numbering stays on the EVT-F series as you chose, and the dashboard/table card design stays the same.

## Technical notes

- `src/routes/_authenticated/dashboard.tsx`: add a settle entry to the occupied-table dropdown, wire it to `SettleFoodBillDialog`, bump `segmentReloadTick` on success.
- `src/components/KotHistoryDialog.tsx`: relax the `openBill` guard so it also resolves for `tableId` walk-ins (currently requires `roomId && bookingId`).
- `src/components/SettleFoodBillDialog.tsx`: accept a walk-in/table bill target; call `settle_segment_bill_with_payment`.
- DB migration: `settle_segment_bill` sets `total_amount = sum_amount` — change to `sum_amount + sum_gst` (matches `settle_segment_bill_with_payment` behaviour); verify walk-in path in `settle_segment_bill_with_payment` writes a `payments` row with the chosen mode.
- After the migration, spot-check that food/GST/cash reports for today still reconcile.
