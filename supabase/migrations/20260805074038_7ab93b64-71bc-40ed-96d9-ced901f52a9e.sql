ALTER TABLE public.segment_bills
  ADD COLUMN IF NOT EXISTS event_booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_segment_bills_event_booking_id
  ON public.segment_bills (event_booking_id) WHERE event_booking_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.tg_assign_segment_bill_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.bill_number IS NOT NULL AND NEW.bill_number <> '' THEN
    RETURN NEW;
  END IF;
  IF NEW.segment = 'food' AND NEW.event_booking_id IS NOT NULL THEN
    NEW.bill_number := public.generate_bill_number(NEW.property_id, 'banquet_food');
  ELSE
    NEW.bill_number := public.generate_bill_number(NEW.property_id, NEW.segment);
  END IF;
  RETURN NEW;
END $function$;