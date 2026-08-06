-- Helper: canonical prefix for a property + segment
CREATE OR REPLACE FUNCTION public.bill_number_prefix(_property_id uuid, _segment text)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(NULLIF(btrim(COALESCE(p.short_code,'')),'') || '-', '')
         || CASE _segment
              WHEN 'lodge'        THEN 'LDG'
              WHEN 'food'         THEN 'F'
              WHEN 'laundry'      THEN 'L'
              WHEN 'banquet'      THEN 'EVT'
              WHEN 'banquet_food' THEN 'EVT-F'
              ELSE upper(_segment)
            END || '-'
  FROM public.properties p WHERE p.id = _property_id
$$;

-- Helper: does a value strictly conform to <prefix>NNNN ?
CREATE OR REPLACE FUNCTION public.is_conforming_bill_number(_value text, _prefix text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT _value IS NOT NULL
     AND _prefix IS NOT NULL
     AND _value ~ ('^' || regexp_replace(_prefix, '([^a-zA-Z0-9])', '\\\1', 'g') || '[0-9]{4}$')
$$;

CREATE OR REPLACE FUNCTION public.tg_assign_segment_bill_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_segment text;
  v_prefix  text;
BEGIN
  IF NEW.segment = 'food' AND NEW.event_booking_id IS NOT NULL THEN
    v_segment := 'banquet_food';
  ELSE
    v_segment := NEW.segment;
  END IF;

  v_prefix := public.bill_number_prefix(NEW.property_id, v_segment);

  -- Only skip when the existing value is a fully conforming number.
  IF public.is_conforming_bill_number(NEW.bill_number, v_prefix) THEN
    RETURN NEW;
  END IF;

  NEW.bill_number := public.generate_bill_number(NEW.property_id, v_segment);
  RETURN NEW;
END
$function$;

CREATE OR REPLACE FUNCTION public.tg_assign_food_bill_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_next int;
  v_short text;
  v_is_banquet boolean := false;
  v_prefix text;
  v_segment text;
  v_existing text;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM public.event_room_blocks erb
     WHERE erb.booking_id = NEW.booking_id
  ) INTO v_is_banquet;

  v_segment := CASE WHEN v_is_banquet THEN 'banquet_food' ELSE 'food' END;

  -- Skip only for fully conforming existing numbers
  IF public.is_conforming_bill_number(
       NEW.food_bill_number,
       public.bill_number_prefix(NEW.property_id, v_segment)
     ) THEN
    RETURN NEW;
  END IF;

  -- Reuse the number already assigned to this booking's food bill
  -- (prevents burning a sequence number on ON CONFLICT DO UPDATE upserts).
  IF NEW.booking_id IS NOT NULL THEN
    SELECT fb.food_bill_number INTO v_existing
      FROM public.food_bills fb
     WHERE fb.booking_id = NEW.booking_id
     LIMIT 1;
    IF v_existing IS NOT NULL AND v_existing <> '' THEN
      NEW.food_bill_number := v_existing;
      RETURN NEW;
    END IF;
  END IF;

  SELECT short_code INTO v_short FROM public.properties WHERE id = NEW.property_id;

  IF v_short IS NOT NULL AND length(btrim(v_short)) > 0 THEN
    NEW.food_bill_number := public.generate_bill_number(NEW.property_id, v_segment);
    RETURN NEW;
  END IF;

  v_prefix := CASE WHEN v_is_banquet THEN 'BFB-' ELSE 'FB-' END;
  SELECT COALESCE(
           MAX(CASE WHEN food_bill_number ~ ('^' || v_prefix || '[0-9]{4}$')
                    THEN substring(food_bill_number from length(v_prefix) + 1)::int END),
           0
         ) + 1
    INTO v_next
    FROM public.food_bills
   WHERE property_id = NEW.property_id
     AND food_bill_number LIKE v_prefix || '%';
  NEW.food_bill_number := v_prefix || LPAD(v_next::text, 4, '0');
  RETURN NEW;
END
$function$;