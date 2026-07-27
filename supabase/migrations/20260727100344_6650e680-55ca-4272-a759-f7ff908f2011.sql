-- 1. Widen bill_sequences.sequence_type allowed values
ALTER TABLE public.bill_sequences DROP CONSTRAINT IF EXISTS bill_sequences_sequence_type_check;
ALTER TABLE public.bill_sequences
  ADD CONSTRAINT bill_sequences_sequence_type_check
  CHECK (sequence_type IN ('regular','event','banquet_master','lodge','food','laundry','banquet'));

-- 2. Seed new segment rows for existing properties (short_code required for prefix, but rows can exist without it)
INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix)
SELECT p.id, s.seg, 0,
  CASE s.seg
    WHEN 'lodge'   THEN COALESCE(p.short_code || '-LDG-', 'LDG-')
    WHEN 'food'    THEN COALESCE(p.short_code || '-F-',   'F-')
    WHEN 'laundry' THEN COALESCE(p.short_code || '-L-',   'L-')
    WHEN 'banquet' THEN COALESCE(p.short_code || '-B-',   'B-')
  END
FROM public.properties p
CROSS JOIN (VALUES ('lodge'),('food'),('laundry'),('banquet')) AS s(seg)
ON CONFLICT (property_id, sequence_type) DO NOTHING;

-- 3. Atomic generator function
CREATE OR REPLACE FUNCTION public.generate_bill_number(_property_id uuid, _segment text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_prefix text;
  v_short  text;
  v_next   int;
  v_pad    int := 4;
  v_seg_code text;
BEGIN
  IF _property_id IS NULL OR _segment IS NULL THEN
    RAISE EXCEPTION 'property_id and segment required';
  END IF;
  IF _segment NOT IN ('lodge','food','laundry','banquet') THEN
    RAISE EXCEPTION 'Unknown bill segment %', _segment;
  END IF;
  v_seg_code := CASE _segment
    WHEN 'lodge'   THEN 'LDG'
    WHEN 'food'    THEN 'F'
    WHEN 'laundry' THEN 'L'
    WHEN 'banquet' THEN 'B'
  END;

  SELECT short_code INTO v_short FROM public.properties WHERE id = _property_id;
  v_prefix := COALESCE(NULLIF(v_short,'') || '-' || v_seg_code || '-', v_seg_code || '-');

  -- Ensure row exists, then lock + increment
  INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix)
    VALUES (_property_id, _segment, 0, v_prefix)
    ON CONFLICT (property_id, sequence_type) DO NOTHING;

  UPDATE public.bill_sequences
     SET last_number = last_number + 1,
         prefix = v_prefix,
         updated_at = now()
   WHERE property_id = _property_id AND sequence_type = _segment
   RETURNING last_number INTO v_next;

  RETURN v_prefix || LPAD(v_next::text, v_pad, '0');
END $$;

GRANT EXECUTE ON FUNCTION public.generate_bill_number(uuid, text) TO authenticated, service_role;

-- 4. Backfill: auto-settle any fully-paid but still-open folios (defensive; usually zero)
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT id, property_id, booking_id, invoice_number, total_amount, paid_amount
      FROM public.folios
     WHERE status = 'open'
       AND COALESCE(is_deleted,false) = false
       AND COALESCE(paid_amount,0) >= COALESCE(total_amount,0)
       AND COALESCE(total_amount,0) > 0
  LOOP
    UPDATE public.folios
       SET status = 'settled',
           settled_at = COALESCE(settled_at, now()),
           updated_at = now()
     WHERE id = r.id;

    INSERT INTO public.activity_log (
      property_id, user_id, user_name, action_type, module,
      reference_id, reference_label, details
    ) VALUES (
      r.property_id, '00000000-0000-0000-0000-000000000000'::uuid, 'System',
      'BILL_AUTO_SETTLED_BACKFILL', 'Billing',
      r.id::text, r.invoice_number,
      jsonb_build_object(
        'total_amount', r.total_amount,
        'paid_amount', r.paid_amount,
        'reason', 'Backfill: fully-paid folio was still open'
      )
    );
  END LOOP;
END $$;

-- 5. Owner override helper — logs the override to activity_log
CREATE OR REPLACE FUNCTION public.log_owner_override(
  _property_id uuid,
  _table_name text,
  _record_id text,
  _action text,
  _old jsonb,
  _new jsonb,
  _reason text
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.is_owner_or_super(v_uid) THEN
    RAISE EXCEPTION 'Owner or Superadmin required to override locked records';
  END IF;

  SELECT COALESCE(name, email, 'Owner') INTO v_name
    FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.activity_log (
    property_id, user_id, user_name, action_type, module,
    reference_id, reference_label, details
  ) VALUES (
    _property_id, v_uid, COALESCE(v_name,'Owner'),
    'OWNER_OVERRIDE', _table_name,
    _record_id, _table_name || ':' || _record_id,
    jsonb_build_object(
      'action', _action,
      'old', COALESCE(_old, '{}'::jsonb),
      'new', COALESCE(_new, '{}'::jsonb),
      'reason', COALESCE(_reason,'')
    )
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $$;

GRANT EXECUTE ON FUNCTION public.log_owner_override(uuid, text, text, text, jsonb, jsonb, text) TO authenticated, service_role;

-- 6. Re-point invoice-number assigner to use generate_bill_number for LODGE segment
--    when a property has a short_code. Preserves legacy BILL### numbering otherwise.
CREATE OR REPLACE FUNCTION public.tg_assign_invoice_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next int;
  v_prefix text := 'BILL';
  v_short text;
BEGIN
  IF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT short_code INTO v_short FROM public.properties WHERE id = NEW.property_id;
  IF v_short IS NOT NULL AND length(btrim(v_short)) > 0 THEN
    NEW.invoice_number := public.generate_bill_number(NEW.property_id, 'lodge');
    RETURN NEW;
  END IF;
  SELECT COALESCE(
           MAX(NULLIF(regexp_replace(invoice_number, '^' || v_prefix, ''), '')::int),
           0
         ) + 1
    INTO v_next
    FROM public.folios
   WHERE property_id = NEW.property_id
     AND invoice_number LIKE v_prefix || '%'
     AND COALESCE(is_deleted, false) = false
     AND status <> 'void';
  NEW.invoice_number := v_prefix || LPAD(v_next::text, 3, '0');
  RETURN NEW;
END $function$;

-- Food bill numbering → food segment
CREATE OR REPLACE FUNCTION public.tg_assign_food_bill_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next int;
  v_prefix text := 'FB-';
  v_short text;
BEGIN
  IF NEW.food_bill_number IS NOT NULL AND NEW.food_bill_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT short_code INTO v_short FROM public.properties WHERE id = NEW.property_id;
  IF v_short IS NOT NULL AND length(btrim(v_short)) > 0 THEN
    NEW.food_bill_number := public.generate_bill_number(NEW.property_id, 'food');
    RETURN NEW;
  END IF;
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

-- Banquet bookings numbering → banquet segment
CREATE OR REPLACE FUNCTION public.tg_assign_banquet_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_next int;
  v_prefix text := 'EVENT';
  v_short text;
BEGIN
  IF NEW.banquet_number IS NOT NULL AND NEW.banquet_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT short_code INTO v_short FROM public.properties WHERE id = NEW.property_id;
  IF v_short IS NOT NULL AND length(btrim(v_short)) > 0 THEN
    NEW.banquet_number := public.generate_bill_number(NEW.property_id, 'banquet');
    RETURN NEW;
  END IF;
  SELECT COALESCE(
           MAX(NULLIF(regexp_replace(banquet_number, '^' || v_prefix, ''), '')::int),
           0
         ) + 1
    INTO v_next
    FROM public.banquet_bookings
   WHERE property_id = NEW.property_id
     AND banquet_number LIKE v_prefix || '%';
  NEW.banquet_number := v_prefix || LPAD(v_next::text, 3, '0');
  RETURN NEW;
END $function$;
