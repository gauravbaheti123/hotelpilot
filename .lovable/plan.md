# BRIJ-F-0694: ₹0 food bill — what happened and how to fix it

## What the records show

On 12 Sep at 14:38 (IST) a food punch for Room 212 (Deepak Mahajan) was made with one line: Bottle Water ₹28.58 + ₹1.43 GST. Bill number **BRIJ-F-0694** was created for it. Thirty seconds later the Owner deleted that punch from the dashboard.

The delete removed the item line, but nobody removed the bill itself. So the bill stayed behind:

- status: open
- total: ₹0.00
- items: none

That is the ₹0 bill in the list. It is not a calculation error — the bill is genuinely empty.

## Why an empty bill is a problem

1. It shows in Invoices as a real bill worth ₹0, which looks like a billing failure to staff.
2. It will never go away on its own. The nightly auto-close skips bills with no items, so it stays "open" forever and keeps appearing.
3. It permanently consumes a bill number, leaving a gap in the food bill series.
4. Any new punch for the same guest on the same day reuses this empty shell — fine — but on later days a fresh number is taken and the empty one remains.

There is currently exactly one such bill in the data (BRIJ-F-0694), so this is a young bug, not a backlog.

## The fix

**1. Deleting the last punch should delete the bill**
When a punch is deleted (KOT history dialog) and the bill has no remaining items, delete the empty bill row instead of leaving it at ₹0. Same treatment when editing a punch removes every line. If the bill was already posted to a folio, remove its folio charges and recompute the folio first so the guest bill stays correct. The existing owner-override audit entry is kept, so the deletion is still traceable.

**2. Same rule for the food-punch dialog**
The punch/charge dialog uses the same recalculation helper; give both screens one shared helper so an empty bill is always cleaned up, never left dangling.

**3. Safety net for empty bills that slip through**
The nightly auto-close currently skips zero-item bills silently. Change it to close out such bills as void/cancelled (not settled, no money movement, no folio charge) with an audit note, so no empty bill can linger open indefinitely.

**4. Clean up BRIJ-F-0694**
Remove the existing empty bill. No items, no payments, no folio charges attached, so no money is affected.

## Technical notes

- Code: `src/components/KotHistoryDialog.tsx` (`recalcBillTotals`, `confirmDelete`, `saveEdit`), `src/components/PunchChargeDialog.tsx` (duplicate `recalcBillTotals`) — extract to one helper in `src/lib/billing.ts` that deletes the bill when the item count drops to zero and unsettled, after clearing `folio_charges` rows with `source_table='segment_bills'` and calling `recompute_folio_totals`.
- DB: update `public.auto_close_segment_bills()` so the `no_items` result path voids/cancels the bill and logs `SEGMENT_BILL_AUTO_VOIDED_EMPTY` instead of leaving it open. `post_segment_bill_to_folio` keeps its `no_items` guard unchanged.
- Data: delete `segment_bills` row `75668b67-fdd8-4efa-910b-33aa43cc73a4` (BRIJ-F-0694) via a data query; verified it has 0 items, `paid_amount` 0, and no folio charges.
- No change to bill numbering, GST logic, settlement, or existing settled bills.
