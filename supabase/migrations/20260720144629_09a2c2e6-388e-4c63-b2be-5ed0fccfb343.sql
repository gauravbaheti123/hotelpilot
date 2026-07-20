
UPDATE public.gst_slabs SET gst_rate = 5 WHERE gst_rate <> 5;

ALTER TABLE public.room_categories ALTER COLUMN gst_rate SET DEFAULT 5;
UPDATE public.room_categories SET gst_rate = 5 WHERE gst_rate <> 5;

UPDATE public.menu_items SET gst_rate = 5 WHERE COALESCE(gst_rate,0) <> 5;

ALTER TABLE public.sundry_items ALTER COLUMN gst_rate SET DEFAULT 5;
UPDATE public.sundry_items SET gst_rate = 5 WHERE gst_rate <> 5;

ALTER TABLE public.properties ALTER COLUMN sundry_gst_rate SET DEFAULT 5;
ALTER TABLE public.properties ALTER COLUMN food_gst_rate  SET DEFAULT 5;
UPDATE public.properties SET sundry_gst_rate = 5 WHERE sundry_gst_rate <> 5;
UPDATE public.properties SET food_gst_rate   = 5 WHERE food_gst_rate   <> 5;

CREATE OR REPLACE FUNCTION public.seed_room_charge_for_booking_room(_booking_room_id uuid)
 RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  v_br public.booking_rooms%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_folio_id uuid; v_existing_id uuid;
  v_nights int; v_gross numeric; v_amount numeric; v_gst_amount numeric;
  v_gst_rate numeric := 5;
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
  v_gross  := v_nights * COALESCE(v_br.rate, 0);
  IF COALESCE(v_booking.rate_type, 'exclusive') = 'inclusive' THEN
    v_amount     := ROUND((v_gross / (1 + v_gst_rate / 100))::numeric, 2);
    v_gst_amount := ROUND((v_gross - v_amount)::numeric, 2);
  ELSE
    v_amount     := v_gross;
    v_gst_amount := ROUND((v_gross * v_gst_rate / 100)::numeric, 2);
  END IF;
  SELECT r.room_number INTO v_room_number FROM public.rooms r WHERE r.id = v_br.room_id;
  SELECT rc.name INTO v_category_name FROM public.room_categories rc WHERE rc.id = v_br.category_id;
  IF v_existing_id IS NOT NULL THEN
    UPDATE public.folio_charges
       SET description = 'Room ' || COALESCE(v_room_number,'') || ' · ' || COALESCE(v_category_name,'') || ' · ' || v_nights || ' night(s)',
           qty = v_nights, rate = COALESCE(v_br.rate, 0), amount = v_amount,
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
    v_nights, COALESCE(v_br.rate, 0), v_amount,
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
  v_gst_rate numeric := 5; v_amount numeric; v_gst numeric;
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
      v_amount := ROUND((v_rec.rate / (1 + v_gst_rate / 100))::numeric, 2);
      v_gst    := ROUND((v_rec.rate - v_amount)::numeric, 2);
    ELSE
      v_amount := v_rec.rate;
      v_gst    := ROUND((v_rec.rate * v_gst_rate / 100)::numeric, 2);
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

-- Backfill open folio charges (skip locked/settled/void)
UPDATE public.folio_charges fc
   SET gst_rate = 5,
       gst_amount = ROUND((fc.amount * 5 / 100)::numeric, 2)
  FROM public.folios f
 WHERE fc.folio_id = f.id
   AND COALESCE(fc.is_wiped,false) = false
   AND COALESCE(fc.gst_rate,0) <> 5
   AND fc.charge_type <> 'discount'
   AND f.status NOT IN ('settled','void')
   AND COALESCE(f.is_deleted,false) = false
   AND NOT public.is_day_locked(f.property_id, COALESCE(fc.charged_on, CURRENT_DATE));

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT DISTINCT f.id FROM public.folios f
     WHERE f.status NOT IN ('settled','void') AND COALESCE(f.is_deleted,false) = false
  LOOP
    PERFORM public.recompute_folio_totals(r.id);
  END LOOP;
END $$;
