-- 0) Allow the new sequence type
ALTER TABLE public.bill_sequences DROP CONSTRAINT IF EXISTS bill_sequences_sequence_type_check;
ALTER TABLE public.bill_sequences ADD CONSTRAINT bill_sequences_sequence_type_check
  CHECK (sequence_type = ANY (ARRAY['regular','event','banquet_master','lodge','food','laundry','banquet','banquet_food']));

-- 1) Extend generate_bill_number with 'banquet_food' -> 'BF'
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
    WHEN 'banquet'      THEN 'B'
    WHEN 'banquet_food' THEN 'BF'
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
                   AND invoice_number LIKE v_prefix || '%'), 0)
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
         WHERE property_id = _property_id AND invoice_number = v_candidate);
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

-- 2) Seed a banquet_food sequence row (starting at 0) for every property.
INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix)
SELECT p.id, 'banquet_food', 0,
       COALESCE(NULLIF(btrim(COALESCE(p.short_code,'')),'') || '-BF-', 'BF-')
  FROM public.properties p
ON CONFLICT (property_id, sequence_type) DO NOTHING;

-- 3) Route food bills on banquet-blocked rooms to the BF series
CREATE OR REPLACE FUNCTION public.tg_assign_food_bill_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next int;
  v_short text;
  v_is_banquet boolean := false;
  v_prefix text;
BEGIN
  IF NEW.food_bill_number IS NOT NULL AND NEW.food_bill_number <> '' THEN
    RETURN NEW;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.event_room_blocks erb
     WHERE erb.booking_id = NEW.booking_id
  ) INTO v_is_banquet;

  SELECT short_code INTO v_short FROM public.properties WHERE id = NEW.property_id;

  IF v_short IS NOT NULL AND length(btrim(v_short)) > 0 THEN
    NEW.food_bill_number := public.generate_bill_number(
      NEW.property_id,
      CASE WHEN v_is_banquet THEN 'banquet_food' ELSE 'food' END
    );
    RETURN NEW;
  END IF;

  v_prefix := CASE WHEN v_is_banquet THEN 'BFB-' ELSE 'FB-' END;
  SELECT COALESCE(
           MAX(NULLIF(regexp_replace(food_bill_number, '^' || v_prefix, ''), '')::int),
           0
         ) + 1
    INTO v_next
    FROM public.food_bills
   WHERE property_id = NEW.property_id
     AND food_bill_number LIKE v_prefix || '%';
  NEW.food_bill_number := v_prefix || LPAD(v_next::text, 4, '0');
  RETURN NEW;
END $function$;

-- 4) Seed rules for new properties: also create the banquet_food sequence row
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
    FROM (VALUES ('lodge','LDG'),('food','F'),('laundry','L'),('banquet','B'),('banquet_food','BF'))
         AS t(seq, code)
  ON CONFLICT (property_id, sequence_type) DO NOTHING;
  RETURN NEW;
END $function$;