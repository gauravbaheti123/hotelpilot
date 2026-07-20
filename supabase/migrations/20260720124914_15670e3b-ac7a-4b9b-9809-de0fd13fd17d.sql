CREATE OR REPLACE FUNCTION public.seed_room_charge_for_booking_room(_booking_room_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_br public.booking_rooms%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_folio_id uuid;
  v_existing_id uuid;
  v_nights int;
  v_amount numeric;
  v_gst_rate numeric := 12;
  v_room_number text;
  v_category_name text;
  v_charged_on date;
BEGIN
  SELECT * INTO v_br
    FROM public.booking_rooms
   WHERE id = _booking_room_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Room-less future reservations should not receive room charges until a room is assigned.
  IF v_br.room_id IS NULL OR COALESCE(v_br.rate, 0) <= 0 THEN
    RETURN NULL;
  END IF;

  IF COALESCE(v_br.status, 'active') NOT IN ('active', 'reserved', 'checked_in') THEN
    RETURN NULL;
  END IF;

  SELECT * INTO v_booking
    FROM public.bookings
   WHERE id = v_br.booking_id;

  IF NOT FOUND OR v_booking.status IN ('cancelled', 'checked_out', 'no_show') THEN
    RETURN NULL;
  END IF;

  SELECT f.id INTO v_folio_id
    FROM public.folios f
   WHERE f.booking_id = v_br.booking_id
     AND COALESCE(f.is_deleted, false) = false
     AND f.status <> 'void'
   ORDER BY f.created_at DESC
   LIMIT 1;

  IF v_folio_id IS NULL THEN
    INSERT INTO public.folios (property_id, booking_id, created_by)
    VALUES (v_br.property_id, v_br.booking_id, auth.uid())
    RETURNING id INTO v_folio_id;
  END IF;

  -- Do not mutate settled/void/deleted or audit-locked folios.
  IF EXISTS (
    SELECT 1 FROM public.folios f
     WHERE f.id = v_folio_id
       AND (f.status IN ('settled', 'void') OR COALESCE(f.is_deleted, false))
  ) THEN
    RETURN NULL;
  END IF;

  v_charged_on := COALESCE(v_br.check_in, v_booking.check_in, CURRENT_DATE);
  IF public.is_day_locked(v_br.property_id, v_charged_on) THEN
    RETURN NULL;
  END IF;

  SELECT fc.id INTO v_existing_id
    FROM public.folio_charges fc
   WHERE fc.folio_id = v_folio_id
     AND fc.charge_type = 'room'
     AND fc.source_table = 'booking_rooms'
     AND fc.source_id = v_br.id
     AND COALESCE(fc.is_wiped, false) = false
   LIMIT 1;

  v_nights := GREATEST(1, (v_br.check_out - v_br.check_in));
  v_amount := v_nights * COALESCE(v_br.rate, 0);

  SELECT r.room_number INTO v_room_number
    FROM public.rooms r
   WHERE r.id = v_br.room_id;

  SELECT rc.name INTO v_category_name
    FROM public.room_categories rc
   WHERE rc.id = v_br.category_id;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.folio_charges
       SET description = 'Room ' || COALESCE(v_room_number, '') || ' · ' || COALESCE(v_category_name, '') || ' · ' || v_nights || ' night(s)',
           qty = v_nights,
           rate = COALESCE(v_br.rate, 0),
           amount = v_amount,
           gst_rate = v_gst_rate,
           gst_amount = ROUND((v_amount * v_gst_rate / 100)::numeric, 2),
           charged_on = v_charged_on,
           created_by = COALESCE(auth.uid(), created_by)
     WHERE id = v_existing_id;

    RETURN v_existing_id;
  END IF;

  INSERT INTO public.folio_charges(
    folio_id, charge_type, description, qty, rate, amount,
    gst_rate, gst_amount, charged_on, source_table, source_id, created_by
  ) VALUES (
    v_folio_id,
    'room',
    'Room ' || COALESCE(v_room_number, '') || ' · ' || COALESCE(v_category_name, '') || ' · ' || v_nights || ' night(s)',
    v_nights,
    COALESCE(v_br.rate, 0),
    v_amount,
    v_gst_rate,
    ROUND((v_amount * v_gst_rate / 100)::numeric, 2),
    v_charged_on,
    'booking_rooms',
    v_br.id,
    auth.uid()
  )
  RETURNING id INTO v_existing_id;

  RETURN v_existing_id;
EXCEPTION
  WHEN unique_violation THEN
    -- Existing legacy unique constraints may already have a room row for the same folio/date.
    -- Leave that row untouched instead of failing booking creation.
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.seed_room_charge_for_booking_room(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_room_charge_for_booking_room(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.seed_room_charge_for_booking_room(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.tg_seed_room_charge_for_booking_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    PERFORM public.seed_room_charge_for_booking_room(NEW.id);
  ELSIF TG_OP = 'UPDATE'
        AND (
          NEW.room_id IS DISTINCT FROM OLD.room_id
          OR NEW.rate IS DISTINCT FROM OLD.rate
          OR NEW.check_in IS DISTINCT FROM OLD.check_in
          OR NEW.check_out IS DISTINCT FROM OLD.check_out
          OR NEW.status IS DISTINCT FROM OLD.status
        ) THEN
    PERFORM public.seed_room_charge_for_booking_room(NEW.id);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_room_charge_for_booking_room ON public.booking_rooms;
CREATE TRIGGER trg_seed_room_charge_for_booking_room
AFTER INSERT OR UPDATE OF room_id, rate, check_in, check_out, status ON public.booking_rooms
FOR EACH ROW EXECUTE FUNCTION public.tg_seed_room_charge_for_booking_room();