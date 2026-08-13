-- 1. Allow an explicit settlement instant to be honoured (used by checkout
--    backfills); default behaviour (now()) unchanged when the GUC is unset.
CREATE OR REPLACE FUNCTION public.tg_force_server_time_folios()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_override timestamptz;
BEGIN
  BEGIN
    v_override := NULLIF(current_setting('app.settle_at', true), '')::timestamptz;
  EXCEPTION WHEN others THEN
    v_override := NULL;
  END;

  IF NEW.status = 'settled' AND OLD.status IS DISTINCT FROM 'settled' THEN
    NEW.settled_at := COALESCE(v_override, now());
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.settled_at := COALESCE(v_override, OLD.settled_at);
  END IF;
  IF NEW.status = 'void' AND OLD.status IS DISTINCT FROM 'void' THEN
    NEW.voided_at := now();
    NEW.deleted_at := COALESCE(OLD.deleted_at, now());
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.voided_at := OLD.voided_at;
  END IF;
  RETURN NEW;
END $function$;

-- 2. Checkout settlement as a SECURITY DEFINER RPC. Settling is a mechanical
--    part of checkout, so it is gated on front-desk/billing access, not on the
--    invoices/edit grid permission (which receptionists do not have).
CREATE OR REPLACE FUNCTION public.settle_folio_at_checkout(
  _folio_id uuid,
  _settled_at timestamptz DEFAULT NULL
)
RETURNS TABLE (folio_id uuid, status text, invoice_number text, settled_at timestamptz)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_folio public.folios%ROWTYPE;
  v_uid uuid := auth.uid();
BEGIN
  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Folio not found';
  END IF;

  IF v_uid IS NULL
     OR NOT (public.can_front_desk(v_uid, v_folio.property_id)
             OR public.can_billing(v_uid, v_folio.property_id)) THEN
    RAISE EXCEPTION 'Not allowed to settle bills for this property';
  END IF;

  IF COALESCE(v_folio.is_deleted, false) OR v_folio.status = 'void' THEN
    RAISE EXCEPTION 'Bill is voided — cannot settle';
  END IF;

  -- Already finalised: no-op, report current state.
  IF v_folio.status IN ('settled','due','refunded') THEN
    RETURN QUERY SELECT v_folio.id, v_folio.status, v_folio.invoice_number, v_folio.settled_at;
    RETURN;
  END IF;

  IF COALESCE(v_folio.balance_amount, 0) > 0.01 THEN
    RAISE EXCEPTION 'Balance of % outstanding — collect payment or mark as due',
      ROUND(v_folio.balance_amount, 2);
  END IF;

  IF _settled_at IS NOT NULL THEN
    PERFORM set_config('app.settle_at', _settled_at::text, true);
  END IF;

  UPDATE public.folios
     SET is_reopened = false,
         status      = 'settled',
         settled_at  = COALESCE(v_folio.settled_at, _settled_at, now())
   WHERE id = _folio_id;

  PERFORM set_config('app.settle_at', '', true);

  SELECT * INTO v_folio FROM public.folios WHERE id = _folio_id;

  IF v_folio.status <> 'settled'
     OR v_folio.invoice_number IS NULL
     OR btrim(v_folio.invoice_number) = '' THEN
    RAISE EXCEPTION 'Settlement did not complete (status %, invoice %)',
      v_folio.status, COALESCE(v_folio.invoice_number, 'none');
  END IF;

  RETURN QUERY SELECT v_folio.id, v_folio.status, v_folio.invoice_number, v_folio.settled_at;
END $function$;

REVOKE ALL ON FUNCTION public.settle_folio_at_checkout(uuid, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.settle_folio_at_checkout(uuid, timestamptz) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_folio_at_checkout(uuid, timestamptz) TO service_role;