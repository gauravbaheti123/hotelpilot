CREATE OR REPLACE FUNCTION public.tg_booking_rooms_no_overlap()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_conflict_id uuid;
  v_conflict_booking text;
BEGIN
  IF NEW.room_id IS NULL OR NEW.check_in IS NULL OR NEW.check_out IS NULL THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.status, 'active') NOT IN ('active','reserved','checked_in') THEN
    RETURN NEW;
  END IF;
  IF NEW.check_out <= NEW.check_in THEN
    RAISE EXCEPTION 'check_out must be after check_in';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.room_id::text, 42));

  -- (1) Date-range overlap with any other active/reserved/checked_in assignment
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

  -- (2) Physical-occupancy guard: room cannot host two live guests at once,
  -- regardless of the new assignment's dates. Excludes the same booking
  -- (extensions/edits) and rows already marked shifted/cancelled/checked_out
  -- so shift_room() remains safe.
  SELECT br.id, b.booking_number
    INTO v_conflict_id, v_conflict_booking
    FROM public.booking_rooms br
    JOIN public.bookings b ON b.id = br.booking_id
   WHERE br.room_id = NEW.room_id
     AND br.id IS DISTINCT FROM NEW.id
     AND br.booking_id IS DISTINCT FROM NEW.booking_id
     AND b.status = 'checked_in'
     AND COALESCE(br.status,'active') IN ('active','checked_in')
   LIMIT 1;

  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION
      'Room is currently occupied by an active checked-in guest (booking %). Check them out or shift them first.',
      COALESCE(v_conflict_booking, v_conflict_id::text)
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END $function$;