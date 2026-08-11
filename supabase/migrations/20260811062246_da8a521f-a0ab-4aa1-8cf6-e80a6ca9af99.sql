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
  v_from timestamptz;
  v_to   timestamptz;
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

  -- IST-anchored, half-open business day window
  v_from := (_date::text || 'T00:00:00+05:30')::timestamptz;
  v_to   := ((_date + 1)::text || 'T00:00:00+05:30')::timestamptz;

  SELECT jsonb_build_object(
    'arrivals', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'booking_number', b.booking_number,
        'balance_amount', b.balance_amount,
        'guest_id', b.guest_id,
        'guest_name', g.name,
        'check_in', b.check_in,
        'room_numbers', COALESCE((
          SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
          FROM public.booking_rooms br
          LEFT JOIN public.rooms r ON r.id = br.room_id
          WHERE br.booking_id = b.id
            AND br.status IN ('active','checked_in')
            AND br.actual_check_out IS NULL
            AND r.room_number IS NOT NULL
        ), '—')
      ) ORDER BY b.check_in, b.booking_number)
      FROM public.bookings b
      LEFT JOIN public.guests g ON g.id = b.guest_id
      WHERE b.property_id = _property_id
        AND b.status = 'reserved'
        AND b.check_in <= _date
        AND NOT EXISTS (
          SELECT 1 FROM public.booking_rooms br2
          WHERE br2.booking_id = b.id AND br2.actual_check_in IS NOT NULL
        )
    ), '[]'::jsonb),

    'departures', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', b.id,
        'booking_number', b.booking_number,
        'balance_amount', b.balance_amount,
        'guest_id', b.guest_id,
        'guest_name', g.name,
        'check_out', b.check_out,
        'room_numbers', COALESCE((
          SELECT string_agg(r.room_number, ', ' ORDER BY r.room_number)
          FROM public.booking_rooms br
          LEFT JOIN public.rooms r ON r.id = br.room_id
          WHERE br.booking_id = b.id
            AND br.status IN ('active','checked_in')
            AND br.actual_check_out IS NULL
            AND r.room_number IS NOT NULL
        ), '—')
      ) ORDER BY b.check_out, b.booking_number)
      FROM public.bookings b
      LEFT JOIN public.guests g ON g.id = b.guest_id
      WHERE b.property_id = _property_id
        AND b.status = 'checked_in'
        AND b.check_out <= _date
    ), '[]'::jsonb),

    'payments_total', COALESCE((
      SELECT SUM(pm.amount)::numeric
      FROM public.payments pm
      WHERE pm.property_id = _property_id
        AND pm.paid_at >= v_from
        AND pm.paid_at <  v_to
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
        'room_count', (
          SELECT COUNT(*) FROM public.booking_rooms br3
          WHERE br3.booking_id = b.id
            AND br3.status IN ('active','checked_in')
            AND br3.actual_check_out IS NULL
        ),
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
        AND br.status IN ('active','checked_in')
        AND br.actual_check_out IS NULL
        AND (
          (br.status IN ('active','checked_in') AND br.actual_check_in IS NOT NULL)
          OR (b.check_in <= _date AND b.check_out > _date)
          OR (b.status = 'checked_in' AND b.check_out <= _date)
        )
    ), '[]'::jsonb),

    'kots', '[]'::jsonb
  ) INTO result;

  RETURN result;
END;
$function$;

CREATE OR REPLACE FUNCTION public.resync_finalised_folio(_folio_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_folio public.folios%ROWTYPE;
BEGIN
  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_folio.status = 'void' THEN
    RETURN jsonb_build_object('ok', false, 'status', v_folio.status);
  END IF;

  -- Genuine repair: recompute charges -> totals -> paid -> balance -> status
  PERFORM public.recompute_folio_totals(_folio_id);

  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  PERFORM public.sync_booking_balance(v_folio.booking_id);

  RETURN jsonb_build_object(
    'ok', true,
    'total_amount', v_folio.total_amount,
    'paid_amount', v_folio.paid_amount,
    'balance_amount', v_folio.balance_amount,
    'status', v_folio.status
  );
END
$function$;

CREATE OR REPLACE FUNCTION public.sync_booking_balance(_booking_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_bal numeric;
BEGIN
  IF _booking_id IS NULL THEN RETURN; END IF;
  -- Use each folio's own stored balance (already includes round_off_amount
  -- via recompute_folio_totals) so multi-folio bookings cannot drift by paise.
  SELECT COALESCE(SUM(ROUND(COALESCE(balance_amount, 0)::numeric, 2)), 0)
    INTO v_bal
    FROM public.folios
   WHERE booking_id = _booking_id
     AND COALESCE(is_deleted, false) = false
     AND status <> 'void';
  UPDATE public.bookings
     SET balance_amount = ROUND(v_bal::numeric, 2),
         updated_at     = now()
   WHERE id = _booking_id;
END $function$;