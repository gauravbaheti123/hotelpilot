-- Move an over-collected amount from one bill (folio) to another bill of the
-- same booking, atomically: a negative "refund/transfer out" row on the source
-- and a matching payment row on the destination.
CREATE OR REPLACE FUNCTION public.transfer_folio_credit(
  _from_folio_id uuid,
  _to_folio_id uuid,
  _amount numeric,
  _reason text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_from   public.folios%ROWTYPE;
  v_to     public.folios%ROWTYPE;
  v_paid   numeric;
  v_excess numeric;
  v_from_no text;
  v_to_no   text;
BEGIN
  IF _amount IS NULL OR _amount <= 0 THEN
    RAISE EXCEPTION 'Transfer amount must be greater than zero';
  END IF;
  IF _from_folio_id = _to_folio_id THEN
    RAISE EXCEPTION 'Source and destination bill must be different';
  END IF;

  SELECT * INTO v_from FROM public.folios WHERE id = _from_folio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Source bill not found'; END IF;
  SELECT * INTO v_to FROM public.folios WHERE id = _to_folio_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Destination bill not found'; END IF;

  IF v_from.booking_id IS DISTINCT FROM v_to.booking_id THEN
    RAISE EXCEPTION 'Both bills must belong to the same booking';
  END IF;
  IF v_to.status IN ('void', 'refunded') OR COALESCE(v_to.is_deleted, false) THEN
    RAISE EXCEPTION 'Destination bill is not open for payments';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.payments WHERE folio_id = _from_folio_id;
  v_excess := ROUND(v_paid - COALESCE(v_from.total_amount, 0), 2);
  IF _amount > v_excess + 0.01 THEN
    RAISE EXCEPTION 'Only % can be transferred from this bill (excess collected)', ROUND(v_excess, 2);
  END IF;

  v_from_no := COALESCE(v_from.invoice_number, 'bill');
  v_to_no   := COALESCE(v_to.invoice_number, 'bill');

  INSERT INTO public.payments (property_id, folio_id, booking_id, amount, mode, notes, created_by)
  VALUES (v_from.property_id, _from_folio_id, v_from.booking_id, -_amount, 'TRANSFER',
          'REFUND — transferred to ' || v_to_no || COALESCE(' — ' || NULLIF(_reason, ''), ''),
          auth.uid());

  INSERT INTO public.payments (property_id, folio_id, booking_id, amount, mode, notes, created_by)
  VALUES (v_to.property_id, _to_folio_id, v_to.booking_id, _amount, 'TRANSFER',
          'Transferred from ' || v_from_no || COALESCE(' — ' || NULLIF(_reason, ''), ''),
          auth.uid());

  PERFORM public.recompute_folio_totals(_from_folio_id);
  PERFORM public.recompute_folio_totals(_to_folio_id);
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_folio_credit(uuid, uuid, numeric, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.transfer_folio_credit(uuid, uuid, numeric, text) TO authenticated, service_role;