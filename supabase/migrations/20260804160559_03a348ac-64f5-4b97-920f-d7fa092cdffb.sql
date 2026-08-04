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
                  FROM public.bookings
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
       AND bill_number LIKE v_prefix || '%';
  END IF;

  SELECT GREATEST(COALESCE(last_number,0), v_max) + 1 INTO v_next
    FROM public.bill_sequences
   WHERE property_id = _property_id AND sequence_type = _segment;

  LOOP
    v_guard := v_guard + 1;
    v_candidate := v_prefix || lpad(v_next::text, v_pad, '0');
    EXIT WHEN v_guard > 500;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.segment_bills WHERE property_id = _property_id AND bill_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.folios WHERE property_id = _property_id AND invoice_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.bookings WHERE property_id = _property_id AND banquet_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.banquet_master_bills WHERE property_id = _property_id AND bill_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.food_bills WHERE property_id = _property_id AND food_bill_number = v_candidate
    );
    v_next := v_next + 1;
  END LOOP;

  UPDATE public.bill_sequences
     SET last_number = v_next, updated_at = now()
   WHERE property_id = _property_id AND sequence_type = _segment;

  RETURN v_candidate;
END;
$function$;

DROP FUNCTION IF EXISTS public.ensure_event_booking(uuid);
DROP TABLE IF EXISTS public.banquet_bookings CASCADE;