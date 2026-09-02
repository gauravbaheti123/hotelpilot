ALTER TABLE public.payments
  ADD COLUMN IF NOT EXISTS segment_bill_id uuid REFERENCES public.segment_bills(id);

CREATE INDEX IF NOT EXISTS idx_payments_segment_bill_id ON public.payments(segment_bill_id);

CREATE OR REPLACE FUNCTION public.settle_segment_bill_with_payment(
  _bill_id uuid,
  _mode text,
  _reference_no text DEFAULT NULL,
  _actor uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b RECORD;
  target_folio_id uuid;
  item_count integer;
  sum_amount numeric := 0;
  sum_gst numeric := 0;
  posted integer := 0;
  new_payment_id uuid;
  actor uuid := COALESCE(_actor, auth.uid());
BEGIN
  IF _mode IS NULL OR btrim(_mode) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'mode_required');
  END IF;

  SELECT * INTO b FROM public.segment_bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  IF b.status <> 'open' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_open', 'bill_number', b.bill_number);
  END IF;

  IF b.is_walkin = true OR b.booking_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'walkin_not_supported', 'bill_number', b.bill_number);
  END IF;

  SELECT COUNT(*), COALESCE(SUM(i.amount), 0), COALESCE(SUM(i.gst_amount), 0)
    INTO item_count, sum_amount, sum_gst
  FROM public.segment_bill_items i
  WHERE i.segment_bill_id = b.id;

  IF item_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_items', 'bill_number', b.bill_number);
  END IF;

  target_folio_id := b.folio_id;
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

  INSERT INTO public.payments (
    property_id, folio_id, booking_id, amount, mode, reference_no,
    paid_at, notes, created_by, segment_bill_id
  ) VALUES (
    b.property_id, target_folio_id, b.booking_id, sum_amount + sum_gst, _mode,
    NULLIF(btrim(COALESCE(_reference_no, '')), ''),
    now(), 'Standalone food bill settlement (' || b.bill_number || ')', actor, b.id
  )
  RETURNING id INTO new_payment_id;

  UPDATE public.segment_bills
  SET status = 'settled',
      settled_at = COALESCE(settled_at, now()),
      total_amount = sum_amount + sum_gst,
      gst_amount = sum_gst,
      paid_amount = sum_amount + sum_gst,
      payment_mode = _mode,
      folio_id = target_folio_id,
      updated_at = now()
  WHERE id = b.id;

  INSERT INTO public.activity_log (
    property_id, action_type, module, reference_id, reference_label, details
  ) VALUES (
    b.property_id,
    'SEGMENT_BILL_SETTLED_STANDALONE',
    CASE WHEN b.segment = 'food' THEN 'food' ELSE 'laundry' END,
    b.id,
    b.bill_number,
    jsonb_build_object(
      'segment', b.segment,
      'bill_number', b.bill_number,
      'amount', sum_amount + sum_gst,
      'gst_amount', sum_gst,
      'items', item_count,
      'folio_charges_posted', posted,
      'room_id', b.room_id,
      'booking_id', b.booking_id,
      'folio_id', target_folio_id,
      'payment_id', new_payment_id,
      'payment_mode', _mode,
      'reference_no', _reference_no,
      'closed_at', now()
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'bill_id', b.id,
    'bill_number', b.bill_number,
    'items', item_count,
    'total_amount', sum_amount + sum_gst,
    'gst_amount', sum_gst,
    'folio_id', target_folio_id,
    'folio_charges_posted', posted,
    'payment_id', new_payment_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.settle_segment_bill_with_payment(uuid, text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.settle_segment_bill_with_payment(uuid, text, text, uuid) TO authenticated;