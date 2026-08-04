-- Link room blocks to the unified event booking WITHOUT disturbing
-- event_room_blocks.booking_id (that column is the guest's stay booking).
ALTER TABLE public.event_room_blocks
  ADD COLUMN IF NOT EXISTS event_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_event_room_blocks_event_booking
  ON public.event_room_blocks (event_booking_id);

COMMENT ON COLUMN public.event_room_blocks.event_booking_id IS
  'Unified banquet booking (bookings.booking_type = ''banquet'') this block belongs to. Distinct from booking_id, which is the guest stay booking created at check-in.';

DO $$
DECLARE
  e         record;
  v_new     uuid;
  v_status  public.booking_status;
  v_migrated int := 0;
  v_blocks   int := 0;
  v_zerotest text;
BEGIN
  FOR e IN
    SELECT bb.* FROM public.banquet_bookings bb
    WHERE NOT EXISTS (
      SELECT 1 FROM public.bookings b
       WHERE b.property_id = bb.property_id
         AND b.banquet_number = bb.banquet_number)
    ORDER BY bb.banquet_number
  LOOP
    v_status := CASE lower(btrim(COALESCE(e.status,'reserved')))
      WHEN 'reserved'    THEN 'reserved'
      WHEN 'confirmed'   THEN 'reserved'
      WHEN 'tentative'   THEN 'reserved'
      WHEN 'checked_in'  THEN 'checked_in'
      WHEN 'ongoing'     THEN 'checked_in'
      WHEN 'checked_out' THEN 'checked_out'
      WHEN 'completed'   THEN 'checked_out'
      WHEN 'cancelled'   THEN 'cancelled'
      WHEN 'no_show'     THEN 'no_show'
      ELSE 'reserved'
    END::public.booking_status;

    INSERT INTO public.bookings (
      property_id, booking_type, banquet_number, guest_id, source, status,
      check_in, check_out, adults, children,
      total_amount, advance_amount, balance_amount,
      notes, created_by, created_at,
      cancelled_at, cancelled_reason,
      hall_id, function_type, event_name, event_date, event_end_date,
      start_time, end_time, pax, package_rate, hall_charge, fb_charge,
      extra_charge, extra_charge_description,
      discount_type, discount_value, discount_amount, round_off_amount,
      host_name, host_mobile, host_email, rate_type
    ) VALUES (
      e.property_id, 'banquet', e.banquet_number, e.guest_id, 'banquet', v_status,
      e.event_date, COALESCE(e.event_end_date, e.event_date), GREATEST(COALESCE(e.pax,0),1), 0,
      0, 0, 0,
      e.notes, e.created_by, e.created_at,
      e.cancelled_at, e.cancelled_reason,
      e.hall_id, e.function_type, e.event_name, e.event_date, e.event_end_date,
      e.start_time, e.end_time, e.pax, e.package_rate, e.hall_charge, e.fb_charge,
      e.extra_charge, e.extra_charge_description,
      e.discount_type, e.discount_value, e.discount_amount, e.round_off_amount,
      e.host_name, e.host_mobile, e.host_email, 'exclusive'
    ) RETURNING id INTO v_new;

    -- Folio + charges only when the event actually carries money.
    IF COALESCE(e.hall_charge,0) > 0
       OR COALESCE(e.package_rate,0) * COALESCE(e.pax,0) > 0
       OR COALESCE(e.extra_charge,0) > 0 THEN
      PERFORM public.seed_event_folio_charges(v_new);
    END IF;

    -- Link room blocks to the unified event booking (stay booking_id untouched).
    UPDATE public.event_room_blocks
       SET event_booking_id = v_new, updated_at = now()
     WHERE banquet_booking_id = e.id;
    GET DIAGNOSTICS v_blocks = ROW_COUNT;

    -- Carry forward existing history entries onto the new booking.
    INSERT INTO public.activity_log
      (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details, created_at)
    SELECT al.property_id, al.user_id, al.user_name, al.action_type, al.module,
           v_new, al.reference_label,
           COALESCE(al.details,'{}'::jsonb) || jsonb_build_object('copied_from_activity_id', al.id, 'legacy_banquet_booking_id', e.id),
           al.created_at
      FROM public.activity_log al
     WHERE al.reference_id = e.id;

    INSERT INTO public.activity_log
      (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
    VALUES (
      e.property_id, e.created_by, 'System', 'BANQUET_MIGRATED_TO_UNIFIED', 'Banquet',
      v_new, e.banquet_number,
      jsonb_build_object(
        'legacy_banquet_booking_id', e.id,
        'new_booking_id', v_new,
        'banquet_number', e.banquet_number,
        'legacy_status', e.status,
        'mapped_status', v_status::text,
        'room_blocks_linked', v_blocks,
        'folio_seeded', (COALESCE(e.hall_charge,0) > 0
                         OR COALESCE(e.package_rate,0) * COALESCE(e.pax,0) > 0
                         OR COALESCE(e.extra_charge,0) > 0)
      )
    );

    v_migrated := v_migrated + 1;
  END LOOP;

  -- Zero-amount safety check for seed_event_folio_charges (rolled back).
  BEGIN
    DECLARE v_b uuid; v_f uuid; v_cnt int;
    BEGIN
      SELECT id INTO v_b FROM public.bookings WHERE booking_type = 'banquet' LIMIT 1;
      IF v_b IS NOT NULL THEN
        v_f := public.seed_event_folio_charges(v_b);
        SELECT count(*) INTO v_cnt FROM public.folio_charges WHERE folio_id = v_f;
        RAISE EXCEPTION 'ZEROTEST ok folio=% charges=%', v_f, v_cnt;
      END IF;
      RAISE EXCEPTION 'ZEROTEST skipped';
    END;
  EXCEPTION WHEN others THEN
    v_zerotest := SQLERRM;
  END;

  INSERT INTO public.activity_log
    (property_id, user_id, user_name, action_type, module, reference_label, details)
  SELECT id, NULL, 'System', 'BANQUET_UNIFY_P2_RESULT', 'Banquet', 'Part 2 migration',
         jsonb_build_object('events_migrated', v_migrated, 'zero_amount_test', v_zerotest)
    FROM public.properties WHERE short_code = 'BRIJ' LIMIT 1;
END $$;