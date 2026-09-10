# Payment modes showing ₹0 in reports

## What is wrong

Payments are saved with the payment-method name exactly as configured for the property — in your data these are `CASH`, `UPI`, `CARD`, `MAKE MY TRIP`, `NEFT`, `BILL ON HOLD`, `YATRA`, `CLEAR TRIP` (plus a few older lowercase `cash` rows).

Reports, however, compare against a hard-coded lowercase list (`cash`, `card`, `upi`, `bank`, `wallet`, `other`). Nothing matches, so:

- **Daily Report → Collections by mode**: every line shows ₹0.00 while "Total collected" is correct (₹47,037 in your screenshot).
- **Cash Collection Report**: the Cash / Card / UPI boxes and the Excel/PDF totals stay ₹0; travel-agent modes like MAKE MY TRIP fall into "Other" or vanish. Its Mode filter also offers only lowercase cash/card/upi/comp, which return no rows.
- Anywhere a fixed six-mode list is printed, real modes used by the hotel (MAKE MY TRIP, NEFT, Yatra, Clear Trip) never appear at all.

The Daily Morning / Day Close report already groups by the actual stored mode, so it is not affected.

## What I will change

1. **One shared way to read modes.** Match modes case-insensitively and after trimming, so `CASH`, `Cash` and `cash` are one line, and keep the property's own configured payment methods as the display order and labels.
2. **Daily Report — Collections by mode**: list every mode actually collected that day plus the property's configured methods (₹0 shown for unused ones), instead of the fixed six. "Bill On Hold" is listed separately and marked as not collected, matching existing behaviour elsewhere, so it never inflates cash.
3. **Cash Collection Report**: totals computed case-insensitively; summary boxes become Cash / Card / UPI / Other-modes-breakup driven by real data; the Mode filter is populated from the property's payment methods instead of the hard-coded four. Excel/PDF totals follow the same numbers.
4. **Sweep of the other reports** (Sales, Date-Wise Revenue, Day Close, Night Audit, Cash Handover, Banquet Billing) for the same fixed-mode assumption, and fix any found the same way. No layout or design changes.
5. **Verify** against the database: Daily Report for 09/01/2026 must show per-mode figures adding up exactly to ₹47,037, and Cash Collection totals for the same range must match a direct database sum.

## Technical notes

- `PAYMENT_MODE_LABELS` in `src/lib/reports.ts` becomes a fallback only; `fetchDailySummary` keys `by_mode` on a normalised mode and returns the display label alongside the raw key.
- Normalisation helper (trim + lowercase key, `formatPaymentMethodLabel` for display) reused by `reports.daily.tsx`, `reports.cash-collection.tsx` and any other affected report.
- Mode pickers read from `usePaymentMethods(propertyId)`; mode filtering on the query uses `ilike` so stored casing does not matter.
- Hold payments continue to use `isHoldPayment` so they are excluded from real collections.
- No schema changes, no data edits, no RBAC changes.
