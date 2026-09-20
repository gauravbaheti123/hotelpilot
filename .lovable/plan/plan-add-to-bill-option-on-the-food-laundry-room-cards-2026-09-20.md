# Plan: "Add to Bill" option on the Food/Laundry room cards

## Problem

Dashboard ke Food/Laundry tab me room card ka menu (View KOT / New KOT / View Invoice) me "Add to Bill" nahi hai. Pending food bill ko room bill me daalne ke liye abhi "Pending Food Orders" overview table tak jaana padta hai. Room card par pending amount dikh bhi raha hai, lekin wahi se action nahi ho sakta.

## Current state (verified)

- `dashboard.tsx:614` — `addPendingFoodToBill(bookingId)` already exists: `get_or_create_folio` → saare open food `segment_bills` → `post_segment_bill_to_folio` (locked, idempotent — repeat taps duplicate charge nahi banate).
- `dashboard.tsx:1464` — `SegmentRoomCard` ka menu sirf View KOT / New KOT / View Invoice deta hai.
- Card ke paas `occ.bookingId` (OccInfo, line 128) aur `pending.amount/count` dono maujood hain — koi naya data fetch nahi chahiye.
- `post_segment_bill_to_folio` segment-agnostic hai — laundry bills ke liye bhi kaam karta hai.

## Changes (ek hi file: `src/routes/_authenticated/dashboard.tsx`)

1. **`addPendingFoodToBill` ko generalize karo** → `addPendingSegmentToBill(bookingId, segment: "food" | "laundry")` — segment filter parameter se; toast message "food bill(s)" / "laundry bill(s)" ke hisaab se. Overview table ka existing call food pass karega (behaviour same).
2. **`SegmentRoomCard` me naya menu item** — "Add to Room Bill" (pending ho to ₹ amount ke saath, e.g. `Add to Room Bill · ₹229.51`):
   - Sirf tab dikhe jab `pending.amount > 0` — koi pending bill nahi to item hide (ya disabled) rahe.
   - Click par parent callback `onAddToBill()` → `addPendingSegmentToBill(occ.bookingId, segment)` → success toast + dashboard reload (card ka ₹ turant update).
3. **Menu order**: View KOT / New KOT / **Add to Room Bill** / View Invoice — bill action, invoice dekhne se pehle.
4. Laundry tab par bhi wahi option ("Add to Room Bill") — wahi RPC, sirf segment filter alag.

## No changes to

- Koi DB/RPC change nahi — existing `post_segment_bill_to_folio` (idempotent, lock-safe) reuse.
- Koi UI redesign nahi — sirf ek menu item add.
- Overview "Pending Food Orders" table ka Add to Bill button waise ka waisa rahega.

## Verification

- Build log clean (`/tmp/observability/build-errors.log`).
- Preview: Food tab → room 203 (₹229.51 pending) → menu → "Add to Room Bill" → toast + card ₹0/hara; folio par food charges dikhein; dobara click par duplicate charge na bane.
