
CREATE INDEX IF NOT EXISTS booking_rooms_property_id_idx ON public.booking_rooms(property_id);
CREATE INDEX IF NOT EXISTS booking_rooms_property_active_dates_idx
  ON public.booking_rooms(property_id, check_in, check_out);

CREATE OR REPLACE FUNCTION public.dashboard_grid(
  _property_id uuid,
  _date date,
  _include_kots boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  result jsonb;
BEGIN
  -- Authorization: caller must have access to this property.
  IF NOT public.user_has_property(auth.uid(), _property_id)
     AND NOT public.is_superadmin(auth.uid()) THEN
    RAISE EXCEPTION 'Access denied for property %', _property_id
      USING ERRCODE = '42501';
  END IF;

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
        AND b.status IN ('reserved','checked_in')
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
      SELECT SUM(amount)::numeric
      FROM public.payments
      WHERE property_id = _property_id
        AND paid_at >= (_date::text || 'T00:00:00')::timestamptz
        AND paid_at <= (_date::text || 'T23:59:59')::timestamptz
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
        'guest_name', g.name
      ))
      FROM public.booking_rooms br
      JOIN public.bookings b ON b.id = br.booking_id
      LEFT JOIN public.guests g ON g.id = b.guest_id
      WHERE br.property_id = _property_id
        AND b.check_in <= _date
        AND b.check_out > _date
        AND b.status IN ('reserved','checked_in')
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
$$;

GRANT EXECUTE ON FUNCTION public.dashboard_grid(uuid, date, boolean) TO authenticated;
