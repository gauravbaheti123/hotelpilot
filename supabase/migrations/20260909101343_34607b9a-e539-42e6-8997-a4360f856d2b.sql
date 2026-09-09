CREATE OR REPLACE FUNCTION public.shift_room(_booking_room_id uuid, _to_room_id uuid, _new_rate numeric, _tariff_choice text, _reason text, _shifted_by uuid, _mode text DEFAULT 'same_day'::text, _effective_date date DEFAULT NULL::date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_br             public.booking_rooms%ROWTYPE;
  v_booking        public.bookings%ROWTYPE;
  v_target         public.rooms%ROWTYPE;
  v_new_br_id      uuid;
  v_now            timestamptz := now();
  v_mode           text := COALESCE(NULLIF(btrim(_mode), ''), 'same_day');
  v_eff            date;
  v_new_in         date;
  v_orig_out       date;
  v_new_charge     uuid;
  v_old_charge     uuid;
  v_event_block_id uuid;
  v_event_booking_id uuid;
  v_target_category_name text;
  v_live_count     integer;
  v_actor          uuid := auth.uid();
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'Authentication is required for room shift';
  END IF;
  IF _shifted_by IS NOT NULL AND _shifted_by IS DISTINCT FROM v_actor THEN
    RAISE EXCEPTION 'Room shift actor does not match the signed-in user';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required for room shift';
  END IF;
  IF _to_room_id IS NULL THEN
    RAISE EXCEPTION 'Target room is required';
  END IF;
  IF v_mode NOT IN ('same_day','mid_stay') THEN
    RAISE EXCEPTION 'Unknown shift mode: %', v_mode;
  END IF;

  SELECT * INTO v_br
    FROM public.booking_rooms
   WHERE id = _booking_room_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking room % not found', _booking_room_id;
  END IF;

  IF COALESCE(v_br.status, 'active') NOT IN ('active', 'checked_in') THEN
    RAISE EXCEPTION 'This room assignment is no longer active (status: %). Refresh and shift the current room.', v_br.status;
  END IF;

  IF NOT public.has_permission(v_actor, v_br.property_id, 'bookings', 'edit') THEN
    RAISE EXCEPTION 'You do not have permission to shift rooms for this property';
  END IF;

  SELECT * INTO v_booking
    FROM public.bookings
   WHERE id = v_br.booking_id
     AND property_id = v_br.property_id
   FOR UPDATE;
  IF NOT FOUND OR v_booking.status NOT IN ('reserved', 'checked_in') THEN
    RAISE EXCEPTION 'Only an open reservation or checked-in stay can be shifted';
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.folios f
     WHERE f.booking_id = v_br.booking_id
       AND f.status IN ('settled', 'void')
       AND COALESCE(f.is_deleted, false) = false
  ) THEN
    RAISE EXCEPTION 'A settled or void bill cannot be shifted';
  END IF;

  SELECT * INTO v_target
    FROM public.rooms
   WHERE id = _to_room_id
     AND property_id = v_br.property_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target room was not found in this property';
  END IF;
  IF v_target.id = v_br.room_id THEN
    RAISE EXCEPTION 'Target room is the same as the current room';
  END IF;
  IF v_target.status IS DISTINCT FROM 'vacant' THEN
    RAISE EXCEPTION 'Target room % is no longer vacant. Refresh and choose another room.', v_target.room_number;
  END IF;

  v_new_in := v_br.check_in;
  v_orig_out := v_br.check_out;
  IF v_mode = 'mid_stay' THEN
    v_eff := COALESCE(_effective_date, CURRENT_DATE);
    IF v_eff <= v_br.check_in THEN
      RAISE EXCEPTION 'Shift date must be after the current room''s check-in date (%)', v_br.check_in;
    END IF;
    IF v_eff >= v_br.check_out THEN
      RAISE EXCEPTION 'Shift date must be before the check-out date (%)', v_br.check_out;
    END IF;
    v_new_in := v_eff;
  ELSE
    v_eff := CURRENT_DATE;
  END IF;

  IF public.is_day_locked(v_br.property_id, v_eff) THEN
    RAISE EXCEPTION 'Room shift is not allowed for a closed business date (%)', v_eff;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_to_room_id::text, 42));

  IF EXISTS (
    SELECT 1
      FROM public.booking_rooms other
     WHERE other.property_id = v_br.property_id
       AND other.room_id = _to_room_id
       AND other.id <> _booking_room_id
       AND other.status IN ('active', 'reserved', 'checked_in')
       AND daterange(other.check_in, other.check_out, '[)') && daterange(v_new_in, v_orig_out, '[)')
  ) THEN
    RAISE EXCEPTION 'Target room % is already assigned for part of this stay', v_target.room_number;
  END IF;

  v_event_block_id := v_br.event_block_id;
  v_event_booking_id := v_br.event_booking_id;
  IF v_event_block_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.event_room_blocks erb
     WHERE erb.id = v_event_block_id
       AND erb.property_id = v_br.property_id
       AND erb.booking_id = v_br.booking_id
       AND erb.status = 'checked_in'
  ) THEN
    RAISE EXCEPTION 'The linked event room is no longer checked in. Refresh before shifting.';
  END IF;

  SELECT fc.id INTO v_old_charge
    FROM public.folio_charges fc
    JOIN public.folios f ON f.id = fc.folio_id
   WHERE f.booking_id = v_br.booking_id
     AND f.status NOT IN ('void')
     AND COALESCE(f.is_deleted,false) = false
     AND fc.charge_type = 'room'
     AND fc.source_table = 'booking_rooms'
     AND fc.source_id = _booking_room_id
     AND COALESCE(fc.is_wiped,false) = false
   LIMIT 1;

  IF v_mode = 'mid_stay' THEN
    UPDATE public.booking_rooms
       SET check_out = v_eff,
           event_block_id = NULL,
           event_booking_id = CASE WHEN v_event_block_id IS NULL THEN event_booking_id ELSE NULL END,
           updated_at = v_now
     WHERE id = _booking_room_id;
  ELSIF v_event_block_id IS NOT NULL THEN
    UPDATE public.booking_rooms
       SET event_block_id = NULL,
           event_booking_id = NULL,
           updated_at = v_now
     WHERE id = _booking_room_id;
  END IF;

  UPDATE public.booking_rooms
     SET status = 'shifted',
         end_date = v_now,
         shifted_to_room_id = _to_room_id,
         shifted_at = v_now,
         shifted_by = v_actor,
         actual_check_out = COALESCE(actual_check_out, v_now),
         updated_at = v_now
   WHERE id = _booking_room_id;

  INSERT INTO public.booking_rooms(
    booking_id, property_id, room_id, category_id, tariff_id, meal_plan,
    rate, adults, children, check_in, check_out, check_in_time, check_out_time,
    actual_check_in, status, start_date, event_booking_id, event_block_id
  ) VALUES (
    v_br.booking_id, v_br.property_id, _to_room_id,
    COALESCE(v_target.category_id, v_br.category_id),
    v_br.tariff_id, v_br.meal_plan,
    COALESCE(_new_rate, v_br.rate),
    v_br.adults, v_br.children, v_new_in, v_orig_out,
    v_br.check_in_time, v_br.check_out_time,
    CASE WHEN v_booking.status = 'checked_in'
         THEN COALESCE(v_br.actual_check_in, v_booking.checked_in_at, v_now)
         ELSE NULL END,
    CASE WHEN v_br.status = 'checked_in' THEN 'checked_in' ELSE 'active' END,
    v_now, v_event_booking_id, v_event_block_id
  )
  RETURNING id INTO v_new_br_id;

  IF v_event_block_id IS NOT NULL THEN
    SELECT rc.name INTO v_target_category_name
      FROM public.room_categories rc
     WHERE rc.id = v_target.category_id;

    UPDATE public.event_room_blocks
       SET room_id = _to_room_id,
           room_number = v_target.room_number,
           room_category = v_target_category_name,
           special_rate = COALESCE(_new_rate, v_br.rate),
           checkin_date = v_new_in,
           checkout_date = v_orig_out,
           updated_at = v_now
     WHERE id = v_event_block_id
       AND property_id = v_br.property_id;
  END IF;

  INSERT INTO public.room_shifts(
    property_id, booking_room_id, from_room_id, to_room_id, reason,
    old_rate, new_rate, tariff_choice, rate_applied, rate_type, shifted_by
  ) VALUES (
    v_br.property_id, _booking_room_id, v_br.room_id, _to_room_id, _reason,
    v_br.rate, COALESCE(_new_rate, v_br.rate), _tariff_choice,
    COALESCE(_new_rate, v_br.rate),
    CASE WHEN _tariff_choice = 'keep' THEN 'original_rate' ELSE 'new_rate' END,
    v_actor
  );

  IF v_mode = 'same_day' THEN
    SELECT fc.id INTO v_new_charge
      FROM public.folio_charges fc
      JOIN public.folios f ON f.id = fc.folio_id
     WHERE f.booking_id = v_br.booking_id
       AND f.status NOT IN ('void')
       AND COALESCE(f.is_deleted,false) = false
       AND fc.charge_type = 'room'
       AND fc.source_table = 'booking_rooms'
       AND fc.source_id = v_new_br_id
       AND COALESCE(fc.is_wiped,false) = false
     LIMIT 1;

    IF v_new_charge IS NULL AND v_old_charge IS NOT NULL THEN
      RAISE EXCEPTION 'Room shift could not be completed: the new room''s charge could not be created (the date may be closed in night audit, or the bill is already settled). Nothing was changed.';
    ELSIF v_new_charge IS NOT NULL THEN
      DELETE FROM public.folio_charges fc
       USING public.folios f
       WHERE f.id = fc.folio_id
         AND f.booking_id = v_br.booking_id
         AND f.status NOT IN ('settled','void')
         AND COALESCE(f.is_deleted,false) = false
         AND fc.charge_type = 'room'
         AND fc.source_table = 'booking_rooms'
         AND fc.source_id = _booking_room_id;
    END IF;
  END IF;

  UPDATE public.segment_bills
     SET room_id = _to_room_id
   WHERE booking_id = v_br.booking_id
     AND status = 'open'
     AND room_id IS DISTINCT FROM _to_room_id;

  IF v_booking.status = 'checked_in' THEN
    IF v_br.room_id IS NOT NULL THEN
      UPDATE public.rooms
         SET status = 'vacant', housekeeping_status = 'dirty', updated_at = v_now
       WHERE id = v_br.room_id;
    END IF;
    UPDATE public.rooms
       SET status = 'occupied', updated_at = v_now
     WHERE id = _to_room_id;
  END IF;

  SELECT count(*) INTO v_live_count
    FROM public.booking_rooms live
   WHERE live.booking_id = v_br.booking_id
     AND live.room_id = _to_room_id
     AND live.status IN ('active', 'checked_in');
  IF v_live_count <> 1 THEN
    RAISE EXCEPTION 'Room shift verification failed: expected one current target assignment, found %', v_live_count;
  END IF;

  RETURN v_new_br_id;
END
$function$;

REVOKE ALL ON FUNCTION public.shift_room(uuid, uuid, numeric, text, text, uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.shift_room(uuid, uuid, numeric, text, text, uuid, text, date) TO authenticated, service_role;