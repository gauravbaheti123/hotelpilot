CREATE OR REPLACE FUNCTION public.post_segment_bill_to_folio(_bill_id uuid, _folio_id uuid DEFAULT NULL::uuid, _actor uuid DEFAULT NULL::uuid)
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
  actor uuid := COALESCE(_actor, auth.uid());
BEGIN
  SELECT * INTO b FROM public.segment_bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF b.is_walkin = true OR b.booking_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'walkin_not_supported', 'bill_number', b.bill_number);
  END IF;

  SELECT COUNT(*), COALESCE(SUM(i.amount),0), COALESCE(SUM(i.gst_amount),0)
    INTO item_count, sum_amount, sum_gst
  FROM public.segment_bill_items i WHERE i.segment_bill_id = b.id;

  IF item_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_items', 'bill_number', b.bill_number);
  END IF;

  target_folio_id := COALESCE(_folio_id, b.folio_id);
  IF target_folio_id IS NULL THEN
    target_folio_id := public.get_or_create_folio(b.booking_id);
  END IF;
  IF target_folio_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_folio', 'bill_number', b.bill_number);
  END IF;

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
    'segment_bills', b.id, b.bill_number, actor
  FROM public.segment_bill_items i
  WHERE i.segment_bill_id = b.id;

  GET DIAGNOSTICS posted = ROW_COUNT;

  UPDATE public.segment_bills
     SET status = 'settled',
         settled_at = COALESCE(settled_at, now()),
         -- Bill header always carries the FINAL, GST-inclusive amount so the
         -- invoice list matches every other settlement path.
         total_amount = round(sum_amount + sum_gst, 2),
         gst_amount = sum_gst,
         folio_id = target_folio_id,
         updated_at = now()
   WHERE id = b.id;

  PERFORM public.recompute_folio_totals(target_folio_id);

  RETURN jsonb_build_object(
    'ok', true, 'bill_id', b.id, 'bill_number', b.bill_number,
    'folio_id', target_folio_id, 'items', item_count, 'folio_charges_posted', posted
  );
END $function$;

REVOKE ALL ON FUNCTION public.post_segment_bill_to_folio(uuid, uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.post_segment_bill_to_folio(uuid, uuid, uuid) TO authenticated;