INSERT INTO public.permissions (module, action)
VALUES ('payments','edit_mode')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.module = 'payments' AND p.action = 'edit_mode'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = true;

CREATE OR REPLACE FUNCTION public.change_payment_mode(
  _payment_id uuid,
  _new_mode text,
  _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pay public.payments%ROWTYPE;
  v_old text;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment not found';
  END IF;

  IF NOT (
    public.is_superadmin(auth.uid())
    OR public.is_global_owner(auth.uid())
    OR public.has_permission(auth.uid(), v_pay.property_id, 'payments', 'edit_mode')
  ) THEN
    RAISE EXCEPTION 'Not authorised to change payment mode';
  END IF;

  IF _new_mode IS NULL OR btrim(_new_mode) = '' THEN
    RAISE EXCEPTION 'Payment mode required';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.payment_methods pm
    WHERE pm.property_id = v_pay.property_id
      AND pm.name = _new_mode
      AND pm.is_active
  ) THEN
    RAISE EXCEPTION 'Select an active payment method';
  END IF;

  v_old := v_pay.mode;
  IF v_old = _new_mode THEN
    RETURN jsonb_build_object('changed', false, 'mode', v_old);
  END IF;

  UPDATE public.payments SET mode = _new_mode WHERE id = _payment_id;

  RETURN jsonb_build_object(
    'changed', true,
    'payment_id', _payment_id,
    'old_mode', v_old,
    'new_mode', _new_mode,
    'reason', _reason
  );
END;
$$;

REVOKE ALL ON FUNCTION public.change_payment_mode(uuid, text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.change_payment_mode(uuid, text, text) TO authenticated;