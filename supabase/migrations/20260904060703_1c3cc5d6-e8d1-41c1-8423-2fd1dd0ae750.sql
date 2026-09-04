CREATE OR REPLACE FUNCTION public.stay_ongoing(_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE((
    SELECT b.status::text IN ('reserved','checked_in')
    FROM public.bookings b
    WHERE b.id = _booking_id
  ), false)
$function$;