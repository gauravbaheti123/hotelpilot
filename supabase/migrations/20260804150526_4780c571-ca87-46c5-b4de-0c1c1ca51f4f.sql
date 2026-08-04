-- 1. explicit link between legacy mirror and unified event booking
ALTER TABLE public.banquet_bookings
  ADD COLUMN IF NOT EXISTS event_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_banquet_bookings_event_booking
  ON public.banquet_bookings(event_booking_id);

UPDATE public.banquet_bookings bb
   SET event_booking_id = b.id
  FROM public.bookings b
 WHERE b.booking_type = 'banquet'
   AND b.property_id = bb.property_id
   AND b.banquet_number = bb.banquet_number
   AND bb.event_booking_id IS DISTINCT FROM b.id;

-- 2. resolve either id space to both ids
CREATE OR REPLACE FUNCTION public.resolve_event_ids(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE v_booking uuid; v_legacy uuid;
BEGIN
  SELECT b.id, bb.id INTO v_booking, v_legacy
    FROM public.bookings b
    LEFT JOIN public.banquet_bookings bb
      ON bb.property_id = b.property_id AND bb.banquet_number = b.banquet_number
   WHERE b.id = _id AND b.booking_type = 'banquet';
  IF v_booking IS NOT NULL THEN
    RETURN jsonb_build_object('booking_id', v_booking, 'banquet_booking_id', v_legacy);
  END IF;

  SELECT bb.id, COALESCE(bb.event_booking_id,
           (SELECT b2.id FROM public.bookings b2
             WHERE b2.booking_type='banquet' AND b2.property_id = bb.property_id
               AND b2.banquet_number = bb.banquet_number LIMIT 1))
    INTO v_legacy, v_booking
    FROM public.banquet_bookings bb WHERE bb.id = _id;
  IF v_legacy IS NULL THEN RETURN NULL; END IF;

  IF v_booking IS NULL THEN
    v_booking := public.ensure_event_booking(v_legacy);
    UPDATE public.banquet_bookings SET event_booking_id = v_booking WHERE id = v_legacy;
  END IF;
  RETURN jsonb_build_object('booking_id', v_booking, 'banquet_booking_id', v_legacy);
END $$;

-- 3. create a banquet event on the unified model (+ legacy mirror)
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

  RETURN jsonb_build_object('booking_id', v_bid, 'banquet_booking_id', v_lid, 'banquet_number', v_num);
END $$;

GRANT EXECUTE ON FUNCTION public.create_event_booking(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_event_ids(uuid) TO authenticated;

-- 4. keep the two rows mirrored (guarded against recursion)
CREATE OR REPLACE FUNCTION public.tg_sync_event_booking_to_mirror()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  IF COALESCE(NEW.booking_type,'lodge') <> 'banquet' OR NEW.banquet_number IS NULL THEN RETURN NEW; END IF;
  UPDATE public.banquet_bookings SET
    hall_id = NEW.hall_id, guest_id = NEW.guest_id,
    function_type = COALESCE(NEW.function_type, function_type),
    event_date = COALESCE(NEW.event_date, NEW.check_in),
    event_end_date = COALESCE(NEW.event_end_date, NEW.check_out),
    start_time = COALESCE(NEW.start_time, start_time),
    end_time = COALESCE(NEW.end_time, end_time),
    pax = COALESCE(NEW.pax, pax),
    package_rate = COALESCE(NEW.package_rate, package_rate),
    hall_charge = COALESCE(NEW.hall_charge, hall_charge),
    fb_charge = COALESCE(NEW.fb_charge, fb_charge),
    extra_charge = COALESCE(NEW.extra_charge, extra_charge),
    extra_charge_description = NEW.extra_charge_description,
    discount_amount = COALESCE(NEW.discount_amount, discount_amount),
    round_off_amount = COALESCE(NEW.round_off_amount, round_off_amount),
    total_amount = COALESCE(NEW.total_amount, total_amount),
    advance_amount = COALESCE(NEW.advance_amount, advance_amount),
    balance_amount = COALESCE(NEW.balance_amount, balance_amount),
    event_name = NEW.event_name,
    host_name = NEW.host_name, host_mobile = NEW.host_mobile, host_email = NEW.host_email,
    notes = NEW.notes,
    cancelled_at = NEW.cancelled_at, cancelled_reason = NEW.cancelled_reason,
    status = CASE WHEN NEW.status::text = 'cancelled' THEN 'cancelled' ELSE status END,
    event_booking_id = NEW.id,
    updated_at = now()
  WHERE property_id = NEW.property_id AND banquet_number = NEW.banquet_number;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_event_booking_to_mirror ON public.bookings;
CREATE TRIGGER trg_sync_event_booking_to_mirror
AFTER UPDATE ON public.bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_event_booking_to_mirror();

CREATE OR REPLACE FUNCTION public.tg_sync_mirror_to_event_booking()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF pg_trigger_depth() > 1 THEN RETURN NEW; END IF;
  UPDATE public.bookings SET
    hall_id = NEW.hall_id, guest_id = NEW.guest_id,
    function_type = NEW.function_type,
    event_date = NEW.event_date,
    event_end_date = COALESCE(NEW.event_end_date, NEW.event_date),
    check_in = NEW.event_date,
    check_out = COALESCE(NEW.event_end_date, NEW.event_date),
    start_time = NEW.start_time, end_time = NEW.end_time, pax = NEW.pax,
    package_rate = NEW.package_rate, hall_charge = NEW.hall_charge,
    fb_charge = NEW.fb_charge, extra_charge = NEW.extra_charge,
    extra_charge_description = NEW.extra_charge_description,
    discount_amount = NEW.discount_amount, round_off_amount = NEW.round_off_amount,
    total_amount = NEW.total_amount, advance_amount = NEW.advance_amount,
    balance_amount = NEW.balance_amount,
    event_name = NEW.event_name, host_name = NEW.host_name,
    host_mobile = NEW.host_mobile, host_email = NEW.host_email, notes = NEW.notes,
    cancelled_at = NEW.cancelled_at, cancelled_reason = NEW.cancelled_reason,
    status = CASE WHEN NEW.status = 'cancelled' THEN 'cancelled'::booking_status ELSE status END,
    updated_at = now()
  WHERE booking_type = 'banquet' AND property_id = NEW.property_id
    AND banquet_number = NEW.banquet_number;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_sync_mirror_to_event_booking ON public.banquet_bookings;
CREATE TRIGGER trg_sync_mirror_to_event_booking
AFTER UPDATE ON public.banquet_bookings
FOR EACH ROW EXECUTE FUNCTION public.tg_sync_mirror_to_event_booking();

-- 5. itemised extras + discount on the event folio
CREATE OR REPLACE FUNCTION public.seed_event_folio_charges(_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  b        public.bookings%ROWTYPE;
  v_folio  uuid;
  v_hall   numeric(12,2);
  v_rate   numeric(5,2);
  v_desc   text;
  v_legacy uuid;
  v_has_items boolean := false;
  r        record;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF COALESCE(b.booking_type,'lodge') <> 'banquet' THEN
    RAISE EXCEPTION 'seed_event_folio_charges: booking % is not a banquet booking', _booking_id;
  END IF;

  v_folio := public.get_or_create_folio(_booking_id);

  v_hall := COALESCE(NULLIF(b.hall_charge, 0),
                     ROUND(COALESCE(b.package_rate,0) * COALESCE(b.pax,0), 2));

  IF COALESCE(v_hall,0) > 0 THEN
    v_rate := public.event_gst_rate(b.property_id, v_hall);
    v_desc := COALESCE(NULLIF(btrim(COALESCE(b.event_name,'')),''),
                       NULLIF(btrim(COALESCE(b.function_type,'')),''),
                       'Banquet Event');
    IF NOT EXISTS (
      SELECT 1 FROM public.folio_charges
       WHERE folio_id = v_folio AND source_table = 'booking_event_hall'
         AND source_id = b.id AND COALESCE(is_wiped,false) = false
    ) THEN
      INSERT INTO public.folio_charges
        (folio_id, charge_type, description, qty, rate, amount, gst_rate, gst_amount,
         source_table, source_id, charged_on, created_by)
      VALUES
        (v_folio, 'extra', 'Hall Charge - ' || v_desc, 1, v_hall, v_hall,
         v_rate, ROUND(v_hall * v_rate / 100.0, 2),
         'booking_event_hall', b.id, COALESCE(b.event_date, b.check_in), b.created_by);
    END IF;
  END IF;

  -- itemised extras from the legacy extras table (same event, matched by number)
  SELECT id INTO v_legacy FROM public.banquet_bookings
   WHERE property_id = b.property_id AND banquet_number = b.banquet_number LIMIT 1;

  IF v_legacy IS NOT NULL THEN
    FOR r IN
      SELECT id, point_name, amount, COALESCE(discount_amount,0) AS disc
        FROM public.banquet_extra_charges
       WHERE banquet_booking_id = v_legacy AND COALESCE(amount,0) > 0
       ORDER BY sort_order, created_at
    LOOP
      v_has_items := true;
      v_rate := public.event_gst_rate(b.property_id, r.amount - r.disc);
      IF EXISTS (SELECT 1 FROM public.folio_charges
                  WHERE folio_id = v_folio AND source_table = 'banquet_extra_charge'
                    AND source_id = r.id AND COALESCE(is_wiped,false) = false) THEN
        UPDATE public.folio_charges
           SET description = r.point_name, rate = r.amount - r.disc, amount = r.amount - r.disc,
               gst_rate = v_rate, gst_amount = ROUND((r.amount - r.disc) * v_rate / 100.0, 2)
         WHERE folio_id = v_folio AND source_table = 'banquet_extra_charge' AND source_id = r.id;
      ELSE
        INSERT INTO public.folio_charges
          (folio_id, charge_type, description, qty, rate, amount, gst_rate, gst_amount,
           source_table, source_id, charged_on, created_by)
        VALUES
          (v_folio, 'extra', r.point_name, 1, r.amount - r.disc, r.amount - r.disc,
           v_rate, ROUND((r.amount - r.disc) * v_rate / 100.0, 2),
           'banquet_extra_charge', r.id, COALESCE(b.event_date, b.check_in), b.created_by);
      END IF;
    END LOOP;

    DELETE FROM public.folio_charges
     WHERE folio_id = v_folio AND source_table = 'banquet_extra_charge'
       AND source_id NOT IN (SELECT id FROM public.banquet_extra_charges
                              WHERE banquet_booking_id = v_legacy AND COALESCE(amount,0) > 0);
  END IF;

  -- aggregate extra line only when there are no itemised extras
  IF NOT v_has_items AND COALESCE(b.extra_charge,0) > 0 THEN
    v_rate := public.event_gst_rate(b.property_id, b.extra_charge);
    IF NOT EXISTS (
      SELECT 1 FROM public.folio_charges
       WHERE folio_id = v_folio AND source_table = 'booking_event_extra'
         AND source_id = b.id AND COALESCE(is_wiped,false) = false
    ) THEN
      INSERT INTO public.folio_charges
        (folio_id, charge_type, description, qty, rate, amount, gst_rate, gst_amount,
         source_table, source_id, charged_on, created_by)
      VALUES
        (v_folio, 'extra',
         COALESCE(NULLIF(btrim(COALESCE(b.extra_charge_description,'')),''), 'Extra Charges'),
         1, b.extra_charge, b.extra_charge,
         v_rate, ROUND(b.extra_charge * v_rate / 100.0, 2),
         'booking_event_extra', b.id, COALESCE(b.event_date, b.check_in), b.created_by);
    END IF;
  ELSIF v_has_items THEN
    DELETE FROM public.folio_charges
     WHERE folio_id = v_folio AND source_table = 'booking_event_extra' AND source_id = b.id;
  END IF;

  -- event-level discount travels to the folio
  UPDATE public.folios SET discount_amount = COALESCE(b.discount_amount, 0)
   WHERE id = v_folio AND COALESCE(discount_amount,0) IS DISTINCT FROM COALESCE(b.discount_amount,0);

  PERFORM public.recompute_folio_totals(v_folio);
  RETURN v_folio;
END $$;

GRANT EXECUTE ON FUNCTION public.seed_event_folio_charges(uuid) TO authenticated;