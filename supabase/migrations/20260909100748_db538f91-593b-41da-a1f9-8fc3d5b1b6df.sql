CREATE OR REPLACE FUNCTION public.shift_room(_booking_room_id uuid, _to_room_id uuid, _new_rate numeric, _tariff_choice text, _reason text, _shifted_by uuid, _mode text DEFAULT 'same_day'::text, _effective_date date DEFAULT NULL::date)
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
  v_mode      text := COALESCE(NULLIF(btrim(_mode), ''), 'same_day');
  v_eff       date;
  v_new_in    date;
  v_orig_out  date;
  v_new_charge uuid;
  v_old_charge uuid;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) = 0 THEN
    RAISE EXCEPTION 'Reason is required for room shift';
  END IF;
  IF _to_room_id IS NULL THEN
    RAISE EXCEPTION 'Target room is required';
  END IF;
  IF v_mode NOT IN ('same_day','mid_stay') THEN
    RAISE EXCEPTION 'Unknown shift mode: %', v_mode;
  END IF;

  SELECT * INTO v_br FROM public.booking_rooms WHERE id = _booking_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking room % not found', _booking_room_id;
  END IF;

  IF COALESCE(v_br.status, 'active') <> 'active' THEN
    RAISE EXCEPTION 'This room assignment is no longer active (status: %). Refresh and shift the current room.', v_br.status;
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_br.booking_id FOR UPDATE;

  SELECT * INTO v_target FROM public.rooms WHERE id = _to_room_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target room not found';
  END IF;

  IF v_target.id = v_br.room_id THEN
    RAISE EXCEPTION 'Target room is the same as the current room';
  END IF;

  v_new_in   := v_br.check_in;
  v_orig_out := v_br.check_out;   -- the guest's real departure date

  IF v_mode = 'mid_stay' THEN
    v_eff := COALESCE(_effective_date, CURRENT_DATE);
    IF v_eff <= v_br.check_in THEN
      RAISE EXCEPTION 'Shift date must be after the current room''s check-in date (%)', v_br.check_in;
    END IF;
    IF v_eff >= v_br.check_out THEN
      RAISE EXCEPTION 'Shift date must be before the check-out date (%)', v_br.check_out;
    END IF;
    v_new_in := v_eff;
    UPDATE public.booking_rooms
       SET check_out = v_eff, updated_at = v_now
     WHERE id = _booking_room_id;
    SELECT * INTO v_br FROM public.booking_rooms WHERE id = _booking_room_id;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(_to_room_id::text, 42));

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
    v_br.adults, v_br.children, v_new_in, v_orig_out,
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

    IF v_new_charge IS NULL THEN
      IF v_old_charge IS NOT NULL THEN
        RAISE EXCEPTION 'Room shift could not be completed: the new room''s charge could not be created (the date may be closed in night audit, or the bill is already settled). Nothing was changed.';
      END IF;
    ELSE
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
    UPDATE public.rooms SET status = 'occupied', updated_at = v_now WHERE id = _to_room_id;
  END IF;

  RETURN v_new_br_id;
END
$function$;