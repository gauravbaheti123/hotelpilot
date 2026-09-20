# Room night missing on BK-20260917-0001 — why, and how to stop it

## What the records show

Stay: Room 304, 17 Sept → 20 Sept = **3 nights** (17th at ₹4,420.17 after a
tariff edit, 18th and 19th at ₹3,929.04 each).

Timeline on this booking:

- 17 Sept 07:28 — check-in, room charges posted for all 3 nights.
- 17 Sept 07:29 — tariff of the 17th edited (stay splits into two segments:
  17→18 at ₹4,420.17, and 18→20 at ₹3,929.04 covering 2 nights).
- 20 Sept 07:05 — **bill split** into a room bill and a food bill. The original
  bill was ₹13,428. The two new bills came out at **₹8,767 + ₹536 = ₹9,303** —
  exactly one night (₹3,929.04 + 5% GST = ₹4,125) short. That is the screenshot
  you sent: only 17/9 and 18/9 appear, Duration reads 2 Nights.
- 20 Sept 08:37 — checkout date changed 20 → 21 → 20. Each change re-posts the
  room charge, which **accidentally restored the missing night**.
- 20 Sept 08:38 — ₹12,892 collected on the room bill.

So the bill is correct *now* (₹12,892 = all 3 nights, fully paid). The money was
not lost on this booking — but only by luck of the date edits.

## Where the night went

The loss happened at the bill split, not at check-in and not in the printed
template. The split screen breaks a multi-night room line into one row per
night and writes the rows you assign onto each new bill; whatever is not
written simply disappears, because the split routine only checks that the new
bills **do not exceed** the original — never that they **add up** to it. A
₹4,125 shortfall passed silently.

Which step dropped that one night row (the per-night expansion, the assignment
buckets, or the charge copy) is **not yet proven**, so that is step 1 below
rather than a guess I build a fix on.

## Step 1 — Reproduce and pin the exact drop

On a test booking that mirrors this one (3 nights, first night's tariff edited
so the stay is stored as 1-night + 2-night segments):

1. Open the split screen and confirm all 3 night rows are listed.
2. Split room vs food with default assignment; compare each new bill's lines and
   total against the original.
3. Repeat without the tariff edit (single 3-night segment) and with a 3-way split.

Each run is checked against the stored charge rows, not just the screen.

## Step 2 — Make a short split impossible

- **Completeness check in the split routine.** Reject any split whose new bills'
  lines do not cover every live line of the original, and whose totals do not
  add up to the original (within rounding). Today only the "must not exceed"
  side is checked.
- **Same check in the split screen before submitting**, with a clear message
  naming the missing line(s), so staff see the problem before the bill is cut.
- **Missing-night warning on the bill.** When a stay's live bills do not carry
  every night between check-in and check-out, show a visible warning on the bill
  with a one-click "restore missing nights" action, instead of quietly printing
  a short bill.

## Step 3 — Scan existing bills

One-off scan of this property for splits where the children's total is less than
the voided parent, and for stays whose billed nights are fewer than the nights
stayed. Results reported to you before anything is changed.

## Technical notes

- Booking `e75e071b…`; parent folio `287a3d7a…` (void, 13428) → children
  `0aad0da8…` (room, created at 8767, now 12278.25 + GST = 12892) and
  `146edb89…` (food, 536).
- `public.split_folio_bill` step 2 only raises when
  `SUM(children.total_amount) > parent.total_amount + 1`. Add the symmetric
  shortfall check plus a per-source coverage assertion over the parent's live
  `folio_charges` (grouping night rows by `source_table`/`source_id` and summing
  `amount`), so a dropped night aborts the transaction.
- `SplitBillDialog` builds assignable units via `expandRoomNights` (units memo,
  ~line 231) and ships `billCharges` per child (~line 695) — add the client-side
  sum/coverage guard there against the incoming `charges` prop.
- The date-change path (`modifyDatesOp` → `seed_room_charge_for_booking_room`)
  re-posted the night onto the child folio by `source_id`, which is why the bill
  self-healed; that behaviour stays as is.

## Verification

- Test split of a 3-night stay: children's lines and totals equal the original,
  every night present on exactly one bill.
- Attempting a split with a line removed: blocked with a clear message.
- BK-20260917-0001: bill stays at ₹12,892 with 3 night lines, Duration 3 Nights.
