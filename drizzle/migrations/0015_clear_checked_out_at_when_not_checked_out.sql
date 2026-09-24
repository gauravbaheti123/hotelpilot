-- A booking that is not in the checked_out state must never carry a checkout
-- timestamp. Undo-checkout and any later edit now leave it NULL.
CREATE OR REPLACE FUNCTION public.tg_force_server_time_bookings()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'checked_out' THEN
    IF OLD.status IS DISTINCT FROM 'checked_out' OR NEW.checked_out_at IS NULL THEN
      NEW.checked_out_at := now();
    ELSE
      NEW.checked_out_at := OLD.checked_out_at;
    END IF;
  ELSE
    NEW.checked_out_at := NULL;
  END IF;
  RETURN NEW;
END $function$;