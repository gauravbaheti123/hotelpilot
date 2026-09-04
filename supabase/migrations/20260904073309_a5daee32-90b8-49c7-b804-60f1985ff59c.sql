DROP FUNCTION IF EXISTS public.owner_update_booking_room_details(uuid, uuid, uuid, date, date, text);

CREATE OR REPLACE FUNCTION public.owner_update_booking_room_details(
  _booking_room_id uuid,
  _room_id uuid DEFAULT NULL,
  _category_id uuid DEFAULT NULL,
  _check_in date DEFAULT NULL,
  _check_out date DEFAULT NULL,
  _reason text DEFAULT NULL,
  _actual_check_in timestamptz DEFAULT NULL,
  _actual_check_out timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _old jsonb;
  _new jsonb;
  _prop uuid;
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

  UPDATE public.booking_rooms
     SET room_id          = COALESCE(_room_id, room_id),
         category_id      = COALESCE(_category_id, category_id),
         check_in         = COALESCE(_check_in, check_in),
         check_out        = COALESCE(_check_out, check_out),
         actual_check_in  = COALESCE(_actual_check_in, actual_check_in),
         actual_check_out = COALESCE(_actual_check_out, actual_check_out),
         updated_at       = now()
   WHERE id = _booking_room_id;

  SELECT to_jsonb(br) INTO _new FROM public.booking_rooms br WHERE br.id = _booking_room_id;
  PERFORM public.log_owner_override(_prop, 'booking_rooms', _booking_room_id::text, 'UPDATE', _old, _new, _reason);

  RETURN jsonb_build_object(
    'ok', true,
    'actual_check_in', _new->>'actual_check_in',
    'actual_check_out', _new->>'actual_check_out'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.owner_update_booking_room_details(uuid, uuid, uuid, date, date, text, timestamptz, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_booking_room_details(uuid, uuid, uuid, date, date, text, timestamptz, timestamptz) TO authenticated;