-- 1. booking_type + event columns on bookings
ALTER TABLE public.bookings
  ADD COLUMN IF NOT EXISTS booking_type text NOT NULL DEFAULT 'lodge',
  ADD COLUMN IF NOT EXISTS hall_id uuid REFERENCES public.halls(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS function_type text,
  ADD COLUMN IF NOT EXISTS event_date date,
  ADD COLUMN IF NOT EXISTS event_end_date date,
  ADD COLUMN IF NOT EXISTS start_time time,
  ADD COLUMN IF NOT EXISTS end_time time,
  ADD COLUMN IF NOT EXISTS pax integer,
  ADD COLUMN IF NOT EXISTS package_rate numeric(12,2),
  ADD COLUMN IF NOT EXISTS hall_charge numeric(12,2),
  ADD COLUMN IF NOT EXISTS fb_charge numeric(12,2),
  ADD COLUMN IF NOT EXISTS extra_charge numeric(12,2),
  ADD COLUMN IF NOT EXISTS extra_charge_description text,
  ADD COLUMN IF NOT EXISTS discount_type text,
  ADD COLUMN IF NOT EXISTS discount_value numeric(12,2),
  ADD COLUMN IF NOT EXISTS discount_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS round_off_amount numeric(12,2),
  ADD COLUMN IF NOT EXISTS host_name text,
  ADD COLUMN IF NOT EXISTS host_mobile text,
  ADD COLUMN IF NOT EXISTS host_email text,
  ADD COLUMN IF NOT EXISTS event_name text,
  ADD COLUMN IF NOT EXISTS banquet_number text;

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_booking_type_check
    CHECK (booking_type IN ('lodge','banquet'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.bookings
    ADD CONSTRAINT bookings_event_discount_type_check
    CHECK (discount_type IS NULL OR discount_type IN ('percent','amount'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE UNIQUE INDEX IF NOT EXISTS ux_bookings_banquet_number
  ON public.bookings (property_id, banquet_number)
  WHERE banquet_number IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_bookings_type
  ON public.bookings (property_id, booking_type);

COMMENT ON COLUMN public.bookings.booking_type IS
  'lodge = regular room booking; banquet = unified event booking (event_* columns populated).';
COMMENT ON COLUMN public.bookings.banquet_number IS
  'Display number for banquet-type bookings (EVT series). Allocated via generate_bill_number(property, ''banquet'').';

-- 2. generate_bill_number: include bookings.banquet_number in the banquet series
CREATE OR REPLACE FUNCTION public.generate_bill_number(_property_id uuid, _segment text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_prefix text;
  v_short  text;
  v_next   int;
  v_max    int := 0;
  v_pad    int := 4;
  v_seg_code text;
  v_candidate text;
  v_guard int := 0;
BEGIN
  IF _property_id IS NULL OR _segment IS NULL THEN
    RAISE EXCEPTION 'property_id and segment required';
  END IF;
  IF _segment NOT IN ('lodge','food','laundry','banquet','banquet_food') THEN
    RAISE EXCEPTION 'Unknown bill segment %', _segment;
  END IF;
  v_seg_code := CASE _segment
    WHEN 'lodge'        THEN 'LDG'
    WHEN 'food'         THEN 'F'
    WHEN 'laundry'      THEN 'L'
    WHEN 'banquet'      THEN 'EVT'
    WHEN 'banquet_food' THEN 'EVT-F'
  END;

  SELECT short_code INTO v_short FROM public.properties WHERE id = _property_id;
  v_prefix := COALESCE(NULLIF(btrim(COALESCE(v_short,'')),'') || '-' || v_seg_code || '-', v_seg_code || '-');

  INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix)
    VALUES (_property_id, _segment, 0, v_prefix)
    ON CONFLICT (property_id, sequence_type) DO NOTHING;

  PERFORM 1 FROM public.bill_sequences
   WHERE property_id = _property_id AND sequence_type = _segment
   FOR UPDATE;

  IF _segment = 'banquet' THEN
    SELECT GREATEST(
      -- (a) new unified model
      COALESCE((SELECT MAX(NULLIF(substring(banquet_number from '([0-9]+)$'),'')::int)
                  FROM public.bookings
                 WHERE property_id = _property_id
                   AND banquet_number LIKE v_prefix || '%'), 0),
      -- (b) legacy banquet_bookings (read source until retired)
      COALESCE((SELECT MAX(NULLIF(substring(banquet_number from '([0-9]+)$'),'')::int)
                  FROM public.banquet_bookings
                 WHERE property_id = _property_id
                   AND banquet_number LIKE v_prefix || '%'), 0),
      -- (c) folio invoice numbers
      COALESCE((SELECT MAX(NULLIF(substring(invoice_number from '([0-9]+)$'),'')::int)
                  FROM public.folios
                 WHERE property_id = _property_id
                   AND invoice_number LIKE v_prefix || '%'), 0),
      -- (d) banquet master bills
      COALESCE((SELECT MAX(NULLIF(substring(bill_number from '([0-9]+)$'),'')::int)
                  FROM public.banquet_master_bills
                 WHERE property_id = _property_id
                   AND bill_number LIKE v_prefix || '%'), 0)
    ) INTO v_max;
  ELSIF _segment = 'banquet_food' THEN
    SELECT GREATEST(
      COALESCE((SELECT MAX(NULLIF(substring(food_bill_number from '([0-9]+)$'),'')::int)
                  FROM public.food_bills
                 WHERE property_id = _property_id
                   AND food_bill_number LIKE v_prefix || '%'), 0),
      COALESCE((SELECT MAX(NULLIF(substring(bill_number from '([0-9]+)$'),'')::int)
                  FROM public.segment_bills
                 WHERE property_id = _property_id
                   AND bill_number LIKE v_prefix || '%'), 0)
    ) INTO v_max;
  ELSE
    SELECT COALESCE(MAX(NULLIF(substring(bill_number from '([0-9]+)$'),'')::int), 0)
      INTO v_max
      FROM public.segment_bills
     WHERE property_id = _property_id
       AND segment = _segment
       AND bill_number LIKE v_prefix || '%';
  END IF;

  LOOP
    v_guard := v_guard + 1;
    UPDATE public.bill_sequences
       SET last_number = GREATEST(last_number, v_max) + 1,
           prefix = v_prefix,
           updated_at = now()
     WHERE property_id = _property_id AND sequence_type = _segment
     RETURNING last_number INTO v_next;

    v_candidate := v_prefix || LPAD(v_next::text, v_pad, '0');
    v_max := v_next;

    IF _segment = 'banquet' THEN
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.bookings
         WHERE property_id = _property_id AND banquet_number = v_candidate)
       AND NOT EXISTS (
        SELECT 1 FROM public.banquet_bookings
         WHERE property_id = _property_id AND banquet_number = v_candidate)
       AND NOT EXISTS (
        SELECT 1 FROM public.folios
         WHERE property_id = _property_id AND invoice_number = v_candidate)
       AND NOT EXISTS (
        SELECT 1 FROM public.banquet_master_bills
         WHERE property_id = _property_id AND bill_number = v_candidate);
    ELSIF _segment = 'banquet_food' THEN
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.food_bills
         WHERE property_id = _property_id AND food_bill_number = v_candidate)
       AND NOT EXISTS (
        SELECT 1 FROM public.segment_bills
         WHERE property_id = _property_id AND bill_number = v_candidate);
    ELSE
      EXIT WHEN NOT EXISTS (
        SELECT 1 FROM public.segment_bills
         WHERE property_id = _property_id AND bill_number = v_candidate);
    END IF;

    IF v_guard > 100 THEN
      RAISE EXCEPTION 'Unable to allocate a free % number for property %', _segment, _property_id;
    END IF;
  END LOOP;

  RETURN v_candidate;
END
$fn$;

-- 3. Event GST rate resolver: banquet slab if configured, else fall back to room slabs.
CREATE OR REPLACE FUNCTION public.event_gst_rate(_property_id uuid, _amount numeric)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $fn$
  SELECT COALESCE(
    public.get_gst_rate(_property_id, 'banquet', COALESCE(_amount,0)),
    public.get_gst_rate(_property_id, 'room',    COALESCE(_amount,0)),
    0
  );
$fn$;

COMMENT ON FUNCTION public.event_gst_rate(uuid, numeric) IS
  'GST rate for banquet hall/extra charges. Uses the ''banquet'' gst_slabs category when the property defines one, otherwise falls back to the ''room'' slab table (documented default).';

-- 3b. Seed folio charges for a unified banquet booking
CREATE OR REPLACE FUNCTION public.seed_event_folio_charges(_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  b        public.bookings%ROWTYPE;
  v_folio  uuid;
  v_hall   numeric(12,2);
  v_rate   numeric(5,2);
  v_desc   text;
BEGIN
  SELECT * INTO b FROM public.bookings WHERE id = _booking_id;
  IF b.id IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF COALESCE(b.booking_type,'lodge') <> 'banquet' THEN
    RAISE EXCEPTION 'seed_event_folio_charges: booking % is not a banquet booking', _booking_id;
  END IF;

  v_folio := public.get_or_create_folio(_booking_id);

  -- Hall charge: explicit hall_charge wins, else package_rate x pax
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

  -- Extra charge line
  IF COALESCE(b.extra_charge,0) > 0 THEN
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
  END IF;

  PERFORM public.recompute_folio_totals(v_folio);
  RETURN v_folio;
END
$fn$;

REVOKE ALL ON FUNCTION public.seed_event_folio_charges(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.seed_event_folio_charges(uuid) TO authenticated, service_role;
REVOKE ALL ON FUNCTION public.event_gst_rate(uuid, numeric) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.event_gst_rate(uuid, numeric) TO authenticated, service_role;

-- 4. Derived advance / balance from folios (read model, no dual writes)
CREATE OR REPLACE VIEW public.booking_financials
WITH (security_invoker = true) AS
SELECT
  b.id                AS booking_id,
  b.property_id,
  b.booking_type,
  COALESCE(SUM(f.total_amount)   FILTER (WHERE f.id IS NOT NULL), 0)::numeric(12,2) AS folio_total,
  COALESCE(SUM(f.paid_amount)    FILTER (WHERE f.id IS NOT NULL), 0)::numeric(12,2) AS advance_amount,
  COALESCE(SUM(f.balance_amount) FILTER (WHERE f.id IS NOT NULL), 0)::numeric(12,2) AS balance_amount
FROM public.bookings b
LEFT JOIN public.folios f
  ON f.booking_id = b.id
 AND COALESCE(f.is_deleted,false) = false
 AND f.status <> 'void'
GROUP BY b.id, b.property_id, b.booking_type;

GRANT SELECT ON public.booking_financials TO authenticated, service_role;

COMMENT ON VIEW public.booking_financials IS
  'Live advance/balance derived from folios. Unified banquet bookings read money from here instead of storing it inline.';