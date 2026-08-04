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
        'check_in_time', to_char(COALESCE(br.check_in_time, v_in_default), 'HH24:MI'),
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