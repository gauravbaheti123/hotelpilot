CREATE OR REPLACE FUNCTION public.create_booking(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _property_id  uuid := (payload->>'property_id')::uuid;
  _check_in_now boolean := COALESCE((payload->>'check_in_now')::boolean, false);
  _uid          uuid := auth.uid();
  _now          timestamptz := now();

  g             jsonb := COALESCE(payload->'guest', '{}'::jsonb);
  _nation       text;
  _guest_id     uuid;
  _mobile       text;
  _dup          uuid;

  _booking_id   uuid;
  _booking_no   text;
  _room_id      uuid;
  _effective_room uuid;
  _folio_id     uuid;
  _advance      numeric := COALESCE((payload->>'advance')::numeric, 0);
  _block_id     uuid := NULLIF(payload->>'block_id', '')::uuid;
  ex            jsonb;
  _ex_guest_id  uuid;
BEGIN
  IF _property_id IS NULL THEN
    RAISE EXCEPTION 'property_id is required';
  END IF;
  IF NOT public.has_permission(_uid, _property_id, 'bookings', 'create') THEN
    RAISE EXCEPTION 'Not allowed to create bookings for this property';
  END IF;

  _nation := NULLIF(btrim(COALESCE(g->>'nation', '')), '');
  _mobile := NULLIF(btrim(COALESCE(g->>'mobile', '')), '');
  _guest_id := NULLIF(g->>'guest_id', '')::uuid;

  IF _guest_id IS NULL AND COALESCE((payload->>'reuse_duplicate_guest')::boolean, true) THEN
    IF _mobile IS NOT NULL AND length(_mobile) = 10 THEN
      SELECT gg.id INTO _dup FROM public.guests gg
      WHERE gg.property_id = _property_id AND gg.mobile = _mobile AND gg.is_wiped = false
      ORDER BY gg.updated_at DESC LIMIT 1;
    END IF;
    IF _dup IS NULL AND length(COALESCE(btrim(g->>'id_proof_number'), '')) >= 6 THEN
      SELECT gg.id INTO _dup FROM public.guests gg
      WHERE gg.property_id = _property_id
        AND gg.id_proof_number = btrim(g->>'id_proof_number')
        AND gg.is_wiped = false
      ORDER BY gg.updated_at DESC LIMIT 1;
    END IF;
    _guest_id := _dup;
  END IF;

  IF _guest_id IS NOT NULL THEN
    UPDATE public.guests SET
      name = COALESCE(NULLIF(btrim(g->>'name'), ''), name),
      mobile = _mobile,
      email = NULLIF(btrim(COALESCE(g->>'email','')), ''),
      dob = NULLIF(g->>'dob','')::date,
      id_proof_type = NULLIF(btrim(COALESCE(g->>'id_proof_type','')), ''),
      id_proof_number = NULLIF(btrim(COALESCE(g->>'id_proof_number','')), ''),
      address = NULLIF(btrim(COALESCE(g->>'address','')), ''),
      city = NULLIF(btrim(COALESCE(g->>'city','')), ''),
      state = NULLIF(btrim(COALESCE(g->>'state','')), ''),
      nationality = COALESCE(_nation, nationality),
      country = COALESCE(_nation, country),
      gst_number = NULLIF(btrim(COALESCE(g->>'gst_number','')), ''),
      company = NULLIF(btrim(COALESCE(g->>'company','')), ''),
      notes = NULLIF(btrim(COALESCE(g->>'notes','')), ''),
      tags = COALESCE(
        (SELECT array_agg(x)::text[] FROM jsonb_array_elements_text(COALESCE(g->'tags','[]'::jsonb)) x),
        '{}'::text[]
      )
    WHERE id = _guest_id AND property_id = _property_id;
  ELSE
    INSERT INTO public.guests (
      property_id, name, mobile, email, dob, id_proof_type, id_proof_number,
      address, city, state, nationality, country, gst_number, company, notes, tags
    ) VALUES (
      _property_id,
      btrim(COALESCE(g->>'name','')),
      _mobile,
      NULLIF(btrim(COALESCE(g->>'email','')), ''),
      NULLIF(g->>'dob','')::date,
      NULLIF(btrim(COALESCE(g->>'id_proof_type','')), ''),
      NULLIF(btrim(COALESCE(g->>'id_proof_number','')), ''),
      NULLIF(btrim(COALESCE(g->>'address','')), ''),
      NULLIF(btrim(COALESCE(g->>'city','')), ''),
      NULLIF(btrim(COALESCE(g->>'state','')), ''),
      _nation,
      COALESCE(_nation, 'India'),
      NULLIF(btrim(COALESCE(g->>'gst_number','')), ''),
      NULLIF(btrim(COALESCE(g->>'company','')), ''),
      NULLIF(btrim(COALESCE(g->>'notes','')), ''),
      COALESCE(
        (SELECT array_agg(x)::text[] FROM jsonb_array_elements_text(COALESCE(g->'tags','[]'::jsonb)) x),
        '{}'::text[]
      )
    )
    RETURNING id INTO _guest_id;
  END IF;

  INSERT INTO public.bookings (
    property_id, booking_number, guest_id, source, ota_partner_name,
    billing_company_id, status, check_in, check_out, adults, children,
    total_amount, advance_amount, balance_amount, notes, custom_remark,
    event_id, created_by, rate_type, checked_in_at, checked_in_by
  ) VALUES (
    _property_id,
    '',
    _guest_id,
    COALESCE(payload->>'source', 'walk_in'),
    NULLIF(btrim(COALESCE(payload->>'ota_partner_name','')), ''),
    NULLIF(payload->>'billing_company_id','')::uuid,
    (CASE WHEN _check_in_now THEN 'checked_in' ELSE 'reserved' END)::booking_status,
    (payload->>'check_in')::date,
    (payload->>'check_out')::date,
    COALESCE((payload->>'adults')::int, 1),
    COALESCE((payload->>'children')::int, 0),
    COALESCE((payload->>'total_amount')::numeric, 0),
    _advance,
    COALESCE((payload->>'balance_amount')::numeric, 0),
    NULLIF(payload->>'notes',''),
    NULLIF(btrim(COALESCE(payload->>'custom_remark','')), ''),
    NULLIF(payload->>'event_id','')::uuid,
    _uid,
    COALESCE(payload->>'rate_type', 'exclusive'),
    CASE WHEN _check_in_now THEN _now ELSE NULL END,
    CASE WHEN _check_in_now THEN _uid ELSE NULL END
  )
  RETURNING id, booking_number INTO _booking_id, _booking_no;

  _room_id := NULLIF(payload->>'room_id','')::uuid;
  _effective_room := CASE WHEN COALESCE((payload->>'assign_later')::boolean, false) THEN NULL ELSE _room_id END;

  INSERT INTO public.booking_rooms (
    booking_id, property_id, room_id, category_id, tariff_id, meal_plan,
    rate, adults, children, check_in, check_out, actual_check_in
  ) VALUES (
    _booking_id, _property_id, _effective_room,
    NULLIF(payload->>'category_id','')::uuid,
    NULLIF(payload->>'tariff_id','')::uuid,
    COALESCE(payload->>'meal_plan','EP')::meal_plan,
    COALESCE((payload->>'rate')::numeric, 0),
    COALESCE((payload->>'adults')::int, 1),
    COALESCE((payload->>'children')::int, 0),
    (payload->>'check_in')::date,
    (payload->>'check_out')::date,
    CASE WHEN _check_in_now AND _effective_room IS NOT NULL THEN _now ELSE NULL END
  );

  IF COALESCE((payload->>'extra_bed_qty')::int, 0) > 0
     AND COALESCE((payload->>'extra_bed_rate')::numeric, 0) > 0 THEN
    INSERT INTO public.booking_extra_beds (
      property_id, booking_id, quantity, rate_per_night, added_from_date, added_by
    ) VALUES (
      _property_id, _booking_id,
      (payload->>'extra_bed_qty')::int,
      (payload->>'extra_bed_rate')::numeric,
      (payload->>'check_in')::date,
      _uid
    );
  END IF;

  IF _check_in_now AND _effective_room IS NOT NULL THEN
    UPDATE public.rooms SET status = 'occupied'::room_status WHERE id = _effective_room;
  END IF;

  IF _block_id IS NOT NULL THEN
    UPDATE public.event_room_blocks SET
      status = CASE WHEN _check_in_now THEN 'checked_in' ELSE 'blocked' END,
      booking_id = _booking_id,
      guest_id = _guest_id,
      guest_name = btrim(COALESCE(g->>'name','')),
      guest_mobile = _mobile,
      checked_in_at = CASE WHEN _check_in_now THEN _now ELSE NULL END,
      checked_in_by = CASE WHEN _check_in_now THEN _uid ELSE NULL END,
      updated_at = _now
    WHERE id = _block_id;
  END IF;

  INSERT INTO public.booking_guests (property_id, booking_id, guest_id, is_primary, relation_to_primary)
  VALUES (_property_id, _booking_id, _guest_id, true, 'self');

  FOR ex IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'extra_guests', '[]'::jsonb))
  LOOP
    CONTINUE WHEN NULLIF(btrim(COALESCE(ex->>'name','')), '') IS NULL;
    INSERT INTO public.guests (property_id, name, id_proof_type, id_proof_number, nationality, country, notes)
    VALUES (
      _property_id,
      btrim(ex->>'name'),
      NULLIF(btrim(COALESCE(ex->>'id_proof_type','')), ''),
      NULLIF(btrim(COALESCE(ex->>'id_proof_number','')), ''),
      _nation,
      _nation,
      'Additional guest for booking ' || COALESCE(_booking_no, '')
    )
    RETURNING id INTO _ex_guest_id;

    INSERT INTO public.booking_guests (property_id, booking_id, guest_id, is_primary, age, relation_to_primary)
    VALUES (
      _property_id, _booking_id, _ex_guest_id, false,
      NULLIF(ex->>'age','')::int,
      NULLIF(btrim(COALESCE(ex->>'relation','')), '')
    );
  END LOOP;

  IF _advance > 0 THEN
    _folio_id := public.get_or_create_folio(_booking_id);
    INSERT INTO public.payments (
      property_id, booking_id, folio_id, amount, mode, reference_no, notes, paid_at, created_by
    ) VALUES (
      _property_id, _booking_id, _folio_id, _advance,
      COALESCE(payload->>'payment_mode', 'cash'),
      NULLIF(btrim(COALESCE(payload->>'payment_ref','')), ''),
      'Advance at check-in',
      _now,
      _uid
    );

    INSERT INTO public.activity_log (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
    VALUES (
      _property_id, _uid, NULLIF(payload->>'actor_name',''), 'PAYMENT_RECEIVED', 'Billing',
      _booking_id, _booking_no,
      jsonb_build_object(
        'booking_id', _booking_id, 'folio_id', _folio_id,
        'amount', _advance, 'mode', COALESCE(payload->>'payment_mode','cash'),
        'source', 'booking_advance'
      )
    );
  END IF;

  INSERT INTO public.activity_log (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
  VALUES (
    _property_id, _uid, NULLIF(payload->>'actor_name',''), 'BOOKING_CREATED', 'Front Desk',
    _booking_id, _booking_no || ' — ' || btrim(COALESCE(g->>'name','')),
    jsonb_build_object(
      'check_in', payload->>'check_in',
      'check_out', payload->>'check_out',
      'room_id', _effective_room,
      'unassigned', (_effective_room IS NULL),
      'total', COALESCE((payload->>'total_amount')::numeric, 0)
    )
  );

  IF _check_in_now THEN
    INSERT INTO public.activity_log (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
    VALUES (
      _property_id, _uid, NULLIF(payload->>'actor_name',''), 'CHECKIN', 'Front Desk',
      _booking_id, _booking_no || ' — ' || btrim(COALESCE(g->>'name','')), '{}'::jsonb
    );
  END IF;

  RETURN jsonb_build_object(
    'booking_id', _booking_id,
    'booking_number', _booking_no,
    'guest_id', _guest_id,
    'room_id', _effective_room,
    'folio_id', _folio_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_booking(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_booking(jsonb) TO authenticated;