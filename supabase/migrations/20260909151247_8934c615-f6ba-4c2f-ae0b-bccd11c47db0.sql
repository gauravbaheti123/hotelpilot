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
  v_owner boolean;
  v_open  boolean;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;

  SELECT * INTO v_folio FROM public.folios WHERE id = v_pay.folio_id;

  v_owner := public.is_owner_or_super(auth.uid());
  v_normal := v_owner
          OR public.has_permission(auth.uid(), v_pay.property_id, 'payments', 'delete');
  v_grace := public.folio_in_grace(v_pay.folio_id);
  v_open  := v_folio.id IS NULL
             OR (COALESCE(v_folio.status,'open') = 'open' AND COALESCE(v_folio.is_deleted,false) = false);

  IF NOT (v_normal OR v_grace) THEN
    RAISE EXCEPTION 'You do not have permission to delete payments';
  END IF;

  -- Finalised bill: Owner/Superadmin only, or inside the post-settlement grace window.
  IF NOT v_open AND NOT v_owner AND NOT v_grace THEN
    RAISE EXCEPTION 'This bill is already finalised — only the Owner can delete a payment on it';
  END IF;

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
      'bill_open', v_open,
      'reason', NULLIF(btrim(COALESCE(_reason, '')), '')
    )
  );

  DELETE FROM public.payments WHERE id = _payment_id;

  IF v_folio.id IS NOT NULL THEN
    -- "Bill on Hold" payments count as paid (same rule as recompute_folio_totals).
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
      FROM public.payments
     WHERE folio_id = v_folio.id;
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

REVOKE ALL ON FUNCTION public.delete_payment(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_payment(uuid, text) TO authenticated, service_role;