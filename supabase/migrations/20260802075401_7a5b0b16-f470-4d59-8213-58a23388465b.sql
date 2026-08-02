CREATE OR REPLACE FUNCTION public.create_bill_sequences_for_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_code TEXT;
BEGIN
  v_code := COALESCE(NULLIF(UPPER(TRIM(NEW.short_code)), '') || '-', '');
  INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix) VALUES
    (NEW.id, 'regular', 0, v_code || 'BILL'),
    (NEW.id, 'lodge',   0, v_code || 'LDG-'),
    (NEW.id, 'food',    0, v_code || 'F-'),
    (NEW.id, 'laundry', 0, v_code || 'L-'),
    (NEW.id, 'banquet', 0, v_code || 'B-')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $function$;