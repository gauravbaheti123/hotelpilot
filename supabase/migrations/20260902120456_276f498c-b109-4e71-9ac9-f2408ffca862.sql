CREATE OR REPLACE FUNCTION public.recompute_folio_totals(_folio_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
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
  v_comp         numeric := 0;
  v_food_gst_ratio numeric := 0;
  v_food_gross   numeric := 0;
  v_food_gst     numeric := 0;
  v_finalised    boolean := false;
  v_old_total    numeric;
  v_old_status   text;
  v_ongoing      boolean := false;
BEGIN
  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF COALESCE(v_folio.is_deleted, false) THEN RETURN; END IF;

  v_old_total  := COALESCE(v_folio.total_amount, 0);
  v_old_status := v_folio.status;
  v_finalised  := v_folio.status IN ('settled','due','refunded');
  IF v_folio.booking_id IS NOT NULL THEN
    v_ongoing := public.stay_ongoing(v_folio.booking_id);
  END IF;

  SELECT MIN(charged_on) INTO v_locked_day
    FROM public.folio_charges
   WHERE folio_id = _folio_id AND COALESCE(is_wiped, false) = false;
  IF v_locked_day IS NULL THEN
    v_locked_day := (v_folio.created_at AT TIME ZONE 'UTC')::date;
  END IF;
  IF public.is_day_locked(v_folio.property_id, v_locked_day) THEN RETURN; END IF;

  v_gst_mode := COALESCE(v_folio.gst_mode, 'gst');

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

  WITH nights AS (
    SELECT
      d.d AS night_date,
      SUM(
        COALESCE(NULLIF(tp.complimentary_food_limit_per_person, 0),
                 rc.complimentary_food_limit_per_person, 0)
        * (br.adults + br.children)
      ) AS day_allowance
    FROM public.booking_rooms br
    LEFT JOIN public.tariff_plans tp    ON tp.id = br.tariff_id
    LEFT JOIN public.room_categories rc ON rc.id = br.category_id
    CROSS JOIN LATERAL generate_series(br.check_in, br.check_out - 1, interval '1 day') AS d(d)
    WHERE br.booking_id = v_folio.booking_id
      AND COALESCE(br.status,'active') IN ('active','reserved','checked_in')
      AND br.meal_plan IN ('MAP','AP')
    GROUP BY d.d
  ),
  food_by_day AS (
    SELECT c.charged_on AS night_date,
           SUM(GREATEST(0, ABS(c.amount) - LEAST(COALESCE(c.discount_amount,0), ABS(c.amount)))) AS day_food
    FROM public.folio_charges c
    WHERE c.folio_id = _folio_id
      AND c.charge_type = 'food'
      AND COALESCE(c.is_wiped, false) = false
    GROUP BY c.charged_on
  )
  SELECT COALESCE(SUM(LEAST(COALESCE(n.day_allowance, 0), COALESCE(f.day_food, 0))), 0)
    INTO v_comp
    FROM nights n
    JOIN food_by_day f ON f.night_date = n.night_date;

  IF v_comp > 0 THEN
    SELECT COALESCE(SUM(
             ABS(c.amount) - LEAST(COALESCE(c.discount_amount,0), ABS(c.amount))
           ),0),
           COALESCE(SUM(
             CASE WHEN v_gst_mode = 'gst' AND ABS(c.amount) > 0
                  THEN COALESCE(c.gst_amount,0)
                       * ((ABS(c.amount) - LEAST(COALESCE(c.discount_amount,0), ABS(c.amount))) / ABS(c.amount))
                  ELSE 0 END
           ),0)
      INTO v_food_gross, v_food_gst
      FROM public.folio_charges c
     WHERE c.folio_id = _folio_id
       AND c.charge_type = 'food'
       AND COALESCE(c.is_wiped, false) = false;
    IF v_food_gross > 0 THEN
      v_food_gst_ratio := LEAST(1, v_comp / v_food_gross);
      v_gst := GREATEST(0, v_gst - (v_food_gst * v_food_gst_ratio));
    END IF;
  END IF;

  -- Bill-level discount lives on folios.discount_type/discount_value.
  -- (folios.discount_amount is an OUTPUT of this routine - never an input.)
  IF COALESCE(v_folio.discount_value, 0) > 0 THEN
    IF COALESCE(v_folio.discount_type, 'amount') = 'percent' THEN
      v_bill_disc := ROUND((LEAST(100, GREATEST(0, v_folio.discount_value)) * v_sub / 100)::numeric, 2);
    ELSE
      v_bill_disc := LEAST(ROUND(v_folio.discount_value::numeric, 2), v_sub);
    END IF;
  ELSE
    v_bill_disc := 0;
  END IF;
  IF v_gst_mode = 'gst' AND v_sub > 0 AND v_bill_disc > 0 THEN
    v_gst := ROUND((v_gst * GREATEST(0, (v_sub - v_bill_disc) / v_sub))::numeric, 2);
  END IF;
  v_disc_total := v_line_disc + v_legacy_disc + v_bill_disc;

  IF v_gst_mode = 'gst' THEN
    v_total_raw := GREATEST(0, v_sub - v_bill_disc - v_legacy_disc - v_comp + v_gst);
  ELSE
    v_total_raw := GREATEST(0, v_sub - v_bill_disc - v_legacy_disc - v_comp);
  END IF;
  v_total := ROUND(v_total_raw);
  v_round_off := ROUND((v_total - v_total_raw)::numeric, 2);

  -- "Bill on Hold" payments count as paid for balance/checkout purposes.
  -- (dashboard_grid's collected-revenue calc still excludes them separately.)
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.payments
   WHERE folio_id = _folio_id;

  -- Credits are real: never clamp a genuine overpayment to zero.
  v_bal := ROUND((v_total - v_paid)::numeric, 2);

  -- A voided bill stays frozen. If charges were added to it, flag instead of absorbing.
  IF v_folio.status = 'void' THEN
    IF ABS(v_total - v_old_total) > 0.01 THEN
      INSERT INTO public.activity_log
        (property_id, user_name, action_type, module, reference_id, reference_label, details)
      VALUES (v_folio.property_id, 'system', 'CHARGE_ON_VOID_FOLIO', 'Billing',
              v_folio.id, 'Invoice ' || COALESCE(v_folio.invoice_number, '—'),
              jsonb_build_object(
                'stored_total', v_old_total,
                'true_total', v_total,
                'difference', ROUND((v_total - v_old_total)::numeric, 2),
                'reason', 'charge changed on a voided bill; header left untouched'
              ));
    END IF;
    RETURN;
  END IF;

  IF v_finalised THEN
    -- Late charge on a finalised bill: absorb it and surface the money.
    IF v_bal > 0.01 THEN
      v_status := 'due';
    ELSIF v_folio.status = 'refunded' THEN
      v_status := 'refunded';
    ELSE
      v_status := 'settled';
    END IF;
  ELSIF v_bal <= 0.01 AND v_paid > 0 AND NOT v_ongoing THEN
    v_status := 'settled';
  ELSE
    -- Advance fully paid while the guest is still in house stays 'open'
    -- so no final invoice number is issued before checkout.
    v_status := 'open';
  END IF;

  UPDATE public.folios
     SET sub_total              = ROUND(v_sub::numeric, 2),
         discount_amount        = ROUND(v_disc_total::numeric, 2),
         complimentary_food_used = ROUND(v_comp::numeric, 2),
         gst_amount             = ROUND((CASE WHEN v_gst_mode='gst' THEN v_gst ELSE 0 END)::numeric, 2),
         total_amount           = v_total,
         round_off_amount       = v_round_off,
         paid_amount            = ROUND(v_paid::numeric, 2),
         balance_amount         = v_bal,
         status                 = v_status,
         settled_at             = CASE
                                    WHEN v_finalised THEN settled_at
                                    WHEN v_status = 'settled' AND settled_at IS NULL THEN now()
                                    WHEN v_status <> 'settled' THEN NULL
                                    ELSE settled_at END,
         updated_at             = now()
   WHERE id = _folio_id;

  IF v_finalised AND (ABS(v_total - v_old_total) > 0.01 OR v_status IS DISTINCT FROM v_old_status) THEN
    INSERT INTO public.activity_log
      (property_id, user_name, action_type, module, reference_id, reference_label, details)
    VALUES (v_folio.property_id, 'system', 'FOLIO_REOPENED_DUE_TO_LATE_CHARGE', 'Billing',
            v_folio.id, 'Invoice ' || COALESCE(v_folio.invoice_number, '—'),
            jsonb_build_object(
              'old_total', v_old_total,
              'new_total', v_total,
              'old_status', v_old_status,
              'new_status', v_status,
              'paid_amount', ROUND(v_paid::numeric, 2),
              'new_balance', v_bal,
              'reason', 'charge added or changed after the bill was finalised'
            ));
  END IF;
END
$function$;

CREATE OR REPLACE FUNCTION public.delete_payment(_payment_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pay   public.payments%ROWTYPE;
  v_folio public.folios%ROWTYPE;
  v_paid  numeric := 0;
  v_bal   numeric := 0;
  v_status text;
  v_normal boolean;
  v_grace boolean;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;

  v_normal := public.is_owner_or_super(auth.uid())
          OR public.has_permission(auth.uid(), v_pay.property_id, 'payments', 'delete');
  v_grace := public.folio_in_grace(v_pay.folio_id);

  IF NOT (v_normal OR v_grace) THEN
    RAISE EXCEPTION 'You do not have permission to delete payments';
  END IF;

  SELECT * INTO v_folio FROM public.folios WHERE id = v_pay.folio_id;

  INSERT INTO public.activity_log
    (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
  VALUES (
    v_pay.property_id, auth.uid(),
    COALESCE((SELECT display_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    'PAYMENT_DELETED', 'Billing', _payment_id,
    COALESCE(NULLIF(btrim(v_folio.invoice_number), ''), 'Bill'),
    jsonb_build_object(
      'payment_id', _payment_id,
      'folio_id', v_pay.folio_id,
      'booking_id', v_pay.booking_id,
      'amount', v_pay.amount,
      'mode', v_pay.mode,
      'reference_no', v_pay.reference_no,
      'paid_at', v_pay.paid_at,
      'via_grace_window', (NOT v_normal AND v_grace),
      'reason', NULLIF(btrim(COALESCE(_reason, '')), '')
    )
  );

  DELETE FROM public.payments WHERE id = _payment_id;

  IF v_folio.id IS NOT NULL THEN
    -- "Bill on Hold" payments count as paid (same rule as recompute_folio_totals).
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
      FROM public.payments
     WHERE folio_id = v_folio.id;
    v_bal := ROUND(GREATEST(0, COALESCE(v_folio.total_amount,0) - v_paid)::numeric, 2);
    IF v_folio.status IN ('void','refunded') THEN
      v_status := v_folio.status;
    ELSIF v_bal <= 0.01 AND v_paid > 0 THEN
      v_status := 'settled';
    ELSIF COALESCE(NULLIF(btrim(v_folio.invoice_number), ''), '') <> '' THEN
      v_status := 'due';
    ELSE
      v_status := 'open';
    END IF;
    UPDATE public.folios
       SET paid_amount    = ROUND(v_paid::numeric, 2),
           balance_amount = v_bal,
           status         = v_status,
           updated_at     = now()
     WHERE id = v_folio.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'paid_amount', v_paid, 'balance_amount', v_bal,
                            'status', v_status, 'via_grace_window', (NOT v_normal AND v_grace));
END
$function$;

-- One-time clean-up: recalculate every bill that currently carries a
-- "Bill on Hold" payment so any bill stuck with a stale pending balance
-- (blocked from checkout) is corrected immediately.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT DISTINCT folio_id
      FROM public.payments
     WHERE folio_id IS NOT NULL
       AND public.is_hold_payment_mode(mode)
  LOOP
    PERFORM public.recompute_folio_totals(r.folio_id);
  END LOOP;
END
$$;