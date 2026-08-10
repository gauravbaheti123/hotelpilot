INSERT INTO public.permissions (module, action)
VALUES ('payments', 'edit_date')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.module = 'payments' AND p.action = 'edit_date'
  AND lower(r.name) IN ('owner', 'manager')
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = true;

CREATE OR REPLACE FUNCTION public.change_payment_date(_payment_id uuid, _new_paid_at timestamptz, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_old timestamptz;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF NOT (
    public.is_superadmin(auth.uid())
    OR public.is_global_owner(auth.uid())
    OR public.has_permission(auth.uid(), v_pay.property_id, 'payments', 'edit_date')
  ) THEN
    RAISE EXCEPTION 'You do not have permission to change the payment date';
  END IF;

  IF _new_paid_at IS NULL THEN
    RAISE EXCEPTION 'Payment date required';
  END IF;
  IF _new_paid_at > now() + interval '1 day' THEN
    RAISE EXCEPTION 'Payment date cannot be in the future';
  END IF;

  v_old := v_pay.paid_at;
  IF v_old = _new_paid_at THEN
    RETURN jsonb_build_object('changed', false, 'paid_at', v_old);
  END IF;

  -- Date-only edit: amount, mode and reference are deliberately untouched,
  -- so folio totals and balance are unaffected.
  UPDATE public.payments SET paid_at = _new_paid_at WHERE id = _payment_id;

  RETURN jsonb_build_object(
    'changed', true,
    'payment_id', _payment_id,
    'old_paid_at', v_old,
    'new_paid_at', _new_paid_at,
    'reason', _reason
  );
END;
$function$;