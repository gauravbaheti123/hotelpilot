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
  IF NEW.segment = 'food' AND (NEW.event_booking_id IS NOT NULL OR NEW.table_id IS NOT NULL) THEN
    v_segment := 'banquet_food';
  ELSE
    v_segment := NEW.segment;
  END IF;

  v_prefix := public.bill_number_prefix(NEW.property_id, v_segment);

  IF public.is_conforming_bill_number(NEW.bill_number, v_prefix) THEN
    RETURN NEW;
  END IF;

  NEW.bill_number := public.generate_bill_number(NEW.property_id, v_segment);
  RETURN NEW;
END
$function$;