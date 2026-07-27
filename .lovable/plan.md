## Phase 0 — Foundation Plan

Before writing migrations, flagging what I found so we don't rebuild things that already exist. All 4 sub-items are still doable, but 0.1 and 0.3 are mostly complete already.

### Findings on current state

- **0.1 Payment Modes master**: `payment_methods` table already exists per-property (id, name, is_default, is_active, display_order) with seed trigger (`seed_payment_methods_for_property`) that inserts Cash/Card/UPI on property create, plus `usePaymentMethods(propertyId)` hook and Master Data CRUD page (`masters.payment-methods.tsx`). What's missing is that ~10 files (`billing.ts`, `expenses.*`, `banquet.*`, `restaurant.index.tsx`, `reports.bill-wise.tsx`, `reports.expenses.tsx`) still reference the hardcoded `PAYMENT_MODES` union. Payments themselves already store `payment_method` as free text, so no schema change is needed — just wire the dropdowns/filters to `usePaymentMethods`.
- **0.2 Segmented bill numbering**: `bill_sequences` table already exists but its CHECK constraint only allows `sequence_type IN ('regular','event')` and `properties.short_code` already exists (`BRIJ`). Need to widen the enum, add lodge/food/laundry/banquet types, and add a new `generate_bill_number(property_id, segment)` SECURITY DEFINER function that formats `{short_code}-{segment_code}-NNNN`. Existing per-domain assigners (`tg_assign_invoice_number`, `tg_assign_food_bill_number`, `tg_assign_banquet_number`) will be pointed at the new function so numbering becomes consistent across segments.
- **0.3 Auto-settle on checkout**: Already implemented — `tg_folios_balance_before_write` flips status to `settled` when `balance_amount <= 0.01` and `paid_amount > 0`, and `tg_payments_sync`/`tg_folio_charges_sync` recompute on every payment/charge change. I ran the diagnostic query for Brij Motel and **zero folios** are `open` with `paid_amount >= total_amount`, so there's nothing to backfill for this property. I'll still add a defensive one-time backfill migration (property-scoped, logged) for safety, and a smoke check that runs across all properties.
- **0.4 Owner bypass + generic audit**: `has_permission()` already bypasses for superadmin + owner. The gap is that non-permission-based locks (settled-bill-lock, day-lock via `is_day_locked`, folio `is_reopened` gating) don't have an Owner override. And `activity_log` exists but callers write to it inconsistently. Rather than build a generic diff-audit across every table (huge blast radius, would take multiple turns), I'll add a small `log_owner_override(table, record_id, action, old, new, reason)` helper + audit rows for the specific unlock actions Owners will now use (edit settled folio, edit locked payment mode, edit charge on locked day). Payment-mode changes already log old→new via `PAYMENT_MODE_CHANGED`.

### Proposed migration (single file)

```text
1. Widen bill_sequences.sequence_type CHECK → add 'lodge','food','laundry','banquet'
2. Seed sequence rows for existing properties for the 4 new segments
3. Create public.generate_bill_number(_property_id uuid, _segment text) -> text
   - SECURITY DEFINER, SELECT ... FOR UPDATE row-lock, atomic increment
   - Prefix = {properties.short_code}-{segment_code}-NNNN
   - segment_code map: lodge→LDG, food→F, laundry→L, banquet→B
4. Update tg_assign_food_bill_number, tg_assign_banquet_number,
   tg_assign_invoice_number → call generate_bill_number for the right segment
   (keep the legacy prefix as fallback when short_code is null so historical
   numbering doesn't renumber)
5. Backfill: UPDATE folios SET status='settled', settled_at=COALESCE(settled_at,now())
   WHERE status='open' AND balance_amount<=0.01 AND paid_amount>0
   AND is_deleted=false — insert one activity_log row per fixed folio
6. Add owner-override helper + widen can_billing / edit gates via new
   is_owner_or_super() checks in DB functions that currently hard-lock
   (void_folio_safe already gates; extend to settled-folio edit path)
```

### Code changes

- Refactor these files to use `usePaymentMethods(propertyId)` and drop hardcoded arrays:
  `src/lib/billing.ts` (kept as fallback constant only), `expenses.new.tsx`, `expenses.index.tsx`, `reports.bill-wise.tsx`, `reports.expenses.tsx`, `banquet.bill.$id.tsx`, `banquet.event.$id.tsx`, `restaurant.index.tsx`.
- `CheckoutDialog`: add Owner-only "Edit after settlement" affordance that calls the new override helper (logs to activity_log).

### What I'll NOT do in this phase (flagging so we're aligned)

- Generic diff-audit table covering every column of every table — too large; the existing `activity_log` + targeted override logging covers Owner edits.
- Renumbering historical invoices to the new BRIJ-LDG- format. New numbering applies from migration forward only.
- Touching Night Audit / day-lock logic beyond adding Owner override for editing folios inside locked days.

Confirm and I'll ship the migration + code refactor. If you want the full generic diff-audit across all tables, say so and I'll scope it as its own phase.