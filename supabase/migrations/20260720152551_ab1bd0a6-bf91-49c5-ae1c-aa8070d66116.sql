
-- 1. Extend charge_type check to allow extra_bed
ALTER TABLE public.folio_charges DROP CONSTRAINT IF EXISTS folio_charges_charge_type_check;
ALTER TABLE public.folio_charges ADD CONSTRAINT folio_charges_charge_type_check
  CHECK (charge_type = ANY (ARRAY['room','food','extra','extra_bed','discount','tax']));

-- 2. booking_extra_beds table
CREATE TABLE IF NOT EXISTS public.booking_extra_beds (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  quantity integer NOT NULL DEFAULT 1 CHECK (quantity > 0),
  rate_per_night numeric(12,2) NOT NULL CHECK (rate_per_night >= 0),
  added_from_date date NOT NULL,
  added_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_wiped boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_beb_booking ON public.booking_extra_beds(booking_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.booking_extra_beds TO authenticated;
GRANT ALL ON public.booking_extra_beds TO service_role;

ALTER TABLE public.booking_extra_beds ENABLE ROW LEVEL SECURITY;

CREATE POLICY "beb_view" ON public.booking_extra_beds FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'view'));
CREATE POLICY "beb_create" ON public.booking_extra_beds FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'create')
          OR public.has_permission(auth.uid(), property_id, 'bookings', 'edit'));
CREATE POLICY "beb_edit" ON public.booking_extra_beds FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'bookings', 'edit'));
CREATE POLICY "beb_delete" ON public.booking_extra_beds FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'bookings', 'delete'));

DROP TRIGGER IF EXISTS trg_beb_updated_at ON public.booking_extra_beds;
CREATE TRIGGER trg_beb_updated_at BEFORE UPDATE ON public.booking_extra_beds
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 3. Seed function — mirrors seed_room_charge_for_booking_room
CREATE OR REPLACE FUNCTION public.seed_extra_bed_charge(_beb_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
DECLARE
  v_beb public.booking_extra_beds%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_folio_id uuid; v_existing_id uuid;
  v_nights int; v_gross numeric; v_amount numeric; v_gst_amount numeric;
  v_gst_rate numeric; v_nightly numeric; v_taxable numeric;
  v_from date;
BEGIN
  SELECT * INTO v_beb FROM public.booking_extra_beds WHERE id = _beb_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_beb.booking_id;
  IF NOT FOUND OR v_booking.status IN ('cancelled','no_show') THEN RETURN NULL; END IF;

  -- Locate existing folio (do not create — booking_rooms trigger already seeds one)
  SELECT f.id INTO v_folio_id FROM public.folios f
    WHERE f.booking_id = v_beb.booking_id
      AND COALESCE(f.is_deleted,false) = false AND f.status <> 'void'
    ORDER BY f.created_at DESC LIMIT 1;
  IF v_folio_id IS NULL THEN
    INSERT INTO public.folios (property_id, booking_id, created_by)
    VALUES (v_beb.property_id, v_beb.booking_id, auth.uid())
    RETURNING id INTO v_folio_id;
  END IF;

  -- Find existing seeded row
  SELECT id INTO v_existing_id FROM public.folio_charges
   WHERE folio_id = v_folio_id
     AND source_table = 'booking_extra_beds' AND source_id = v_beb.id
     AND COALESCE(is_wiped,false) = false
   LIMIT 1;

  -- If wiped, remove the seeded charge and exit
  IF v_beb.is_wiped THEN
    IF v_existing_id IS NOT NULL THEN
      UPDATE public.folio_charges
         SET is_wiped = true, wiped_at = now()
       WHERE id = v_existing_id;
    END IF;
    RETURN v_existing_id;
  END IF;

  v_from := GREATEST(v_beb.added_from_date, v_booking.check_in);
  v_nights := GREATEST(1, (v_booking.check_out - v_from));
  v_nightly := COALESCE(v_beb.rate_per_night, 0) * COALESCE(v_beb.quantity, 1);

  IF v_nightly <= 0 THEN
    IF v_existing_id IS NOT NULL THEN
      UPDATE public.folio_charges SET is_wiped = true, wiped_at = now() WHERE id = v_existing_id;
    END IF;
    RETURN NULL;
  END IF;

  IF COALESCE(v_booking.rate_type,'exclusive') = 'inclusive' THEN
    v_gst_rate := COALESCE(public.get_gst_rate(v_beb.property_id, 'room', v_nightly), 0);
    v_taxable  := ROUND((v_nightly / (1 + v_gst_rate/100))::numeric, 2);
    v_gst_rate := COALESCE(public.get_gst_rate(v_beb.property_id, 'room', v_taxable), v_gst_rate);
    v_gross      := v_nights * v_nightly;
    v_amount     := ROUND((v_gross / (1 + v_gst_rate/100))::numeric, 2);
    v_gst_amount := ROUND((v_gross - v_amount)::numeric, 2);
  ELSE
    v_gst_rate   := COALESCE(public.get_gst_rate(v_beb.property_id, 'room', v_nightly), 0);
    v_gross      := v_nights * v_nightly;
    v_amount     := v_gross;
    v_gst_amount := ROUND((v_gross * v_gst_rate / 100)::numeric, 2);
  END IF;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.folio_charges
       SET description = 'Extra Bed × ' || v_beb.quantity || ' · ' || v_nights || ' night(s)',
           qty = v_nights, rate = v_nightly, amount = v_amount,
           gst_rate = v_gst_rate, gst_amount = v_gst_amount, charged_on = v_from
     WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.folio_charges(
    folio_id, charge_type, description, qty, rate, amount,
    gst_rate, gst_amount, charged_on, source_table, source_id, created_by
  ) VALUES (
    v_folio_id, 'extra_bed',
    'Extra Bed × ' || v_beb.quantity || ' · ' || v_nights || ' night(s)',
    v_nights, v_nightly, v_amount, v_gst_rate, v_gst_amount, v_from,
    'booking_extra_beds', v_beb.id, COALESCE(v_beb.added_by, auth.uid())
  ) RETURNING id INTO v_existing_id;
  RETURN v_existing_id;
END $fn$;

CREATE OR REPLACE FUNCTION public.tg_seed_extra_bed()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $fn$
BEGIN
  IF TG_OP = 'DELETE' THEN
    UPDATE public.folio_charges
       SET is_wiped = true, wiped_at = now()
     WHERE source_table = 'booking_extra_beds' AND source_id = OLD.id
       AND COALESCE(is_wiped,false) = false;
    RETURN OLD;
  END IF;
  PERFORM public.seed_extra_bed_charge(NEW.id);
  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_seed_extra_bed ON public.booking_extra_beds;
CREATE TRIGGER trg_seed_extra_bed
AFTER INSERT OR UPDATE OR DELETE ON public.booking_extra_beds
FOR EACH ROW EXECUTE FUNCTION public.tg_seed_extra_bed();
