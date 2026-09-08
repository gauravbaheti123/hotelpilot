# Platform health check — what I found, and what I suggest fixing

I checked the live data (bills, payments, rooms, guests), the crash log, the database security report, and the whole codebase. Good news first: **no duplicate bill numbers, no stuck bills, no room-status mismatch, and the duplicate food-charge problem is gone** — today's food bills post exactly one line per item.

Below is everything that still looks wrong, worst first.

## Confirmed problems

1. **Banquet "New event" screen crashes.** 13 crashes in the last days, the latest today, all on the new-banquet screen (an endless refresh loop inside the form). Two more crashes on the dashboard the same night.
2. **Two food/laundry bills can open for the same room or table.** If two staff punch at the same moment, or someone double-taps, the app can create two open bills and split the guest's items between them. The database has no guard against this.
3. **Bill totals are calculated in two places.** The database already recalculates a bill correctly (discounts, round-off, complimentary food, day-lock). The checkout and split-bill screens recalculate it again in the app and overwrite the database answer — so round-off can be lost and a day-locked (night-audited) bill can still be changed.
4. **Checkout is not one safe step.** Payment, booking status, room release and checkout time are saved one after another. If the internet drops midway, the guest is paid but still shows in-house and the room stays occupied.
5. **Lists and reports silently cut off.** Activity report stops at 1,000 rows, KOT report at 2,000, invoices at 300, staff dropdowns at 500, booking lists at 200 — with no "showing part of the results" message.
6. **Payment mode names are inconsistent in the data:** `cash` and `CASH`, `Bill on Hold` / `Bill On Hold` / `BILL ON HOLD`, `MMT` and `MAKE MY TRIP`. Cash-collection and revenue reports split the same mode into several rows.
7. **115 stays have no Guest Registration Card record**, so GRC printing for those is empty.
8. **28 duplicate guest records** share the same mobile number (repeat guests created again instead of matched).
9. **4 rooms are marked vacant but still "dirty"** — housekeeping board and sellable-room count can disagree.
10. **Errors hidden from staff:** banquet charge-seeding, extra-bed tariff lookup and the plan-wise report ignore failures silently — a failure looks the same as "nothing to show" (extra bed can end up at ₹0).
11. **Database security warnings:** 158 internal functions are callable by anyone signed in (and 60 even without signing in), 3 functions have no fixed search path, 1 extension sits in the public schema.
12. **Small cosmetic gaps:** a few screens still show time in the phone's default (12-hour) format instead of 24-hour (room detail, communications, guest profile, restaurant), and a handful of badges use fixed colours instead of the theme.

## Not problems (checked and cleared)

- No duplicate or double-issued invoice numbers in any series.
- Bills that show "Bill on Hold" with ₹0 paid are correct — that is the intended behaviour.
- Aadhaar numbers are stored clean; the remaining spaced IDs are driving licences (correct format).
- No orphan child bills after splits, no negative charges, no old unsettled food bills.

## Suggested fix order

**Stage 1 — money and crashes**
- Fix the banquet new-event crash loop and the dashboard crash.
- Add a database guard (unique open bill per room/table per day) and move "find-or-create today's bill" into a single database call.
- Remove the app-side bill-total recalculation; let the database be the only source, so round-off and day-lock always hold.
- Make checkout one single database call (payment + booking + rooms + times together).

**Stage 2 — data hygiene**
- Normalise payment mode names to one master list and clean existing rows.
- Create the missing GRC records for past stays (or generate them on demand).
- Merge duplicate guests by mobile number.
- Re-sync the 4 vacant-but-dirty rooms and prevent the mismatch.

**Stage 3 — reporting and polish**
- Paginate the capped reports/lists, or show a clear "results limited" notice.
- Surface the currently-hidden errors as toasts.
- Route the remaining timestamps through the 24-hour helper and swap fixed-colour badges for theme colours.

**Stage 4 — security tightening**
- Revoke public/signed-in execute rights on internal database functions that should not be called directly, fix the 3 functions missing a search path, move the public-schema extension.

## Technical notes

- Crash source: React error #185 on `/banquet/new` (state update loop), plus `insertBefore` null on `/dashboard`.
- `segment_bills` has no partial unique index on open bills (verified against live indexes); `PunchChargeDialog.getOrCreateTodayBill()` is a check-then-insert.
- `src/lib/billing.ts recomputeFolio` duplicates SQL `recompute_folio_totals`; direct `folios.update()` in `CheckoutDialog.tsx` and `SplitBillDialog.tsx` bypasses the trigger's day-lock and round-off.
- Caps: `reports.activity`, `reports.kot-activity`, `reports.food-kot`, `InvoiceListPanel`, `front-desk.bookings`, `expenses.index`, profile dropdowns in cash-collection/expenses.
- Silent catches: `banquet.event.$id.tsx`, `AddChargesDialog.tsx`, `reports.plan-wise.tsx`.
- Linter: 98 authenticated-executable + 60 anon-executable SECURITY DEFINER functions, 3 mutable search_path, 1 extension in public.

Tell me which stage to start with (or "all"), and I will implement it.
