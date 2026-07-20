
## What I found (verified against the live DB)

I checked the actual data before planning. The "100% auto-discount" is almost certainly **not** a discount at all — no discount is being applied anywhere. What staff are seeing is **stale folio totals** being rendered next to fresh charges.

Evidence from the current database:

- `folios.discount_value` default = **0**, `folios.discount_amount` default = **0**, `discount_type` default = **NULL**. No 100% default anywhere.
- **Zero rows** in `folio_charges` with `charge_type='discount'` and **zero rows** with a negative `amount`. There is no discount row being auto-inserted.
- On recent bookings, some folios have this exact pattern:
  - Folio `fc8d928a…` — actual charges in `folio_charges` sum to ₹4,040 (room ₹3,500 + food ₹540), but the folio row itself has `sub_total = 0`, `total_amount = 0`, `paid_amount = 567`. Totals were never rewritten.
  - Folio `a7f39f5e…` — booking has a room + rate, but `folio_charges` is empty. Auto-seed never ran for this booking.
- There is **no database trigger** on `folio_charges` that recomputes the parent folio when a charge is inserted / updated / deleted. The `recompute_folio_totals` function exists but is only called from the `payments` trigger and from a couple of client paths.

So the two user-visible symptoms are the same underlying bug:

1. **"Checkout shows ₹0 charges"** — either `folio_charges` is genuinely empty (auto-seed skipped or silently failed), or charges exist but the stored folio totals were never refreshed.
2. **"Invoice shows a discount = full bill, Balance ₹0"** — the on-screen invoice reads `folio.sub_total` / `folio.total_amount` / `folio.balance_amount` straight from the stale folio row (all 0). Anywhere the code path happens to call `recomputeFolio` (e.g. the "Save & Print", the GST-slab auto-fix branch, or opening the bill-discount dialog), totals snap back to the correct values — which is why "removing the discount" appears to fix it.

The "discount" line in the invoice template only renders when `folio.discount_amount > 0` (verified in `src/lib/invoiceTemplates.ts` and `billing.folio.$bookingId.tsx`), and no row in the DB has that. Staff are misreading `Sub-total ₹0 → Grand Total ₹0` as "a discount was applied".

## Plan

### 1. Confirm root cause (first, before shipping the fix)

Add one browser-side reproduction on the affected booking (`115a3e85…` / `a4bf4a13…`):

- Open Checkout Summary → confirm charges list is empty / stale-total ₹0.
- Open the Bill/Invoice page → confirm Sub-total ₹0, Grand Total ₹0, but `folio_charges` in DB has real rows.
- Confirm there is **no** `folio_charges` row with `charge_type='discount'` for that folio.

If that matches, we ship the fix below. If a real discount row *is* present, we branch to hunt the writer instead.

### 2. Database fix — keep folio totals in sync automatically

New migration:

- Add an `AFTER INSERT / UPDATE / DELETE` trigger on `public.folio_charges` that calls the existing `recompute_folio_totals(folio_id)` and then `sync_booking_balance(booking_id)`. Idempotent, safe on backfills.
- One-shot backfill in the same migration: for every folio, call `recompute_folio_totals` so the stored `sub_total / gst_amount / total_amount / balance_amount / status` match the current charges. This corrects historical bookings without touching payment history.

Not touching column defaults — they are already correct (0 / NULL). Not adding any new discount logic.

### 3. Client fix — harden CheckoutDialog auto-seed

In `src/components/CheckoutDialog.tsx`:

- Only set `didSeedRoomCharges.current = true` **after** the insert succeeds, so a transient failure doesn't leave the dialog stuck on "0 charges" forever.
- After a successful seed, call `recompute_folio_totals` (via RPC) or rely on the new trigger (preferred), then `load()` — no client math drift.
- Keep the "assign room later / rate = 0" early-exit but surface a small "Room not assigned yet — nothing to charge" hint instead of silent 0.

No other UI changes. No changes to discount code paths.

### 4. Verify nothing implicit is applying a discount

Quick audit pass (read-only, no changes expected):

- Grep for any writer of `folio_charges` with `charge_type='discount'` or negative `amount` — none should exist as a default path (only `saveBillDiscount` / `addExtraOrDiscount` which require explicit staff input).
- Grep for any writer of `folios.discount_value` / `discount_type` — same story.

If either grep surfaces an unexpected caller, fix that specific site in the same PR; otherwise leave discount code untouched.

### 5. Testing checklist (must pass before shipping)

- Fresh booking → open Checkout → room charge appears immediately, discount ₹0, Balance = Grand Total.
- Fresh booking → open Bill/Invoice directly (skipping Checkout) → totals correct on first render (trigger handles it even if CheckoutDialog never opened).
- Add a KOT charge → folio totals update without a manual refresh.
- Delete a folio_charge → totals recalc downward.
- Apply an explicit bill discount → discount line appears; clear it → discount line disappears; verify DB shows `discount_value = 0`.
- Re-open the two known-broken bookings (`115a3e85…`, `a4bf4a13…`) after backfill → totals match the sum of their `folio_charges`, balance/paid reconcile, no phantom discount.

## Technical details

- Migration file: new file under `supabase/migrations/…_folio_charges_recompute_trigger.sql`.
  - `CREATE OR REPLACE FUNCTION public.tg_folio_charges_sync()` returning trigger, `SECURITY DEFINER`, `SET search_path = public`, calling `recompute_folio_totals(NEW.folio_id)` (and `OLD.folio_id` on DELETE / folio_id change), then `sync_booking_balance` via the folio's booking_id.
  - `CREATE TRIGGER trg_folio_charges_sync AFTER INSERT OR UPDATE OR DELETE ON public.folio_charges FOR EACH ROW EXECUTE FUNCTION public.tg_folio_charges_sync();`
  - Backfill loop: `SELECT public.recompute_folio_totals(id) FROM public.folios WHERE COALESCE(is_deleted,false) = false;`
- Client edit: `src/components/CheckoutDialog.tsx` auto-seed effect — move the `didSeedRoomCharges.current = true` line to run only after `!seedErr`, and drop the `load()` call in favour of the trigger + one final `load()` at the end.
- No schema changes to `folios` or `folio_charges` columns. No changes to `src/lib/billing.ts`, `invoiceTemplates.ts`, discount dialogs, or any RLS policy.
