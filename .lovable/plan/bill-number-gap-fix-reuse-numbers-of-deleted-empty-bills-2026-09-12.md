# Bill Number Gap Fix — Reuse Numbers of Deleted Empty Bills

## Problem
Bill numbers are taken from a counter (`bill_sequences.last_number`) the moment a bill is created. When an empty unpaid bill is deleted (e.g. BRIJ-F-0694), the counter is not rewound, so the next bill skips that number: after deleting 0694, the next food bill would be BRIJ-F-0695 with 0694 missing.

## Goal
No visible gaps in food/laundry bill numbering when an empty, unpaid bill is auto-removed.

## Changes

1. **Rewind the counter when safe** — in the shared empty-bill cleanup (`src/lib/segmentBill.ts` / cleanup RPC), after deleting an empty bill:
   - Read the bill's number (e.g. `BRIJ-F-0694` → series `food`, number 694).
   - If that number equals `bill_sequences.last_number` for the property+series (i.e. it was the latest bill and no newer bill exists), decrement `last_number` by 1 so the next bill reuses the exact same number.
   - If a newer bill already exists, do NOT rewind (avoid duplicate numbers); the gap stays only in that rare case, which is acceptable and auditable.

2. **Cancelled empty bills at daily close** — keep the existing auto-close behavior of marking the bill `cancelled`/`void` rather than deleting it, so its number stays on record (a cancelled bill showing 0 is more auditable than a vanished number; no gap because the row remains). No counter change needed there.

3. **Backfill current data** — BRIJ-F-0694 was already deleted and it was the latest food number (counter = 694). Rewind food `last_number` from 694 → 693 so the next food bill is again BRIJ-F-0694, eliminating the gap.

## Out of scope
- Settled/paid bills: never deleted, numbers never reused.
- Lodge (room invoice) and banquet numbering: unchanged — those bills are not deleted by this flow.

## Technical details
- Files: `src/lib/segmentBill.ts`, plus a small migration if the rewind logic lives in a DB function.
- Rewind guarded by: bill has zero items, zero payments, status not settled/complimentary.
- Verify with typecheck/build after edits.
