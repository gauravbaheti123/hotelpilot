CREATE OR REPLACE FUNCTION public.split_room_night(_booking_room_id uuid, _night date, _new_rate numeric)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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

  IF NOT EXISTS (
    SELECT 1 FROM public.folios f
     WHERE f.booking_id = v_br.booking_id
       AND COALESCE(f.is_deleted,false) = false
       AND f.status = 'open'
  ) THEN
    RAISE EXCEPTION 'Tariff can only be changed while the bill is OPEN';
  END IF;

  -- Pre-checkout edit: the booking is active and the bill is still open, so the
  -- Bookings -> Edit grant is enough. Invoices -> Edit still qualifies.
  IF NOT (
       public.has_permission(auth.uid(), v_br.property_id, 'bookings', 'edit')
    OR public.has_permission(auth.uid(), v_br.property_id, 'invoices', 'edit')
  ) THEN
    RAISE EXCEPTION 'You do not have permission to edit the tariff';
  END IF;

  IF public.is_day_locked(v_br.property_id, _night) THEN
    RAISE EXCEPTION 'That date is locked by night audit';
  END IF;

  IF _night < v_br.check_in OR _night >= v_br.check_out THEN
    RAISE EXCEPTION 'That night is not part of this stay';
  END IF;

  v_out := v_br.check_out;

  IF (v_out - v_br.check_in) <= 1 THEN
    UPDATE public.booking_rooms
       SET rate = _new_rate, updated_at = now()
     WHERE id = v_br.id;
    RETURN v_br.id;
  END IF;

  IF _night = v_br.check_in THEN
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
$fn$;

REVOKE ALL ON FUNCTION public.split_room_night(uuid, date, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.split_room_night(uuid, date, numeric) TO authenticated;