-- 1. Extend gst_slabs with category + activation metadata
ALTER TABLE public.gst_slabs
  ADD COLUMN IF NOT EXISTS charge_category text NOT NULL DEFAULT 'room',
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS effective_from date NOT NULL DEFAULT CURRENT_DATE;

-- Keep is_active in sync with legacy 'active' flag for rows written by older code paths
UPDATE public.gst_slabs SET is_active = COALESCE(active, true) WHERE is_active IS DISTINCT FROM COALESCE(active, true);

DO $$ BEGIN
  ALTER TABLE public.gst_slabs
    ADD CONSTRAINT gst_slabs_category_chk
    CHECK (charge_category IN ('room','food','banquet','sundry'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS idx_gst_slabs_lookup
  ON public.gst_slabs(property_id, charge_category, is_active);

-- 2. Central lookup — the ONLY source of GST% at charge-creation time
CREATE OR REPLACE FUNCTION public.get_gst_rate(
  p_property_id uuid, p_category text, p_amount numeric
) RETURNS numeric
LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT gst_rate
    FROM public.gst_slabs
   WHERE property_id = p_property_id
     AND charge_category = p_category
     AND COALESCE(is_active, true) = true
     AND effective_from <= CURRENT_DATE
     AND COALESCE(p_amount, 0) >= from_amount
     AND (to_amount IS NULL OR to_amount = 0 OR COALESCE(p_amount, 0) <= to_amount)
   ORDER BY from_amount DESC
   LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_gst_rate(uuid, text, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_gst_rate(uuid, text, numeric) TO authenticated, service_role;

-- 3. Seed defaults for every property (only where category rows are missing)
--    Room: tiered.  Food/Banquet/Sundry: single flat row (min 0, max NULL = "and above").
INSERT INTO public.gst_slabs (property_id, charge_category, from_amount, to_amount, gst_rate, is_active, active)
SELECT p.id, 'room', 0, 1000, 0, true, true FROM public.properties p
 WHERE NOT EXISTS (SELECT 1 FROM public.gst_slabs g WHERE g.property_id = p.id AND g.charge_category = 'room' AND g.from_amount = 0 AND g.to_amount = 1000);

INSERT INTO public.gst_slabs (property_id, charge_category, from_amount, to_amount, gst_rate, is_active, active)
SELECT p.id, 'room', 1001, 7500, 5, true, true FROM public.properties p
 WHERE NOT EXISTS (SELECT 1 FROM public.gst_slabs g WHERE g.property_id = p.id AND g.charge_category = 'room' AND g.from_amount = 1001 AND g.to_amount = 7500);

INSERT INTO public.gst_slabs (property_id, charge_category, from_amount, to_amount, gst_rate, is_active, active)
SELECT p.id, 'room', 7501, 0, 18, true, true FROM public.properties p
 WHERE NOT EXISTS (SELECT 1 FROM public.gst_slabs g WHERE g.property_id = p.id AND g.charge_category = 'room' AND g.from_amount = 7501);

-- to_amount = 0 is treated as "no upper bound" by get_gst_rate above
INSERT INTO public.gst_slabs (property_id, charge_category, from_amount, to_amount, gst_rate, is_active, active)
SELECT p.id, 'food',    0, 0, 5,  true, true FROM public.properties p
 WHERE NOT EXISTS (SELECT 1 FROM public.gst_slabs g WHERE g.property_id = p.id AND g.charge_category = 'food');

INSERT INTO public.gst_slabs (property_id, charge_category, from_amount, to_amount, gst_rate, is_active, active)
SELECT p.id, 'banquet', 0, 0, 18, true, true FROM public.properties p
 WHERE NOT EXISTS (SELECT 1 FROM public.gst_slabs g WHERE g.property_id = p.id AND g.charge_category = 'banquet');

INSERT INTO public.gst_slabs (property_id, charge_category, from_amount, to_amount, gst_rate, is_active, active)
SELECT p.id, 'sundry',  0, 0, 5,  true, true FROM public.properties p
 WHERE NOT EXISTS (SELECT 1 FROM public.gst_slabs g WHERE g.property_id = p.id AND g.charge_category = 'sundry');

-- 4. Auto-seed slabs when a new property is created
CREATE OR REPLACE FUNCTION public.tg_seed_gst_slabs_for_property()
 RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.gst_slabs (property_id, charge_category, from_amount, to_amount, gst_rate, is_active, active) VALUES
    (NEW.id, 'room',    0,    1000, 0,  true, true),
    (NEW.id, 'room',    1001, 7500, 5,  true, true),
    (NEW.id, 'room',    7501, 0,    18, true, true),
    (NEW.id, 'food',    0,    0,    5,  true, true),
    (NEW.id, 'banquet', 0,    0,    18, true, true),
    (NEW.id, 'sundry',  0,    0,    5,  true, true)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_gst_slabs_for_property ON public.properties;
CREATE TRIGGER trg_seed_gst_slabs_for_property
  AFTER INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.tg_seed_gst_slabs_for_property();

-- 5. Rewrite room-charge posting functions to use get_gst_rate ONLY (no hardcoded fallback)
CREATE OR REPLACE FUNCTION public.seed_room_charge_for_booking_room(_booking_room_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_br public.booking_rooms%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_folio_id uuid; v_existing_id uuid;
  v_nights int; v_gross numeric; v_amount numeric; v_gst_amount numeric;
  v_gst_rate numeric;
  v_nightly numeric; v_taxable numeric;
  v_room_number text; v_category_name text; v_charged_on date;
BEGIN
  SELECT * INTO v_br FROM public.booking_rooms WHERE id = _booking_room_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_br.room_id IS NULL OR COALESCE(v_br.rate, 0) <= 0 THEN RETURN NULL; END IF;
  IF COALESCE(v_br.status, 'active') NOT IN ('active','reserved','checked_in') THEN RETURN NULL; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = v_br.booking_id;
  IF NOT FOUND OR v_booking.status IN ('cancelled','checked_out','no_show') THEN RETURN NULL; END IF;
  SELECT f.id INTO v_folio_id FROM public.folios f
    WHERE f.booking_id = v_br.booking_id AND COALESCE(f.is_deleted,false) = false AND f.status <> 'void'
    ORDER BY f.created_at DESC LIMIT 1;
  IF v_folio_id IS NULL THEN
    INSERT INTO public.folios (property_id, booking_id, created_by)
    VALUES (v_br.property_id, v_br.booking_id, auth.uid()) RETURNING id INTO v_folio_id;
  END IF;
  IF EXISTS (SELECT 1 FROM public.folios f WHERE f.id = v_folio_id
       AND (f.status IN ('settled','void') OR COALESCE(f.is_deleted,false))) THEN RETURN NULL; END IF;
  v_charged_on := COALESCE(v_br.check_in, v_booking.check_in, CURRENT_DATE);
  IF public.is_day_locked(v_br.property_id, v_charged_on) THEN RETURN NULL; END IF;
  SELECT fc.id INTO v_existing_id FROM public.folio_charges fc
   WHERE fc.folio_id = v_folio_id AND fc.charge_type = 'room'
     AND fc.source_table = 'booking_rooms' AND fc.source_id = v_br.id
     AND COALESCE(fc.is_wiped,false) = false LIMIT 1;
  v_nights := GREATEST(1, (v_br.check_out - v_br.check_in));
  v_nightly := COALESCE(v_br.rate, 0);

  IF COALESCE(v_booking.rate_type, 'exclusive') = 'inclusive' THEN
    -- For inclusive tariffs the slab is decided on the pre-GST (taxable) per-night value.
    -- First-pass with the slab looked up on gross, then re-lookup on the resulting taxable value.
    v_gst_rate := COALESCE(public.get_gst_rate(v_br.property_id, 'room', v_nightly), 0);
    v_taxable  := ROUND((v_nightly / (1 + v_gst_rate / 100))::numeric, 2);
    v_gst_rate := COALESCE(public.get_gst_rate(v_br.property_id, 'room', v_taxable), v_gst_rate);
    v_gross      := v_nights * v_nightly;
    v_amount     := ROUND((v_gross / (1 + v_gst_rate / 100))::numeric, 2);
    v_gst_amount := ROUND((v_gross - v_amount)::numeric, 2);
  ELSE
    v_gst_rate   := COALESCE(public.get_gst_rate(v_br.property_id, 'room', v_nightly), 0);
    v_gross      := v_nights * v_nightly;
    v_amount     := v_gross;
    v_gst_amount := ROUND((v_gross * v_gst_rate / 100)::numeric, 2);
  END IF;

  SELECT r.room_number INTO v_room_number FROM public.rooms r WHERE r.id = v_br.room_id;
  SELECT rc.name INTO v_category_name FROM public.room_categories rc WHERE rc.id = v_br.category_id;
  IF v_existing_id IS NOT NULL THEN
    UPDATE public.folio_charges
       SET description = 'Room ' || COALESCE(v_room_number,'') || ' · ' || COALESCE(v_category_name,'') || ' · ' || v_nights || ' night(s)',
           qty = v_nights, rate = v_nightly, amount = v_amount,
           gst_rate = v_gst_rate, gst_amount = v_gst_amount, charged_on = v_charged_on,
           created_by = COALESCE(auth.uid(), created_by)
     WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;
  INSERT INTO public.folio_charges(
    folio_id, charge_type, description, qty, rate, amount,
    gst_rate, gst_amount, charged_on, source_table, source_id, created_by
  ) VALUES (
    v_folio_id, 'room',
    'Room ' || COALESCE(v_room_number,'') || ' · ' || COALESCE(v_category_name,'') || ' · ' || v_nights || ' night(s)',
    v_nights, v_nightly, v_amount,
    v_gst_rate, v_gst_amount, v_charged_on,
    'booking_rooms', v_br.id, auth.uid()
  ) RETURNING id INTO v_existing_id;
  RETURN v_existing_id;
END $function$;

CREATE OR REPLACE FUNCTION public.post_nightly_room_charges(_property_id uuid, _audit_date date)
 RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_rec record; v_folio uuid; v_posted int := 0;
  v_gst_rate numeric; v_amount numeric; v_gst numeric; v_taxable numeric;
BEGIN
  IF NOT public.user_has_property(auth.uid(), _property_id) THEN
    RAISE EXCEPTION 'Not authorised for this property';
  END IF;
  IF NOT public.can_billing(auth.uid()) THEN
    RAISE EXCEPTION 'Not authorised to post charges';
  END IF;
  FOR v_rec IN
    SELECT br.booking_id, br.room_id, br.rate, r.room_number,
           COALESCE(b.rate_type,'exclusive') AS rate_type
      FROM public.booking_rooms br
      JOIN public.bookings b ON b.id = br.booking_id
      LEFT JOIN public.rooms r ON r.id = br.room_id
     WHERE br.property_id = _property_id
       AND b.check_in  <= _audit_date AND b.check_out  > _audit_date
       AND b.status IN ('checked_in','reserved')
       AND COALESCE(br.status,'active') IN ('active','checked_in','reserved')
       AND COALESCE(br.rate,0) > 0
  LOOP
    v_folio := public.get_or_create_folio(v_rec.booking_id);
    IF v_folio IS NULL THEN CONTINUE; END IF;
    IF EXISTS (SELECT 1 FROM public.folio_charges
       WHERE folio_id = v_folio AND charge_type = 'room'
         AND charged_on = _audit_date AND COALESCE(is_wiped,false) = false) THEN CONTINUE; END IF;

    IF v_rec.rate_type = 'inclusive' THEN
      v_gst_rate := COALESCE(public.get_gst_rate(_property_id, 'room', v_rec.rate), 0);
      v_taxable  := ROUND((v_rec.rate / (1 + v_gst_rate / 100))::numeric, 2);
      v_gst_rate := COALESCE(public.get_gst_rate(_property_id, 'room', v_taxable), v_gst_rate);
      v_amount := ROUND((v_rec.rate / (1 + v_gst_rate / 100))::numeric, 2);
      v_gst    := ROUND((v_rec.rate - v_amount)::numeric, 2);
    ELSE
      v_gst_rate := COALESCE(public.get_gst_rate(_property_id, 'room', v_rec.rate), 0);
      v_amount   := v_rec.rate;
      v_gst      := ROUND((v_rec.rate * v_gst_rate / 100)::numeric, 2);
    END IF;
    BEGIN
      INSERT INTO public.folio_charges(
        folio_id, charge_type, description, qty, rate, amount,
        gst_rate, gst_amount, charged_on, source_table, source_id, created_by
      ) VALUES (
        v_folio, 'room',
        'Room Charge — ' || to_char(_audit_date,'YYYY-MM-DD') ||
          COALESCE(' — Rm ' || v_rec.room_number, ''),
        1, v_rec.rate, v_amount, v_gst_rate, v_gst, _audit_date,
        'night_audit', v_rec.booking_id, auth.uid()
      );
      v_posted := v_posted + 1;
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
  END LOOP;
  RETURN v_posted;
END $function$;