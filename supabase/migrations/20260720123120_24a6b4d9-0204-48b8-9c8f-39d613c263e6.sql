
-- Rewrite recompute_folio_totals to actually recompute sub_total, discount_amount,
-- gst_amount, and total_amount from folio_charges. Respect:
--   * MIS suppression: is_wiped = true charges are excluded
--   * Settled / void / refunded folios: skip silently (protects Night Audit)
--   * Audit-locked business day: skip silently
-- Bill-level discount from folios.discount_type / discount_value is applied on
-- net subtotal (matches src/lib/billing.ts recomputeFolio).
CREATE OR REPLACE FUNCTION public.recompute_folio_totals(_folio_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_folio        public.folios%ROWTYPE;
  v_sub          numeric := 0;
  v_line_disc    numeric := 0;
  v_legacy_disc  numeric := 0;
  v_gst          numeric := 0;
  v_bill_disc    numeric := 0;
  v_disc_total   numeric := 0;
  v_total_raw    numeric := 0;
  v_total        numeric := 0;
  v_round_off    numeric := 0;
  v_paid         numeric := 0;
  v_bal          numeric := 0;
  v_status       text;
  v_gst_mode     text;
  v_locked_day   date;
BEGIN
  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  IF NOT FOUND THEN RETURN; END IF;

  -- Never silently mutate settled / voided / refunded folios.
  IF v_folio.status IN ('settled','void','refunded') THEN
    RETURN;
  END IF;
  IF COALESCE(v_folio.is_deleted, false) THEN
    RETURN;
  END IF;

  -- Skip if the folio's business day is night-audit-locked. Use the earliest
  -- charge date on the folio as its business day; fall back to created_at.
  SELECT MIN(charged_on) INTO v_locked_day
    FROM public.folio_charges
   WHERE folio_id = _folio_id AND COALESCE(is_wiped, false) = false;
  IF v_locked_day IS NULL THEN
    v_locked_day := (v_folio.created_at AT TIME ZONE 'UTC')::date;
  END IF;
  IF public.is_day_locked(v_folio.property_id, v_locked_day) THEN
    RETURN;
  END IF;

  v_gst_mode := COALESCE(v_folio.gst_mode, 'gst');

  -- Aggregate live charges (exclude MIS-suppressed / wiped rows).
  SELECT
    COALESCE(SUM(
      CASE WHEN c.charge_type = 'discount' THEN 0
           WHEN c.charge_type = 'tax'      THEN 0
           ELSE ABS(c.amount)
                - LEAST(COALESCE(c.discount_amount,0), ABS(c.amount))
      END
    ), 0),
    COALESCE(SUM(
      CASE WHEN c.charge_type IN ('discount','tax') THEN 0
           ELSE LEAST(COALESCE(c.discount_amount,0), ABS(c.amount))
      END
    ), 0),
    COALESCE(SUM(
      CASE WHEN c.charge_type = 'discount' THEN ABS(c.amount) ELSE 0 END
    ), 0),
    COALESCE(SUM(
      CASE
        WHEN v_gst_mode <> 'gst' THEN 0
        WHEN c.charge_type = 'tax' THEN c.amount
        WHEN c.charge_type = 'discount' THEN 0
        WHEN ABS(c.amount) > 0 THEN
          COALESCE(c.gst_amount,0)
            * ((ABS(c.amount) - LEAST(COALESCE(c.discount_amount,0), ABS(c.amount))) / ABS(c.amount))
        ELSE COALESCE(c.gst_amount,0)
      END
    ), 0)
  INTO v_sub, v_line_disc, v_legacy_disc, v_gst
  FROM public.folio_charges c
  WHERE c.folio_id = _folio_id
    AND COALESCE(c.is_wiped, false) = false;

  -- Bill-level discount from folios.discount_value / discount_type.
  IF v_folio.discount_type IS NOT NULL AND COALESCE(v_folio.discount_value,0) > 0 THEN
    IF v_folio.discount_type = 'percent' THEN
      v_bill_disc := GREATEST(0, LEAST(100, v_folio.discount_value)) * v_sub / 100;
    ELSE
      v_bill_disc := LEAST(v_folio.discount_value, v_sub);
    END IF;
    IF v_gst_mode = 'gst' AND v_sub > 0 THEN
      v_gst := v_gst * GREATEST(0, (v_sub - v_bill_disc) / v_sub);
    END IF;
  END IF;

  v_disc_total := v_legacy_disc + v_bill_disc;

  IF v_gst_mode = 'gst' THEN
    v_total_raw := GREATEST(0, v_sub - v_bill_disc - v_legacy_disc + v_gst);
  ELSE
    v_total_raw := GREATEST(0, v_sub - v_bill_disc - v_legacy_disc);
  END IF;
  v_total := ROUND(v_total_raw);
  v_round_off := ROUND((v_total - v_total_raw)::numeric, 2);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.payments WHERE folio_id = _folio_id;
  v_bal := GREATEST(0, v_total - v_paid);

  IF v_bal <= 0.01 AND v_paid > 0 THEN
    v_status := 'settled';
  ELSE
    v_status := 'open';
  END IF;

  UPDATE public.folios
     SET sub_total       = ROUND(v_sub::numeric, 2),
         discount_amount = ROUND(v_disc_total::numeric, 2),
         gst_amount      = ROUND((CASE WHEN v_gst_mode='gst' THEN v_gst ELSE 0 END)::numeric, 2),
         total_amount    = v_total,
         round_off_amount= v_round_off,
         paid_amount     = ROUND(v_paid::numeric, 2),
         balance_amount  = ROUND(v_bal::numeric, 2),
         status          = v_status,
         settled_at      = CASE WHEN v_status = 'settled' AND settled_at IS NULL THEN now()
                                WHEN v_status <> 'settled' THEN NULL
                                ELSE settled_at END,
         updated_at      = now()
   WHERE id = _folio_id;
END $function$;

-- Backfill: recompute every non-settled, non-void, non-deleted folio. The
-- function itself skips settled / audit-locked rows, so this is safe.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id FROM public.folios
     WHERE COALESCE(is_deleted, false) = false
       AND status NOT IN ('settled','void','refunded')
  LOOP
    PERFORM public.recompute_folio_totals(r.id);
  END LOOP;
END $$;
