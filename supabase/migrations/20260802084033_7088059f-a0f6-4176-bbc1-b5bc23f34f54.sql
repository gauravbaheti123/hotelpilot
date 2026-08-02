-- 34.1 booking_rooms: store times + allow same-day stays
ALTER TABLE public.booking_rooms
  ADD COLUMN IF NOT EXISTS check_in_time time,
  ADD COLUMN IF NOT EXISTS check_out_time time;

ALTER TABLE public.booking_rooms DROP CONSTRAINT IF EXISTS booking_rooms_check;
ALTER TABLE public.booking_rooms
  ADD CONSTRAINT booking_rooms_check CHECK (check_out >= check_in);

-- 34.3 banquet events can span midnight
ALTER TABLE public.banquet_bookings
  ADD COLUMN IF NOT EXISTS event_end_date date;

-- Full-datetime overlap + validation guard
CREATE OR REPLACE FUNCTION public.tg_booking_rooms_no_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conflict_id uuid;
  v_conflict_booking text;
  v_in  timestamp;
  v_out timestamp;
BEGIN
  IF NEW.room_id IS NULL OR NEW.check_in IS NULL OR NEW.check_out IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.status, 'active') NOT IN ('active','reserved','checked_in') THEN
    RETURN NEW;
  END IF;

  v_in  := NEW.check_in  + COALESCE(NEW.check_in_time,  TIME '12:00');
  v_out := NEW.check_out + COALESCE(NEW.check_out_time, TIME '11:00');

  IF v_out <= v_in THEN
    RAISE EXCEPTION 'check_out must be after check_in';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.room_id::text, 42));

  -- (1) Datetime-range overlap with any other active/reserved/checked_in assignment
  SELECT br.id, b.booking_number
    INTO v_conflict_id, v_conflict_booking
    FROM public.booking_rooms br
    JOIN public.bookings b ON b.id = br.booking_id
   WHERE br.room_id = NEW.room_id
     AND br.id IS DISTINCT FROM NEW.id
     AND COALESCE(br.status, 'active') IN ('active','reserved','checked_in')
     AND COALESCE(b.status, 'reserved') NOT IN ('cancelled','checked_out','no_show')
     AND (br.check_in  + COALESCE(br.check_in_time,  TIME '12:00')) < v_out
     AND (br.check_out + COALESCE(br.check_out_time, TIME '11:00')) > v_in
   LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Room already booked for the selected dates (conflicts with booking %)',
      COALESCE(v_conflict_booking, v_conflict_id::text)
      USING ERRCODE = '23P01';
  END IF;

  -- (2) Physical occupancy guard: a guest physically in the room blocks any
  -- new assignment regardless of dates, until an explicit checkout happens.
  SELECT br.id, b.booking_number
    INTO v_conflict_id, v_conflict_booking
    FROM public.booking_rooms br
    JOIN public.bookings b ON b.id = br.booking_id
   WHERE br.room_id = NEW.room_id
     AND br.id IS DISTINCT FROM NEW.id
     AND br.actual_check_out IS NULL
     AND b.status = 'checked_in'
     AND COALESCE(br.status, 'active') IN ('active','reserved','checked_in')
   LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Room is currently occupied (booking %) — check the guest out first',
      COALESCE(v_conflict_booking, v_conflict_id::text)
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$function$;

-- Datetime validation for event room blocks
CREATE OR REPLACE FUNCTION public.tg_event_room_block_valid_dates()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.checkin_date IS NULL OR NEW.checkout_date IS NULL THEN
    RETURN NEW;
  END IF;
  IF (NEW.checkout_date + COALESCE(NEW.checkout_time, TIME '11:00'))
     <= (NEW.checkin_date + COALESCE(NEW.checkin_time, TIME '12:00')) THEN
    RAISE EXCEPTION 'check-out must be after check-in';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_event_room_block_valid_dates ON public.event_room_blocks;
CREATE TRIGGER trg_event_room_block_valid_dates
  BEFORE INSERT OR UPDATE ON public.event_room_blocks
  FOR EACH ROW EXECUTE FUNCTION public.tg_event_room_block_valid_dates();

-- Datetime validation for banquet bulk rooms
CREATE OR REPLACE FUNCTION public.tg_banquet_bulk_room_valid_dates()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.check_in IS NULL OR NEW.check_out IS NULL THEN
    RETURN NEW;
  END IF;
  IF (NEW.check_out + COALESCE(NEW.check_out_time, TIME '11:00'))
     <= (NEW.check_in + COALESCE(NEW.check_in_time, TIME '12:00')) THEN
    RAISE EXCEPTION 'check-out must be after check-in';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_banquet_bulk_room_valid_dates ON public.banquet_bulk_rooms;
CREATE TRIGGER trg_banquet_bulk_room_valid_dates
  BEFORE INSERT OR UPDATE ON public.banquet_bulk_rooms
  FOR EACH ROW EXECUTE FUNCTION public.tg_banquet_bulk_room_valid_dates();

-- Dashboard grid: expose stay times for room cards
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

  SELECT COALESCE(NULLIF(p.default_checkin_time, '')::time, TIME '12:00'),
         COALESCE(NULLIF(p.default_checkout_time, '')::time, TIME '11:00')
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