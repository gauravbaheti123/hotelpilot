DO $$
DECLARE
  v_prop uuid;
  v_msg  text;
BEGIN
  SELECT id INTO v_prop FROM public.properties WHERE short_code = 'BRIJ' LIMIT 1;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'BRIJ property not found'; END IF;

  BEGIN
    DECLARE
      v_num1 text; v_num2 text; v_bid uuid; v_folio uuid;
      v_lines text; v_tot text; v_fin text; v_res text;
    BEGIN
      v_num1 := public.generate_bill_number(v_prop, 'banquet');

      INSERT INTO public.bookings (
        property_id, booking_type, banquet_number, guest_id, status,
        check_in, check_out, adults, children,
        hall_id, function_type, event_name, event_date, event_end_date,
        start_time, end_time, pax, package_rate, extra_charge, extra_charge_description,
        host_name, host_mobile, host_email, rate_type
      ) VALUES (
        v_prop, 'banquet', v_num1, NULL, 'reserved',
        DATE '2026-08-10', DATE '2026-08-10', 1, 0,
        (SELECT id FROM public.halls WHERE property_id = v_prop LIMIT 1),
        'wedding', 'Test Sangeet', DATE '2026-08-10', DATE '2026-08-10',
        TIME '18:00', TIME '23:00', 100, 500, 2000, 'Decoration & Lighting',
        'TEST HOST', '9999999999', 'test@example.com', 'exclusive'
      ) RETURNING id INTO v_bid;

      v_folio := public.seed_event_folio_charges(v_bid);
      -- idempotency check: second call must not duplicate
      PERFORM public.seed_event_folio_charges(v_bid);

      SELECT string_agg(format('%s | qty %s x %s = %s | gst %s%% = %s',
               description, qty, rate, amount, gst_rate, gst_amount), ' || ' ORDER BY description)
        INTO v_lines FROM public.folio_charges WHERE folio_id = v_folio;

      SELECT format('sub=%s gst=%s total=%s paid=%s bal=%s',
               sub_total, gst_amount, total_amount, paid_amount, balance_amount)
        INTO v_tot FROM public.folios WHERE id = v_folio;

      SELECT format('advance=%s balance=%s folio_total=%s',
               advance_amount, balance_amount, folio_total)
        INTO v_fin FROM public.booking_financials WHERE booking_id = v_bid;

      v_num2 := public.generate_bill_number(v_prop, 'banquet');

      v_res := format('num1=%s num2=%s | guest_id=NULL host=TEST HOST ok | charges: %s | folio: %s | derived: %s | charge_count=%s',
                 v_num1, v_num2, v_lines, v_tot, v_fin,
                 (SELECT count(*) FROM public.folio_charges WHERE folio_id = v_folio));

      RAISE EXCEPTION 'TESTRESULT %', v_res;
    END;
  EXCEPTION WHEN others THEN
    v_msg := SQLERRM;
  END;

  INSERT INTO public.activity_log (property_id, user_id, user_name, action_type, module, reference_label, details)
  VALUES (v_prop, NULL, 'System', 'BANQUET_UNIFY_P1_TEST', 'Banquet',
          'Part 1 backend test', jsonb_build_object('result', v_msg));
END $$;