CREATE OR REPLACE FUNCTION public.tg_booking_rooms_close_prior_on_shift()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'shifted' AND OLD.status IS DISTINCT FROM 'shifted' AND NEW.room_id IS NOT NULL THEN
    UPDATE public.booking_rooms
       SET actual_check_out = COALESCE(NEW.actual_check_out, now()), updated_at = now()
     WHERE booking_id = NEW.booking_id
       AND id <> NEW.id
       AND room_id = NEW.room_id
       AND actual_check_out IS NULL
       AND status IN ('active','checked_in')
       AND check_out <= NEW.check_out;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS booking_rooms_close_prior_on_shift ON public.booking_rooms;
CREATE TRIGGER booking_rooms_close_prior_on_shift
AFTER UPDATE OF status ON public.booking_rooms
FOR EACH ROW EXECUTE FUNCTION public.tg_booking_rooms_close_prior_on_shift();

CREATE OR REPLACE FUNCTION public.tg_booking_rooms_inherit_actual_check_in()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF NEW.actual_check_in IS NULL AND NEW.room_id IS NOT NULL THEN
    SELECT s.actual_check_in INTO NEW.actual_check_in
      FROM public.booking_rooms s
     WHERE s.booking_id = NEW.booking_id
       AND s.room_id = NEW.room_id
       AND s.actual_check_in IS NOT NULL
       AND s.actual_check_out IS NULL
       AND s.status IN ('active','checked_in')
     ORDER BY s.actual_check_in LIMIT 1;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS booking_rooms_inherit_actual_check_in ON public.booking_rooms;
CREATE TRIGGER booking_rooms_inherit_actual_check_in
BEFORE INSERT ON public.booking_rooms
FOR EACH ROW EXECUTE FUNCTION public.tg_booking_rooms_inherit_actual_check_in();