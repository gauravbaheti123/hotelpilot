# Reports section — full audit and fix

I checked all 22 report pages plus the shared report data/export code. The build is clean, but there are real issues that make reports show wrong or incomplete numbers, look "stuck", or fail to export. Below is what I found and what I will fix.

## What is wrong today

1. **Reports silently drop data on long date ranges (most serious).**
   Each database read returns a maximum of 1000 rows, and most reports read charge/payment rows directly with no paging. This property already has 2,341 charge rows in the last 30 days, so a month-long Bill-Wise, Date-Wise Revenue, Sales, Daily Morning or Day Close report is quietly using only part of the data — room/food splits and totals come out lower than reality, with no warning on screen.

2. **No "loading" feedback on most reports.**
   GST, Sales, Room-Wise, Guest-Wise, Food/KOT, Date-Wise Revenue, Expenses, Cash Collection, Banquet and Room Shift show the old/empty table while fetching, so a slow report looks broken or empty.

3. **Reports can stay stuck on "Loading…".**
   Bill-Wise, Dues, Plan-Wise, Activity and Banquet Billing turn the loading flag off only on the success path. If a read fails, the page stays in loading state forever.

4. **PDF export can do nothing at all.**
   PDF export opens a new window and prints. If the browser blocks pop-ups (common on phones and on some desktop profiles), nothing happens and no message is shown — the user just thinks "export is not working".

5. **Bill-Wise shows only the first room of a multi-room bill.**
   Same problem already fixed on invoices/GRC: a booking with 301 and 302 shows only 301.

6. **Reports list offers a report some logins cannot open.**
   The Cash Handover card is shown to every role, but only Owner, Manager and Receptionist have handover access — Accounts, Executive, Housekeeping and Label Operator land on "access denied".

7. **Export buttons can export an empty file.**
   Exports use the table's filtered rows; if that list has not been populated yet, Excel/PDF can come out blank even though data is on screen.

## What I will do

**A. Correct data (no more silent truncation)**
- Route every report read through the existing paged fetch helper so all rows are loaded, and split long id lists into safe batches.
- Applies to: Bill-Wise, Date-Wise Revenue, Sales, Cash Collection, Dues, Room-Wise, Guest-Wise, Food/KOT, Expenses, Room Shift, Banquet, Banquet Billing, Daily, Daily Morning, Day Close, GST, Analytics, Activity, KOT Activity.
- Spot-check a month of Bill-Wise and Date-Wise Revenue totals against the database after the change.

**B. Reliable loading and error states**
- Every report gets a loading indicator and an empty-vs-loading distinction in the table.
- Every load wraps in try/finally so a failure clears the loading state and shows a clear error toast instead of hanging.
- Every report shows the "select a property" message when no property is chosen.

**C. Exports that always work**
- PDF: if the print window is blocked, fall back to printing from a hidden frame in the same tab, and show a clear message if that also fails.
- Excel: show a short "preparing…" state and an error toast on failure.
- Exports always use the currently visible (filtered) rows, falling back to the full loaded rows when no filter is applied — never an empty file.

**D. Correctness details**
- Bill-Wise shows all room numbers of a booking, comma-separated and de-duplicated (matching invoice/GRC behaviour).
- Reports list hides report cards the logged-in role cannot open (Cash Handover for roles without handover access), so no login hits "access denied" from the reports menu. Existing role permissions are not widened.

**E. Verification pass**
- Load each of the 22 reports for a month range, confirm data appears, both exports run, and totals match a direct database check for Bill-Wise, Date-Wise Revenue, GST and Dues.

## Technical notes

- Paging via `fetchAllRows` (src/lib/fetchAll.ts) with query factories; `.in()` id lists chunked at ~200 ids to stay under URL limits.
- Loading/error standardised in each report's `load` callback (`try/finally` + `reportQueryError`).
- `exportPdf` and `exportSectionsPdf` in `src/lib/reportExports.ts` get a hidden-iframe print fallback when `window.open` returns null.
- Bill-Wise room label built from all `booking_rooms.rooms.room_number` values.
- Reports index filters `ITEMS` by permission using the existing permissions hook.
- Design, layout and report contents stay unchanged; no schema changes and no RBAC changes.
