ALTER TABLE public.folios ADD COLUMN IF NOT EXISTS guest_name text;
COMMENT ON COLUMN public.folios.guest_name IS 'Guest name frozen when the bill is settled/finalised; invoices of closed bills print this.';

UPDATE public.folios f SET guest_name = g.name
  FROM public.bookings b JOIN public.guests g ON g.id = b.guest_id
 WHERE b.id = f.booking_id AND f.guest_name IS NULL AND f.status <> 'open';

CREATE OR REPLACE FUNCTION public.tg_folio_freeze_guest_name()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.booking_id IS NULL OR NEW.status = 'open' THEN
    RETURN NEW;
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.guest_name IS NULL THEN
      SELECT g.name INTO NEW.guest_name FROM public.bookings b JOIN public.guests g ON g.id=b.guest_id WHERE b.id=NEW.booking_id;
    END IF;
  ELSIF OLD.status = 'open' AND NEW.guest_name IS NOT DISTINCT FROM OLD.guest_name THEN
    SELECT g.name INTO NEW.guest_name FROM public.bookings b JOIN public.guests g ON g.id=b.guest_id WHERE b.id=NEW.booking_id;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_folio_freeze_guest_name ON public.folios;
CREATE TRIGGER trg_folio_freeze_guest_name BEFORE INSERT OR UPDATE OF status ON public.folios
  FOR EACH ROW EXECUTE FUNCTION public.tg_folio_freeze_guest_name();

CREATE OR REPLACE FUNCTION public.set_folio_guest_name(_folio_id uuid, _name text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _prop uuid;
BEGIN
  SELECT property_id INTO _prop FROM public.folios WHERE id=_folio_id;
  IF _prop IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF NOT public.staff_can_correct(_prop) THEN RAISE EXCEPTION 'You do not have access to this property'; END IF;
  UPDATE public.folios SET guest_name = NULLIF(btrim(_name),''), updated_at=now() WHERE id=_folio_id;
END $$;
GRANT EXECUTE ON FUNCTION public.set_folio_guest_name(uuid, text) TO authenticated;

-- undo_checkout: only re-activate real stay segments (skip shifted/cancelled/zero-night rows)
DO $mig$
DECLARE d text; n text;
BEGIN
  d := pg_get_functiondef('public.undo_checkout(uuid)'::regprocedure);
  n := replace(d,
$a$    WHERE booking_id = _booking_id AND room_id IS NOT NULL;$a$,
$b$    WHERE booking_id = _booking_id AND room_id IS NOT NULL
      AND COALESCE(status,'active') IN ('active','checked_in','checked_out','reserved')
      AND check_out > check_in;$b$);
  n := replace(n,
$a$         updated_at = now()
   WHERE booking_id = _booking_id;$a$,
$b$         updated_at = now()
   WHERE booking_id = _booking_id
     AND COALESCE(status,'active') IN ('active','checked_in','checked_out','reserved')
     AND check_out > check_in;$b$);
  IF n = d OR position('check_out > check_in;' in n) = 0 THEN RAISE EXCEPTION 'undo_checkout patch did not apply'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.split_room_night(uuid,date,numeric)'::regprocedure);
  n := replace(d,
$a$  IF NOT FOUND OR v_booking.status IN ('cancelled','checked_out','no_show') THEN
    RAISE EXCEPTION 'Tariff can only be changed on an active booking';
  END IF;$a$,
$b$  IF NOT FOUND OR v_booking.status IN ('cancelled','no_show') THEN
    RAISE EXCEPTION 'Tariff can only be changed on an active booking';
  END IF;
  IF v_booking.status = 'checked_out' AND NOT (
       public.is_superadmin(auth.uid()) OR public.is_global_owner(auth.uid())
    OR public.has_role(auth.uid(),'owner'::app_role) OR public.has_role(auth.uid(),'manager'::app_role)
  ) THEN
    RAISE EXCEPTION 'Booking is checked out — only Owner/Manager can correct the tariff';
  END IF;$b$);
  n := replace(n, $a$'Tariff can only be changed while the bill is OPEN'$a$,
    $b$'Bill is already settled — use Undo Checkout / reopen the bill first, then edit the tariff'$b$);
  IF n = d THEN RAISE EXCEPTION 'split_room_night patch did not apply'; END IF;
  EXECUTE n;

  d := pg_get_functiondef('public.tg_booking_rooms_no_overlap()'::regprocedure);
  n := regexp_replace(d, E'  RETURN NEW;\\nEND;\\s*\\$function\\$\\s*$',
$b$  -- (3) Same booking + same room: never two live segments for the same night.
  SELECT br.id INTO v_conflict_id
    FROM public.booking_rooms br
   WHERE br.booking_id = NEW.booking_id
     AND br.room_id = NEW.room_id
     AND br.id IS DISTINCT FROM NEW.id
     AND COALESCE(br.status, 'active') IN ('active','reserved','checked_in')
     AND br.check_in < NEW.check_out
     AND br.check_out > NEW.check_in
   LIMIT 1;
  IF v_conflict_id IS NOT NULL THEN
    RAISE EXCEPTION 'This room already has these night(s) on the same booking — duplicate night blocked'
      USING ERRCODE = '23P01';
  END IF;

  RETURN NEW;
END;
$function$
$b$);
  IF n = d THEN RAISE EXCEPTION 'overlap patch did not apply'; END IF;
  EXECUTE n;
END
$mig$;