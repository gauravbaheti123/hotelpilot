-- tg_force_server_time_bookings pinned checked_out_at to its OLD value for
-- every non-checkout update, so undo_checkout could never clear it. A booking
-- back in 'checked_in' kept a stale checkout timestamp, which made the undo
-- grace window and checkout screens treat it as already checked out.
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
  ELSIF OLD.status = 'checked_out' THEN
    -- Leaving the checked_out state (undo checkout) clears the stamp.
    NEW.checked_out_at := NULL;
  ELSE
    NEW.checked_out_at := OLD.checked_out_at;
  END IF;
  RETURN NEW;
END $function$;