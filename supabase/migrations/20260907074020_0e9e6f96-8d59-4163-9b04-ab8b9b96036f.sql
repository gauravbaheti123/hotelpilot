GRANT EXECUTE ON FUNCTION public.is_day_locked(uuid, date) TO authenticated;

CREATE OR REPLACE FUNCTION public.owner_update_booking_room_details(_booking_room_id uuid, _room_id uuid DEFAULT NULL::uuid, _category_id uuid DEFAULT NULL::uuid, _check_in date DEFAULT NULL::date, _check_out date DEFAULT NULL::date, _reason text DEFAULT NULL::text, _actual_check_in timestamp with time zone DEFAULT NULL::timestamp with time zone, _actual_check_out timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _old jsonb;
  _new jsonb;
  _prop uuid;
  _old_room uuid;
  _booking_status text;
  _conflict int;
BEGIN
  IF NOT public.is_owner_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Owner or Superadmin required to override locked records';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT to_jsonb(br), br.property_id INTO _old, _prop
    FROM public.booking_rooms br WHERE br.id = _booking_room_id FOR UPDATE;
  IF _old IS NULL THEN RAISE EXCEPTION 'Booking room not found'; END IF;

  IF _check_in IS NOT NULL AND _check_out IS NOT NULL AND _check_out <= _check_in THEN
    RAISE EXCEPTION 'Check-out must be after check-in';
  END IF;
  IF _actual_check_in IS NOT NULL AND _actual_check_out IS NOT NULL AND _actual_check_out <= _actual_check_in THEN
    RAISE EXCEPTION 'Actual check-out time must be after actual check-in time';
  END IF;

  IF (_room_id IS NULL OR _room_id = (_old->>'room_id')::uuid)
     AND (_category_id IS NULL OR _category_id = (_old->>'category_id')::uuid)
     AND (_check_in IS NULL OR _check_in = (_old->>'check_in')::date)
     AND (_check_out IS NULL OR _check_out = (_old->>'check_out')::date)
     AND (_actual_check_in IS NULL OR _actual_check_in = (_old->>'actual_check_in')::timestamptz)
     AND (_actual_check_out IS NULL OR _actual_check_out = (_old->>'actual_check_out')::timestamptz) THEN
    RAISE EXCEPTION 'No booking-room values changed; the submitted stay times match the stored values';
  END IF;

  _old_room := (_old->>'room_id')::uuid;

  SELECT b.status::text INTO _booking_status
    FROM public.bookings b WHERE b.id = (_old->>'booking_id')::uuid;

  -- Room change: keep physical room occupancy consistent, same guarantees as shift_room.
  IF _room_id IS NOT NULL AND _room_id IS DISTINCT FROM _old_room THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(_room_id::text, 0));

    SELECT count(*) INTO _conflict
      FROM public.booking_rooms br2
      JOIN public.bookings b2 ON b2.id = br2.booking_id
     WHERE br2.room_id = _room_id
       AND br2.id <> _booking_room_id
       AND COALESCE(br2.status, 'active') <> 'shifted'
       AND b2.status IN ('reserved', 'checked_in')
       AND COALESCE(_check_in, (_old->>'check_in')::date) < br2.check_out
       AND COALESCE(_check_out, (_old->>'check_out')::date) > br2.check_in;

    IF _conflict > 0 THEN
      RAISE EXCEPTION 'That room is already assigned to another guest for these dates';
    END IF;
  END IF;

  PERFORM set_config('app.allow_actual_time_edit', 'true', true);
  UPDATE public.booking_rooms
     SET room_id          = COALESCE(_room_id, room_id),
         category_id      = COALESCE(_category_id, category_id),
         check_in         = COALESCE(_check_in, check_in),
         check_out        = COALESCE(_check_out, check_out),
         actual_check_in  = COALESCE(_actual_check_in, actual_check_in),
         actual_check_out = COALESCE(_actual_check_out, actual_check_out),
         updated_at       = now()
   WHERE id = _booking_room_id;
  PERFORM set_config('app.allow_actual_time_edit', '', true);

  IF _room_id IS NOT NULL AND _room_id IS DISTINCT FROM _old_room THEN
    IF _booking_status = 'checked_in' THEN
      UPDATE public.rooms
         SET status = 'vacant', housekeeping_status = 'dirty', updated_at = now()
       WHERE id = _old_room AND status = 'occupied';
      UPDATE public.rooms
         SET status = 'occupied', updated_at = now()
       WHERE id = _room_id;
    ELSE
      UPDATE public.rooms
         SET status = 'vacant', housekeeping_status = 'dirty', updated_at = now()
       WHERE id = _old_room AND status = 'blocked';
    END IF;

    UPDATE public.segment_bills
       SET room_id = _room_id
     WHERE booking_id = (_old->>'booking_id')::uuid
       AND room_id = _old_room
       AND status = 'open';
  END IF;

  SELECT to_jsonb(br) INTO _new FROM public.booking_rooms br WHERE br.id = _booking_room_id;
  PERFORM public.log_owner_override(_prop, 'booking_rooms', _booking_room_id::text, 'UPDATE', _old, _new, _reason);

  RETURN jsonb_build_object(
    'ok', true,
    'actual_check_in', _new->>'actual_check_in',
    'actual_check_out', _new->>'actual_check_out'
  );
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.owner_update_booking_room_details(uuid, uuid, uuid, date, date, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_booking_room_details(uuid, uuid, uuid, date, date, text, timestamptz, timestamptz) TO authenticated;