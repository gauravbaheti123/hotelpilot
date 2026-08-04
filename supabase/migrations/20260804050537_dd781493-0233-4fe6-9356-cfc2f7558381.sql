-- ============ BUG A: seed room charge targets active folio ============
CREATE OR REPLACE FUNCTION public.seed_room_charge_for_booking_room(_booking_room_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  v_br public.booking_rooms%ROWTYPE;
  v_booking public.bookings%ROWTYPE;
  v_folio_id uuid; v_existing_id uuid; v_other_id uuid;
  v_nights int; v_gross numeric; v_amount numeric; v_gst_amount numeric;
  v_gst_rate numeric;
  v_nightly numeric; v_taxable numeric;
  v_room_number text; v_category_name text; v_charged_on date;
BEGIN
  SELECT * INTO v_br FROM public.booking_rooms WHERE id = _booking_room_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_br.room_id IS NULL OR COALESCE(v_br.rate, 0) <= 0 THEN RETURN NULL; END IF;
  IF COALESCE(v_br.status, 'active') NOT IN ('active','reserved','checked_in') THEN RETURN NULL; END IF;
  SELECT * INTO v_booking FROM public.bookings WHERE id = v_br.booking_id;
  IF NOT FOUND OR v_booking.status IN ('cancelled','checked_out','no_show') THEN RETURN NULL; END IF;

  -- Resolve the ACTIVE folio (open with balance preferred), never "newest".
  v_folio_id := public.get_or_create_folio(v_br.booking_id);
  IF v_folio_id IS NULL THEN RETURN NULL; END IF;

  IF EXISTS (SELECT 1 FROM public.folios f WHERE f.id = v_folio_id
       AND (f.status IN ('settled','void') OR COALESCE(f.is_deleted,false))) THEN RETURN NULL; END IF;

  -- Charge already present on THIS folio -> refresh it.
  SELECT fc.id INTO v_existing_id FROM public.folio_charges fc
   WHERE fc.folio_id = v_folio_id AND fc.charge_type = 'room'
     AND fc.source_table = 'booking_rooms' AND fc.source_id = v_br.id
     AND COALESCE(fc.is_wiped,false) = false LIMIT 1;

  -- Idempotent guard: charge already lives on another live folio of this booking -> do nothing.
  IF v_existing_id IS NULL THEN
    SELECT fc.id INTO v_other_id
      FROM public.folio_charges fc
      JOIN public.folios f ON f.id = fc.folio_id
     WHERE f.booking_id = v_br.booking_id
       AND f.status <> 'void' AND COALESCE(f.is_deleted,false) = false
       AND fc.charge_type = 'room'
       AND fc.source_table = 'booking_rooms' AND fc.source_id = v_br.id
       AND COALESCE(fc.is_wiped,false) = false
     LIMIT 1;
    IF v_other_id IS NOT NULL THEN RETURN v_other_id; END IF;
  END IF;

  v_charged_on := COALESCE(v_br.check_in, v_booking.check_in, CURRENT_DATE);
  IF public.is_day_locked(v_br.property_id, v_charged_on) THEN RETURN NULL; END IF;

  v_nights := GREATEST(1, (v_br.check_out - v_br.check_in));
  v_nightly := COALESCE(v_br.rate, 0);

  IF COALESCE(v_booking.rate_type, 'exclusive') = 'inclusive' THEN
    v_gst_rate := COALESCE(public.get_gst_rate(v_br.property_id, 'room', v_nightly), 0);
    v_taxable  := ROUND((v_nightly / (1 + v_gst_rate / 100))::numeric, 2);
    v_gst_rate := COALESCE(public.get_gst_rate(v_br.property_id, 'room', v_taxable), v_gst_rate);
    v_gross      := v_nights * v_nightly;
    v_amount     := ROUND((v_gross / (1 + v_gst_rate / 100))::numeric, 2);
    v_gst_amount := ROUND((v_gross - v_amount)::numeric, 2);
  ELSE
    v_gst_rate   := COALESCE(public.get_gst_rate(v_br.property_id, 'room', v_nightly), 0);
    v_gross      := v_nights * v_nightly;
    v_amount     := v_gross;
    v_gst_amount := ROUND((v_gross * v_gst_rate / 100)::numeric, 2);
  END IF;

  SELECT r.room_number INTO v_room_number FROM public.rooms r WHERE r.id = v_br.room_id;
  SELECT rc.name INTO v_category_name FROM public.room_categories rc WHERE rc.id = v_br.category_id;

  IF v_existing_id IS NOT NULL THEN
    UPDATE public.folio_charges
       SET description = 'Room ' || COALESCE(v_room_number,'') || ' · ' || COALESCE(v_category_name,'') || ' · ' || v_nights || ' night(s)',
           qty = v_nights, rate = v_nightly, amount = v_amount,
           gst_rate = v_gst_rate, gst_amount = v_gst_amount, charged_on = v_charged_on,
           created_by = COALESCE(auth.uid(), created_by)
     WHERE id = v_existing_id;
    RETURN v_existing_id;
  END IF;

  INSERT INTO public.folio_charges(
    folio_id, charge_type, description, qty, rate, amount,
    gst_rate, gst_amount, charged_on, source_table, source_id, created_by
  ) VALUES (
    v_folio_id, 'room',
    'Room ' || COALESCE(v_room_number,'') || ' · ' || COALESCE(v_category_name,'') || ' · ' || v_nights || ' night(s)',
    v_nights, v_nightly, v_amount,
    v_gst_rate, v_gst_amount, v_charged_on,
    'booking_rooms', v_br.id, auth.uid()
  ) RETURNING id INTO v_existing_id;
  RETURN v_existing_id;
END $function$;

-- ============ void_folio_safe: mandatory reason + optional force ============
CREATE OR REPLACE FUNCTION public.void_folio_safe(_folio_id uuid, _reason text, _user_id uuid, _force boolean DEFAULT false)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_paid numeric;
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to void a bill.';
  END IF;
  SELECT COALESCE(SUM(amount),0) INTO v_paid FROM public.payments WHERE folio_id = _folio_id;
  IF v_paid > 0 AND NOT _force THEN
    RAISE EXCEPTION 'Cannot void folio % — it has recorded payments (₹%). Refund or move payments first.', _folio_id, v_paid;
  END IF;
  UPDATE public.folios
     SET is_deleted = true, deleted_at = now(), deleted_by = _user_id,
         status = 'void', voided_at = now(), void_reason = _reason, updated_at = now()
   WHERE id = _folio_id;
END $function$;

-- ============ BUG B: server-side timestamps ============
CREATE OR REPLACE FUNCTION public.tg_force_server_time_bookings()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'checked_out' AND OLD.status IS DISTINCT FROM 'checked_out' THEN
    NEW.checked_out_at := now();
  ELSE
    NEW.checked_out_at := OLD.checked_out_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_force_server_time_bookings ON public.bookings;
CREATE TRIGGER trg_force_server_time_bookings
BEFORE UPDATE ON public.bookings FOR EACH ROW
EXECUTE FUNCTION public.tg_force_server_time_bookings();

CREATE OR REPLACE FUNCTION public.tg_force_server_time_booking_rooms()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.actual_check_out IS NOT NULL AND OLD.actual_check_out IS NULL THEN
    NEW.actual_check_out := now();
  ELSIF NEW.actual_check_out IS NOT NULL AND OLD.actual_check_out IS NOT NULL THEN
    NEW.actual_check_out := OLD.actual_check_out;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_force_server_time_booking_rooms ON public.booking_rooms;
CREATE TRIGGER trg_force_server_time_booking_rooms
BEFORE UPDATE ON public.booking_rooms FOR EACH ROW
EXECUTE FUNCTION public.tg_force_server_time_booking_rooms();

CREATE OR REPLACE FUNCTION public.tg_force_server_time_folios()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'settled' AND OLD.status IS DISTINCT FROM 'settled' THEN
    NEW.settled_at := now();
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.settled_at := OLD.settled_at;
  END IF;
  IF NEW.status = 'void' AND OLD.status IS DISTINCT FROM 'void' THEN
    NEW.voided_at := now();
    NEW.deleted_at := COALESCE(OLD.deleted_at, now());
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.voided_at := OLD.voided_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_force_server_time_folios ON public.folios;
CREATE TRIGGER trg_force_server_time_folios
BEFORE UPDATE ON public.folios FOR EACH ROW
EXECUTE FUNCTION public.tg_force_server_time_folios();

CREATE OR REPLACE FUNCTION public.tg_force_server_time_segment_bills()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  IF NEW.status = 'settled' AND OLD.status IS DISTINCT FROM 'settled' THEN
    NEW.settled_at := now();
  ELSIF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    NEW.settled_at := OLD.settled_at;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_force_server_time_segment_bills ON public.segment_bills;
CREATE TRIGGER trg_force_server_time_segment_bills
BEFORE UPDATE ON public.segment_bills FOR EACH ROW
EXECUTE FUNCTION public.tg_force_server_time_segment_bills();

ALTER TABLE public.payments ALTER COLUMN paid_at SET DEFAULT now();
CREATE OR REPLACE FUNCTION public.tg_force_server_time_payments()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.paid_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_force_server_time_payments ON public.payments;
CREATE TRIGGER trg_force_server_time_payments
BEFORE INSERT ON public.payments FOR EACH ROW
EXECUTE FUNCTION public.tg_force_server_time_payments();

ALTER TABLE public.shift_handovers ALTER COLUMN window_end SET DEFAULT now();
CREATE OR REPLACE FUNCTION public.tg_force_server_time_handover()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  NEW.window_end := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_force_server_time_handover ON public.shift_handovers;
CREATE TRIGGER trg_force_server_time_handover
BEFORE INSERT ON public.shift_handovers FOR EACH ROW
EXECUTE FUNCTION public.tg_force_server_time_handover();

-- ============ Checkout blocker: unsettled / dangling segment bills ============
CREATE OR REPLACE FUNCTION public.tg_block_checkout_unsettled_bills()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE v_msg text;
BEGIN
  IF NEW.status = 'checked_out' AND OLD.status IS DISTINCT FROM 'checked_out' THEN
    SELECT string_agg(sb.bill_number || ' (' ||
             CASE WHEN f.status = 'void' THEN 'attached to a voided bill'
                  ELSE 'unsettled' END || ')', ', ')
      INTO v_msg
      FROM public.segment_bills sb
      LEFT JOIN public.folios f ON f.id = sb.folio_id
     WHERE sb.booking_id = NEW.id
       AND (COALESCE(sb.status,'open') <> 'settled' OR f.status = 'void');
    IF v_msg IS NOT NULL THEN
      RAISE EXCEPTION 'Cannot check out — resolve these bills first: %', v_msg;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_block_checkout_unsettled_bills ON public.bookings;
CREATE TRIGGER trg_block_checkout_unsettled_bills
BEFORE UPDATE ON public.bookings FOR EACH ROW
EXECUTE FUNCTION public.tg_block_checkout_unsettled_bills();