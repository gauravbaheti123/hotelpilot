
-- 1) Block exact duplicate room lines on one bill (split-bill duplication guard)
CREATE OR REPLACE FUNCTION public.tg_folio_charges_block_dupe_room()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.charge_type = 'room'
     AND NEW.source_table = 'booking_rooms'
     AND NEW.source_id IS NOT NULL
     AND COALESCE(NEW.is_wiped, false) = false THEN
    IF EXISTS (
      SELECT 1 FROM public.folio_charges fc
       WHERE fc.folio_id = NEW.folio_id
         AND fc.charge_type = 'room'
         AND fc.source_table = 'booking_rooms'
         AND fc.source_id = NEW.source_id
         AND COALESCE(fc.is_wiped, false) = false
         AND fc.id <> NEW.id
    ) THEN
      RETURN NULL; -- silently skip the duplicate insert
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS folio_charges_block_dupe_room ON public.folio_charges;
CREATE TRIGGER folio_charges_block_dupe_room
BEFORE INSERT ON public.folio_charges
FOR EACH ROW EXECUTE FUNCTION public.tg_folio_charges_block_dupe_room();

-- 2) Remove ONE night from a stay without destroying the other nights
CREATE OR REPLACE FUNCTION public.remove_room_night(_booking_room_id uuid, _night date)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_br      public.booking_rooms%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_out     date;
  v_target  uuid;
  v_removed int := 0;
BEGIN
  SELECT * INTO v_br FROM public.booking_rooms WHERE id = _booking_room_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Room segment not found'; END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_br.booking_id FOR UPDATE;
  IF NOT FOUND OR v_booking.status IN ('cancelled','no_show') THEN
    RAISE EXCEPTION 'Nights can only be removed from an active booking';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.folios f
     WHERE f.booking_id = v_br.booking_id
       AND COALESCE(f.is_deleted,false) = false
       AND f.status = 'open'
  ) THEN
    RAISE EXCEPTION 'Nights can only be removed while the bill is OPEN';
  END IF;

  IF NOT (
       public.is_owner_or_super(auth.uid())
    OR public.has_permission(auth.uid(), v_br.property_id, 'bookings', 'edit')
    OR public.has_permission(auth.uid(), v_br.property_id, 'invoices', 'edit')
  ) THEN
    RAISE EXCEPTION 'You do not have permission to remove a night';
  END IF;

  IF public.is_day_locked(v_br.property_id, _night) THEN
    RAISE EXCEPTION 'That date is locked by night audit';
  END IF;

  IF _night < v_br.check_in OR _night >= v_br.check_out THEN
    RAISE EXCEPTION 'That night is not part of this stay';
  END IF;

  v_out := v_br.check_out;

  -- Single-night segment: drop the whole segment's charge.
  IF (v_out - v_br.check_in) <= 1 THEN
    v_target := v_br.id;
  ELSIF _night = v_br.check_in THEN
    -- Keep the tail as a new segment, this segment becomes the removed night.
    UPDATE public.booking_rooms SET check_out = _night + 1, updated_at = now() WHERE id = v_br.id;
    v_target := v_br.id;
    INSERT INTO public.booking_rooms(
      booking_id, property_id, room_id, category_id, tariff_id, meal_plan,
      rate, adults, children, extra_beds, check_in, check_out,
      check_in_time, check_out_time, status, start_date
    ) VALUES (
      v_br.booking_id, v_br.property_id, v_br.room_id, v_br.category_id,
      v_br.tariff_id, v_br.meal_plan, v_br.rate, v_br.adults, v_br.children,
      0, _night + 1, v_out, v_br.check_in_time, v_br.check_out_time,
      COALESCE(v_br.status,'active'), now()
    );
  ELSE
    -- Head keeps its nights, the removed night becomes its own segment,
    -- the tail (if any) continues afterwards.
    UPDATE public.booking_rooms SET check_out = _night, updated_at = now() WHERE id = v_br.id;
    PERFORM public.seed_room_charge_for_booking_room(v_br.id);

    INSERT INTO public.booking_rooms(
      booking_id, property_id, room_id, category_id, tariff_id, meal_plan,
      rate, adults, children, extra_beds, check_in, check_out,
      check_in_time, check_out_time, status, start_date
    ) VALUES (
      v_br.booking_id, v_br.property_id, v_br.room_id, v_br.category_id,
      v_br.tariff_id, v_br.meal_plan, v_br.rate, v_br.adults, v_br.children,
      0, _night, _night + 1, v_br.check_in_time, v_br.check_out_time,
      COALESCE(v_br.status,'active'), now()
    ) RETURNING id INTO v_target;

    IF (_night + 1) < v_out THEN
      INSERT INTO public.booking_rooms(
        booking_id, property_id, room_id, category_id, tariff_id, meal_plan,
        rate, adults, children, extra_beds, check_in, check_out,
        check_in_time, check_out_time, status, start_date
      ) VALUES (
        v_br.booking_id, v_br.property_id, v_br.room_id, v_br.category_id,
        v_br.tariff_id, v_br.meal_plan, v_br.rate, v_br.adults, v_br.children,
        0, _night + 1, v_out, v_br.check_in_time, v_br.check_out_time,
        COALESCE(v_br.status,'active'), now()
      );
    END IF;
  END IF;

  -- Wipe only the charge(s) belonging to the removed night's segment.
  UPDATE public.folio_charges fc
     SET is_wiped = true, wiped_at = now()
    FROM public.folios f
   WHERE f.id = fc.folio_id
     AND f.booking_id = v_br.booking_id
     AND fc.charge_type = 'room'
     AND fc.source_table = 'booking_rooms'
     AND fc.source_id = v_target
     AND COALESCE(fc.is_wiped,false) = false;
  GET DIAGNOSTICS v_removed = ROW_COUNT;

  -- The removed night no longer exists as a stay segment.
  UPDATE public.booking_rooms
     SET status = 'cancelled', updated_at = now()
   WHERE id = v_target;

  -- Make sure every remaining segment still carries its own charge.
  PERFORM public.seed_room_charge_for_booking_room(br.id)
     FROM public.booking_rooms br
    WHERE br.booking_id = v_br.booking_id
      AND COALESCE(br.status,'active') IN ('active','reserved','checked_in');

  -- Refresh every live bill of this stay.
  PERFORM public.recompute_folio_totals(f.id)
     FROM public.folios f
    WHERE f.booking_id = v_br.booking_id
      AND COALESCE(f.is_deleted,false) = false
      AND f.status NOT IN ('void','refunded');

  RETURN jsonb_build_object('ok', true, 'night', _night, 'charges_removed', v_removed);
END;
$$;

REVOKE ALL ON FUNCTION public.remove_room_night(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.remove_room_night(uuid, date) TO authenticated;

-- 3) Which nights of a stay are NOT covered by a live room charge?
CREATE OR REPLACE FUNCTION public.missing_room_nights(_booking_id uuid)
RETURNS TABLE(night date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH stay AS (
    SELECT b.check_in, b.check_out FROM public.bookings b WHERE b.id = _booking_id
  ),
  nights AS (
    SELECT gs::date AS night
      FROM stay, generate_series(stay.check_in, stay.check_out - 1, interval '1 day') gs
  ),
  covered AS (
    SELECT gs::date AS night
      FROM public.folio_charges fc
      JOIN public.folios f ON f.id = fc.folio_id
      JOIN public.booking_rooms br ON br.id = fc.source_id
      CROSS JOIN LATERAL generate_series(br.check_in, br.check_out - 1, interval '1 day') gs
     WHERE f.booking_id = _booking_id
       AND COALESCE(f.is_deleted,false) = false
       AND f.status NOT IN ('void','refunded')
       AND fc.charge_type = 'room'
       AND fc.source_table = 'booking_rooms'
       AND COALESCE(fc.is_wiped,false) = false
  )
  SELECT n.night FROM nights n
   WHERE NOT EXISTS (SELECT 1 FROM covered c WHERE c.night = n.night)
   ORDER BY n.night
$$;

REVOKE ALL ON FUNCTION public.missing_room_nights(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.missing_room_nights(uuid) TO authenticated;
