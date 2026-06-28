
CREATE OR REPLACE FUNCTION public.recompute_folio_totals(_folio_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_total  numeric;
  v_paid   numeric;
  v_bal    numeric;
  v_status text;
BEGIN
  SELECT COALESCE(total_amount,0), status
    INTO v_total, v_status
    FROM public.folios WHERE id = _folio_id;
  IF NOT FOUND THEN RETURN; END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_paid
    FROM public.payments
   WHERE folio_id = _folio_id;

  v_bal := GREATEST(0, COALESCE(v_total,0) - COALESCE(v_paid,0));

  IF v_status IN ('void','refunded') THEN
    NULL;
  ELSIF v_bal <= 0.01 AND v_paid > 0 THEN
    v_status := 'settled';
  ELSE
    v_status := 'open';
  END IF;

  UPDATE public.folios
     SET paid_amount    = ROUND(v_paid::numeric, 2),
         balance_amount = ROUND(v_bal::numeric, 2),
         status         = v_status,
         settled_at     = CASE WHEN v_status = 'settled' AND settled_at IS NULL THEN now()
                               WHEN v_status <> 'settled' THEN NULL
                               ELSE settled_at END,
         updated_at     = now()
   WHERE id = _folio_id;
END $$;

CREATE OR REPLACE FUNCTION public.sync_booking_balance(_booking_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_total numeric; v_paid numeric;
BEGIN
  IF _booking_id IS NULL THEN RETURN; END IF;
  SELECT COALESCE(SUM(total_amount),0), COALESCE(SUM(paid_amount),0)
    INTO v_total, v_paid
    FROM public.folios
   WHERE booking_id = _booking_id
     AND COALESCE(is_deleted, false) = false
     AND status <> 'void';
  UPDATE public.bookings
     SET balance_amount = ROUND(GREATEST(0, v_total - v_paid)::numeric, 2),
         updated_at     = now()
   WHERE id = _booking_id;
END $$;

CREATE OR REPLACE FUNCTION public.tg_payments_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_folio uuid; v_booking uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN v_folio := OLD.folio_id; v_booking := OLD.booking_id;
  ELSE                     v_folio := NEW.folio_id; v_booking := NEW.booking_id;
  END IF;
  IF v_folio IS NOT NULL THEN PERFORM public.recompute_folio_totals(v_folio); END IF;
  IF v_booking IS NULL AND v_folio IS NOT NULL THEN
    SELECT booking_id INTO v_booking FROM public.folios WHERE id = v_folio;
  END IF;
  IF v_booking IS NOT NULL THEN PERFORM public.sync_booking_balance(v_booking); END IF;
  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS payments_sync ON public.payments;
CREATE TRIGGER payments_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.payments
  FOR EACH ROW EXECUTE FUNCTION public.tg_payments_sync();

CREATE OR REPLACE FUNCTION public.tg_folios_sync_booking()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.booking_id IS NOT NULL THEN PERFORM public.sync_booking_balance(NEW.booking_id); END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS folios_sync_booking ON public.folios;
CREATE TRIGGER folios_sync_booking
  AFTER INSERT OR UPDATE OF total_amount, paid_amount, status, is_deleted ON public.folios
  FOR EACH ROW EXECUTE FUNCTION public.tg_folios_sync_booking();

CREATE OR REPLACE FUNCTION public.void_folio_safe(
  _folio_id uuid, _reason text, _user_id uuid
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_paid numeric;
BEGIN
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.payments WHERE folio_id = _folio_id;
  IF v_paid > 0 THEN
    RAISE EXCEPTION 'Cannot void folio % — it has recorded payments (₹%). Refund or move payments first.', _folio_id, v_paid;
  END IF;
  UPDATE public.folios
     SET is_deleted = true, deleted_at = now(), deleted_by = _user_id,
         status = 'void', voided_at = now(), void_reason = _reason, updated_at = now()
   WHERE id = _folio_id;
END $$;

REVOKE ALL ON FUNCTION public.void_folio_safe(uuid,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_folio_safe(uuid,text,uuid) TO authenticated;

-- One-time backfill
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT id FROM public.folios LOOP PERFORM public.recompute_folio_totals(r.id); END LOOP;
  FOR r IN SELECT id FROM public.bookings LOOP PERFORM public.sync_booking_balance(r.id); END LOOP;
END $$;
