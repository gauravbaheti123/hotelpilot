
CREATE OR REPLACE FUNCTION public.update_booking_safe_fields(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _booking_id uuid := NULLIF(payload->>'booking_id','')::uuid;
  _uid        uuid := auth.uid();
  _now        timestamptz := now();
  _property_id uuid;
  _status     text;
  _booking_no text;
  _guest_id   uuid;
  g           jsonb := COALESCE(payload->'guest', '{}'::jsonb);
  _nation     text;
  _mobile     text;
  ex          jsonb;
  _ex_guest_id uuid;
  _settled    int;
BEGIN
  IF _booking_id IS NULL THEN
    RAISE EXCEPTION 'booking_id is required';
  END IF;

  SELECT b.property_id, b.status::text, b.booking_number, b.guest_id
    INTO _property_id, _status, _booking_no, _guest_id
  FROM public.bookings b
  WHERE b.id = _booking_id
  FOR UPDATE;

  IF _property_id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF NOT public.has_permission(_uid, _property_id, 'bookings', 'edit') THEN
    RAISE EXCEPTION 'Not allowed to edit bookings for this property';
  END IF;

  IF _status NOT IN ('reserved', 'checked_in') THEN
    RAISE EXCEPTION 'This booking can no longer be edited (status: %)', _status;
  END IF;

  SELECT count(*) INTO _settled
  FROM public.folios f
  WHERE f.booking_id = _booking_id
    AND COALESCE(f.is_deleted, false) = false
    AND f.status <> 'open';
  IF _settled > 0 THEN
    RAISE EXCEPTION 'This booking has already been billed and can no longer be edited';
  END IF;

  _nation := NULLIF(btrim(COALESCE(g->>'nation','')), '');
  _mobile := NULLIF(btrim(COALESCE(g->>'mobile','')), '');

  -- Primary guest profile (never re-pointed to another guest row).
  IF _guest_id IS NOT NULL AND jsonb_typeof(payload->'guest') = 'object' THEN
    UPDATE public.guests SET
      name            = COALESCE(NULLIF(btrim(g->>'name'), ''), name),
      mobile          = COALESCE(_mobile, mobile),
      email           = NULLIF(btrim(COALESCE(g->>'email','')), ''),
      dob             = NULLIF(g->>'dob','')::date,
      id_proof_type   = NULLIF(btrim(COALESCE(g->>'id_proof_type','')), ''),
      id_proof_number = NULLIF(btrim(COALESCE(g->>'id_proof_number','')), ''),
      address         = NULLIF(btrim(COALESCE(g->>'address','')), ''),
      city            = NULLIF(btrim(COALESCE(g->>'city','')), ''),
      state           = NULLIF(btrim(COALESCE(g->>'state','')), ''),
      pincode         = NULLIF(btrim(COALESCE(g->>'pincode','')), ''),
      nationality     = COALESCE(_nation, nationality),
      country         = COALESCE(_nation, country),
      gst_number      = NULLIF(btrim(COALESCE(g->>'gst_number','')), ''),
      company         = NULLIF(btrim(COALESCE(g->>'company','')), '')
    WHERE id = _guest_id AND property_id = _property_id;
  END IF;

  -- Booking-level safe fields.
  UPDATE public.bookings SET
    adults              = COALESCE(NULLIF(payload->>'adults','')::int, adults),
    children            = COALESCE(NULLIF(payload->>'children','')::int, children),
    custom_remark       = CASE WHEN payload ? 'custom_remark'
                               THEN NULLIF(btrim(COALESCE(payload->>'custom_remark','')), '')
                               ELSE custom_remark END,
    billing_company_id  = CASE WHEN payload ? 'billing_company_id'
                               THEN NULLIF(payload->>'billing_company_id','')::uuid
                               ELSE billing_company_id END,
    notes               = CASE WHEN payload ? 'notes'
                               THEN NULLIF(btrim(COALESCE(payload->>'notes','')), '')
                               ELSE notes END,
    updated_at          = _now
  WHERE id = _booking_id;

  -- Accompanying guests are replaced wholesale when provided.
  IF jsonb_typeof(payload->'extra_guests') = 'array' THEN
    DELETE FROM public.booking_guests bg
    WHERE bg.booking_id = _booking_id AND bg.is_primary = false;

    FOR ex IN SELECT * FROM jsonb_array_elements(payload->'extra_guests')
    LOOP
      CONTINUE WHEN NULLIF(btrim(COALESCE(ex->>'name','')), '') IS NULL;

      _ex_guest_id := NULLIF(ex->>'guest_id','')::uuid;
      IF _ex_guest_id IS NULL THEN
        INSERT INTO public.guests (property_id, name, mobile, id_proof_type, id_proof_number, nationality, country, notes)
        VALUES (
          _property_id,
          btrim(ex->>'name'),
          NULLIF(btrim(COALESCE(ex->>'mobile','')), ''),
          NULLIF(btrim(COALESCE(ex->>'id_proof_type','')), ''),
          NULLIF(btrim(COALESCE(ex->>'id_proof_number','')), ''),
          _nation, _nation,
          'Additional guest for booking ' || COALESCE(_booking_no, '')
        )
        RETURNING id INTO _ex_guest_id;
      END IF;

      INSERT INTO public.booking_guests (property_id, booking_id, guest_id, is_primary, age, relation_to_primary)
      VALUES (
        _property_id, _booking_id, _ex_guest_id, false,
        NULLIF(ex->>'age','')::int,
        NULLIF(btrim(COALESCE(ex->>'relation','')), '')
      );
    END LOOP;
  END IF;

  INSERT INTO public.activity_log (property_id, user_id, user_name, action_type, module, reference_id, description)
  VALUES (
    _property_id, _uid, NULLIF(btrim(COALESCE(payload->>'actor_name','')), ''),
    'booking_modified', 'front_desk', _booking_id,
    'Booking ' || COALESCE(_booking_no, '') || ' details edited'
  );

  RETURN jsonb_build_object('booking_id', _booking_id, 'guest_id', _guest_id);
END
$$;

REVOKE ALL ON FUNCTION public.update_booking_safe_fields(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.update_booking_safe_fields(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_booking_safe_fields(jsonb) TO service_role;
