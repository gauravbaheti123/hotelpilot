-- Allow any staff login (with view access to the booking's property) to edit
-- the Adults / Children count shown on the invoice Stay Details.
CREATE OR REPLACE FUNCTION public.update_booking_pax(_booking_id uuid, _adults int, _children int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_property_id uuid;
BEGIN
  SELECT property_id INTO v_property_id FROM bookings WHERE id = _booking_id;
  IF v_property_id IS NULL THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF NOT (
    public.is_superadmin(auth.uid())
    OR public.is_global_owner(auth.uid())
    OR v_property_id IN (
      SELECT public.permitted_property_ids(auth.uid(), 'bookings', 'view')
    )
  ) THEN
    RAISE EXCEPTION 'You do not have access to this property';
  END IF;

  UPDATE bookings
     SET adults = GREATEST(1, COALESCE(_adults, 1)),
         children = GREATEST(0, COALESCE(_children, 0))
   WHERE id = _booking_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_booking_pax(uuid, int, int) TO authenticated;
