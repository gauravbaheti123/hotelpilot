## Goal
Add per-column sort + filter to all Reports tables, with filtered/sorted data flowing into Excel/PDF exports. Reusable component shared across the 10 report routes.

## Approach

### 1. New reusable component: `src/components/ReportDataTable.tsx`
Generic table with:
- **Column config**: `{ key, header, accessor(row), type: 'text'|'number'|'date'|'enum', sortable?, filterable?, enumOptions?, currency?, render?(row), exportValue?(row) }`
- **Sort**: click header cycles asc → desc → none. Chevron icon + highlight active direction.
- **Filter**: popover on header (Filter icon). Type-driven UI:
  - text → contains input
  - number → min/max
  - date → from/to date inputs
  - enum → checkbox list (with All/None)
- **Active filter chips** above the table, each removable + "Clear all".
- **AND logic** across columns.
- **Uncontrolled internal state** but exposes `onDerivedRowsChange(rows)` so parent can export filtered+sorted data.
- Perf: `useMemo` for filter + sort; keep < ~5k rows in RAM without virtualization (adequate for reports).

### 2. Wire into `ReportShell`
Add an optional `getExportRows: () => T[]` prop path — simpler: parent tracks `derivedRows` via state from `ReportDataTable`'s callback and passes those to `exportExcel` / `exportPdf` / Tally builder.

### 3. Migrate report routes (10 total)
Replace hand-rolled `<table>` markup in each with `<ReportDataTable columns={...} rows={...} onDerivedRowsChange={setDerived} />` and export from `derived`:
1. `reports.gst.tsx` (keep slab grouping semantics — treat each display row as independent for filter/sort; `is_first_of_invoice` display flag disabled once sorted — accept that limitation, header cells become populated on every visible row)
2. `reports.mis.tsx`
3. `reports.sales.tsx`
4. `reports.night-audit.tsx`
5. `reports.kot-activity.tsx`
6. `reports.food-kot.tsx`
7. `reports.daily.tsx`
8. `reports.cash-collection.tsx`
9. `reports.date-wise-revenue.tsx`
10. `reports.room-wise.tsx`
11. `reports.guest-wise.tsx`
12. `reports.bill-wise.tsx`
13. `reports.expenses.tsx`
14. `reports.banquet.tsx`
15. `reports.room-shift.tsx`
16. `reports.activity.tsx`
17. `reports.analytics.tsx` (skip — chart-based, no tabular)

Actual tabular routes get the treatment; chart/analytics pages left alone.

### 4. GST report caveat
GST report currently renders a "grouped" view where the invoice number / guest / bill total appears only on the first slab row. After sort, grouping breaks. Solution: always render those fields on every row when a sort/filter is active; keep existing "first only" look only when unsorted+unfiltered. Totals footer keeps summing all visible rows.

### 5. Exports
`exportExcel` / `exportPdf` / Tally XML builders receive the `derived` array (post filter+sort). No changes to `reportExports.ts` needed.

### 6. UI stays the same visually
- Same table density, colors, muted header row, emerald totals footer.
- Add small icons in headers only (chevron + funnel). Chips row appears only when filters active.

## Technical notes
- Filter/sort state kept as `Record<columnKey, FilterValue>` + `{ key, dir }` inside component.
- Enum options auto-derived from the row set unless caller provides `enumOptions`.
- Numbers: `accessor` returns number; filter compares numerically.
- Dates: caller marks `type: 'date'` and returns ISO string / Date; component parses.
- Export values use `column.exportValue ?? column.accessor` so currency stays numeric in Excel.

## Out of scope
- Virtualization (not needed at current data sizes).
- Server-side filtering (all reports already fetch bounded windows).
- Column resize / reorder / pinning.

## Verification
- Typecheck.
- Manual: on GST + MIS + Sales, test text/number/date/enum filters, multi-column AND, chip removal, clear-all, and confirm Excel/PDF exports reflect filtered rows.
