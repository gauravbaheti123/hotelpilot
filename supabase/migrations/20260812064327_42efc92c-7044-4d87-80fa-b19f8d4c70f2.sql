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

CREATE OR REPLACE FUNCTION public.extend_stay(_folio_id uuid, _new_check_out date, _new_check_out_time time without time zone DEFAULT NULL::time without time zone, _reason text DEFAULT NULL::text, _payment_amount numeric DEFAULT 0, _payment_mode text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_folio    public.folios%ROWTYPE;
  v_booking  public.bookings%ROWTYPE;
  v_br       public.booking_rooms%ROWTYPE;
  v_old_out  date;
  v_old_total numeric;
  v_new_total numeric;
  v_nights   int;
  v_nightly  numeric;
  v_gst_rate numeric;
  v_gross    numeric;
  v_amount   numeric;
  v_gst_amt  numeric;
  v_charge_id uuid;
  v_room_number text;
  v_category_name text;
  v_pay numeric := ROUND(COALESCE(_payment_amount, 0)::numeric, 2);
  v_res jsonb;
BEGIN
  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_folio.status IN ('void','refunded') OR COALESCE(v_folio.is_deleted,false) THEN
    RAISE EXCEPTION 'This bill is % and cannot be extended', v_folio.status;
  END IF;
  IF v_folio.booking_id IS NULL THEN
    RAISE EXCEPTION 'This bill is not linked to a booking';
  END IF;

  IF NOT (public.is_owner_or_super(auth.uid())
          OR public.has_permission(auth.uid(), v_folio.property_id, 'bookings', 'extend_stay_locked')) THEN
    RAISE EXCEPTION 'You do not have permission to extend a settled stay';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_folio.booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_booking.status IN ('cancelled','no_show') THEN
    RAISE EXCEPTION 'This booking is % and cannot be extended', v_booking.status;
  END IF;

  v_old_out   := v_booking.check_out;
  v_old_total := COALESCE(v_folio.total_amount, 0);

  IF _new_check_out IS NULL OR _new_check_out <= v_old_out THEN
    RAISE EXCEPTION 'The new checkout date must be later than the current checkout date (%)', v_old_out;
  END IF;

  -- Reopen the bill so the pricing routines are allowed to touch it.
  UPDATE public.folios
     SET status = 'open', settled_at = NULL, updated_at = now()
   WHERE id = _folio_id;

  -- Only the CURRENT, live room assignment(s) move. Shifted/historical rows and
  -- partial split-slices already represent a closed date range: stretching them
  -- re-seeds a full new charge and inflates the bill (see BK-20260802-0005).
  FOR v_br IN
    SELECT * FROM public.booking_rooms br
     WHERE br.booking_id = v_booking.id
       AND COALESCE(br.status, 'active') IN ('active','reserved','checked_in')
       AND br.check_out = (
         SELECT MAX(b2.check_out) FROM public.booking_rooms b2
          WHERE b2.booking_id = v_booking.id
            AND COALESCE(b2.status, 'active') IN ('active','reserved','checked_in')
       )
  LOOP
    UPDATE public.booking_rooms
       SET check_out      = _new_check_out,
           check_out_time = COALESCE(_new_check_out_time, check_out_time),
           updated_at     = now()
     WHERE id = v_br.id;

    -- Re-price via the shared seeding routine first.
    PERFORM public.seed_room_charge_for_booking_room(v_br.id);

    v_nights  := GREATEST(1, (_new_check_out - v_br.check_in));
    v_nightly := COALESCE(v_br.rate, 0);

    SELECT fc.id INTO v_charge_id
      FROM public.folio_charges fc
     WHERE fc.folio_id = _folio_id
       AND fc.charge_type = 'room'
       AND fc.source_table = 'booking_rooms'
       AND fc.source_id = v_br.id
       AND COALESCE(fc.is_wiped,false) = false
       AND fc.qty = v_nights
     LIMIT 1;

    -- Day locks or a foreign folio can make the shared routine skip the row;
    -- fall back to the identical pricing maths so the extra night is still billed.
    IF v_charge_id IS NULL AND v_nightly > 0 THEN
      IF COALESCE(v_booking.rate_type, 'exclusive') = 'inclusive' THEN
        v_gst_rate := COALESCE(public.get_gst_rate(v_br.property_id, 'room', v_nightly), 0);
        v_gross    := v_nights * v_nightly;
        v_amount   := ROUND((v_gross / (1 + v_gst_rate / 100))::numeric, 2);
        v_gst_amt  := ROUND((v_gross - v_amount)::numeric, 2);
      ELSE
        v_gst_rate := COALESCE(public.get_gst_rate(v_br.property_id, 'room', v_nightly), 0);
        v_gross    := v_nights * v_nightly;
        v_amount   := v_gross;
        v_gst_amt  := ROUND((v_gross * v_gst_rate / 100)::numeric, 2);
      END IF;

      SELECT r.room_number INTO v_room_number FROM public.rooms r WHERE r.id = v_br.room_id;
      SELECT rc.name INTO v_category_name FROM public.room_categories rc WHERE rc.id = v_br.category_id;

      SELECT fc.id INTO v_charge_id
        FROM public.folio_charges fc
       WHERE fc.folio_id = _folio_id
         AND fc.charge_type = 'room'
         AND fc.source_table = 'booking_rooms'
         AND fc.source_id = v_br.id
         AND COALESCE(fc.is_wiped,false) = false
       LIMIT 1;

      IF v_charge_id IS NOT NULL THEN
        UPDATE public.folio_charges
           SET description = 'Room ' || COALESCE(v_room_number,'') || ' · ' || COALESCE(v_category_name,'') || ' · ' || v_nights || ' night(s)',
               qty = v_nights, rate = v_nightly, amount = v_amount,
               gst_rate = v_gst_rate, gst_amount = v_gst_amt
         WHERE id = v_charge_id;
      ELSE
        INSERT INTO public.folio_charges(
          folio_id, charge_type, description, qty, rate, amount,
          gst_rate, gst_amount, charged_on, source_table, source_id, created_by
        ) VALUES (
          _folio_id, 'room',
          'Room ' || COALESCE(v_room_number,'') || ' · ' || COALESCE(v_category_name,'') || ' · ' || v_nights || ' night(s)',
          v_nights, v_nightly, v_amount, v_gst_rate, v_gst_amt,
          COALESCE(v_br.check_in, v_booking.check_in, CURRENT_DATE),
          'booking_rooms', v_br.id, auth.uid()
        );
      END IF;
    END IF;
  END LOOP;

  UPDATE public.bookings
     SET check_out = _new_check_out, updated_at = now()
   WHERE id = v_booking.id;

  PERFORM public.recompute_folio_totals(_folio_id);

  -- Optional payment collected in the same flow.
  IF v_pay > 0 THEN
    IF COALESCE(btrim(_payment_mode), '') = '' THEN
      RAISE EXCEPTION 'Select a payment mode to collect payment now';
    END IF;
    SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
    IF v_pay > COALESCE(v_folio.balance_amount, 0) + 0.01 THEN
      RAISE EXCEPTION 'Payment cannot exceed the outstanding balance of %', COALESCE(v_folio.balance_amount, 0);
    END IF;
    INSERT INTO public.payments(property_id, booking_id, folio_id, amount, mode, paid_at, created_by)
    VALUES (v_folio.property_id, v_folio.booking_id, _folio_id, v_pay, btrim(_payment_mode), now(), auth.uid());
    PERFORM public.recompute_folio_totals(_folio_id);
  END IF;

  -- Finalised bills keep their invoice number and land on settled or due.
  IF COALESCE(NULLIF(btrim(v_folio.invoice_number), ''), '') <> '' THEN
    PERFORM public.resync_finalised_folio(_folio_id);
  END IF;

  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  v_new_total := COALESCE(v_folio.total_amount, 0);

  INSERT INTO public.activity_log
    (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
  VALUES (
    v_folio.property_id, auth.uid(),
    COALESCE((SELECT display_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    'STAY_EXTENDED_POST_SETTLEMENT', 'Billing', _folio_id,
    COALESCE(NULLIF(btrim(v_folio.invoice_number), ''), 'Bill') || ' — ' || v_old_out || ' → ' || _new_check_out,
    jsonb_build_object(
      'folio_id', _folio_id,
      'booking_id', v_folio.booking_id,
      'old_check_out', v_old_out,
      'new_check_out', _new_check_out,
      'new_check_out_time', _new_check_out_time,
      'old_total', v_old_total,
      'new_total', v_new_total,
      'added_amount', ROUND((v_new_total - v_old_total)::numeric, 2),
      'payment_collected', v_pay,
      'payment_mode', _payment_mode,
      'reason', NULLIF(btrim(COALESCE(_reason, '')), ''),
      'status', v_folio.status,
      'changed_by', auth.uid(),
      'changed_at', now()
    )
  );

  v_res := jsonb_build_object(
    'ok', true,
    'old_check_out', v_old_out,
    'new_check_out', _new_check_out,
    'added_amount', ROUND((v_new_total - v_old_total)::numeric, 2),
    'total_amount', v_new_total,
    'balance_amount', COALESCE(v_folio.balance_amount, 0),
    'status', v_folio.status
  );
  RETURN v_res;
END
$function$;