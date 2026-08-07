INSERT INTO public.permissions (module, action)
VALUES ('payments','edit_amount')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r, public.permissions p
WHERE p.module='payments' AND p.action='edit_amount' AND r.name = 'Owner'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = true;

CREATE OR REPLACE FUNCTION public.change_payment_amount(_payment_id uuid, _new_amount numeric, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_folio public.folios%ROWTYPE;
  v_old numeric;
  v_paid numeric := 0;
  v_bal numeric := 0;
  v_status text;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;

  IF NOT (
    public.is_superadmin(auth.uid())
    OR public.is_global_owner(auth.uid())
    OR public.has_permission(auth.uid(), v_pay.property_id, 'payments', 'edit_amount')
  ) THEN
    RAISE EXCEPTION 'Not authorised to change payment amount';
  END IF;

  IF _new_amount IS NULL OR _new_amount <= 0 THEN
    RAISE EXCEPTION 'Amount must be greater than zero';
  END IF;

  v_old := v_pay.amount;
  IF ROUND(v_old,2) = ROUND(_new_amount,2) THEN
    RETURN jsonb_build_object('changed', false, 'amount', v_old);
  END IF;

  UPDATE public.payments SET amount = ROUND(_new_amount,2) WHERE id = _payment_id;

  IF v_pay.folio_id IS NOT NULL THEN
    -- trigger already recomputes open folios; settled/void folios are skipped there,
    -- so re-sync paid/balance explicitly from the payment rows.
    SELECT * INTO v_folio FROM public.folios WHERE id = v_pay.folio_id;
    IF FOUND THEN
      SELECT COALESCE(SUM(amount),0) INTO v_paid
        FROM public.payments WHERE folio_id = v_folio.id;
      v_bal := ROUND(COALESCE(v_folio.total_amount,0) - v_paid, 2);
      v_status := v_folio.status;
      IF v_status NOT IN ('void','refunded') THEN
        IF v_bal > 0.01 AND v_status = 'settled' THEN v_status := 'due';
        ELSIF v_bal <= 0.01 AND v_status = 'due' THEN v_status := 'settled';
        END IF;
      END IF;
      UPDATE public.folios
         SET paid_amount = ROUND(v_paid,2),
             balance_amount = v_bal,
             status = v_status,
             updated_at = now()
       WHERE id = v_folio.id;
      IF v_folio.booking_id IS NOT NULL THEN
        PERFORM public.sync_booking_balance(v_folio.booking_id);
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'changed', true,
    'payment_id', _payment_id,
    'old_amount', v_old,
    'new_amount', ROUND(_new_amount,2),
    'folio_id', v_pay.folio_id,
    'paid_amount', ROUND(v_paid,2),
    'balance_amount', v_bal,
    'status', v_status,
    'reason', _reason
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.change_payment_amount(uuid, numeric, text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.change_payment_amount(uuid, numeric, text) TO authenticated;