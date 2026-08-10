-- 1) Keep 'due' a sticky, deliberate status ------------------------------
CREATE OR REPLACE FUNCTION public.tg_folios_balance_before_write()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.balance_amount := GREATEST(0, COALESCE(NEW.total_amount,0) - COALESCE(NEW.paid_amount,0));
  IF NEW.status NOT IN ('void','refunded') THEN
    IF COALESCE(NEW.is_reopened, false) AND NEW.status <> 'settled' THEN
      NEW.status := 'open';
      NEW.settled_at := NULL;
    ELSIF NEW.balance_amount <= 0.01 AND COALESCE(NEW.paid_amount,0) > 0 THEN
      NEW.status := 'settled';
      IF NEW.settled_at IS NULL THEN NEW.settled_at := now(); END IF;
      NEW.is_reopened := false;
    ELSIF NEW.status = 'due' THEN
      -- Deliberate "checked out with balance outstanding". Never downgrade to open.
      IF NEW.settled_at IS NULL THEN NEW.settled_at := now(); END IF;
      NEW.is_reopened := false;
    ELSE
      NEW.status := 'open';
      NEW.settled_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END
$$;

-- 2) recompute_folio_totals: treat 'due' as final, like settled -----------
CREATE OR REPLACE FUNCTION public.recompute_folio_totals(_folio_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_status_now text;
BEGIN
  SELECT status INTO v_status_now FROM public.folios WHERE id = _folio_id;
  IF v_status_now = 'due' THEN RETURN; END IF;
  PERFORM public.recompute_folio_totals_core(_folio_id);
END
$fn$;

-- 3) New permission keys --------------------------------------------------
INSERT INTO public.permissions (module, action)
VALUES ('payments','delete'), ('invoices','edit_room_rate_locked')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
  FROM public.roles r
  JOIN public.permissions p
    ON (p.module = 'payments' AND p.action = 'delete' AND r.name = 'Owner')
    OR (p.module = 'invoices' AND p.action = 'edit_room_rate_locked' AND r.name IN ('Owner','Manager'))
ON CONFLICT DO NOTHING;

-- 4) Mark a folio as DUE at checkout -------------------------------------
CREATE OR REPLACE FUNCTION public.mark_folio_due(_folio_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
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
  IF NOT (public.is_owner_or_super(auth.uid())
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
END
$fn$;

REVOKE ALL ON FUNCTION public.mark_folio_due(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.mark_folio_due(uuid, text) TO authenticated;

-- 5) Delete a payment (audited) ------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_payment(_payment_id uuid, _reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_pay   public.payments%ROWTYPE;
  v_folio public.folios%ROWTYPE;
  v_paid  numeric := 0;
  v_bal   numeric := 0;
  v_status text;
BEGIN
  SELECT * INTO v_pay FROM public.payments WHERE id = _payment_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Payment not found'; END IF;
  IF NOT (public.is_owner_or_super(auth.uid())
          OR public.has_permission(auth.uid(), v_pay.property_id, 'payments', 'delete')) THEN
    RAISE EXCEPTION 'You do not have permission to delete payments';
  END IF;

  SELECT * INTO v_folio FROM public.folios WHERE id = v_pay.folio_id;

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
      'reason', NULLIF(btrim(COALESCE(_reason, '')), '')
    )
  );

  DELETE FROM public.payments WHERE id = _payment_id;

  IF v_folio.id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_paid
      FROM public.payments
     WHERE folio_id = v_folio.id
       AND NOT public.is_hold_payment_mode(mode);
    v_bal := ROUND(GREATEST(0, COALESCE(v_folio.total_amount,0) - v_paid)::numeric, 2);
    IF v_folio.status IN ('void','refunded') THEN
      v_status := v_folio.status;
    ELSIF v_bal <= 0.01 AND v_paid > 0 THEN
      v_status := 'settled';
    ELSIF COALESCE(NULLIF(btrim(v_folio.invoice_number), ''), '') <> '' THEN
      v_status := 'due';   -- already finalised/checked out: keep it in the dues list
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

  RETURN jsonb_build_object('ok', true, 'paid_amount', v_paid, 'balance_amount', v_bal, 'status', v_status);
END
$fn$;

REVOKE ALL ON FUNCTION public.delete_payment(uuid, text) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_payment(uuid, text) TO authenticated;

-- 6) Re-settle a finalised folio after a post-settlement room-rate edit ----
CREATE OR REPLACE FUNCTION public.resync_finalised_folio(_folio_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  v_folio public.folios%ROWTYPE;
  v_paid  numeric := 0;
  v_bal   numeric := 0;
  v_status text;
BEGIN
  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'Bill not found'; END IF;
  IF v_folio.status IN ('void','refunded') THEN
    RETURN jsonb_build_object('ok', false, 'status', v_folio.status);
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.payments
   WHERE folio_id = _folio_id
     AND NOT public.is_hold_payment_mode(mode);
  v_bal := ROUND(GREATEST(0, COALESCE(v_folio.total_amount,0) - v_paid)::numeric, 2);
  IF v_bal <= 0.01 AND v_paid > 0 THEN
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
   WHERE id = _folio_id;
  RETURN jsonb_build_object('ok', true, 'paid_amount', v_paid, 'balance_amount', v_bal, 'status', v_status);
END
$fn$;

REVOKE ALL ON FUNCTION public.resync_finalised_folio(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.resync_finalised_folio(uuid) TO authenticated;