
-- =========================================================
-- 1) Overlap-prevention + race-condition trigger on booking_rooms
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_booking_rooms_no_overlap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_conflict_id uuid;
  v_conflict_booking text;
BEGIN
  -- Only validate active assignments with a real room + date range
  IF NEW.room_id IS NULL OR NEW.check_in IS NULL OR NEW.check_out IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.status, 'active') NOT IN ('active','reserved','checked_in') THEN
    RETURN NEW;
  END IF;
  IF NEW.check_out <= NEW.check_in THEN
    RAISE EXCEPTION 'check_out must be after check_in';
  END IF;

  -- Serialise concurrent writes for the same room within this transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.room_id::text, 42));

  SELECT br.id, b.booking_number
    INTO v_conflict_id, v_conflict_booking
    FROM public.booking_rooms br
    JOIN public.bookings b ON b.id = br.booking_id
   WHERE br.room_id = NEW.room_id
     AND br.id IS DISTINCT FROM NEW.id
     AND COALESCE(br.status, 'active') IN ('active','reserved','checked_in')
     AND COALESCE(b.status, 'reserved') NOT IN ('cancelled','checked_out','no_show')
     AND br.check_in  < NEW.check_out
     AND br.check_out > NEW.check_in
   LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Room already booked for the selected dates (conflicts with booking %)',
      COALESCE(v_conflict_booking, v_conflict_id::text)
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS booking_rooms_no_overlap ON public.booking_rooms;
CREATE TRIGGER booking_rooms_no_overlap
  BEFORE INSERT OR UPDATE OF room_id, check_in, check_out, status
  ON public.booking_rooms
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_booking_rooms_no_overlap();

-- =========================================================
-- 2) Atomic Room Shift RPC
-- =========================================================
CREATE OR REPLACE FUNCTION public.shift_room(
  _booking_room_id uuid,
  _to_room_id     uuid,
  _new_rate       numeric,
  _tariff_choice  text,
  _reason         text,
  _shifted_by     uuid
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  -- Lock the source booking_room and its booking
  SELECT * INTO v_br
    FROM public.booking_rooms
   WHERE id = _booking_room_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking room % not found', _booking_room_id;
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

  -- Lock the target room for the rest of this transaction (race-safe)
  PERFORM pg_advisory_xact_lock(hashtextextended(_to_room_id::text, 42));

  -- Close out the old booking_room (audit trail)
  UPDATE public.booking_rooms
     SET status              = 'shifted',
         end_date            = v_now,
         shifted_to_room_id  = _to_room_id,
         shifted_at          = v_now,
         shifted_by          = _shifted_by,
         actual_check_out    = COALESCE(actual_check_out, v_now),
         updated_at          = v_now
   WHERE id = _booking_room_id;

  -- Create the new active booking_room (overlap trigger validates target room)
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
    CASE WHEN v_booking.status = 'checked_in' THEN v_now ELSE NULL END,
    'active', v_now
  )
  RETURNING id INTO v_new_br_id;

  -- Log the shift
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

  -- Update room status only when the booking is currently checked-in
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
END $$;

REVOKE ALL ON FUNCTION public.shift_room(uuid,uuid,numeric,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.shift_room(uuid,uuid,numeric,text,text,uuid) TO authenticated;

-- =========================================================
-- 3) Cancellation auto-release trigger on bookings
-- =========================================================
CREATE OR REPLACE FUNCTION public.tg_booking_cancel_release_rooms()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    -- Close active room assignments
    UPDATE public.booking_rooms
       SET status     = 'cancelled',
           end_date   = COALESCE(end_date, now()),
           updated_at = now()
     WHERE booking_id = NEW.id
       AND COALESCE(status, 'active') IN ('active','reserved','checked_in');

    -- Vacate any rooms still showing occupied/reserved for this booking
    UPDATE public.rooms r
       SET status              = 'vacant',
           housekeeping_status = CASE WHEN r.status = 'occupied' THEN 'dirty'
                                      ELSE r.housekeeping_status END,
           updated_at          = now()
     WHERE r.id IN (
            SELECT br.room_id
              FROM public.booking_rooms br
             WHERE br.booking_id = NEW.id
               AND br.room_id IS NOT NULL
           )
       AND r.status IN ('occupied','reserved');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS booking_cancel_release_rooms ON public.bookings;
CREATE TRIGGER booking_cancel_release_rooms
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.tg_booking_cancel_release_rooms();
