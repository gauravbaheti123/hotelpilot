CREATE OR REPLACE FUNCTION public.create_event_booking(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_prop uuid := (payload->>'property_id')::uuid;
  v_num  text;
  v_bid  uuid;
  v_lid  uuid;
  v_start date := (payload->>'event_date')::date;
  v_end   date := COALESCE((payload->>'event_end_date')::date, (payload->>'event_date')::date);
  v_extra jsonb;
  v_i     int := 0;
BEGIN
  IF v_prop IS NULL THEN RAISE EXCEPTION 'property_id required'; END IF;
  IF NOT public.has_permission(auth.uid(), v_prop, 'banquet', 'create') THEN
    RAISE EXCEPTION 'Not allowed to create banquet events';
  END IF;

  v_num := public.generate_bill_number(v_prop, 'banquet');

  INSERT INTO public.bookings (
    property_id, booking_type, banquet_number, status, source,
    check_in, check_out, adults, children,
    guest_id, host_name, host_mobile, host_email,
    hall_id, event_name, function_type, event_date, event_end_date,
    start_time, end_time, pax,
    package_rate, hall_charge, fb_charge, extra_charge, extra_charge_description,
    discount_amount, round_off_amount,
    total_amount, advance_amount, balance_amount,
    notes, created_by
  ) VALUES (
    v_prop, 'banquet', v_num, 'reserved', 'banquet',
    v_start, v_end, GREATEST(COALESCE((payload->>'pax')::int,1),1), 0,
    NULLIF(payload->>'guest_id','')::uuid,
    payload->>'host_name', NULLIF(payload->>'host_mobile',''), NULLIF(payload->>'host_email',''),
    NULLIF(payload->>'hall_id','')::uuid, NULLIF(payload->>'event_name',''), payload->>'function_type',
    v_start, v_end,
    (payload->>'start_time')::time, (payload->>'end_time')::time,
    COALESCE((payload->>'pax')::int, 0),
    COALESCE((payload->>'package_rate')::numeric, 0),
    COALESCE((payload->>'hall_charge')::numeric, 0),
    COALESCE((payload->>'fb_charge')::numeric, 0),
    COALESCE((payload->>'extra_charge')::numeric, 0),
    NULLIF(payload->>'extra_charge_description',''),
    COALESCE((payload->>'discount_amount')::numeric, 0),
    COALESCE((payload->>'round_off_amount')::numeric, 0),
    COALESCE((payload->>'total_amount')::numeric, 0),
    COALESCE((payload->>'advance_amount')::numeric, 0),
    COALESCE((payload->>'balance_amount')::numeric, 0),
    NULLIF(payload->>'notes',''), auth.uid()
  ) RETURNING id INTO v_bid;

  INSERT INTO public.banquet_bookings (
    property_id, banquet_number, hall_id, guest_id, function_type,
    event_date, event_end_date, start_time, end_time, pax,
    package_rate, hall_charge, fb_charge, extra_charge, extra_charge_description,
    discount_amount, round_off_amount, total_amount, advance_amount, balance_amount,
    total_room_charges, status, notes, event_name,
    host_name, host_mobile, host_email, created_by, event_booking_id
  ) VALUES (
    v_prop, v_num, NULLIF(payload->>'hall_id','')::uuid, NULLIF(payload->>'guest_id','')::uuid,
    payload->>'function_type', v_start, v_end,
    (payload->>'start_time')::time, (payload->>'end_time')::time,
    COALESCE((payload->>'pax')::int, 0),
    COALESCE((payload->>'package_rate')::numeric, 0),
    COALESCE((payload->>'hall_charge')::numeric, 0),
    COALESCE((payload->>'fb_charge')::numeric, 0),
    COALESCE((payload->>'extra_charge')::numeric, 0),
    NULLIF(payload->>'extra_charge_description',''),
    COALESCE((payload->>'discount_amount')::numeric, 0),
    COALESCE((payload->>'round_off_amount')::numeric, 0),
    COALESCE((payload->>'total_amount')::numeric, 0),
    COALESCE((payload->>'advance_amount')::numeric, 0),
    COALESCE((payload->>'balance_amount')::numeric, 0),
    COALESCE((payload->>'total_room_charges')::numeric, 0),
    'reserved', NULLIF(payload->>'notes',''), NULLIF(payload->>'event_name',''),
    payload->>'host_name', NULLIF(payload->>'host_mobile',''), NULLIF(payload->>'host_email',''),
    auth.uid(), v_bid
  ) RETURNING id INTO v_lid;

  -- named extra charge lines, saved in the same transaction
  IF jsonb_typeof(payload->'extras') = 'array' THEN
    FOR v_extra IN SELECT * FROM jsonb_array_elements(payload->'extras') LOOP
      IF COALESCE(NULLIF(btrim(COALESCE(v_extra->>'point_name','')),''), '') <> ''
         AND COALESCE((v_extra->>'amount')::numeric, 0) > 0 THEN
        INSERT INTO public.banquet_extra_charges
          (banquet_booking_id, property_id, point_name, amount, sort_order, created_by)
        VALUES (v_lid, v_prop, btrim(v_extra->>'point_name'),
                (v_extra->>'amount')::numeric, v_i, auth.uid());
        v_i := v_i + 1;
      END IF;
    END LOOP;
  END IF;

  PERFORM public.seed_event_folio_charges(v_bid);

  RETURN jsonb_build_object('booking_id', v_bid, 'banquet_booking_id', v_lid, 'banquet_number', v_num);
END $$;

REVOKE EXECUTE ON FUNCTION public.create_event_booking(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_event_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event_booking(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_event_ids(uuid) TO authenticated, service_role;