CREATE OR REPLACE FUNCTION public.tg_folios_sync_booking()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.booking_id IS NOT NULL THEN PERFORM public.sync_booking_balance(OLD.booking_id); END IF;
    RETURN OLD;
  END IF;
  IF NEW.booking_id IS NOT NULL THEN PERFORM public.sync_booking_balance(NEW.booking_id); END IF;
  RETURN NEW;
END $function$;

DROP TRIGGER IF EXISTS folios_sync_booking_delete ON public.folios;
CREATE TRIGGER folios_sync_booking_delete
AFTER DELETE ON public.folios
FOR EACH ROW EXECUTE FUNCTION public.tg_folios_sync_booking();