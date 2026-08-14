CREATE OR REPLACE FUNCTION public.update_booking_safe_fields(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _company_id uuid;
  _company_name text;
  _company_gstin text;
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

  UPDATE public.bookings SET
    adults              = COALESCE(NULLIF(payload->>'adults','')::int, adults),
    children            = COALESCE(NULLIF(payload->>'children','')::int, children),
    custom_remark       = CASE WHEN payload ? 'custom_remark'
                               THEN NULLIF(btrim(COALESCE(payload->>'custom_remark','')), '')
                               ELSE custom_remark END,
    source              = CASE WHEN payload ? 'source'
                               THEN COALESCE(NULLIF(btrim(COALESCE(payload->>'source','')), ''), source)
                               ELSE source END,
    ota_partner_name    = CASE WHEN payload ? 'ota_partner_name'
                               THEN NULLIF(btrim(COALESCE(payload->>'ota_partner_name','')), '')
                               ELSE ota_partner_name END,
    billing_company_id  = CASE WHEN payload ? 'billing_company_id'
                               THEN NULLIF(payload->>'billing_company_id','')::uuid
                               ELSE billing_company_id END,
    notes               = CASE WHEN payload ? 'notes'
                               THEN NULLIF(btrim(COALESCE(payload->>'notes','')), '')
                               ELSE notes END,
    updated_at          = _now
  WHERE id = _booking_id;

  IF payload ? 'billing_company_id' THEN
    _company_id := NULLIF(payload->>'billing_company_id','')::uuid;
    IF _company_id IS NOT NULL THEN
      SELECT name, gstin INTO _company_name, _company_gstin
      FROM public.billing_companies WHERE id = _company_id;
    ELSE
      _company_name := NULL; _company_gstin := NULL;
    END IF;

    UPDATE public.folios f SET
      billing_company_id = _company_id,
      billing_guest_id   = CASE WHEN _company_id IS NOT NULL THEN NULL ELSE f.billing_guest_id END,
      guest_company      = CASE WHEN _company_id IS NOT NULL THEN _company_name ELSE NULL END,
      guest_gstin        = CASE WHEN _company_id IS NOT NULL THEN _company_gstin ELSE f.guest_gstin END,
      updated_at         = _now
    WHERE f.booking_id = _booking_id
      AND COALESCE(f.is_deleted, false) = false
      AND f.status = 'open';
  END IF;

  -- Extra guests (replace-in-place, same as before).
  IF jsonb_typeof(payload->'extra_guests') = 'array' THEN
    DELETE FROM public.booking_guests bg
    WHERE bg.booking_id = _booking_id
      AND bg.guest_id IS DISTINCT FROM _guest_id
      AND bg.guest_id NOT IN (
        SELECT NULLIF(x->>'guest_id','')::uuid
        FROM jsonb_array_elements(payload->'extra_guests') x
        WHERE NULLIF(x->>'guest_id','') IS NOT NULL
      );

    FOR ex IN SELECT * FROM jsonb_array_elements(payload->'extra_guests') LOOP
      _ex_guest_id := NULLIF(ex->>'guest_id','')::uuid;
      IF _ex_guest_id IS NULL THEN
        INSERT INTO public.guests (property_id, name, mobile, id_proof_type, id_proof_number)
        VALUES (_property_id,
                btrim(ex->>'name'),
                NULLIF(btrim(COALESCE(ex->>'mobile','')), ''),
                NULLIF(btrim(COALESCE(ex->>'id_proof_type','')), ''),
                NULLIF(btrim(COALESCE(ex->>'id_proof_number','')), ''))
        RETURNING id INTO _ex_guest_id;

        INSERT INTO public.booking_guests (booking_id, guest_id, is_primary, relation, age)
        VALUES (_booking_id, _ex_guest_id, false,
                NULLIF(btrim(COALESCE(ex->>'relation','')), ''),
                NULLIF(ex->>'age','')::int);
      ELSE
        UPDATE public.guests SET
          name            = COALESCE(NULLIF(btrim(ex->>'name'), ''), name),
          mobile          = NULLIF(btrim(COALESCE(ex->>'mobile','')), ''),
          id_proof_type   = NULLIF(btrim(COALESCE(ex->>'id_proof_type','')), ''),
          id_proof_number = NULLIF(btrim(COALESCE(ex->>'id_proof_number','')), '')
        WHERE id = _ex_guest_id AND property_id = _property_id;

        UPDATE public.booking_guests SET
          relation = NULLIF(btrim(COALESCE(ex->>'relation','')), ''),
          age      = NULLIF(ex->>'age','')::int
        WHERE booking_id = _booking_id AND guest_id = _ex_guest_id;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('booking_id', _booking_id, 'booking_number', _booking_no);
END;
$function$;