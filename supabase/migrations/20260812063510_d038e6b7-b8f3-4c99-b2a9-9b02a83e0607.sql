CREATE OR REPLACE FUNCTION public.stay_ongoing(_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE((
    SELECT b.status::text IN ('reserved','checked_in')
       AND b.check_out > ((now() AT TIME ZONE 'Asia/Kolkata')::date)
    FROM public.bookings b
    WHERE b.id = _booking_id
  ), false)
$$;

CREATE OR REPLACE FUNCTION public.tg_folios_balance_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_ongoing boolean := false;
  v_explicit boolean := false;
BEGIN
  NEW.balance_amount := ROUND((COALESCE(NEW.total_amount,0) - COALESCE(NEW.paid_amount,0))::numeric, 2);

  IF NEW.booking_id IS NOT NULL THEN
    v_ongoing := public.stay_ongoing(NEW.booking_id);
  END IF;

  -- Explicit settlement: the caller asked for 'settled' (checkout / staff action),
  -- not merely a balance that happens to hit zero.
  v_explicit := (NEW.status = 'settled')
                AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'settled');

  IF NEW.status NOT IN ('void','refunded') THEN
    IF COALESCE(NEW.is_reopened, false) AND NEW.status <> 'settled' THEN
      NEW.status := 'open';
      NEW.settled_at := NULL;
    ELSIF NEW.balance_amount <= 0.01 AND COALESCE(NEW.paid_amount,0) > 0 THEN
      IF v_ongoing AND NOT v_explicit AND (TG_OP = 'INSERT' OR OLD.status <> 'settled') THEN
        -- Advance fully paid but the guest is still in house: keep the bill open.
        NEW.status := 'open';
        NEW.settled_at := NULL;
      ELSE
        NEW.status := 'settled';
        IF NEW.settled_at IS NULL THEN NEW.settled_at := now(); END IF;
        NEW.is_reopened := false;
      END IF;
    ELSIF NEW.status = 'due' THEN
      IF NEW.settled_at IS NULL THEN NEW.settled_at := now(); END IF;
      NEW.is_reopened := false;
    ELSE
      NEW.status := 'open';
      NEW.settled_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$function$;