# Room 309 — same missing-nights problem, and it happened after the fix

## What the records show (BK-20260920-0002, Room 309, 20 → 23 Sept @ ₹3,200)

- Original bill (now voided) carried, all lines live:
  - Room 309 · Deluxe · **3 night(s)** = ₹9,600
  - Late-checkout room charge = ₹3,200
  - Restaurant/food lines = ₹2,858
  - Total charges ₹15,658 → ₹16,300 with GST
- At 22 Sept 22:45 IST it was split into two bills:
  - Bill A: **Room 309 · Deluxe, 1 line of ₹3,200** → ₹3,360
  - Bill B: late checkout ₹3,200 + restaurant/food ₹2,858 → ₹6,220
- Two bills together = ₹9,258 of charges against ₹15,658. **₹6,400 (2 nights) was dropped**, exactly the same failure as Room 301.

## The important difference

The conservation guard was installed in the database at **22:15 IST** — half an hour *before* this split. The split still went through short. So the guard was not reached on the path actually used. This is not yet proven; naming the bypass is the first step, not an assumption.

Candidates to test, in order:
1. The split was run from the published site, whose screen may still use an older save path that writes the new bills directly instead of calling the guarded routine.
2. The split screen received a partial charge list from the screen that opened it, and the payload it sent matched what the guard compares, while fewer lines were written.
3. The guard's comparison key lets a line pass when the night rows are regrouped (e.g. per-night rows folded into one row with a different date).

## Step 1 — Find the bypass (no changes yet)

- Attempt the identical short split in preview on a multi-night bill and confirm whether it is refused.
- Compare with the published site's behaviour for the same action.
- Report which of the three candidates is the real one before touching anything.

## Step 2 — Close it for good

Once the bypass is known:
- If it is an old save path: make the new-bill creation itself impossible outside the guarded routine, so no browser tab or older published build can write bills directly.
- If it is a payload/comparison gap: tighten the check so nights are matched by room and date, not only by grouped totals, and reject with the missing night named.
- Either way the rule stays: a split that does not carry every live line is refused and nothing is changed.

## Step 3 — Repair Room 309

Restore the 2 missing nights (₹6,400 + 5% GST = ₹6,720) onto Bill A, so it reads 3 nights / ₹9,600 for the room. To be done only after you confirm the guest's billed stay is 20 → 23 Sept (activity log shows several checkout-date changes to 22 Sept in the same minute, so the intended departure needs your word).

## Step 4 — Sweep

Re-run the scan of past splits where the new bills total less than the voided original, now including anything split after 22:15 IST today, and list them for your decision.

## Technical notes

- Parent folio `5909fb32…` (void, is_deleted, charges ₹15,658 / total ₹16,300) → children `781a91ef…` (₹3,360, room qty 1) and `3ecf5370…` (₹6,220).
- Parent room line `booking_rooms:b5018dcb…` qty 3 / ₹9,600 was live and unwiped at split time; the child's room line has qty 1 and a description without a night count.
- `assert_split_conserves` is called unconditionally from `public.split_folio_bill`, and `split_folio_bill_v2` runs its own check only for `coverage='full'`; both were in place (migration id 11 applied 16:45 UTC) before the 17:15 UTC split, which is why the bypass must be located before any further hardening.
- Share/percent splits are exempt from the per-line rule; this split's child lines are `room`/`extra`/`food`, so that exemption does not explain it.
- Repair of Bill A is a data correction through the owner-edit path with an activity-log entry, not a migration.

## Verification

- A short split is refused in both preview and the published site.
- BK-20260920-0002 Bill A shows Room 309 · 3 nights · ₹9,600 with correct GST.
