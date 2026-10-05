CREATE OR REPLACE FUNCTION public.restore_missing_room_nights(_booking_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bk record;
  v_before int;
  v_after int;
  v_priv boolean;
  r record;
  v_folios uuid[] := '{}';
  f uuid;
BEGIN
  SELECT id, property_id, status INTO v_bk FROM public.bookings WHERE id = _booking_id;
  IF v_bk.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF NOT public.staff_can_correct(v_bk.property_id) THEN
    RAISE EXCEPTION 'You do not have access to this property';
  END IF;
  v_priv := public.is_owner_or_super(auth.uid())
         OR public.has_role(auth.uid(), 'manager')
         OR public.has_permission(auth.uid(), v_bk.property_id, 'invoices', 'edit_room_rate_locked');

  SELECT count(*) INTO v_before FROM public.missing_room_nights(_booking_id);
  IF v_before = 0 THEN RETURN 0; END IF;

  -- 1) Un-wipe previously wiped room charges that cover a missing night.
  FOR r IN
    SELECT DISTINCT ON (m.night) fc.id, fc.folio_id, f.status AS fstatus
      FROM public.missing_room_nights(_booking_id) m
      JOIN public.folios f ON f.booking_id = _booking_id
       AND COALESCE(f.is_deleted,false) = false AND f.status NOT IN ('void','refunded')
      JOIN public.folio_charges fc ON fc.folio_id = f.id
       AND fc.charge_type = 'room' AND fc.source_table = 'booking_rooms'
       AND COALESCE(fc.is_wiped,false) = true
      JOIN public.booking_rooms br ON br.id = fc.source_id
       AND m.night >= br.check_in AND m.night < br.check_out
     ORDER BY m.night, (fc.charged_on = m.night) DESC, fc.wiped_at DESC NULLS LAST
  LOOP
    IF r.fstatus <> 'open' AND NOT v_priv THEN
      RAISE EXCEPTION 'Only Owner or Manager can restore nights on a finalised bill';
    END IF;
    UPDATE public.folio_charges SET is_wiped = false, wiped_at = NULL WHERE id = r.id;
    v_folios := array_append(v_folios, r.folio_id);
  END LOOP;

  -- 2) Still missing on an active stay: normal re-seed.
  IF EXISTS (SELECT 1 FROM public.missing_room_nights(_booking_id))
     AND v_bk.status NOT IN ('checked_out','cancelled','no_show') THEN
    FOR r IN SELECT id FROM public.booking_rooms
              WHERE booking_id = _booking_id AND COALESCE(status,'active') IN ('active','reserved','checked_in')
    LOOP
      PERFORM public.seed_room_charge_for_booking_room(r.id);
    END LOOP;
  END IF;

  FOREACH f IN ARRAY v_folios LOOP
    PERFORM public.recompute_folio_totals(f);
  END LOOP;

  SELECT count(*) INTO v_after FROM public.missing_room_nights(_booking_id);
  IF v_before - v_after > 0 THEN
    PERFORM public.log_owner_override(v_bk.property_id, 'folio_charges', _booking_id::text,
      'RESTORE_NIGHTS', jsonb_build_object('missing', v_before), jsonb_build_object('missing', v_after),
      'Restore missing room nights');
  END IF;
  RETURN v_before - v_after;
END $$;

REVOKE ALL ON FUNCTION public.restore_missing_room_nights(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_missing_room_nights(uuid) TO authenticated;