CREATE OR REPLACE FUNCTION public.shift_room(_booking_room_id uuid, _to_room_id uuid, _new_rate numeric, _tariff_choice text, _reason text, _shifted_by uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_br        public.booking_rooms%ROWTYPE;
  v_booking   public.bookings%ROWTYPE;
  v_target    public.rooms%ROWTYPE;
  v_new_br_id uuid;
  v_now       timestamptz := now();
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required for room shift';
  END IF;
  IF _to_room_id IS NULL THEN
    RAISE EXCEPTION 'Target room is required';
  END IF;

  SELECT * INTO v_br
    FROM public.booking_rooms
   WHERE id = _booking_room_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking room % not found', _booking_room_id;
  END IF;

  -- Never shift a historical row: it would leave the live room occupied and
  -- separately billed.
  IF COALESCE(v_br.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'This room assignment is no longer active (status: %). Refresh and shift the current room.', v_br.status;
  END IF;

  SELECT * INTO v_booking
    FROM public.bookings
   WHERE id = v_br.booking_id
   FOR UPDATE;

  SELECT * INTO v_target FROM public.rooms WHERE id = _to_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target room not found';
  END IF;

  IF v_target.id = v_br.room_id THEN
    RAISE EXCEPTION 'Target room is the same as the current room';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_to_room_id::text, 42));

  UPDATE public.booking_rooms
     SET status              = 'shifted',
         end_date            = v_now,
         shifted_to_room_id  = _to_room_id,
         shifted_at          = v_now,
         shifted_by          = _shifted_by,
         actual_check_out    = COALESCE(actual_check_out, v_now),
         updated_at          = v_now
   WHERE id = _booking_room_id;

  INSERT INTO public.booking_rooms(
    booking_id, property_id, room_id, category_id, tariff_id, meal_plan,
    rate, adults, children, check_in, check_out,
    actual_check_in, status, start_date
  ) VALUES (
    v_br.booking_id, v_br.property_id, _to_room_id,
    COALESCE(v_target.category_id, v_br.category_id),
    v_br.tariff_id, v_br.meal_plan,
    COALESCE(_new_rate, v_br.rate),
    v_br.adults, v_br.children, v_br.check_in, v_br.check_out,
    -- Carry the guest's TRUE original arrival time across every shift.
    CASE WHEN v_booking.status = 'checked_in'
         THEN COALESCE(v_br.actual_check_in, v_booking.checked_in_at, v_now)
         ELSE NULL END,
    'active', v_now
  )
  RETURNING id INTO v_new_br_id;

  INSERT INTO public.room_shifts(
    property_id, booking_room_id, from_room_id, to_room_id, reason,
    old_rate, new_rate, tariff_choice, rate_applied, rate_type, shifted_by
  ) VALUES (
    v_br.property_id, _booking_room_id, v_br.room_id, _to_room_id, _reason,
    v_br.rate, COALESCE(_new_rate, v_br.rate), _tariff_choice,
    COALESCE(_new_rate, v_br.rate),
    CASE WHEN _tariff_choice = 'keep' THEN 'original_rate' ELSE 'new_rate' END,
    _shifted_by
  );

  -- Open food/restaurant bills are room-scoped: move them with the guest.
  UPDATE public.segment_bills
     SET room_id = _to_room_id
   WHERE booking_id = v_br.booking_id
     AND status = 'open'
     AND room_id IS DISTINCT FROM _to_room_id;

  IF v_booking.status = 'checked_in' THEN
    IF v_br.room_id IS NOT NULL THEN
      UPDATE public.rooms
         SET status = 'vacant',
             housekeeping_status = 'dirty',
             updated_at = v_now
       WHERE id = v_br.room_id;
    END IF;
    UPDATE public.rooms
       SET status = 'occupied',
           updated_at = v_now
     WHERE id = _to_room_id;
  END IF;

  RETURN v_new_br_id;
END
$function$;