# Invoice 2081 — why it is missing, and how to stop future gaps

## What actually happened (confirmed from the records)

Booking BK-20260915-0002 (Ajay Paul Singh Rana, Room 401) had its bill **split into two portions**. At 09:00 IST on 17 Sep both portions were checked out together, so two invoice numbers were issued back to back:

- portion A → **2081**
- portion B → **2082**

Ninety seconds later the checkout was undone (audit entry: "Undo checkout · released 2081"). The undo cleared **2081** from portion A and tried to step the counter back — but the counter had already moved on to 2082 (the second portion). The existing rule is "only step back if this was the very last number issued", so it correctly refused, and 2081 was left freed but unused.

On the re-checkout, portion B kept 2082 and portion A was given the next fresh number, **2083**. Numbering only ever counts forward, so the freed 2081 is never picked up again.

Net effect: no money is affected, no duplicate numbers — only a permanent hole at 2081. This is the only gap in the current lodge series (2075–2093 are otherwise continuous).

## Fix

**1. Remember freed numbers instead of losing them**
When an undo checkout releases an invoice number, record it in a small "free numbers" list for that property and series (instead of only trying the step-back).

**2. Issue freed numbers first**
Before taking the next counter number, the numbering routine takes the lowest recorded free number for that property/series, if any, and verifies it is genuinely unused. This closes the gap in the natural order and can never create a duplicate.

**3. Handle split bills properly on undo**
An undo currently touches only one bill of a split booking. Change it to release the numbers of every live bill of that booking's checkout, so a split undo does not half-release and leave the other portion numbered.

**4. Put 2081 back in circulation**
Add 2081 to the free list so the next lodge checkout issues it, leaving the series continuous.

## Out of scope
- Settled bills, amounts, GST, payments: unchanged.
- Food/laundry/banquet numbering keeps its current behaviour, except it uses the same free-number list when a number is released.
- No UI or layout changes.

## Technical notes
- New table `public.bill_number_pool (property_id, sequence_type, number, released_from_folio_id, created_at, consumed_at)` with GRANTs + RLS (service/definer access only; no client writes).
- `public.undo_checkout`: keep the current step-back path; when step-back is not possible, insert the released number into the pool. Loop over all non-void, non-deleted folios of the booking rather than the single latest one.
- `public.generate_bill_number`: before `last_number + 1`, claim the lowest unconsumed pool row for `(property_id, sequence_type)` under the existing `FOR UPDATE` lock and run it through the same existing-number guard loop; on collision mark consumed and fall through.
- Data: insert a pool row for `2081`, `sequence_type = 'lodge'`, property `Brij`.
- Verify: check out a booking and confirm it receives 2081; confirm no duplicate invoice numbers exist afterwards.
