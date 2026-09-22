# Split ke baad room tariff gayab — cause and fix

## What the records show (BK-20260920-0003, Room 301)

- Stay is 20 → 24 Sept at ₹2,800 = **4 nights**, and the room row still says so.
- The original bill (now voided) carried one room line: **"Room 301 · Super Deluxe · 4 night(s)" = ₹11,200**, plus restaurant/food lines. Its charges added up to ₹15,773 (₹16,348 with GST).
- At 22 Sept 22:05 it was split into two bills:
  - Bill A: **one room line of ₹2,800 (1 night)** → ₹2,940 — this is your screenshot.
  - Bill B: all the restaurant/food lines → ₹4,588.
- Two bills together = ₹7,373 against an original of ₹15,773. **₹8,400 (3 nights) simply vanished** at the split.

So the tariff wasn't "hidden" on the print — three nights were never written onto the new bills, and the old bill was voided.

## Why the safety check didn't stop it

A guard already exists that rejects any split whose new bills don't add up to the original. It only runs when the split screen asks for it (`coverage: "full"`), so a split started from an **older published build of the site** goes straight to the unguarded routine. `hotelpilot.in` in your screenshot is the published app, which is behind the preview. This is the most likely explanation and is confirmed in step 1 before anything else is changed.

## Step 1 — Confirm, then repair this bill

- Reproduce a 4-night split in preview and confirm the guard blocks a short split there; confirm the published build is the unguarded one.
- Restore the missing 3 nights (₹8,400 + 5% GST) onto Bill A of this booking, so it reads 4 nights / ₹11,200 and the guest is billed correctly. Done only after you confirm the guest is indeed staying till 24 Sept.

## Step 2 — Make the protection version-proof

Move the conservation check **inside the core split routine itself**, not just the wrapper:

- Every split must carry every live line of the original bill; per charge line (room / food / extra, matched to its source) the new bills must add up to the old one within ₹1.
- If anything is short, the split is rejected with a clear message naming the missing line, and nothing is changed.
- This way even an old browser tab or the older published build cannot cut a short bill.

## Step 3 — Publish and scan

- Publish so the guarded split screen (which also shows the shortfall before submitting) is live on hotelpilot.in.
- One-off scan of this property for past splits where the new bills total less than the voided original, and for stays whose billed nights are fewer than nights stayed. Results reported to you before any correction.

## Technical notes

- Parent folio `25dc272c…` (void, is_deleted) → children `3a88cd6b…` (room, 2,940) and `eb576f84…` (extras, 4,588). Parent room charge `37c0f1b3…` qty 4 / ₹11,200, source `booking_rooms:2a743312…`.
- Guard currently lives in `split_folio_bill_v2` behind `coverage='full'`; it will be folded into `public.split_folio_bill` as an unconditional per-source coverage + total equality check (migration). `split_folio_bill_v2` stays as-is for compatibility.
- `SplitBillDialog.tsx` already sends `coverage: "full"` for item-mode whole-bill splits and blocks client-side on a sum mismatch; share/percent splits (which create "Share of…" lines) are excluded from the per-line coverage rule and keep only the total check.
- Repair of Bill A is a data correction via the owner-edit path, with an activity-log entry, not a migration.

## Verification

- 4-night stay, item split → both bills together show all 4 nights; removing a night is refused with a clear message.
- BK-20260920-0003 Bill A shows Room 301 · 4 nights · ₹11,200 with correct GST and duration.
