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
BEGIN
  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  IF NOT FOUND THEN RETURN; END IF;
  IF COALESCE(v_folio.is_deleted, false) THEN RETURN; END IF;

  v_old_total  := COALESCE(v_folio.total_amount, 0);
  v_old_status := v_folio.status;
  v_finalised  := v_folio.status IN ('settled','due','refunded');

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

    v_comp := LEAST(v_comp, v_food_gross);

    IF v_gst_mode = 'gst' AND v_food_gross > 0 AND v_food_gst > 0 THEN
      v_food_gst_ratio := (v_food_gross - v_comp) / v_food_gross;
      v_gst := v_gst - v_food_gst + (v_food_gst * v_food_gst_ratio);
    END IF;
  END IF;

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
    v_total_raw := GREATEST(0, v_sub - v_bill_disc - v_legacy_disc - v_comp + v_gst);
  ELSE
    v_total_raw := GREATEST(0, v_sub - v_bill_disc - v_legacy_disc - v_comp);
  END IF;
  v_total := ROUND(v_total_raw);
  v_round_off := ROUND((v_total - v_total_raw)::numeric, 2);

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.payments
   WHERE folio_id = _folio_id
     AND NOT public.is_hold_payment_mode(mode);

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
  ELSIF v_bal <= 0.01 AND v_paid > 0 THEN
    v_status := 'settled';
  ELSE
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

  -- Self-reporting trail whenever a finalised bill is changed by a late charge.
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