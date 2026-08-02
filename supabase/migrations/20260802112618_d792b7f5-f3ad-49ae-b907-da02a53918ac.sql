-- 1. Mobile normalization trigger on guests
CREATE OR REPLACE FUNCTION public.tg_guests_normalize_mobile()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE m text;
BEGIN
  m := regexp_replace(COALESCE(NEW.mobile, ''), '\D', '', 'g');
  IF length(m) > 10 AND left(m, 2) = '91' THEN m := substr(m, 3); END IF;
  WHILE length(m) > 10 AND left(m, 1) = '0' LOOP m := substr(m, 2); END LOOP;
  IF length(m) = 11 AND left(m, 1) = '0' THEN m := substr(m, 2); END IF;
  NEW.mobile := NULLIF(m, '');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guests_normalize_mobile ON public.guests;
CREATE TRIGGER trg_guests_normalize_mobile
BEFORE INSERT OR UPDATE OF mobile ON public.guests
FOR EACH ROW EXECUTE FUNCTION public.tg_guests_normalize_mobile();

-- 2. segment_bills.guest_id
ALTER TABLE public.segment_bills
  ADD COLUMN IF NOT EXISTS guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_segment_bills_guest_id ON public.segment_bills(guest_id);

UPDATE public.segment_bills sb
   SET guest_id = b.guest_id
  FROM public.bookings b
 WHERE sb.booking_id = b.id
   AND sb.guest_id IS NULL
   AND b.guest_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_segment_bills_fill_guest()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.guest_id IS NULL AND NEW.booking_id IS NOT NULL THEN
    SELECT b.guest_id INTO NEW.guest_id FROM public.bookings b WHERE b.id = NEW.booking_id;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_segment_bills_fill_guest ON public.segment_bills;
CREATE TRIGGER trg_segment_bills_fill_guest
BEFORE INSERT OR UPDATE OF booking_id ON public.segment_bills
FOR EACH ROW EXECUTE FUNCTION public.tg_segment_bills_fill_guest();