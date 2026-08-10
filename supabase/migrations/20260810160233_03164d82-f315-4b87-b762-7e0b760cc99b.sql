-- 1. Permission key
INSERT INTO public.permissions (module, action)
VALUES ('bookings', 'extend_stay_locked')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE p.module = 'bookings' AND p.action = 'extend_stay_locked'
   AND r.name IN ('Owner', 'Manager')
ON CONFLICT DO NOTHING;

-- 2. Extend stay routine
CREATE OR REPLACE FUNCTION public.extend_stay(
  _folio_id uuid,
  _new_check_out date,
  _new_check_out_time time DEFAULT NULL,
  _reason text DEFAULT NULL,
  _payment_amount numeric DEFAULT 0,
  _payment_mode text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_folio    public.folios%ROWTYPE;
  v_booking  public.bookings%ROWTYPE;
  v_br       public.booking_rooms%ROWTYPE;
  v_old_out  date;
  v_old_total numeric;
  v_new_total numeric;
  v_nights   int;
  v_nightly  numeric;
  v_gst_rate numeric;
  v_gross    numeric;
  v_amount   numeric;
  v_gst_amt  numeric;
  v_charge_id uuid;
  v_room_number text;
  v_category_name text;
  v_pay numeric := ROUND(COALESCE(_payment_amount, 0)::numeric, 2);
  v_res jsonb;
BEGIN
  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_folio.status IN ('void','refunded') OR COALESCE(v_folio.is_deleted,false) THEN
    RAISE EXCEPTION 'This bill is % and cannot be extended', v_folio.status;
  END IF;
  IF v_folio.booking_id IS NULL THEN
    RAISE EXCEPTION 'This bill is not linked to a booking';
  END IF;

  IF NOT (public.is_owner_or_super(auth.uid())
          OR public.has_permission(auth.uid(), v_folio.property_id, 'bookings', 'extend_stay_locked')) THEN
    RAISE EXCEPTION 'You do not have permission to extend a settled stay';
  END IF;

  SELECT * INTO v_booking FROM public.bookings WHERE id = v_folio.booking_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Booking not found'; END IF;
  IF v_booking.status IN ('cancelled','no_show') THEN
    RAISE EXCEPTION 'This booking is % and cannot be extended', v_booking.status;
  END IF;

  v_old_out   := v_booking.check_out;
  v_old_total := COALESCE(v_folio.total_amount, 0);

  IF _new_check_out IS NULL OR _new_check_out <= v_old_out THEN
    RAISE EXCEPTION 'The new checkout date must be later than the current checkout date (%)', v_old_out;
  END IF;

  -- Reopen the bill so the pricing routines are allowed to touch it.
  UPDATE public.folios
     SET status = 'open', settled_at = NULL, updated_at = now()
   WHERE id = _folio_id;

  -- Push every live room assignment forward. The overlap trigger on
  -- booking_rooms blocks the extension if the room is taken for the extra night.
  FOR v_br IN
    SELECT * FROM public.booking_rooms
     WHERE booking_id = v_booking.id
       AND COALESCE(status, 'active') IN ('active','reserved','checked_in')
  LOOP
    UPDATE public.booking_rooms
       SET check_out      = _new_check_out,
           check_out_time = COALESCE(_new_check_out_time, check_out_time),
           updated_at     = now()
     WHERE id = v_br.id;

    -- Re-price via the shared seeding routine first.
    PERFORM public.seed_room_charge_for_booking_room(v_br.id);

    v_nights  := GREATEST(1, (_new_check_out - v_br.check_in));
    v_nightly := COALESCE(v_br.rate, 0);

    SELECT fc.id INTO v_charge_id
      FROM public.folio_charges fc
     WHERE fc.folio_id = _folio_id
       AND fc.charge_type = 'room'
       AND fc.source_table = 'booking_rooms'
       AND fc.source_id = v_br.id
       AND COALESCE(fc.is_wiped,false) = false
       AND fc.qty = v_nights
     LIMIT 1;

    -- Day locks or a foreign folio can make the shared routine skip the row;
    -- fall back to the identical pricing maths so the extra night is still billed.
    IF v_charge_id IS NULL AND v_nightly > 0 THEN
      IF COALESCE(v_booking.rate_type, 'exclusive') = 'inclusive' THEN
        v_gst_rate := COALESCE(public.get_gst_rate(v_br.property_id, 'room', v_nightly), 0);
        v_gross    := v_nights * v_nightly;
        v_amount   := ROUND((v_gross / (1 + v_gst_rate / 100))::numeric, 2);
        v_gst_amt  := ROUND((v_gross - v_amount)::numeric, 2);
      ELSE
        v_gst_rate := COALESCE(public.get_gst_rate(v_br.property_id, 'room', v_nightly), 0);
        v_gross    := v_nights * v_nightly;
        v_amount   := v_gross;
        v_gst_amt  := ROUND((v_gross * v_gst_rate / 100)::numeric, 2);
      END IF;

      SELECT r.room_number INTO v_room_number FROM public.rooms r WHERE r.id = v_br.room_id;
      SELECT rc.name INTO v_category_name FROM public.room_categories rc WHERE rc.id = v_br.category_id;

      SELECT fc.id INTO v_charge_id
        FROM public.folio_charges fc
       WHERE fc.folio_id = _folio_id
         AND fc.charge_type = 'room'
         AND fc.source_table = 'booking_rooms'
         AND fc.source_id = v_br.id
         AND COALESCE(fc.is_wiped,false) = false
       LIMIT 1;

      IF v_charge_id IS NOT NULL THEN
        UPDATE public.folio_charges
           SET description = 'Room ' || COALESCE(v_room_number,'') || ' · ' || COALESCE(v_category_name,'') || ' · ' || v_nights || ' night(s)',
               qty = v_nights, rate = v_nightly, amount = v_amount,
               gst_rate = v_gst_rate, gst_amount = v_gst_amt
         WHERE id = v_charge_id;
      ELSE
        INSERT INTO public.folio_charges(
          folio_id, charge_type, description, qty, rate, amount,
          gst_rate, gst_amount, charged_on, source_table, source_id, created_by
        ) VALUES (
          _folio_id, 'room',
          'Room ' || COALESCE(v_room_number,'') || ' · ' || COALESCE(v_category_name,'') || ' · ' || v_nights || ' night(s)',
          v_nights, v_nightly, v_amount, v_gst_rate, v_gst_amt,
          COALESCE(v_br.check_in, v_booking.check_in, CURRENT_DATE),
          'booking_rooms', v_br.id, auth.uid()
        );
      END IF;
    END IF;
  END LOOP;

  UPDATE public.bookings
     SET check_out = _new_check_out, updated_at = now()
   WHERE id = v_booking.id;

  PERFORM public.recompute_folio_totals(_folio_id);

  -- Optional payment collected in the same flow.
  IF v_pay > 0 THEN
    IF COALESCE(btrim(_payment_mode), '') = '' THEN
      RAISE EXCEPTION 'Select a payment mode to collect payment now';
    END IF;
    SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
    IF v_pay > COALESCE(v_folio.balance_amount, 0) + 0.01 THEN
      RAISE EXCEPTION 'Payment cannot exceed the outstanding balance of %', COALESCE(v_folio.balance_amount, 0);
    END IF;
    INSERT INTO public.payments(property_id, booking_id, folio_id, amount, mode, paid_at, created_by)
    VALUES (v_folio.property_id, v_folio.booking_id, _folio_id, v_pay, btrim(_payment_mode), now(), auth.uid());
    PERFORM public.recompute_folio_totals(_folio_id);
  END IF;

  -- Finalised bills keep their invoice number and land on settled or due.
  IF COALESCE(NULLIF(btrim(v_folio.invoice_number), ''), '') <> '' THEN
    PERFORM public.resync_finalised_folio(_folio_id);
  END IF;

  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  v_new_total := COALESCE(v_folio.total_amount, 0);

  INSERT INTO public.activity_log
    (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
  VALUES (
    v_folio.property_id, auth.uid(),
    COALESCE((SELECT display_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    'STAY_EXTENDED_POST_SETTLEMENT', 'Billing', _folio_id,
    COALESCE(NULLIF(btrim(v_folio.invoice_number), ''), 'Bill') || ' — ' || v_old_out || ' → ' || _new_check_out,
    jsonb_build_object(
      'folio_id', _folio_id,
      'booking_id', v_folio.booking_id,
      'old_check_out', v_old_out,
      'new_check_out', _new_check_out,
      'new_check_out_time', _new_check_out_time,
      'old_total', v_old_total,
      'new_total', v_new_total,
      'added_amount', ROUND((v_new_total - v_old_total)::numeric, 2),
      'payment_collected', v_pay,
      'payment_mode', _payment_mode,
      'reason', NULLIF(btrim(COALESCE(_reason, '')), ''),
      'status', v_folio.status,
      'changed_by', auth.uid(),
      'changed_at', now()
    )
  );

  v_res := jsonb_build_object(
    'ok', true,
    'old_check_out', v_old_out,
    'new_check_out', _new_check_out,
    'added_amount', ROUND((v_new_total - v_old_total)::numeric, 2),
    'total_amount', v_new_total,
    'balance_amount', COALESCE(v_folio.balance_amount, 0),
    'status', v_folio.status
  );
  RETURN v_res;
END
$function$;

REVOKE ALL ON FUNCTION public.extend_stay(uuid, date, time, text, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.extend_stay(uuid, date, time, text, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.extend_stay(uuid, date, time, text, numeric, text) TO service_role;