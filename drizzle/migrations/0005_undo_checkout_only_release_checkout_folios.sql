-- Restrict the undo-checkout invoice-number release to folios that were
-- finalised BY this checkout. Bills settled earlier during the stay (advance
-- settlement) keep their printed invoice number.
CREATE OR REPLACE FUNCTION public.undo_checkout(_booking_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_booking public.bookings%ROWTYPE;
  v_folio   public.folios%ROWTYPE;
  v_room_ids uuid[];
  v_conflict int;
  v_privileged boolean;
  v_normal boolean;
  v_grace boolean;
  v_segment text := 'lodge';
  v_prefix text;
  v_suffix text;
  v_num int;
  v_last int;
  v_released text;
  v_released_all text[] := ARRAY[]::text[];
  v_f record;
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
  END IF;

  SELECT * INTO v_folio
    FROM public.folios
   WHERE booking_id = _booking_id
     AND COALESCE(is_deleted, false) = false
     AND status <> 'void'
   ORDER BY created_at DESC
   LIMIT 1;

  SELECT prefix, last_number INTO v_prefix, v_last
    FROM public.bill_sequences
   WHERE property_id = v_booking.property_id
     AND sequence_type = v_segment;

  FOR v_f IN
    SELECT id, invoice_number
      FROM public.folios
     WHERE booking_id = _booking_id
       AND COALESCE(is_deleted, false) = false
       AND status <> 'void'
       AND COALESCE(btrim(invoice_number), '') <> ''
       -- Only folios finalised by THIS checkout. A bill settled in advance
       -- (guest still in house) keeps its printed number.
       AND (
         settled_at IS NULL
         OR settled_at >= v_booking.checked_out_at - interval '10 minutes'
       )
     ORDER BY invoice_number DESC
  LOOP
    v_released_all := v_released_all || btrim(v_f.invoice_number);
    IF v_released IS NULL THEN
      v_released := btrim(v_f.invoice_number);
    END IF;

    IF v_prefix IS NOT NULL AND btrim(v_f.invoice_number) LIKE v_prefix || '%' THEN
      v_suffix := substring(btrim(v_f.invoice_number) from length(v_prefix) + 1);
      IF v_suffix ~ '^[0-9]+$' THEN
        v_num := v_suffix::int;
        IF v_num = v_last THEN
          UPDATE public.bill_sequences
             SET last_number = GREATEST(v_num - 1, 0), updated_at = now()
           WHERE property_id = v_booking.property_id
             AND sequence_type = v_segment;
          v_last := GREATEST(v_num - 1, 0);
        ELSIF v_num < v_last THEN
          INSERT INTO public.bill_number_pool (property_id, sequence_type, number, released_from_folio_id)
          VALUES (v_booking.property_id, v_segment, v_num, v_f.id)
          ON CONFLICT DO NOTHING;
        END IF;
      END IF;
    END IF;

    UPDATE public.folios
       SET status = 'open',
           settled_at = NULL,
           invoice_number = NULL,
           is_reopened = true,
           updated_at = now()
     WHERE id = v_f.id;
  END LOOP;

  INSERT INTO public.checkout_undo_log (booking_id, folio_id, undone_by, original_checkout_at, property_id)
  VALUES (_booking_id, v_folio.id, auth.uid(), v_booking.checked_out_at, v_booking.property_id);

  IF v_folio.id IS NOT NULL AND COALESCE(btrim(v_folio.invoice_number), '') = '' THEN
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

  INSERT INTO public.activity_log
    (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
  VALUES (
    v_booking.property_id, auth.uid(), NULL, 'undo_checkout', 'bookings',
    _booking_id, v_booking.booking_number,
    jsonb_build_object('released_invoice_numbers', to_jsonb(v_released_all))
  );

  RETURN jsonb_build_object('ok', true, 'released', v_released, 'released_all', to_jsonb(v_released_all));
END
$fn$;

REVOKE ALL ON FUNCTION public.undo_checkout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_checkout(uuid) TO authenticated, service_role;
