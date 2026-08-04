-- ============ 1. NEW COLUMNS ON bookings ============
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS event_status text,
  ADD COLUMN IF NOT EXISTS total_room_charges numeric(12,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS bill_type text,
  ADD COLUMN IF NOT EXISTS line_discounts jsonb,
  ADD COLUMN IF NOT EXISTS advance_payment_mode text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'bookings_event_status_check') THEN
    ALTER TABLE public.bookings
      ADD CONSTRAINT bookings_event_status_check
      CHECK (event_status IS NULL OR event_status IN ('confirmed','in_progress','completed','cancelled'));
  END IF;
END $$;

-- backfill from the legacy mirror
UPDATE public.bookings b
   SET total_room_charges   = COALESCE(bb.total_room_charges, 0),
       bill_type            = COALESCE(b.bill_type, bb.bill_type),
       line_discounts       = COALESCE(b.line_discounts, bb.line_discounts),
       advance_payment_mode = COALESCE(b.advance_payment_mode, bb.advance_payment_mode),
       event_status         = COALESCE(b.event_status,
                                CASE lower(COALESCE(bb.status,''))
                                  WHEN 'completed'   THEN 'completed'
                                  WHEN 'checked_out' THEN 'completed'
                                  WHEN 'in_progress' THEN 'in_progress'
                                  WHEN 'checked_in'  THEN 'in_progress'
                                  WHEN 'cancelled'   THEN 'cancelled'
                                  ELSE 'confirmed'
                                END)
  FROM public.banquet_bookings bb
 WHERE b.booking_type = 'banquet'
   AND (bb.event_booking_id = b.id
        OR (bb.property_id = b.property_id AND bb.banquet_number = b.banquet_number));

UPDATE public.bookings
   SET event_status = CASE WHEN status::text = 'cancelled' THEN 'cancelled' ELSE 'confirmed' END
 WHERE booking_type = 'banquet' AND event_status IS NULL;

-- ============ 2. REMOVE SYNC TRIGGERS ============
DROP TRIGGER IF EXISTS trg_sync_event_booking_to_mirror ON public.bookings;
DROP TRIGGER IF EXISTS trg_sync_mirror_to_event_booking ON public.banquet_bookings;
DROP FUNCTION IF EXISTS public.tg_sync_event_booking_to_mirror() CASCADE;
DROP FUNCTION IF EXISTS public.tg_sync_mirror_to_event_booking() CASCADE;

-- ============ 3. RE-FK CHILD TABLES ============
-- banquet_extra_charges
ALTER TABLE public.banquet_extra_charges DROP CONSTRAINT IF EXISTS banquet_extra_charges_banquet_booking_id_fkey;
ALTER TABLE public.banquet_extra_charges RENAME COLUMN banquet_booking_id TO booking_id;
UPDATE public.banquet_extra_charges ec
   SET booking_id = COALESCE(bb.event_booking_id,
        (SELECT b.id FROM public.bookings b
          WHERE b.booking_type='banquet' AND b.property_id = bb.property_id
            AND b.banquet_number = bb.banquet_number LIMIT 1))
  FROM public.banquet_bookings bb
 WHERE bb.id = ec.booking_id;
DELETE FROM public.banquet_extra_charges ec
 WHERE NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = ec.booking_id);
ALTER TABLE public.banquet_extra_charges
  ADD CONSTRAINT banquet_extra_charges_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;
DROP INDEX IF EXISTS idx_banquet_extra_charges_booking;
CREATE INDEX idx_banquet_extra_charges_booking ON public.banquet_extra_charges (booking_id);

-- banquet_master_bills
ALTER TABLE public.banquet_master_bills DROP CONSTRAINT IF EXISTS banquet_master_bills_banquet_booking_id_fkey;
ALTER TABLE public.banquet_master_bills DROP CONSTRAINT IF EXISTS banquet_master_bills_banquet_booking_id_key;
ALTER TABLE public.banquet_master_bills RENAME COLUMN banquet_booking_id TO booking_id;
UPDATE public.banquet_master_bills mb
   SET booking_id = COALESCE(bb.event_booking_id,
        (SELECT b.id FROM public.bookings b
          WHERE b.booking_type='banquet' AND b.property_id = bb.property_id
            AND b.banquet_number = bb.banquet_number LIMIT 1))
  FROM public.banquet_bookings bb
 WHERE bb.id = mb.booking_id;
DELETE FROM public.banquet_master_bills mb
 WHERE NOT EXISTS (SELECT 1 FROM public.bookings b WHERE b.id = mb.booking_id);
ALTER TABLE public.banquet_master_bills
  ADD CONSTRAINT banquet_master_bills_booking_id_key UNIQUE (booking_id);
ALTER TABLE public.banquet_master_bills
  ADD CONSTRAINT banquet_master_bills_booking_id_fkey
  FOREIGN KEY (booking_id) REFERENCES public.bookings(id) ON DELETE CASCADE;

-- event_room_blocks: event_booking_id is already the unified pointer
UPDATE public.event_room_blocks erb
   SET event_booking_id = COALESCE(bb.event_booking_id,
        (SELECT b.id FROM public.bookings b
          WHERE b.booking_type='banquet' AND b.property_id = bb.property_id
            AND b.banquet_number = bb.banquet_number LIMIT 1))
  FROM public.banquet_bookings bb
 WHERE bb.id = erb.banquet_booking_id AND erb.event_booking_id IS NULL;
DROP INDEX IF EXISTS idx_event_room_blocks_event;
ALTER TABLE public.event_room_blocks DROP COLUMN IF EXISTS banquet_booking_id;

-- ============ 4. REWRITE DEPENDENT FUNCTIONS ============
DO $rewrite$
DECLARE fn text; def text;
BEGIN
  FOREACH fn IN ARRAY ARRAY['sync_event_block_booking_room','banquet_visibility',
                            'tg_banquet_master_bill_on_checkout','seed_event_folio_charges'] LOOP
    SELECT pg_get_functiondef(p.oid) INTO def
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = fn LIMIT 1;
    IF def IS NULL THEN CONTINUE; END IF;
    def := regexp_replace(def,
      'COALESCE\(v_b\.event_booking_id, public\.ensure_event_booking\(v_b\.banquet_booking_id\)\)',
      'v_b.event_booking_id', 'g');
    def := regexp_replace(def,
      'SELECT id INTO v_legacy FROM public\.banquet_bookings\s+WHERE[^;]*;',
      'v_legacy := b.id;', 'g');
    def := replace(def, 'erb.banquet_booking_id', 'erb.event_booking_id');
    def := replace(def, 'v_b.banquet_booking_id', 'v_b.event_booking_id');
    def := replace(def, 'banquet_booking_id', 'booking_id');
    EXECUTE def;
  END LOOP;
END
$rewrite$;

-- resolve_event_ids now resolves within the unified model only
CREATE OR REPLACE FUNCTION public.resolve_event_ids(_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_booking uuid;
BEGIN
  SELECT b.id INTO v_booking FROM public.bookings b
   WHERE b.id = _id AND b.booking_type = 'banquet';
  IF v_booking IS NULL THEN RETURN NULL; END IF;
  RETURN jsonb_build_object('booking_id', v_booking, 'banquet_booking_id', v_booking);
END
$$;

-- create_event_booking: single write path, no mirror
CREATE OR REPLACE FUNCTION public.create_event_booking(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prop uuid := (payload->>'property_id')::uuid;
  v_num  text;
  v_bid  uuid;
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
    property_id, booking_type, banquet_number, status, event_status, source,
    check_in, check_out, adults, children,
    guest_id, host_name, host_mobile, host_email,
    hall_id, event_name, function_type, event_date, event_end_date,
    start_time, end_time, pax,
    package_rate, hall_charge, fb_charge, extra_charge, extra_charge_description,
    discount_amount, round_off_amount,
    total_amount, advance_amount, balance_amount,
    total_room_charges, bill_type, line_discounts, advance_payment_mode,
    notes, created_by
  ) VALUES (
    v_prop, 'banquet', v_num, 'reserved', 'confirmed', 'banquet',
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
    COALESCE((payload->>'total_room_charges')::numeric, 0),
    NULLIF(payload->>'bill_type',''),
    CASE WHEN jsonb_typeof(payload->'line_discounts') IN ('object','array')
         THEN payload->'line_discounts' ELSE NULL END,
    NULLIF(payload->>'advance_payment_mode',''),
    NULLIF(payload->>'notes',''), auth.uid()
  ) RETURNING id INTO v_bid;

  IF jsonb_typeof(payload->'extras') = 'array' THEN
    FOR v_extra IN SELECT * FROM jsonb_array_elements(payload->'extras') LOOP
      IF COALESCE(NULLIF(btrim(COALESCE(v_extra->>'point_name','')),''), '') <> ''
         AND COALESCE((v_extra->>'amount')::numeric, 0) > 0 THEN
        INSERT INTO public.banquet_extra_charges
          (booking_id, property_id, point_name, amount, sort_order, created_by)
        VALUES (v_bid, v_prop, btrim(v_extra->>'point_name'),
                (v_extra->>'amount')::numeric, v_i, auth.uid());
        v_i := v_i + 1;
      END IF;
    END LOOP;
  END IF;

  PERFORM public.seed_event_folio_charges(v_bid);

  RETURN jsonb_build_object('booking_id', v_bid, 'banquet_booking_id', v_bid, 'banquet_number', v_num);
END
$$;