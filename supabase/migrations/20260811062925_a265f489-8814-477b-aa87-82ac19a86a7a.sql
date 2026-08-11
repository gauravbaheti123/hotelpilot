CREATE OR REPLACE FUNCTION public.tg_booking_cancel_release_rooms()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.status = 'cancelled' AND OLD.status IS DISTINCT FROM 'cancelled' THEN
    UPDATE public.booking_rooms
       SET status     = 'cancelled',
           end_date   = COALESCE(end_date, now()),
           updated_at = now()
     WHERE booking_id = NEW.id
       AND COALESCE(status, 'active') IN ('active','reserved','checked_in');

    -- room_status enum = vacant | occupied | blocked | maintenance
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
       AND r.status IN ('occupied','blocked');
  END IF;
  RETURN NEW;
END $function$;