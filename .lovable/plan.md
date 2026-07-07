# GST Report % distortion — findings

## Current formula (`src/routes/_authenticated/reports.gst.tsx`)
Per invoice row:
- `cgst = folio.gst_amount / 2`
- `cgstPct = cgst / folio.sub_total * 100` (same for SGST)

This is a blended average across the entire bill.

## Taxable column
`folio.sub_total` from `recomputeFolio` (`src/lib/billing.ts`) = sum of net amounts of every non-tax / non-discount charge, **including 0%-GST lines**. Bill- and line-level discounts also scale GST proportionally, so the stored `gst_amount` no longer equals `sub_total × slab`.

## BILL007 (shown as 4.93%)
Folio: sub_total ₹3,085.00 · gst ₹304.20 · total ₹3,081

| description | type | amount | rate | gst | line disc |
|---|---|---:|---:|---:|---:|
| Room 106 · Deluxe · 1 night | room | 3500.00 | 12% | 420.00 | 875.00 |
| Food · KOT-20260707-0001 | food | 460.00 | 5% | 23.00 | 0.00 |

Two different slabs (12% + 5%) on one bill + discount-driven GST scaling → blended 9.86% → 4.93% each half.

## BILL005 (shown as 0.24%)
Folio: sub_total ₹4,029.50 · gst ₹19.20 · total ₹221

| description | type | amount | rate | gst | line disc |
|---|---|---:|---:|---:|---:|
| Room 310 · Deluxe · 1 night | room | 3200.00 | 12% | 384.00 | 0.00 |
| Food — KOT-20260704-0002 | food | 829.50 | 0% | 0.00 | 0.00 |

Two problems compounding: (a) 0% food line is included in the taxable denominator; (b) a bill-level discount collapsed the ₹384 room GST down to ₹19.20 in the folio. Back-computed % → 0.24%.

## Diagnosis
Not a math bug — it's a data-model mismatch. A single row per invoice cannot represent a multi-slab bill, and zero-rate lines pollute the denominator. Both BILL007 and BILL005 are genuinely mixed / discounted, not corrupted data.

## Recommended fix (for approval, not yet applied)
Change the GST Report row model from **one row per invoice** to **one row per (invoice, gst_rate)** — the standard GSTR-1 shape:

- Fetch `folio_charges` joined to folios for the month, filter `gst_mode='gst'` and non-void.
- Group by `(invoice_number, gst_rate)` where `gst_rate > 0` (exempt lines get their own "0%" bucket, shown separately or excluded from CGST%/SGST% math).
- Per group: `Taxable = Σ (amount − line_discount)` scaled for bill-discount factor; `Total GST = Σ gst_amount` scaled the same way; `CGST% = SGST% = gst_rate / 2`; `CGST amt = SGST amt = GST/2`.
- Invoice Total column: shown only on the first slab row of each invoice (or use a sub-total row per invoice).
- Totals footer: sum taxable / CGST / SGST across all slab rows.
- Tally XML export: emit one voucher per invoice with slab-wise ledger lines (matches Tally's Sales voucher GST breakup).

No DB changes required — everything derives from existing `folio_charges` + `folios`. Scope is limited to `reports.gst.tsx` and the Tally builder in `src/lib/reportExports.ts`.

Confirm and I'll implement.
