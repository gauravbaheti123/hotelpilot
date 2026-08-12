-- 1. Grace-window helpers -------------------------------------------------
CREATE OR REPLACE FUNCTION public.in_grace_window(_ts timestamptz)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT _ts IS NOT NULL AND now() - _ts <= interval '60 minutes' AND now() >= _ts - interval '1 minute';
$$;

-- TRUE when the folio was settled less than 60 minutes ago AND the caller
-- is a staff member of that property (any role).
CREATE OR REPLACE FUNCTION public.folio_in_grace(_folio_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.folios f
     WHERE f.id = _folio_id
       AND public.in_grace_window(f.settled_at)
       AND (
         public.is_superadmin(auth.uid())
         OR public.is_global_owner(auth.uid())
         OR f.property_id IN (SELECT public.my_property_ids(auth.uid()))
       )
  );
$$;

-- TRUE when the booking was checked out less than 60 minutes ago AND the
-- caller is a staff member of that property (any role).
CREATE OR REPLACE FUNCTION public.booking_in_undo_grace(_booking_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.bookings b
     WHERE b.id = _booking_id
       AND public.in_grace_window(b.checked_out_at)
       AND (
         public.is_superadmin(auth.uid())
         OR public.is_global_owner(auth.uid())
         OR b.property_id IN (SELECT public.my_property_ids(auth.uid()))
       )
  );
$$;

GRANT EXECUTE ON FUNCTION public.in_grace_window(timestamptz) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.folio_in_grace(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.booking_in_undo_grace(uuid) TO authenticated, service_role;

-- 2. Undo checkout: any property staff within 60 minutes -------------------
CREATE OR REPLACE FUNCTION public.undo_checkout(_booking_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_folio   public.folios%ROWTYPE;
  v_room_ids uuid[];
  v_conflict int;
  v_privileged boolean;
  v_normal boolean;
  v_grace boolean;
BEGIN
  SELECT * INTO v_booking FROM public.bookings WHERE id = _booking_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  v_normal := public.can_front_desk(auth.uid(), v_booking.property_id);
  v_grace  := public.in_grace_window(v_booking.checked_out_at)
              AND (
                public.is_superadmin(auth.uid())
                OR public.is_global_owner(auth.uid())
                OR v_booking.property_id IN (SELECT public.my_property_ids(auth.uid()))
              );

  IF NOT (v_normal OR v_grace) THEN
    RAISE EXCEPTION 'Not authorised to undo checkout';
  END IF;

  IF v_booking.status <> 'checked_out' THEN
    RAISE EXCEPTION 'Booking is not in checked-out state';
  END IF;
  IF v_booking.checked_out_at IS NULL THEN
    RAISE EXCEPTION 'Checkout timestamp is missing';
  END IF;

  v_privileged := public.has_role(auth.uid(), 'owner'::app_role)
               OR public.has_role(auth.uid(), 'superadmin'::app_role)
               OR public.has_role(auth.uid(), 'manager'::app_role);

  IF NOT v_privileged AND now() - v_booking.checked_out_at > interval '60 minutes' THEN
    RAISE EXCEPTION 'Undo window (60 minutes) has passed';
  END IF;

  IF public.is_day_locked(v_booking.property_id, v_booking.checked_out_at::date) THEN
    RAISE EXCEPTION 'Day is locked by Night Audit; cannot undo checkout';
  END IF;

  SELECT array_agg(room_id) INTO v_room_ids
    FROM public.booking_rooms
    WHERE booking_id = _booking_id AND room_id IS NOT NULL;

  IF v_room_ids IS NOT NULL AND array_length(v_room_ids, 1) > 0 THEN
    SELECT count(*) INTO v_conflict
      FROM public.bookings b2
      JOIN public.booking_rooms br ON br.booking_id = b2.id
      WHERE br.room_id = ANY(v_room_ids)
        AND b2.id <> _booking_id
        AND b2.status = 'checked_out'
        AND b2.checked_out_at > v_booking.checked_out_at;
    IF v_conflict > 0 THEN
      RAISE EXCEPTION 'A newer checkout exists on this room; undo not allowed';
    END IF;

    SELECT count(*) INTO v_conflict
      FROM public.booking_rooms br
      JOIN public.bookings b2 ON b2.id = br.booking_id
      WHERE br.room_id = ANY(v_room_ids)
        AND br.booking_id <> _booking_id
        AND COALESCE(br.status,'active') IN ('active','reserved','checked_in')
        AND COALESCE(b2.status,'reserved') NOT IN ('cancelled','no_show','checked_out');
    IF v_conflict > 0 THEN
      RAISE EXCEPTION 'Room has been reassigned to another booking; undo not allowed';
    END IF;
  END IF;

  SELECT * INTO v_folio FROM public.folios
    WHERE booking_id = _booking_id
      AND COALESCE(is_deleted, false) = false
      AND status <> 'void'
    ORDER BY created_at DESC LIMIT 1;

  INSERT INTO public.checkout_undo_log (booking_id, folio_id, undone_by, original_checkout_at, property_id)
  VALUES (_booking_id, v_folio.id, auth.uid(), v_booking.checked_out_at, v_booking.property_id);

  IF v_folio.id IS NOT NULL THEN
    UPDATE public.folios
       SET status = 'open',
           settled_at = NULL,
           is_reopened = true,
           updated_at = now()
     WHERE id = v_folio.id;
  END IF;

  UPDATE public.bookings
     SET status = 'checked_in',
         checked_out_at = NULL,
         checked_out_by = NULL,
         updated_at = now()
   WHERE id = _booking_id;

  UPDATE public.booking_rooms
     SET actual_check_out = NULL,
         status = 'active',
         updated_at = now()
   WHERE booking_id = _booking_id;

  IF v_room_ids IS NOT NULL AND array_length(v_room_ids, 1) > 0 THEN
    UPDATE public.rooms
       SET status = 'occupied',
           updated_at = now()
     WHERE id = ANY(v_room_ids);
  END IF;

  IF NOT v_normal AND v_grace THEN
    INSERT INTO public.activity_log
      (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
    VALUES (
      v_booking.property_id, auth.uid(),
      COALESCE((SELECT display_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
      'CHECKOUT_UNDONE', 'Front Desk', _booking_id,
      'Undo checkout (grace window)',
      jsonb_build_object(
        'booking_id', _booking_id,
        'folio_id', v_folio.id,
        'original_checkout_at', v_booking.checked_out_at,
        'via_grace_window', true
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', _booking_id,
    'folio_id', v_folio.id,
    'original_checkout_at', v_booking.checked_out_at,
    'via_grace_window', (NOT v_normal AND v_grace),
    'privileged_override', v_privileged AND now() - v_booking.checked_out_at > interval '60 minutes'
  );
END $function$;

-- 3. change_payment_amount: grace window ----------------------------------
CREATE OR REPLACE FUNCTION public.change_payment_amount(_payment_id uuid, _new_amount numeric, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_folio public.folios%ROWTYPE;
  v_old numeric;
  v_paid numeric := 0;
  v_bal numeric := 0;
  v_status text;
  v_normal boolean;
  v_grace boolean;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;

  v_normal := public.is_superadmin(auth.uid())
    OR public.is_global_owner(auth.uid())
    OR public.has_permission(auth.uid(), v_pay.property_id, 'payments', 'edit_amount');
  v_grace := public.folio_in_grace(v_pay.folio_id);

  IF NOT (v_normal OR v_grace) THEN
    RAISE EXCEPTION 'Not authorised to change payment amount';
  END IF;

  IF _new_amount IS NULL OR _new_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  v_old := v_pay.amount;
  IF ROUND(v_old,2) = ROUND(_new_amount,2) THEN
    RETURN jsonb_build_object('changed', false, 'amount', v_old);
  END IF;

  UPDATE public.payments SET amount = ROUND(_new_amount,2) WHERE id = _payment_id;

  IF v_pay.folio_id IS NOT NULL THEN
    SELECT * INTO v_folio FROM public.folios WHERE id = v_pay.folio_id;
    IF FOUND THEN
      SELECT COALESCE(SUM(amount),0) INTO v_paid
        FROM public.payments WHERE folio_id = v_folio.id;
      v_bal := ROUND(COALESCE(v_folio.total_amount,0) - v_paid, 2);
      v_status := v_folio.status;
      IF v_status NOT IN ('void','refunded') THEN
        IF v_bal > 0.01 AND v_status = 'settled' THEN v_status := 'due';
        ELSIF v_bal <= 0.01 AND v_status = 'due' THEN v_status := 'settled';
        END IF;
      END IF;
      UPDATE public.folios
         SET paid_amount = ROUND(v_paid,2),
             balance_amount = v_bal,
             status = v_status,
             updated_at = now()
       WHERE id = v_folio.id;
      IF v_folio.booking_id IS NOT NULL THEN
        PERFORM public.sync_booking_balance(v_folio.booking_id);
      END IF;
    END IF;
  END IF;

  IF NOT v_normal AND v_grace THEN
    INSERT INTO public.activity_log
      (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
    VALUES (
      v_pay.property_id, auth.uid(),
      COALESCE((SELECT display_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
      'PAYMENT_AMOUNT_CHANGED', 'Billing', _payment_id,
      'Payment amount changed (grace window)',
      jsonb_build_object(
        'payment_id', _payment_id,
        'folio_id', v_pay.folio_id,
        'old_amount', v_old,
        'new_amount', ROUND(_new_amount,2),
        'reason', NULLIF(btrim(COALESCE(_reason,'')), ''),
        'via_grace_window', true
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'changed', true,
    'payment_id', _payment_id,
    'old_amount', v_old,
    'new_amount', ROUND(_new_amount,2),
    'folio_id', v_pay.folio_id,
    'paid_amount', ROUND(v_paid,2),
    'balance_amount', v_bal,
    'status', v_status,
    'via_grace_window', (NOT v_normal AND v_grace),
    'reason', _reason
  );
END;
$function$;

-- 4. delete_payment: grace window -----------------------------------------
CREATE OR REPLACE FUNCTION public.delete_payment(_payment_id uuid, _reason text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_pay   public.payments%ROWTYPE;
  v_folio public.folios%ROWTYPE;
  v_paid  numeric := 0;
  v_bal   numeric := 0;
  v_status text;
  v_normal boolean;
  v_grace boolean;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;

  v_normal := public.is_owner_or_super(auth.uid())
          OR public.has_permission(auth.uid(), v_pay.property_id, 'payments', 'delete');
  v_grace := public.folio_in_grace(v_pay.folio_id);

  IF NOT (v_normal OR v_grace) THEN
    RAISE EXCEPTION 'You do not have permission to delete payments';
  END IF;

  SELECT * INTO v_folio FROM public.folios WHERE id = v_pay.folio_id;

  INSERT INTO public.activity_log
    (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
  VALUES (
    v_pay.property_id, auth.uid(),
    COALESCE((SELECT display_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    'PAYMENT_DELETED', 'Billing', _payment_id,
    COALESCE(NULLIF(btrim(v_folio.invoice_number), ''), 'Bill'),
    jsonb_build_object(
      'payment_id', _payment_id,
      'folio_id', v_pay.folio_id,
      'booking_id', v_pay.booking_id,
      'amount', v_pay.amount,
      'mode', v_pay.mode,
      'reference_no', v_pay.reference_no,
      'paid_at', v_pay.paid_at,
      'via_grace_window', (NOT v_normal AND v_grace),
      'reason', NULLIF(btrim(COALESCE(_reason, '')), '')
    )
  );

  DELETE FROM public.payments WHERE id = _payment_id;

  IF v_folio.id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
      FROM public.payments
     WHERE folio_id = v_folio.id
       AND NOT public.is_hold_payment_mode(mode);
    v_bal := ROUND(GREATEST(0, COALESCE(v_folio.total_amount,0) - v_paid)::numeric, 2);
    IF v_folio.status IN ('void','refunded') THEN
      v_status := v_folio.status;
    ELSIF v_bal <= 0.01 AND v_paid > 0 THEN
      v_status := 'settled';
    ELSIF COALESCE(NULLIF(btrim(v_folio.invoice_number), ''), '') <> '' THEN
      v_status := 'due';
    ELSE
      v_status := 'open';
    END IF;
    UPDATE public.folios
       SET paid_amount    = ROUND(v_paid::numeric, 2),
           balance_amount = v_bal,
           status         = v_status,
           updated_at     = now()
     WHERE id = v_folio.id;
  END IF;

  RETURN jsonb_build_object('ok', true, 'paid_amount', v_paid, 'balance_amount', v_bal,
                            'status', v_status, 'via_grace_window', (NOT v_normal AND v_grace));
END
$function$;

-- 5. Grace-window RLS so room-rate / Bill-To edits work server-side --------
DROP POLICY IF EXISTS folios_grace_edit ON public.folios;
CREATE POLICY folios_grace_edit ON public.folios
  FOR UPDATE TO authenticated
  USING (public.in_grace_window(settled_at) AND property_id IN (SELECT public.my_property_ids(auth.uid())))
  WITH CHECK (property_id IN (SELECT public.my_property_ids(auth.uid())));

DROP POLICY IF EXISTS folio_charges_grace_edit ON public.folio_charges;
CREATE POLICY folio_charges_grace_edit ON public.folio_charges
  FOR UPDATE TO authenticated
  USING (public.folio_in_grace(folio_id))
  WITH CHECK (public.folio_in_grace(folio_id));

DROP POLICY IF EXISTS payments_grace_edit ON public.payments;
CREATE POLICY payments_grace_edit ON public.payments
  FOR UPDATE TO authenticated
  USING (public.folio_in_grace(folio_id))
  WITH CHECK (public.folio_in_grace(folio_id));

DROP POLICY IF EXISTS payments_grace_delete ON public.payments;
CREATE POLICY payments_grace_delete ON public.payments
  FOR DELETE TO authenticated
  USING (public.folio_in_grace(folio_id));