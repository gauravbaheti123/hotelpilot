CREATE OR REPLACE FUNCTION public.mark_folio_due(_folio_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_folio public.folios%ROWTYPE;
  v_paid  numeric := 0;
  v_bal   numeric := 0;
BEGIN
  IF COALESCE(btrim(_reason), '') = '' THEN
    RAISE EXCEPTION 'A reason is required to mark a bill as due';
  END IF;
  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_folio.status IN ('void','refunded') THEN
    RAISE EXCEPTION 'This bill is % and cannot be marked as due', v_folio.status;
  END IF;
  -- Checking out with a due balance is a front-desk action, not an
  -- "edit invoice" action: gate it on front-desk/billing access too.
  IF NOT (public.is_owner_or_super(auth.uid())
          OR public.can_front_desk(auth.uid(), v_folio.property_id)
          OR public.can_billing(auth.uid(), v_folio.property_id)
          OR public.has_permission(auth.uid(), v_folio.property_id, 'invoices', 'edit')
          OR public.has_permission(auth.uid(), v_folio.property_id, 'front_desk', 'edit')) THEN
    RAISE EXCEPTION 'You do not have permission to check out with a due balance';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.payments
   WHERE folio_id = _folio_id
     AND NOT public.is_hold_payment_mode(mode);
  v_bal := ROUND(GREATEST(0, COALESCE(v_folio.total_amount,0) - v_paid)::numeric, 2);
  IF v_bal <= 0.01 THEN
    RAISE EXCEPTION 'Nothing is outstanding on this bill — use the normal checkout';
  END IF;

  UPDATE public.folios
     SET paid_amount    = ROUND(v_paid::numeric, 2),
         balance_amount = v_bal,
         status         = 'due',
         is_reopened    = false,
         settled_at     = COALESCE(settled_at, now()),
         updated_at     = now()
   WHERE id = _folio_id;

  INSERT INTO public.activity_log
    (property_id, user_id, user_name, action_type, module, reference_id, reference_label, details)
  VALUES (
    v_folio.property_id, auth.uid(),
    COALESCE((SELECT display_name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    'CHECKOUT_WITH_DUE_BALANCE', 'Billing', _folio_id,
    COALESCE(NULLIF(btrim(v_folio.invoice_number), ''), 'Bill'),
    jsonb_build_object(
      'folio_id', _folio_id,
      'booking_id', v_folio.booking_id,
      'total_amount', v_folio.total_amount,
      'real_paid', v_paid,
      'amount_due', v_bal,
      'reason', btrim(_reason)
    )
  );

  RETURN jsonb_build_object('ok', true, 'paid_amount', v_paid, 'balance_amount', v_bal);
END $function$;