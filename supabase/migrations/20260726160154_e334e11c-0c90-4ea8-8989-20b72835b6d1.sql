CREATE OR REPLACE FUNCTION public.get_or_create_folio(_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_prop uuid;
BEGIN
  -- Prefer an OPEN folio (with balance) over settled/void so post-split
  -- checkout always resolves to the bill that still needs collection.
  SELECT id INTO v_id
    FROM public.folios
   WHERE booking_id = _booking_id
     AND COALESCE(is_deleted, false) = false
     AND status NOT IN ('void','refunded')
   ORDER BY
     CASE WHEN status = 'open' THEN 0 ELSE 1 END,
     CASE WHEN COALESCE(balance_amount,0) > 0 THEN 0 ELSE 1 END,
     created_at DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT property_id INTO v_prop FROM public.bookings WHERE id = _booking_id;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  INSERT INTO public.folios (property_id, booking_id, created_by)
    VALUES (v_prop, _booking_id, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $function$;