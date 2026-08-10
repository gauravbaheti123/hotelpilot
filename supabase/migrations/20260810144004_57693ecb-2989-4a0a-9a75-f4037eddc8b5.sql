CREATE OR REPLACE FUNCTION public.is_hold_payment_mode(_mode text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $function$
  SELECT lower(btrim(COALESCE(_mode, ''))) = 'bill on hold';
$function$;

GRANT EXECUTE ON FUNCTION public.is_hold_payment_mode(text) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.dashboard_grid(_property_id uuid, _date date, _include_kots boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  result jsonb;
  v_in_default  time;
  v_out_default time;
BEGIN
  IF NOT public.user_has_property(auth.uid(), _property_id)
     AND NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied for property %', _property_id
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(p.default_checkin_time,  p.checkin_time,  TIME '12:00'),
         COALESCE(p.default_checkout_time, p.checkout_time, TIME '11:00')
    INTO v_in_default, v_out_default
    FROM public.properties p WHERE p.id = _property_id;
  v_in_default  := COALESCE(v_in_default,  TIME '12:00');
  v_out_default := COALESCE(v_out_default, TIME '11:00');

  SELECT jsonb_build_object(
    'arrivals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'booking_number', b.booking_number,
        'balance_amount', b.balance_amount,
        'guest_id', b.guest_id,
        'guest_name', g.name,
        'room_numbers', COALESCE((
          SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
          FROM public.booking_rooms br
          LEFT JOIN public.rooms r ON r.id = br.room_id
          WHERE br.booking_id = b.id AND r.room_number IS NOT NULL
        ), '—')
      ))
      FROM public.bookings b
      LEFT JOIN public.guests g ON g.id = b.guest_id
      WHERE b.property_id = _property_id
        AND b.status = 'reserved'
        AND b.check_in = _date
    ), '[]'::jsonb),

    'departures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'booking_number', b.booking_number,
        'balance_amount', b.balance_amount,
        'guest_id', b.guest_id,
        'guest_name', g.name,
        'room_numbers', COALESCE((
          SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
          FROM public.booking_rooms br
          LEFT JOIN public.rooms r ON r.id = br.room_id
          WHERE br.booking_id = b.id AND r.room_number IS NOT NULL
        ), '—')
      ))
      FROM public.bookings b
      LEFT JOIN public.guests g ON g.id = b.guest_id
      WHERE b.property_id = _property_id
        AND b.status = 'checked_in'
        AND b.check_out = _date
    ), '[]'::jsonb),

    'payments_total', COALESCE((
      SELECT SUM(pm.amount)::numeric
      FROM public.payments pm
      WHERE pm.property_id = _property_id
        AND pm.paid_at >= (_date::text || 'T00:00:00')::timestamptz
        AND pm.paid_at <= (_date::text || 'T23:59:59')::timestamptz
        AND NOT public.is_hold_payment_mode(pm.mode)
        AND NOT EXISTS (
          SELECT 1
          FROM public.bookings eb
          WHERE eb.source = 'event_block'
            AND (
              eb.id = pm.booking_id
              OR eb.id = (SELECT f.booking_id FROM public.folios f WHERE f.id = pm.folio_id)
            )
        )
    ), 0),

    'rooms', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id,
        'room_number', r.room_number,
        'status', r.status,
        'housekeeping_status', r.housekeeping_status,
        'category_id', r.category_id,
        'floor', r.floor
      ) ORDER BY r.room_number)
      FROM public.rooms r
      WHERE r.property_id = _property_id AND r.is_active = true
    ), '[]'::jsonb),

    'active_booking_rooms', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'room_id', br.room_id,
        'booking_id', br.booking_id,
        'status', b.status,
        'balance_amount', b.balance_amount,
        'check_in', b.check_in,
        'check_out', b.check_out,
        'check_in_time', COALESCE(
          to_char(br.check_in_time, 'HH24:MI'),
          to_char(br.actual_check_in AT TIME ZONE 'Asia/Kolkata', 'HH24:MI')
        ),
        'check_out_time', to_char(COALESCE(br.check_out_time, v_out_default), 'HH24:MI'),
        'guest_name', g.name
      ))
      FROM public.booking_rooms br
      JOIN public.bookings b ON b.id = br.booking_id
      LEFT JOIN public.guests g ON g.id = b.guest_id
      WHERE br.property_id = _property_id
        AND b.status IN ('reserved','checked_in')
        AND br.actual_check_out IS NULL
        AND (
          (b.check_in <= _date AND b.check_out > _date)
          OR (b.status = 'checked_in' AND b.check_out <= _date)
        )
    ), '[]'::jsonb),

    'kots', CASE WHEN _include_kots THEN COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', k.id,
        'booking_id', k.booking_id,
        'room_id', k.room_id,
        'total_amount', k.total_amount,
        'created_at', k.created_at,
        'status', k.status,
        'items', COALESCE((
          SELECT jsonb_agg(jsonb_build_object('item_name', ki.item_name, 'qty', ki.qty))
          FROM public.kot_items ki WHERE ki.kot_id = k.id
        ), '[]'::jsonb)
      ))
      FROM public.kot_orders k
      WHERE k.property_id = _property_id
        AND k.kot_copy = 'hotel_copy'
        AND k.status IN ('open','printed','served')
    ), '[]'::jsonb) ELSE '[]'::jsonb END
  ) INTO result;

  RETURN result;
END;
$function$;

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
BEGIN
  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  IF NOT FOUND THEN RETURN; END IF;

  IF v_folio.status IN ('settled','void','refunded') THEN RETURN; END IF;
  IF COALESCE(v_folio.is_deleted, false) THEN RETURN; END IF;

  SELECT MIN(charged_on) INTO v_locked_day
    FROM public.folio_charges
   WHERE folio_id = _folio_id AND COALESCE(is_wiped, false) = false;
  IF v_locked_day IS NULL THEN
    v_locked_day := (v_folio.created_at AT TIME ZONE 'UTC')::date;
  END IF;
  IF public.is_day_locked(v_folio.property_id, v_locked_day) THEN RETURN; END IF;

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

  -- Only REAL money counts toward paid / balance. "Bill On Hold" rows are a
  -- staff marker that nothing was collected, so they must never settle a bill.
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.payments
   WHERE folio_id = _folio_id
     AND NOT public.is_hold_payment_mode(mode);
  v_bal := GREATEST(0, v_total - v_paid);

  IF v_bal <= 0.01 AND v_paid > 0 THEN
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
         balance_amount         = ROUND(v_bal::numeric, 2),
         status                 = v_status,
         settled_at             = CASE WHEN v_status = 'settled' AND settled_at IS NULL THEN now()
                                       WHEN v_status <> 'settled' THEN NULL
                                       ELSE settled_at END,
         updated_at             = now()
   WHERE id = _folio_id;
END
$function$;