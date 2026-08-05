-- 1. allow early_checkin charge type
ALTER TABLE public.folio_charges DROP CONSTRAINT IF EXISTS folio_charges_charge_type_check;
ALTER TABLE public.folio_charges ADD CONSTRAINT folio_charges_charge_type_check
  CHECK (charge_type = ANY (ARRAY['room','food','laundry','extra','extra_bed','early_checkin','discount','tax']));

-- 2. early check-in slabs master (modeled on gst_slabs)
CREATE TABLE IF NOT EXISTS public.early_checkin_slabs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  from_hours numeric(5,2) NOT NULL DEFAULT 0,
  to_hours numeric(5,2) NOT NULL DEFAULT 0,
  charge_amount numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  effective_from date NOT NULL DEFAULT CURRENT_DATE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_early_checkin_slabs_lookup
  ON public.early_checkin_slabs (property_id, is_active, from_hours);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.early_checkin_slabs TO authenticated;
GRANT ALL ON public.early_checkin_slabs TO service_role;

ALTER TABLE public.early_checkin_slabs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "early_checkin_slabs_view" ON public.early_checkin_slabs FOR SELECT
  TO authenticated
  USING (user_has_property(auth.uid(), property_id));

CREATE POLICY "early_checkin_slabs_create" ON public.early_checkin_slabs FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT is_superadmin(auth.uid()))
    OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
    OR (property_id IN (SELECT permitted_property_ids(auth.uid(), 'master_data', 'create')))
  );

CREATE POLICY "early_checkin_slabs_edit" ON public.early_checkin_slabs FOR UPDATE
  TO authenticated
  USING (
    (SELECT is_superadmin(auth.uid()))
    OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
    OR (property_id IN (SELECT permitted_property_ids(auth.uid(), 'master_data', 'edit')))
  )
  WITH CHECK (
    (SELECT is_superadmin(auth.uid()))
    OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
    OR (property_id IN (SELECT permitted_property_ids(auth.uid(), 'master_data', 'edit')))
  );

CREATE POLICY "early_checkin_slabs_delete" ON public.early_checkin_slabs FOR DELETE
  TO authenticated
  USING (
    (SELECT is_superadmin(auth.uid()))
    OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
    OR (property_id IN (SELECT permitted_property_ids(auth.uid(), 'master_data', 'delete')))
  );

DROP TRIGGER IF EXISTS trg_early_checkin_slabs_updated_at ON public.early_checkin_slabs;
CREATE TRIGGER trg_early_checkin_slabs_updated_at
  BEFORE UPDATE ON public.early_checkin_slabs
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. resolver, mirroring get_gst_rate()
CREATE OR REPLACE FUNCTION public.get_early_checkin_charge(p_property_id uuid, p_hours_early numeric)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT charge_amount
    FROM public.early_checkin_slabs
   WHERE property_id = p_property_id
     AND COALESCE(is_active, true) = true
     AND effective_from <= CURRENT_DATE
     AND COALESCE(p_hours_early, 0) >= from_hours
     AND (to_hours IS NULL OR to_hours = 0 OR COALESCE(p_hours_early, 0) <= to_hours)
   ORDER BY from_hours DESC
   LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_early_checkin_charge(uuid, numeric) TO authenticated, service_role;

-- 4. create_booking: accept extra_beds[] and early_checkins[] inside the transaction
CREATE OR REPLACE FUNCTION public.create_booking(payload jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _first_room   uuid;
  _folio_id     uuid;
  _advance      numeric := COALESCE((payload->>'advance')::numeric, 0);
  _block_id     uuid := NULLIF(payload->>'block_id', '')::uuid;
  _rooms        jsonb;
  rm            jsonb;
  ex            jsonb;
  _ex_guest_id  uuid;
  eb            jsonb;
  ec            jsonb;
  _ec_amount    numeric;
  _ec_rate      numeric;
  _ec_gst       numeric;
  _ec_folio     uuid;
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

  _rooms := payload->'rooms';
  IF _rooms IS NULL OR jsonb_typeof(_rooms) <> 'array' OR jsonb_array_length(_rooms) = 0 THEN
    _rooms := jsonb_build_array(jsonb_build_object(
      'category_id', payload->>'category_id',
      'room_id', payload->>'room_id',
      'assign_later', COALESCE((payload->>'assign_later')::boolean, false),
      'tariff_id', payload->>'tariff_id',
      'meal_plan', COALESCE(payload->>'meal_plan','EP'),
      'rate', COALESCE((payload->>'rate')::numeric, 0),
      'check_in', payload->>'check_in',
      'check_out', payload->>'check_out'
    ));
  END IF;

  FOR rm IN SELECT * FROM jsonb_array_elements(_rooms)
  LOOP
    _room_id := NULLIF(rm->>'room_id','')::uuid;
    _effective_room := CASE WHEN COALESCE((rm->>'assign_later')::boolean, false) THEN NULL ELSE _room_id END;
    IF _first_room IS NULL THEN _first_room := _effective_room; END IF;

    INSERT INTO public.booking_rooms (
      booking_id, property_id, room_id, category_id, tariff_id, meal_plan,
      rate, adults, children, check_in, check_out, actual_check_in
    ) VALUES (
      _booking_id, _property_id, _effective_room,
      NULLIF(rm->>'category_id','')::uuid,
      NULLIF(rm->>'tariff_id','')::uuid,
      COALESCE(NULLIF(rm->>'meal_plan',''),'EP')::meal_plan,
      COALESCE((rm->>'rate')::numeric, 0),
      COALESCE((rm->>'adults')::int, (payload->>'adults')::int, 1),
      COALESCE((rm->>'children')::int, (payload->>'children')::int, 0),
      COALESCE(NULLIF(rm->>'check_in',''), payload->>'check_in')::date,
      COALESCE(NULLIF(rm->>'check_out',''), payload->>'check_out')::date,
      CASE WHEN _check_in_now AND _effective_room IS NOT NULL THEN _now ELSE NULL END
    );

    IF _check_in_now AND _effective_room IS NOT NULL THEN
      UPDATE public.rooms SET status = 'occupied'::room_status WHERE id = _effective_room;
    END IF;
  END LOOP;

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

  -- Per-room extra beds from the wizard (array form).
  FOR eb IN SELECT * FROM jsonb_array_elements(COALESCE(payload->'extra_beds', '[]'::jsonb))
  LOOP
    CONTINUE WHEN COALESCE((eb->>'qty')::int, 0) <= 0;
    CONTINUE WHEN COALESCE((eb->>'rate')::numeric, 0) <= 0;
    INSERT INTO public.booking_extra_beds (
      property_id, booking_id, quantity, rate_per_night, added_from_date, added_by
    ) VALUES (
      _property_id, _booking_id,
      (eb->>'qty')::int,
      (eb->>'rate')::numeric,
      COALESCE(NULLIF(eb->>'from_date','')::date, (payload->>'check_in')::date),
      _uid
    );
  END LOOP;

  -- Early check-in charges (folio_charges, room GST category).
  IF jsonb_array_length(COALESCE(payload->'early_checkins', '[]'::jsonb)) > 0 THEN
    _ec_folio := public.get_or_create_folio(_booking_id);
    FOR ec IN SELECT * FROM jsonb_array_elements(payload->'early_checkins')
    LOOP
      _ec_amount := COALESCE((ec->>'amount')::numeric, 0);
      CONTINUE WHEN _ec_amount <= 0;
      _ec_rate := COALESCE(public.get_gst_rate(_property_id, 'room', _ec_amount), 0);
      _ec_gst := ROUND((_ec_amount * _ec_rate / 100)::numeric, 2);
      INSERT INTO public.folio_charges (
        folio_id, charge_type, description, qty, rate, amount,
        gst_rate, gst_amount, charged_on, source_table, created_by
      ) VALUES (
        _ec_folio, 'early_checkin',
        COALESCE(NULLIF(btrim(ec->>'description'), ''), 'Early Check-in'),
        1, _ec_amount, _ec_amount, _ec_rate, _ec_gst,
        COALESCE(NULLIF(ec->>'charged_on','')::date, (payload->>'check_in')::date),
        'early_checkin', _uid
      );
    END LOOP;
    PERFORM public.recompute_folio_totals(_ec_folio);
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

    INSERT INTO public.activity_log (property_id, user_id, user_name, action_type, module, reference_id, description)
    VALUES (
      _property_id, _uid, NULLIF(btrim(COALESCE(payload->>'actor_name','')), ''),
      'payment_received', 'billing', _booking_id,
      'Advance ' || _advance::text || ' collected for booking ' || COALESCE(_booking_no, '')
    );
  END IF;

  IF _folio_id IS NULL THEN
    SELECT f.id INTO _folio_id FROM public.folios f
     WHERE f.booking_id = _booking_id AND COALESCE(f.is_deleted,false) = false
     ORDER BY f.created_at DESC LIMIT 1;
  END IF;

  INSERT INTO public.activity_log (property_id, user_id, user_name, action_type, module, reference_id, description)
  VALUES (
    _property_id, _uid, NULLIF(btrim(COALESCE(payload->>'actor_name','')), ''),
    CASE WHEN _check_in_now THEN 'check_in' ELSE 'booking_created' END,
    'front_desk', _booking_id,
    'Booking ' || COALESCE(_booking_no, '') || ' for ' || btrim(COALESCE(g->>'name',''))
  );

  RETURN jsonb_build_object(
    'booking_id', _booking_id,
    'booking_number', _booking_no,
    'guest_id', _guest_id,
    'room_id', _first_room,
    'folio_id', _folio_id
  );
END $function$;
