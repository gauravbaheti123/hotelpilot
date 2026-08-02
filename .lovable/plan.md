## What I found (read-only checks)

Verified against the live database and `src/components/PunchChargeDialog.tsx`.

**Working today**
- Cron job `auto-close-segment-bills-daily` is active at `29 18 * * *` UTC = 23:59 IST and has succeeded every night (last run 2026-08-01 18:29 UTC, no errors).
- Its selection filter (`status='open'`, segment in food/laundry, `is_walkin=false`, `booking_id IS NOT NULL`) does match bills produced by the new Print-KOT flow — current live examples `BRIJ-F-0011`, `-0012`, `-0013` are open, non-walk-in, booking-linked, with 1-2 items and zero folio charges, so they would be picked up.

**Gaps vs. the manual "Print Bill" path**

| # | Issue | Detail |
|---|---|---|
| 1 | Two sources of truth | Settlement is implemented twice — in SQL (`auto_close_segment_bills`) and in TSX (`printBill`). They already differ, which is exactly how they will drift further. |
| 2 | Partial-post blind spot | SQL only posts when `COUNT(folio_charges)=0`. A bill that was partly posted (e.g. Print Bill posted, then more KOT items were appended) is closed with the newer items **never** reaching the folio. `printBill` avoids this by delete-then-reinsert. |
| 3 | Stale totals | SQL never recalculates `total_amount`/`gst_amount` from `segment_bill_items` before closing; `printBill` does. The activity log then records a stale amount. |
| 4 | No day scoping | The job closes *every* open bill regardless of date. Harmless at 23:59, but a manual `SELECT auto_close_segment_bills();` mid-day silently settles in-progress KOT bills — which is exactly what 23.2's test would do. |

Item 2 is a real money bug: line items can be silently dropped from the guest's folio.

## Plan

**1. Single source of truth (DB function)**

Create `public.settle_segment_bill(_bill_id uuid, _actor uuid default null, _auto boolean default false)`:
- recalculate `total_amount` / `gst_amount` from `segment_bill_items`
- resolve folio via `COALESCE(folio_id, get_or_create_folio(booking_id))`
- **delete + reinsert** all `folio_charges` for `source_table='segment_bills', source_id=_bill_id` (idempotent, matches `printBill`, fixes the partial-post gap)
- set `status='settled'`, `settled_at=now()`, `folio_id`
- append the auto-close note and write the `SEGMENT_BILL_AUTO_CLOSED` / `SEGMENT_BILL_SETTLED` activity log entry
- no-op safely if the bill is already settled or has zero items

**2. Rewrite `auto_close_segment_bills()`** to be a thin loop that calls `settle_segment_bill(id, null, true)`, wrapped per-bill in an exception block so one bad bill can't abort the whole nightly run (currently a single failure aborts everything). Add optional IST-day scoping so mid-day manual invocation only touches bills from the current IST day.

**3. Point `printBill` at the same function** — replace the client-side delete/insert/settle block in `PunchChargeDialog.tsx` with an RPC call to `settle_segment_bill`, keeping the existing print + toast + totals-fetch behaviour unchanged. No UI change.

**4. Test (23.2)** using the live open bills plus fresh punches:
- punch 3 Print-KOT items on one room/segment → confirm one bill number, 3 items, **0** folio charges
- run `SELECT public.auto_close_segment_bills();` → confirm `settled_at` set, exactly 3 folio charges (no dupes, none missing), totals match the item sum, activity log row written
- re-run the job → confirm it is a no-op (no duplicate charges)
- re-run the partial-post case: settle, append another KOT item, settle again → confirm the folio ends with all items exactly once
- confirm the dashboard/checkout pending indicator clears for that room

## Technical notes
- Requires two migrations-worth of SQL in one migration: new `settle_segment_bill`, replaced `auto_close_segment_bills`. `SECURITY DEFINER`, `search_path=public`, `EXECUTE` granted to `authenticated` (Print Bill calls it as the signed-in user) and `service_role`.
- The client keeps doing the printing; only the write path moves into SQL.
- Cron schedule and job name stay as they are — they are already correct.
