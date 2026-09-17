-- 1. Pool of released (freed) bill numbers so gaps can be reissued in order.
CREATE TABLE IF NOT EXISTS public.bill_number_pool (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL,
  sequence_type text NOT NULL,
  number integer NOT NULL,
  released_from_folio_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS bill_number_pool_open_uniq
  ON public.bill_number_pool (property_id, sequence_type, number)
  WHERE consumed_at IS NULL;

GRANT SELECT ON public.bill_number_pool TO authenticated;
GRANT ALL ON public.bill_number_pool TO service_role;

ALTER TABLE public.bill_number_pool ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "staff read bill number pool" ON public.bill_number_pool;
CREATE POLICY "staff read bill number pool"
ON public.bill_number_pool
FOR SELECT
TO authenticated
USING (
  public.is_superadmin(auth.uid())
  OR public.is_global_owner(auth.uid())
  OR property_id IN (SELECT public.my_property_ids(auth.uid()))
);

-- 2. Numbering claims a freed number before advancing the counter.
CREATE OR REPLACE FUNCTION public.generate_bill_number(_property_id uuid, _segment text)
RETURNS text
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_prefix text;
  v_short  text;
  v_next   int;
  v_max    int := 0;
  v_pad    int := 4;
  v_seg_code text;
  v_candidate text;
  v_guard int := 0;
  v_re    text;
  v_plen  int;
  v_stored text;
  v_exists boolean;
  v_pool   record;
BEGIN
  IF _property_id IS NULL OR _segment IS NULL THEN
    RAISE EXCEPTION 'property_id and segment required';
  END IF;
  IF _segment NOT IN ('lodge','food','laundry','banquet','banquet_food') THEN
    RAISE EXCEPTION 'Unknown bill segment %', _segment;
  END IF;
  v_seg_code := CASE _segment
    WHEN 'lodge'        THEN 'LDG'
    WHEN 'food'         THEN 'F'
    WHEN 'laundry'      THEN 'L'
    WHEN 'banquet'      THEN 'EVT'
    WHEN 'banquet_food' THEN 'EVT-F'
  END;

  SELECT short_code INTO v_short FROM public.properties WHERE id = _property_id;

  SELECT prefix, true INTO v_stored, v_exists
    FROM public.bill_sequences
   WHERE property_id = _property_id AND sequence_type = _segment;

  IF v_stored IS NOT NULL THEN
    v_prefix := v_stored;
  ELSE
    v_prefix := COALESCE(NULLIF(btrim(COALESCE(v_short,'')),'') || '-' || v_seg_code || '-', v_seg_code || '-');
  END IF;

  v_plen := length(v_prefix);
  v_re := '^' || regexp_replace(v_prefix, '([^a-zA-Z0-9])', '\\\1', 'g') || '[0-9]+$';

  INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix)
    VALUES (_property_id, _segment, 0, v_prefix)
    ON CONFLICT (property_id, sequence_type) DO NOTHING;

  PERFORM 1 FROM public.bill_sequences
   WHERE property_id = _property_id AND sequence_type = _segment
   FOR UPDATE;

  -- Reuse released numbers (e.g. freed by an undo checkout) lowest-first.
  LOOP
    SELECT * INTO v_pool
      FROM public.bill_number_pool
     WHERE property_id = _property_id
       AND sequence_type = _segment
       AND consumed_at IS NULL
     ORDER BY number
     LIMIT 1
     FOR UPDATE SKIP LOCKED;

    EXIT WHEN v_pool.id IS NULL;

    UPDATE public.bill_number_pool SET consumed_at = now() WHERE id = v_pool.id;
    v_candidate := v_prefix || lpad(v_pool.number::text, v_pad, '0');

    IF NOT EXISTS (
      SELECT 1 FROM public.segment_bills WHERE property_id = _property_id AND bill_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.folios WHERE property_id = _property_id AND invoice_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.bookings WHERE property_id = _property_id AND banquet_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.banquet_master_bills WHERE property_id = _property_id AND bill_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.food_bills WHERE property_id = _property_id AND food_bill_number = v_candidate
    ) THEN
      RETURN v_candidate;
    END IF;

    v_pool := NULL;
  END LOOP;

  IF _segment = 'banquet' THEN
    SELECT GREATEST(
      COALESCE((SELECT MAX(CASE WHEN banquet_number ~ v_re
                                THEN substring(banquet_number from v_plen + 1)::int END)
                  FROM public.bookings
                 WHERE property_id = _property_id
                   AND banquet_number LIKE v_prefix || '%'), 0),
      COALESCE((SELECT MAX(CASE WHEN invoice_number ~ v_re
                                THEN substring(invoice_number from v_plen + 1)::int END)
                  FROM public.folios
                 WHERE property_id = _property_id
                   AND invoice_number LIKE v_prefix || '%'), 0),
      COALESCE((SELECT MAX(CASE WHEN bill_number ~ v_re
                                THEN substring(bill_number from v_plen + 1)::int END)
                  FROM public.banquet_master_bills
                 WHERE property_id = _property_id
                   AND bill_number LIKE v_prefix || '%'), 0)
    ) INTO v_max;
  ELSIF _segment = 'banquet_food' THEN
    SELECT GREATEST(
      COALESCE((SELECT MAX(CASE WHEN food_bill_number ~ v_re
                                THEN substring(food_bill_number from v_plen + 1)::int END)
                  FROM public.food_bills
                 WHERE property_id = _property_id
                   AND food_bill_number LIKE v_prefix || '%'), 0),
      COALESCE((SELECT MAX(CASE WHEN bill_number ~ v_re
                                THEN substring(bill_number from v_plen + 1)::int END)
                  FROM public.segment_bills
                 WHERE property_id = _property_id
                   AND bill_number LIKE v_prefix || '%'), 0)
    ) INTO v_max;
  ELSE
    SELECT COALESCE(MAX(CASE WHEN bill_number ~ v_re
                             THEN substring(bill_number from v_plen + 1)::int END), 0)
      INTO v_max
      FROM public.segment_bills
     WHERE property_id = _property_id
       AND bill_number LIKE v_prefix || '%';
  END IF;

  SELECT GREATEST(COALESCE(last_number,0), v_max) + 1 INTO v_next
    FROM public.bill_sequences
   WHERE property_id = _property_id AND sequence_type = _segment;

  LOOP
    v_guard := v_guard + 1;
    v_candidate := v_prefix || lpad(v_next::text, v_pad, '0');
    EXIT WHEN v_guard > 500;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.segment_bills WHERE property_id = _property_id AND bill_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.folios WHERE property_id = _property_id AND invoice_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.bookings WHERE property_id = _property_id AND banquet_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.banquet_master_bills WHERE property_id = _property_id AND bill_number = v_candidate
      UNION ALL
      SELECT 1 FROM public.food_bills WHERE property_id = _property_id AND food_bill_number = v_candidate
    );
    v_next := v_next + 1;
  END LOOP;

  UPDATE public.bill_sequences
     SET last_number = v_next, updated_at = now()
   WHERE property_id = _property_id AND sequence_type = _segment;

  RETURN v_candidate;
END
$fn$;

REVOKE ALL ON FUNCTION public.generate_bill_number(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.generate_bill_number(uuid, text) TO authenticated, service_role;

-- 3. Undo checkout releases the numbers of EVERY live folio of the booking and
--    banks any number it cannot rewind into the pool.
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

  IF COALESCE(v_booking.source,'') = 'event_block'
     OR COALESCE(v_booking.booking_type::text,'') = 'banquet' THEN
    v_segment := 'banquet';
  END IF;

  SELECT prefix, last_number INTO v_prefix, v_last
    FROM public.bill_sequences
   WHERE property_id = v_booking.property_id
     AND sequence_type = v_segment
   FOR UPDATE;

  -- Release every numbered live folio of this booking (split bills included).
  FOR v_f IN
    SELECT id, invoice_number
      FROM public.folios
     WHERE booking_id = _booking_id
       AND COALESCE(is_deleted, false) = false
       AND status <> 'void'
       AND COALESCE(btrim(invoice_number), '') <> ''
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
          -- Latest number of the series: step the counter back.
          UPDATE public.bill_sequences
             SET last_number = GREATEST(v_num - 1, 0), updated_at = now()
           WHERE property_id = v_booking.property_id
             AND sequence_type = v_segment;
          v_last := GREATEST(v_num - 1, 0);
        ELSIF v_num < v_last THEN
          -- Cannot rewind (a newer number exists) — bank it for reuse.
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

  IF v_folio.id IS NOT NULL THEN
    UPDATE public.folios
       SET status = 'open',
           settled_at = NULL,
           invoice_number = NULL,
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
    v_booking.property_id, auth.uid(),
    COALESCE((SELECT display_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    'CHECKOUT_UNDONE', 'Front Desk', _booking_id,
    COALESCE('Undo checkout · released ' || array_to_string(v_released_all, ', '), 'Undo checkout'),
    jsonb_build_object(
      'booking_id', _booking_id,
      'folio_id', v_folio.id,
      'original_checkout_at', v_booking.checked_out_at,
      'released_invoice_number', v_released,
      'released_invoice_numbers', to_jsonb(v_released_all),
      'via_grace_window', (NOT v_normal AND v_grace)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', _booking_id,
    'folio_id', v_folio.id,
    'original_checkout_at', v_booking.checked_out_at,
    'released_invoice_number', v_released,
    'released_invoice_numbers', to_jsonb(v_released_all),
    'via_grace_window', (NOT v_normal AND v_grace),
    'privileged_override', v_privileged AND now() - v_booking.checked_out_at > interval '60 minutes'
  );
END
$fn$;

REVOKE ALL ON FUNCTION public.undo_checkout(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.undo_checkout(uuid) TO authenticated, service_role;
