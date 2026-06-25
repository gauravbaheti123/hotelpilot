
-- Allow multiple folios per booking (for split-bill at checkout).
ALTER TABLE public.folios DROP CONSTRAINT IF EXISTS folios_booking_id_key;

-- Partial unique: ensure only ONE active (non-deleted, non-void) folio per booking,
-- so existing flows that fetch "the" folio stay deterministic.
CREATE UNIQUE INDEX IF NOT EXISTS folios_active_per_booking_uniq
  ON public.folios (booking_id)
  WHERE is_deleted = false AND status <> 'void';

-- get_or_create_folio: prefer an ACTIVE folio. Only create a new one when no
-- active folio exists. This keeps backward compatibility after splits/voids.
CREATE OR REPLACE FUNCTION public.get_or_create_folio(_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_prop uuid;
BEGIN
  SELECT id INTO v_id
    FROM public.folios
   WHERE booking_id = _booking_id
     AND is_deleted = false
     AND status <> 'void'
   ORDER BY created_at DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;
  SELECT property_id INTO v_prop FROM public.bookings WHERE id = _booking_id;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  INSERT INTO public.folios (property_id, booking_id, created_by)
    VALUES (v_prop, _booking_id, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $function$;
