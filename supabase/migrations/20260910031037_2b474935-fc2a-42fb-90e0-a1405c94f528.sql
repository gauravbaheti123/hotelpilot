CREATE OR REPLACE FUNCTION public.get_or_create_folio(_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_prop uuid;
BEGIN
  -- Match the folios_active_per_booking_uniq index predicate exactly:
  -- is_deleted = false AND status <> 'void' AND parent_folio_id IS NULL.
  -- Previously 'due'/'refunded' folios were skipped here, so the function
  -- tried to insert a second live folio and hit the unique index.
  SELECT id INTO v_id
    FROM public.folios
   WHERE booking_id = _booking_id
     AND COALESCE(is_deleted, false) = false
     AND status <> 'void'
     AND parent_folio_id IS NULL
   ORDER BY
     CASE WHEN status = 'open' AND COALESCE(balance_amount,0) > 0 THEN 0 ELSE 1 END,
     CASE WHEN status = 'open' THEN 0 ELSE 1 END,
     COALESCE(balance_amount,0) DESC,
     COALESCE(total_amount,0) DESC,
     created_at DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT property_id INTO v_prop FROM public.bookings WHERE id = _booking_id;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  BEGIN
    INSERT INTO public.folios (property_id, booking_id, created_by)
      VALUES (v_prop, _booking_id, auth.uid()) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id
      FROM public.folios
     WHERE booking_id = _booking_id
       AND COALESCE(is_deleted, false) = false
       AND status <> 'void'
       AND parent_folio_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_id IS NULL THEN RAISE; END IF;
  END;

  RETURN v_id;
END
$function$;

REVOKE ALL ON FUNCTION public.get_or_create_folio(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_folio(uuid) TO authenticated;