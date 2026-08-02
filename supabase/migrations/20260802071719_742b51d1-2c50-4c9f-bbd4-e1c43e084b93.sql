CREATE OR REPLACE FUNCTION public.settle_segment_bill(_bill_id uuid, _actor uuid DEFAULT NULL, _auto boolean DEFAULT false)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b RECORD;
  target_folio_id uuid;
  item_count integer;
  sum_amount numeric := 0;
  sum_gst numeric := 0;
  posted integer := 0;
BEGIN
  SELECT * INTO b FROM public.segment_bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT COUNT(*), COALESCE(SUM(i.amount), 0), COALESCE(SUM(i.gst_amount), 0)
    INTO item_count, sum_amount, sum_gst
  FROM public.segment_bill_items i
  WHERE i.segment_bill_id = b.id;

  IF item_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_items', 'bill_number', b.bill_number);
  END IF;

  -- Resolve folio for in-house bills
  IF b.is_walkin = false AND b.booking_id IS NOT NULL THEN
    target_folio_id := b.folio_id;
    IF target_folio_id IS NULL THEN
      BEGIN
        target_folio_id := public.get_or_create_folio(b.booking_id);
      EXCEPTION WHEN OTHERS THEN
        target_folio_id := NULL;
      END;
    END IF;
  END IF;

  -- Idempotent re-post: clear then insert current line state
  IF target_folio_id IS NOT NULL THEN
    DELETE FROM public.folio_charges
    WHERE source_table = 'segment_bills' AND source_id = b.id;

    INSERT INTO public.folio_charges (
      folio_id, charge_type, description, qty, rate, amount, gst_rate, gst_amount,
      source_table, source_id, segment_bill_ref, created_by
    )
    SELECT
      target_folio_id,
      CASE WHEN b.segment = 'food' THEN 'food' ELSE 'laundry' END,
      i.description || ' (' || b.bill_number || ')',
      i.qty, i.rate, i.amount, i.gst_rate, i.gst_amount,
      'segment_bills', b.id, b.bill_number, _actor
    FROM public.segment_bill_items i
    WHERE i.segment_bill_id = b.id;

    GET DIAGNOSTICS posted = ROW_COUNT;
  END IF;

  UPDATE public.segment_bills
  SET status = 'settled',
      settled_at = COALESCE(settled_at, now()),
      total_amount = sum_amount,
      gst_amount = sum_gst,
      folio_id = COALESCE(target_folio_id, folio_id),
      notes = CASE
        WHEN _auto THEN COALESCE(notes,'')
             || CASE WHEN COALESCE(notes,'') = '' THEN '' ELSE E'\n' END
             || 'Auto-closed at daily close on '
             || to_char(now() AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD HH24:MI')
        ELSE notes
      END,
      updated_at = now()
  WHERE id = b.id;

  INSERT INTO public.activity_log (
    property_id, action_type, module, reference_id, reference_label, details
  ) VALUES (
    b.property_id,
    CASE WHEN _auto THEN 'SEGMENT_BILL_AUTO_CLOSED' ELSE 'SEGMENT_BILL_SETTLED' END,
    CASE WHEN b.segment = 'food' THEN 'food' ELSE 'laundry' END,
    b.id,
    b.bill_number,
    jsonb_build_object(
      'segment', b.segment,
      'bill_number', b.bill_number,
      'amount', sum_amount,
      'gst_amount', sum_gst,
      'items', item_count,
      'folio_charges_posted', posted,
      'room_id', b.room_id,
      'booking_id', b.booking_id,
      'folio_id', target_folio_id,
      'auto', _auto,
      'closed_at', now()
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'bill_id', b.id,
    'bill_number', b.bill_number,
    'items', item_count,
    'total_amount', sum_amount,
    'gst_amount', sum_gst,
    'folio_id', target_folio_id,
    'folio_charges_posted', posted
  );
END;
$function$;

GRANT EXECUTE ON FUNCTION public.settle_segment_bill(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_segment_bill(uuid, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.auto_close_segment_bills()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b RECORD;
  closed_count integer := 0;
  res jsonb;
BEGIN
  FOR b IN
    SELECT sb.id, sb.bill_number, sb.property_id
    FROM public.segment_bills sb
    WHERE sb.status = 'open'
      AND sb.segment IN ('food','laundry')
      AND sb.is_walkin = false
      AND sb.booking_id IS NOT NULL
      AND (sb.created_at AT TIME ZONE 'Asia/Kolkata')::date
          <= (now() AT TIME ZONE 'Asia/Kolkata')::date
  LOOP
    BEGIN
      res := public.settle_segment_bill(b.id, NULL, true);
      IF COALESCE((res->>'ok')::boolean, false) THEN
        closed_count := closed_count + 1;
      END IF;
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO public.activity_log (
        property_id, action_type, module, reference_id, reference_label, details
      ) VALUES (
        b.property_id, 'SEGMENT_BILL_AUTO_CLOSE_FAILED', 'food', b.id, b.bill_number,
        jsonb_build_object('error', SQLERRM)
      );
    END;
  END LOOP;

  RETURN closed_count;
END;
$function$;