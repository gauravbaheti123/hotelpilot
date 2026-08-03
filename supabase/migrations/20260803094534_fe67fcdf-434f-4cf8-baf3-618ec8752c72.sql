-- 1) generate_bill_number: EVT / EVT-F codes, banquet_master_bills folded into 'banquet'
CREATE OR REPLACE FUNCTION public.generate_bill_number(_property_id uuid, _segment text)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
      COALESCE((SELECT MAX(NULLIF(substring(banquet_number from '([0-9]+)$'),'')::int)
                  FROM public.banquet_bookings
                 WHERE property_id = _property_id
                   AND banquet_number LIKE v_prefix || '%'), 0),
      COALESCE((SELECT MAX(NULLIF(substring(invoice_number from '([0-9]+)$'),'')::int)
                  FROM public.folios
                 WHERE property_id = _property_id
                   AND invoice_number LIKE v_prefix || '%'), 0),
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
$function$;

-- 2) Master bill trigger now uses the shared 'banquet' counter
CREATE OR REPLACE FUNCTION public.tg_banquet_master_bill_on_checkout()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_banquet_id uuid; v_property uuid; v_room_number text; v_room_category text;
  v_master_id uuid; v_bill_no text;
  v_food_amount numeric := 0; v_gst numeric := 0; v_food_bill text;
BEGIN
  IF NEW.status IS DISTINCT FROM 'checked_out'::public.booking_status
     OR OLD.status IS NOT DISTINCT FROM 'checked_out'::public.booking_status THEN
    RETURN NEW;
  END IF;

  SELECT erb.banquet_booking_id, erb.property_id, erb.room_number, erb.room_category
    INTO v_banquet_id, v_property, v_room_number, v_room_category
    FROM public.event_room_blocks erb
    WHERE erb.booking_id = NEW.id LIMIT 1;
  IF v_banquet_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(fc.amount),0), COALESCE(SUM(fc.gst_amount),0)
    INTO v_food_amount, v_gst
    FROM public.folio_charges fc
    JOIN public.folios f ON f.id = fc.folio_id
   WHERE f.booking_id = NEW.id
     AND COALESCE(fc.is_wiped,false) = false
     AND fc.charge_type NOT IN ('room','tax','discount');

  SELECT food_bill_number INTO v_food_bill
    FROM public.food_bills WHERE booking_id = NEW.id LIMIT 1;

  SELECT id INTO v_master_id FROM public.banquet_master_bills
    WHERE banquet_booking_id = v_banquet_id;
  IF v_master_id IS NULL THEN
    v_bill_no := public.generate_bill_number(v_property, 'banquet');
    INSERT INTO public.banquet_master_bills (property_id, banquet_booking_id, bill_number)
      VALUES (v_property, v_banquet_id, v_bill_no) RETURNING id INTO v_master_id;
  END IF;

  INSERT INTO public.banquet_master_bill_items
    (master_bill_id, booking_id, room_number, room_category, food_amount, gst_amount, food_bill_number)
    VALUES (v_master_id, NEW.id, v_room_number, v_room_category, v_food_amount, v_gst, v_food_bill)
    ON CONFLICT (master_bill_id, booking_id) DO UPDATE
      SET food_amount = EXCLUDED.food_amount, gst_amount = EXCLUDED.gst_amount,
          food_bill_number = EXCLUDED.food_bill_number,
          room_number = EXCLUDED.room_number, room_category = EXCLUDED.room_category,
          updated_at = now();

  UPDATE public.banquet_master_bills
     SET food_subtotal = (SELECT COALESCE(SUM(food_amount),0) FROM public.banquet_master_bill_items WHERE master_bill_id = v_master_id),
         gst_amount    = (SELECT COALESCE(SUM(gst_amount),0)  FROM public.banquet_master_bill_items WHERE master_bill_id = v_master_id),
         total_amount  = (SELECT COALESCE(SUM(food_amount + gst_amount),0) FROM public.banquet_master_bill_items WHERE master_bill_id = v_master_id),
         updated_at    = now()
   WHERE id = v_master_id;

  RETURN NEW;
END $function$;

-- 3) New properties get the new codes
CREATE OR REPLACE FUNCTION public.create_bill_sequences_for_property()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix)
  SELECT NEW.id, t.seq, 0,
         COALESCE(NULLIF(btrim(COALESCE(NEW.short_code,'')),'') || '-' || t.code || '-', t.code || '-')
    FROM (VALUES ('lodge','LDG'),('food','F'),('laundry','L'),('banquet','EVT'),('banquet_food','EVT-F'))
         AS t(seq, code)
  ON CONFLICT (property_id, sequence_type) DO NOTHING;
  RETURN NEW;
END $function$;