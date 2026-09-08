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

  -- Editable until the guest actually checks out. A bill settled in advance
  -- (guest still in house) no longer freezes the booking.
  IF _status NOT IN ('reserved', 'checked_in') THEN
    RAISE EXCEPTION 'This booking can no longer be edited (status: %)', _status;
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

        INSERT INTO public.booking_guests (booking_id, guest_id, is_primary, relation_to_primary, age)
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
          relation_to_primary = NULLIF(btrim(COALESCE(ex->>'relation','')), ''),
          age      = NULLIF(ex->>'age','')::int
        WHERE booking_id = _booking_id AND guest_id = _ex_guest_id;
      END IF;
    END LOOP;
  END IF;

  RETURN jsonb_build_object('booking_id', _booking_id, 'booking_number', _booking_no);
END;
$function$;

CREATE OR REPLACE FUNCTION public.undo_checkout(_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_folio   public.folios%ROWTYPE;
  v_room_ids uuid[];
  v_conflict int;
  v_privileged boolean;
  v_normal boolean;
  v_grace boolean;
  v_segment text := 'lodge';
  v_prefix text;
  v_suffix text;
  v_num int;
  v_last int;
  v_released text;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  v_normal := public.can_front_desk(auth.uid(), v_booking.property_id);
  v_grace  := public.in_grace_window(v_booking.checked_out_at)
              AND (
                public.is_superadmin(auth.uid())
                OR public.is_global_owner(auth.uid())
                OR v_booking.property_id IN (SELECT public.my_property_ids(auth.uid()))
              );

  IF NOT (v_normal OR v_grace) THEN
    RAISE EXCEPTION 'Not authorised to undo checkout';
  END IF;

  IF v_booking.status <> 'checked_out' THEN
    RAISE EXCEPTION 'Booking is not in checked-out state';
  END IF;
  IF v_booking.checked_out_at IS NULL THEN
    RAISE EXCEPTION 'Checkout timestamp is missing';
  END IF;

  v_privileged := public.has_role(auth.uid(), 'owner'::app_role)
               OR public.has_role(auth.uid(), 'superadmin'::app_role)
               OR public.has_role(auth.uid(), 'manager'::app_role);

  IF NOT v_privileged AND now() - v_booking.checked_out_at > interval '60 minutes' THEN
    RAISE EXCEPTION 'Undo window (60 minutes) has passed';
  END IF;

  IF public.is_day_locked(v_booking.property_id, v_booking.checked_out_at::date) THEN
    RAISE EXCEPTION 'Day is locked by Night Audit; cannot undo checkout';
  END IF;

  SELECT array_agg(room_id) INTO v_room_ids
    FROM public.booking_rooms
    WHERE booking_id = _booking_id AND room_id IS NOT NULL;

  IF v_room_ids IS NOT NULL AND array_length(v_room_ids, 1) > 0 THEN
    SELECT count(*) INTO v_conflict
      FROM public.bookings b2
      JOIN public.booking_rooms br ON br.booking_id = b2.id
      WHERE br.room_id = ANY(v_room_ids)
        AND b2.id <> _booking_id
        AND b2.status = 'checked_out'
        AND b2.checked_out_at > v_booking.checked_out_at;
    IF v_conflict > 0 THEN
      RAISE EXCEPTION 'A newer checkout exists on this room; undo not allowed';
    END IF;

    SELECT count(*) INTO v_conflict
      FROM public.booking_rooms br
      JOIN public.bookings b2 ON b2.id = br.booking_id
      WHERE br.room_id = ANY(v_room_ids)
        AND br.booking_id <> _booking_id
        AND COALESCE(br.status,'active') IN ('active','reserved','checked_in')
        AND COALESCE(b2.status,'reserved') NOT IN ('cancelled','no_show','checked_out');
    IF v_conflict > 0 THEN
      RAISE EXCEPTION 'Room has been reassigned to another booking; undo not allowed';
    END IF;
  END IF;

  SELECT * INTO v_folio FROM public.folios
    WHERE booking_id = _booking_id
      AND COALESCE(is_deleted, false) = false
      AND status <> 'void'
    ORDER BY created_at DESC LIMIT 1;

  -- Release the invoice number: the bill is no longer final, so the number must
  -- not stay consumed. When it is the most recent number of its series, the
  -- counter steps back so the next real checkout receives the same number.
  IF v_folio.id IS NOT NULL AND COALESCE(btrim(v_folio.invoice_number), '') <> '' THEN
    v_released := btrim(v_folio.invoice_number);

    IF COALESCE(v_booking.source,'') = 'event_block'
       OR COALESCE(v_booking.booking_type::text,'') = 'banquet' THEN
      v_segment := 'banquet';
    END IF;

    SELECT prefix, last_number INTO v_prefix, v_last
      FROM public.bill_sequences
     WHERE property_id = v_booking.property_id
       AND sequence_type = v_segment
     FOR UPDATE;

    IF v_prefix IS NOT NULL AND v_released LIKE v_prefix || '%' THEN
      v_suffix := substring(v_released from length(v_prefix) + 1);
      IF v_suffix ~ '^[0-9]+$' THEN
        v_num := v_suffix::int;
        IF v_num = v_last THEN
          UPDATE public.bill_sequences
             SET last_number = GREATEST(v_num - 1, 0), updated_at = now()
           WHERE property_id = v_booking.property_id
             AND sequence_type = v_segment;
        END IF;
      END IF;
    END IF;
  END IF;

  INSERT INTO public.checkout_undo_log (booking_id, folio_id, undone_by, original_checkout_at, property_id)
  VALUES (_booking_id, v_folio.id, auth.uid(), v_booking.checked_out_at, v_booking.property_id);

  IF v_folio.id IS NOT NULL THEN
    UPDATE public.folios
       SET status = 'open',
           settled_at = NULL,
           invoice_number = NULL,
           is_reopened = true,
           updated_at = now()
     WHERE id = v_folio.id;
  END IF;

  UPDATE public.bookings
     SET status = 'checked_in',
         checked_out_at = NULL,
         checked_out_by = NULL,
         updated_at = now()
   WHERE id = _booking_id;

  UPDATE public.booking_rooms
     SET actual_check_out = NULL,
         status = 'active',
         updated_at = now()
   WHERE booking_id = _booking_id;

  IF v_room_ids IS NOT NULL AND array_length(v_room_ids, 1) > 0 THEN
    UPDATE public.rooms
       SET status = 'occupied',
           updated_at = now()
     WHERE id = ANY(v_room_ids);
  END IF;

  INSERT INTO public.activity_log
    (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
  VALUES (
    v_booking.property_id, auth.uid(),
    COALESCE((SELECT display_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    'CHECKOUT_UNDONE', 'Front Desk', _booking_id,
    COALESCE('Undo checkout · released ' || v_released, 'Undo checkout'),
    jsonb_build_object(
      'booking_id', _booking_id,
      'folio_id', v_folio.id,
      'original_checkout_at', v_booking.checked_out_at,
      'released_invoice_number', v_released,
      'via_grace_window', (NOT v_normal AND v_grace)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', _booking_id,
    'folio_id', v_folio.id,
    'original_checkout_at', v_booking.checked_out_at,
    'released_invoice_number', v_released,
    'via_grace_window', (NOT v_normal AND v_grace),
    'privileged_override', v_privileged AND now() - v_booking.checked_out_at > interval '60 minutes'
  );
END $function$;