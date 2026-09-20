CREATE OR REPLACE FUNCTION public.get_or_create_folio(_booking_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_prop uuid;
        v_co uuid; v_co_name text; v_co_gstin text;
BEGIN
  -- Prefer a LIVE bill of this booking that is not superseded by a split.
  SELECT f.id INTO v_id
    FROM public.folios f
   WHERE f.booking_id = _booking_id
     AND COALESCE(f.is_deleted, false) = false
     AND f.status NOT IN ('void', 'refunded')
     AND NOT EXISTS (
       SELECT 1 FROM public.folios c
        WHERE c.parent_folio_id = f.id
          AND COALESCE(c.is_deleted, false) = false
          AND c.status NOT IN ('void', 'refunded')
     )
   ORDER BY
     CASE WHEN f.status = 'open' AND COALESCE(f.balance_amount,0) > 0 THEN 0 ELSE 1 END,
     CASE WHEN f.status = 'open' THEN 0 ELSE 1 END,
     COALESCE(f.balance_amount,0) DESC,
     COALESCE(f.total_amount,0) DESC,
     f.created_at DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT property_id, billing_company_id INTO v_prop, v_co
    FROM public.bookings WHERE id = _booking_id;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  -- Inherit the booking's Bill-To company so the bill/invoice shows the
  -- company name and GSTIN that were chosen during booking.
  IF v_co IS NOT NULL THEN
    SELECT name, gstin INTO v_co_name, v_co_gstin
      FROM public.billing_companies WHERE id = v_co;
  END IF;

  BEGIN
    INSERT INTO public.folios (property_id, booking_id, created_by,
                               billing_company_id, guest_company, guest_gstin)
      VALUES (v_prop, _booking_id, auth.uid(), v_co, v_co_name, v_co_gstin)
      RETURNING id INTO v_id;
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