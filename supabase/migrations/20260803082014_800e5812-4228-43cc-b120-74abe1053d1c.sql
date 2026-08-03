-- 1) Overlap guard: never treat two date-slices of the SAME booking as a clash.
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

  -- (1) Datetime-range overlap with another BOOKING's assignment.
  SELECT br.id, b.booking_number
    INTO v_conflict_id, v_conflict_booking
    FROM public.booking_rooms br
    JOIN public.bookings b ON b.id = br.booking_id
   WHERE br.room_id = NEW.room_id
     AND br.id IS DISTINCT FROM NEW.id
     AND br.booking_id IS DISTINCT FROM NEW.booking_id
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

  -- (2) Physical occupancy guard (other bookings only).
  SELECT br.id, b.booking_number
    INTO v_conflict_id, v_conflict_booking
    FROM public.booking_rooms br
    JOIN public.bookings b ON b.id = br.booking_id
   WHERE br.room_id = NEW.room_id
     AND br.id IS DISTINCT FROM NEW.id
     AND br.booking_id IS DISTINCT FROM NEW.booking_id
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

-- 2) Per-night tariff edit. Slices the booking_rooms segment around the target
--    night so that night carries its own rate. Charge rows + GST for every
--    resulting slice are produced by the existing seed trigger
--    (seed_room_charge_for_booking_room -> get_gst_rate), so no new pricing or
--    tax logic here. Same-room, rate-only: no room_shifts entry, no room status
--    change, no actual_check_out stamp.
CREATE OR REPLACE FUNCTION public.split_room_night(
  _booking_room_id uuid,
  _night date,
  _new_rate numeric
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_br      public.booking_rooms%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_out     date;
  v_target  uuid;
BEGIN
  IF _new_rate IS NULL OR _new_rate < 0 THEN
    RAISE EXCEPTION 'A valid nightly tariff is required';
  END IF;

  SELECT * INTO v_br FROM public.booking_rooms WHERE id = _booking_room_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Room segment not found';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_br.booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.status IN ('cancelled','checked_out','no_show') THEN
    RAISE EXCEPTION 'Tariff can only be changed on an active booking';
  END IF;

  -- Permission: the folio-edit grant from the RBAC grid, not an owner override.
  IF NOT public.has_permission(auth.uid(), v_br.property_id, 'invoices', 'edit') THEN
    RAISE EXCEPTION 'You do not have permission to edit the tariff';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.folios f
     WHERE f.booking_id = v_br.booking_id
       AND COALESCE(f.is_deleted,false) = false
       AND f.status = 'open'
  ) THEN
    RAISE EXCEPTION 'Tariff can only be changed while the bill is OPEN';
  END IF;

  IF public.is_day_locked(v_br.property_id, _night) THEN
    RAISE EXCEPTION 'That date is locked by night audit';
  END IF;

  IF _night < v_br.check_in OR _night >= v_br.check_out THEN
    RAISE EXCEPTION 'That night is not part of this stay';
  END IF;

  v_out := v_br.check_out;

  -- Single-night segment: nothing to slice.
  IF (v_out - v_br.check_in) <= 1 THEN
    UPDATE public.booking_rooms
       SET rate = _new_rate, updated_at = now()
     WHERE id = v_br.id;
    RETURN v_br.id;
  END IF;

  IF _night = v_br.check_in THEN
    -- Head night keeps the original row; the remainder becomes a new slice.
    UPDATE public.booking_rooms
       SET check_out = _night + 1, rate = _new_rate, updated_at = now()
     WHERE id = v_br.id;
    v_target := v_br.id;

    INSERT INTO public.booking_rooms(
      booking_id, property_id, room_id, category_id, tariff_id, meal_plan,
      rate, adults, children, extra_beds, check_in, check_out,
      check_in_time, check_out_time, status, start_date
    ) VALUES (
      v_br.booking_id, v_br.property_id, v_br.room_id, v_br.category_id,
      v_br.tariff_id, v_br.meal_plan, v_br.rate, v_br.adults, v_br.children,
      0, _night + 1, v_out, v_br.check_in_time, v_br.check_out_time,
      COALESCE(v_br.status,'active'), now()
    );
  ELSE
    -- Truncate the original to the nights before the edited one.
    UPDATE public.booking_rooms
       SET check_out = _night, updated_at = now()
     WHERE id = v_br.id;

    INSERT INTO public.booking_rooms(
      booking_id, property_id, room_id, category_id, tariff_id, meal_plan,
      rate, adults, children, extra_beds, check_in, check_out,
      check_in_time, check_out_time, status, start_date
    ) VALUES (
      v_br.booking_id, v_br.property_id, v_br.room_id, v_br.category_id,
      v_br.tariff_id, v_br.meal_plan, _new_rate, v_br.adults, v_br.children,
      0, _night, _night + 1, v_br.check_in_time, v_br.check_out_time,
      COALESCE(v_br.status,'active'), now()
    ) RETURNING id INTO v_target;

    -- Tail slice at the original rate, when the edited night is in the middle.
    IF (_night + 1) < v_out THEN
      INSERT INTO public.booking_rooms(
        booking_id, property_id, room_id, category_id, tariff_id, meal_plan,
        rate, adults, children, extra_beds, check_in, check_out,
        check_in_time, check_out_time, status, start_date
      ) VALUES (
        v_br.booking_id, v_br.property_id, v_br.room_id, v_br.category_id,
        v_br.tariff_id, v_br.meal_plan, v_br.rate, v_br.adults, v_br.children,
        0, _night + 1, v_out, v_br.check_in_time, v_br.check_out_time,
        COALESCE(v_br.status,'active'), now()
      );
    END IF;
  END IF;

  RETURN v_target;
END;
$function$;

REVOKE ALL ON FUNCTION public.split_room_night(uuid, date, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.split_room_night(uuid, date, numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.split_room_night(uuid, date, numeric) TO service_role;