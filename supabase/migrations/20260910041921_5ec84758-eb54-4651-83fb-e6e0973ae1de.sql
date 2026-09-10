-- 1) get_or_create_folio: recognise live split portions
CREATE OR REPLACE FUNCTION public.get_or_create_folio(_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid; v_prop uuid;
BEGIN
  -- Prefer a LIVE bill of this booking that is not superseded by a split:
  -- a parent folio whose portions are live must never be returned, and the
  -- portions themselves ARE valid bills (previously excluded by the
  -- parent_folio_id IS NULL predicate, which silently created empty folios).
  SELECT f.id INTO v_id
    FROM public.folios f
   WHERE f.booking_id = _booking_id
     AND COALESCE(f.is_deleted, false) = false
     AND f.status NOT IN ('void', 'refunded')
     AND NOT EXISTS (
       SELECT 1 FROM public.folios c
        WHERE c.parent_folio_id = f.id
          AND COALESCE(c.is_deleted, false) = false
          AND c.status NOT IN ('void', 'refunded')
     )
   ORDER BY
     CASE WHEN f.status = 'open' AND COALESCE(f.balance_amount,0) > 0 THEN 0 ELSE 1 END,
     CASE WHEN f.status = 'open' THEN 0 ELSE 1 END,
     COALESCE(f.balance_amount,0) DESC,
     COALESCE(f.total_amount,0) DESC,
     f.created_at DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT property_id INTO v_prop FROM public.bookings WHERE id = _booking_id;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;

  BEGIN
    INSERT INTO public.folios (property_id, booking_id, created_by)
      VALUES (v_prop, _booking_id, auth.uid()) RETURNING id INTO v_id;
  EXCEPTION WHEN unique_violation THEN
    SELECT id INTO v_id
      FROM public.folios
     WHERE booking_id = _booking_id
       AND COALESCE(is_deleted, false) = false
       AND status <> 'void'
       AND parent_folio_id IS NULL
     ORDER BY created_at DESC
     LIMIT 1;
    IF v_id IS NULL THEN RAISE; END IF;
  END;

  RETURN v_id;
END
$$;

REVOKE ALL ON FUNCTION public.get_or_create_folio(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_or_create_folio(uuid) TO authenticated;

-- 2) balance trigger: a deliberately settled zero-value bill stays settled
CREATE OR REPLACE FUNCTION public.tg_folios_balance_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_ongoing boolean := false;
  v_explicit boolean := false;
BEGIN
  NEW.balance_amount := ROUND((COALESCE(NEW.total_amount,0) - COALESCE(NEW.paid_amount,0))::numeric, 2);

  IF NEW.booking_id IS NOT NULL THEN
    v_ongoing := public.stay_ongoing(NEW.booking_id);
  END IF;

  v_explicit := (NEW.status = 'settled')
                AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'settled');

  IF NEW.status NOT IN ('void','refunded') THEN
    IF COALESCE(NEW.is_reopened, false) AND NEW.status <> 'settled' THEN
      NEW.status := 'open';
      NEW.settled_at := NULL;
    ELSIF TG_OP = 'UPDATE'
          AND OLD.status = 'settled'
          AND NEW.status = 'settled'
          AND COALESCE(NEW.is_reopened, false) = false
          AND NEW.balance_amount <= 0.01 THEN
      -- Already finalised (including nil-value bills): keep it settled.
      IF NEW.settled_at IS NULL THEN NEW.settled_at := COALESCE(OLD.settled_at, now()); END IF;
    ELSIF NEW.balance_amount <= 0.01
          AND (COALESCE(NEW.paid_amount,0) > 0
               OR (v_explicit AND COALESCE(NEW.total_amount,0) <= 0.01)) THEN
      IF v_ongoing AND NOT v_explicit AND (TG_OP = 'INSERT' OR OLD.status <> 'settled') THEN
        NEW.status := 'open';
        NEW.settled_at := NULL;
      ELSE
        NEW.status := 'settled';
        IF NEW.settled_at IS NULL THEN NEW.settled_at := now(); END IF;
        NEW.is_reopened := false;
      END IF;
    ELSIF NEW.status = 'due' THEN
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

-- 3) complete_checkout: never number a nil bill
CREATE OR REPLACE FUNCTION public.complete_checkout(
  _booking_id uuid,
  _mark_due boolean DEFAULT false,
  _due_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bk        record;
  v_now       timestamptz := now();
  v_balance   numeric := 0;
  v_room_ids  uuid[] := '{}';
  v_f         record;
  v_settled   int := 0;
  v_nil       boolean;
BEGIN
  SELECT * INTO v_bk FROM public.bookings WHERE id = _booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found';
  END IF;

  IF NOT public.has_permission(auth.uid(), v_bk.property_id, 'bookings', 'edit')
     AND NOT public.has_permission(auth.uid(), v_bk.property_id, 'billing', 'edit')
     AND NOT public.is_owner_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Not allowed to check out this booking';
  END IF;

  FOR v_f IN
    SELECT id, COALESCE(balance_amount, 0) AS bal, status
    FROM public.folios
    WHERE booking_id = _booking_id
      AND COALESCE(is_deleted, false) = false
      AND status NOT IN ('void', 'cancelled')
    FOR UPDATE
  LOOP
    IF v_f.bal > 0.01 THEN
      v_balance := v_balance + v_f.bal;
    END IF;
  END LOOP;

  IF v_balance > 0.01 AND NOT _mark_due THEN
    RAISE EXCEPTION 'Pending balance %. Collect payment first.', v_balance;
  END IF;

  FOR v_f IN
    SELECT id, COALESCE(balance_amount, 0) AS bal, status,
           COALESCE(total_amount,0) AS total, COALESCE(paid_amount,0) AS paid,
           invoice_number
    FROM public.folios
    WHERE booking_id = _booking_id
      AND COALESCE(is_deleted, false) = false
      AND status NOT IN ('void', 'cancelled')
  LOOP
    -- A nil bill (no charges, no payments, nothing billed) must never consume
    -- an invoice number — close it quietly instead of settling it.
    v_nil := v_f.total <= 0.01
             AND v_f.paid <= 0.01
             AND COALESCE(NULLIF(btrim(COALESCE(v_f.invoice_number,'')),''), '') = ''
             AND NOT EXISTS (SELECT 1 FROM public.folio_charges c WHERE c.folio_id = v_f.id)
             AND NOT EXISTS (SELECT 1 FROM public.payments p WHERE p.folio_id = v_f.id);

    IF v_nil THEN
      UPDATE public.folios
         SET status = 'void', is_deleted = true, deleted_at = v_now, deleted_by = auth.uid()
       WHERE id = v_f.id;
      CONTINUE;
    END IF;

    IF v_f.bal > 0.01 THEN
      PERFORM public.mark_folio_due(v_f.id, COALESCE(_due_reason, 'Checked out with balance'));
    ELSE
      PERFORM public.settle_folio_at_checkout(v_f.id, v_now);
    END IF;
    v_settled := v_settled + 1;
  END LOOP;

  IF v_bk.status NOT IN ('checked_out', 'cancelled') THEN
    UPDATE public.bookings
       SET status = 'checked_out',
           checked_out_at = v_now,
           checked_out_by = auth.uid()
     WHERE id = _booking_id;
  END IF;

  UPDATE public.booking_rooms
     SET actual_check_out = v_now
   WHERE booking_id = _booking_id
     AND actual_check_out IS NULL;

  SELECT COALESCE(array_agg(DISTINCT room_id), '{}')
    INTO v_room_ids
    FROM public.booking_rooms
   WHERE booking_id = _booking_id
     AND room_id IS NOT NULL;

  IF array_length(v_room_ids, 1) > 0 THEN
    UPDATE public.rooms
       SET status = 'vacant',
           housekeeping_status = 'dirty'
     WHERE id = ANY (v_room_ids)
       AND status <> 'maintenance';
  END IF;

  RETURN jsonb_build_object(
    'booking_id', _booking_id,
    'checked_out_at', v_now,
    'folios_finalized', v_settled,
    'due_amount', GREATEST(v_balance, 0)
  );
END
$$;

REVOKE ALL ON FUNCTION public.complete_checkout(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.complete_checkout(uuid, boolean, text) TO authenticated;