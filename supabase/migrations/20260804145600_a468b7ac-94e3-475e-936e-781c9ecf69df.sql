CREATE OR REPLACE FUNCTION public.ensure_event_booking(_banquet_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  v_bb public.banquet_bookings%ROWTYPE;
  v_id uuid;
BEGIN
  SELECT * INTO v_bb FROM public.banquet_bookings WHERE id = _banquet_booking_id;
  IF NOT FOUND THEN RETURN NULL; END IF;

  SELECT id INTO v_id FROM public.bookings
   WHERE booking_type = 'banquet' AND banquet_number = v_bb.banquet_number
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  INSERT INTO public.bookings (
    property_id, booking_type, banquet_number, status,
    check_in, check_out, adults, children,
    hall_id, event_name, function_type, host_name, host_mobile,
    source, notes
  ) VALUES (
    v_bb.property_id, 'banquet', v_bb.banquet_number, 'reserved',
    v_bb.event_date, COALESCE(v_bb.event_end_date, v_bb.event_date), GREATEST(COALESCE(v_bb.pax,1),1), 0,
    v_bb.hall_id, v_bb.event_name, v_bb.function_type,
    COALESCE(v_bb.host_name, v_bb.event_name), v_bb.host_mobile,
    'banquet', 'Auto-created from banquet event ' || COALESCE(v_bb.banquet_number, '')
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;