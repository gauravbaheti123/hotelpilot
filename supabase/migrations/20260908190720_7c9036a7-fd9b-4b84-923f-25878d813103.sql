CREATE OR REPLACE FUNCTION public.complete_checkout(
  _booking_id uuid,
  _mark_due boolean DEFAULT false,
  _due_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bk        record;
  v_now       timestamptz := now();
  v_balance   numeric := 0;
  v_room_ids  uuid[] := '{}';
  v_f         record;
  v_settled   int := 0;
BEGIN
  SELECT * INTO v_bk FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF NOT public.has_permission(auth.uid(), v_bk.property_id, 'bookings', 'edit')
     AND NOT public.has_permission(auth.uid(), v_bk.property_id, 'billing', 'edit')
     AND NOT public.is_owner_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed to check out this booking';
  END IF;

  -- Live (payable) folios of this booking.
  FOR v_f IN
    SELECT id, COALESCE(balance_amount, 0) AS bal, status
    FROM public.folios
    WHERE booking_id = _booking_id
      AND COALESCE(is_deleted, false) = false
      AND status NOT IN ('void', 'cancelled')
    FOR UPDATE
  LOOP
    IF v_f.bal > 0.01 THEN
      v_balance := v_balance + v_f.bal;
    END IF;
  END LOOP;

  IF v_balance > 0.01 AND NOT _mark_due THEN
    RAISE EXCEPTION 'Pending balance %. Collect payment first.', v_balance;
  END IF;

  FOR v_f IN
    SELECT id, COALESCE(balance_amount, 0) AS bal, status
    FROM public.folios
    WHERE booking_id = _booking_id
      AND COALESCE(is_deleted, false) = false
      AND status NOT IN ('void', 'cancelled')
  LOOP
    IF v_f.bal > 0.01 THEN
      PERFORM public.mark_folio_due(v_f.id, COALESCE(_due_reason, 'Checked out with balance'));
    ELSE
      PERFORM public.settle_folio_at_checkout(v_f.id, v_now);
    END IF;
    v_settled := v_settled + 1;
  END LOOP;

  IF v_bk.status NOT IN ('checked_out', 'cancelled') THEN
    UPDATE public.bookings
       SET status = 'checked_out',
           checked_out_at = v_now,
           checked_out_by = auth.uid()
     WHERE id = _booking_id;
  END IF;

  UPDATE public.booking_rooms
     SET actual_check_out = v_now
   WHERE booking_id = _booking_id
     AND actual_check_out IS NULL;

  SELECT COALESCE(array_agg(DISTINCT room_id), '{}')
    INTO v_room_ids
    FROM public.booking_rooms
   WHERE booking_id = _booking_id
     AND room_id IS NOT NULL;

  IF array_length(v_room_ids, 1) > 0 THEN
    UPDATE public.rooms
       SET status = 'vacant',
           housekeeping_status = 'dirty'
     WHERE id = ANY (v_room_ids)
       AND status <> 'maintenance';
  END IF;

  RETURN jsonb_build_object(
    'booking_id', _booking_id,
    'checked_out_at', v_now,
    'folios_finalized', v_settled,
    'due_amount', GREATEST(v_balance, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.complete_checkout(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_checkout(uuid, boolean, text) TO authenticated;