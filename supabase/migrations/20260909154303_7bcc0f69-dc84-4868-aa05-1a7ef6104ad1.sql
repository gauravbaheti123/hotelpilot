CREATE OR REPLACE FUNCTION public.settle_segment_bill_complimentary(_bill_id uuid, _reason text, _actor uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  b RECORD;
  uid uuid := COALESCE(auth.uid(), _actor);
  item_count integer;
  sum_amount numeric := 0;
  sum_gst numeric := 0;
  removed integer := 0;
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reason_required');
  END IF;

  -- Complimentary settlement is a routine food-service task (MAP/AP plan
  -- inclusions), so ANY signed-in staff member of the property may do it.
  -- Accountability lives in the mandatory reason + activity_log entry.
  IF uid IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  SELECT * INTO b FROM public.segment_bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF NOT (
    public.is_superadmin(uid)
    OR b.property_id IN (SELECT unnest(public.permitted_property_ids()))
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = uid AND ur.property_id = b.property_id
    )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  SELECT COUNT(*), COALESCE(SUM(i.amount), 0), COALESCE(SUM(i.gst_amount), 0)
    INTO item_count, sum_amount, sum_gst
  FROM public.segment_bill_items i
  WHERE i.segment_bill_id = b.id;

  IF item_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_items', 'bill_number', b.bill_number);
  END IF;

  DELETE FROM public.folio_charges
  WHERE source_table = 'segment_bills' AND source_id = b.id;
  GET DIAGNOSTICS removed = ROW_COUNT;

  IF b.folio_id IS NOT NULL THEN
    BEGIN
      PERFORM public.recompute_folio_totals(b.folio_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  UPDATE public.segment_bills
  SET status = 'settled',
      settled_at = COALESCE(settled_at, now()),
      total_amount = sum_amount,
      gst_amount = sum_gst,
      paid_amount = 0,
      payment_mode = 'complimentary',
      is_complimentary = true,
      complimentary_reason = btrim(_reason),
      complimentary_by = uid,
      complimentary_at = now(),
      updated_at = now()
  WHERE id = b.id;

  INSERT INTO public.activity_log (
    property_id, action_type, module, reference_id, reference_label, details
  ) VALUES (
    b.property_id,
    'BILL_MARKED_COMPLIMENTARY',
    CASE WHEN b.segment = 'food' THEN 'food' ELSE 'laundry' END,
    b.id,
    b.bill_number,
    jsonb_build_object(
      'segment', b.segment,
      'bill_number', b.bill_number,
      'amount', sum_amount,
      'gst_amount', sum_gst,
      'items', item_count,
      'reason', btrim(_reason),
      'folio_charges_removed', removed,
      'booking_id', b.booking_id,
      'folio_id', b.folio_id,
      'marked_at', now()
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'bill_id', b.id,
    'bill_number', b.bill_number,
    'total_amount', sum_amount,
    'gst_amount', sum_gst,
    'reason', btrim(_reason)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_segment_bill_complimentary(uuid, text, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.settle_segment_bill_complimentary(uuid, text, uuid) TO authenticated;