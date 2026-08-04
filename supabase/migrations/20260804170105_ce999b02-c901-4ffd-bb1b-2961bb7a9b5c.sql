-- 1. LODGE: number the folio at settlement, not at creation --------------
DROP TRIGGER IF EXISTS tg_folio_invoice_number ON public.folios;

CREATE OR REPLACE FUNCTION public.tg_assign_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_next int;
  v_prefix text := 'BILL';
  v_short text;
  v_source text;
  v_type text;
  v_segment text := 'lodge';
BEGIN
  IF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    RETURN NEW;
  END IF;

  SELECT source, booking_type::text INTO v_source, v_type
    FROM public.bookings WHERE id = NEW.booking_id;
  IF v_source = 'event_block' OR v_type = 'banquet' THEN
    v_segment := 'banquet';
  END IF;

  SELECT short_code INTO v_short FROM public.properties WHERE id = NEW.property_id;
  IF v_short IS NOT NULL AND length(btrim(v_short)) > 0 THEN
    NEW.invoice_number := public.generate_bill_number(NEW.property_id, v_segment);
  ELSE
    SELECT COALESCE(
             MAX(NULLIF(regexp_replace(invoice_number, '^' || v_prefix, ''), '')::int),
             0
           ) + 1
      INTO v_next
      FROM public.folios
     WHERE property_id = NEW.property_id
       AND invoice_number LIKE v_prefix || '%'
       AND COALESCE(is_deleted, false) = false
       AND status <> 'void';
    NEW.invoice_number := v_prefix || LPAD(v_next::text, 3, '0');
  END IF;

  -- Event folios: the event's own banquet_number is issued at settlement too.
  IF v_type = 'banquet' THEN
    UPDATE public.bookings
       SET banquet_number = COALESCE(NULLIF(btrim(banquet_number), ''),
                                     public.generate_bill_number(NEW.property_id, 'banquet'))
     WHERE id = NEW.booking_id
       AND COALESCE(NULLIF(btrim(banquet_number), ''), '') = '';
  END IF;

  RETURN NEW;
END
$function$;

CREATE TRIGGER tg_folio_invoice_number_on_settle
BEFORE UPDATE OF status ON public.folios
FOR EACH ROW
WHEN (NEW.status IN ('settled','due')
      AND OLD.status IS DISTINCT FROM NEW.status
      AND (NEW.invoice_number IS NULL OR btrim(NEW.invoice_number) = ''))
EXECUTE FUNCTION public.tg_assign_invoice_number();

-- 2. BANQUET: no number at event creation --------------------------------
CREATE OR REPLACE FUNCTION public.create_event_booking(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_prop uuid := (payload->>'property_id')::uuid;
  v_bid  uuid;
  v_start date := (payload->>'event_date')::date;
  v_end   date := COALESCE((payload->>'event_end_date')::date, (payload->>'event_date')::date);
  v_extra jsonb;
  v_i     int := 0;
  v_bknum text;
BEGIN
  IF v_prop IS NULL THEN RAISE EXCEPTION 'property_id required'; END IF;
  IF NOT public.has_permission(auth.uid(), v_prop, 'banquet', 'create') THEN
    RAISE EXCEPTION 'Not allowed to create banquet events';
  END IF;

  INSERT INTO public.bookings (
    property_id, booking_type, banquet_number, status, event_status, source,
    check_in, check_out, adults, children,
    guest_id, host_name, host_mobile, host_email,
    hall_id, event_name, function_type, event_date, event_end_date,
    start_time, end_time, pax,
    package_rate, hall_charge, fb_charge, extra_charge, extra_charge_description,
    discount_amount, round_off_amount,
    total_amount, advance_amount, balance_amount,
    total_room_charges, bill_type, line_discounts, advance_payment_mode,
    notes, created_by
  ) VALUES (
    v_prop, 'banquet', NULL, 'reserved', 'confirmed', 'banquet',
    v_start, v_end, GREATEST(COALESCE((payload->>'pax')::int,1),1), 0,
    NULLIF(payload->>'guest_id','')::uuid,
    payload->>'host_name', NULLIF(payload->>'host_mobile',''), NULLIF(payload->>'host_email',''),
    NULLIF(payload->>'hall_id','')::uuid, NULLIF(payload->>'event_name',''), payload->>'function_type',
    v_start, v_end,
    (payload->>'start_time')::time, (payload->>'end_time')::time,
    COALESCE((payload->>'pax')::int, 0),
    COALESCE((payload->>'package_rate')::numeric, 0),
    COALESCE((payload->>'hall_charge')::numeric, 0),
    COALESCE((payload->>'fb_charge')::numeric, 0),
    COALESCE((payload->>'extra_charge')::numeric, 0),
    NULLIF(payload->>'extra_charge_description',''),
    COALESCE((payload->>'discount_amount')::numeric, 0),
    COALESCE((payload->>'round_off_amount')::numeric, 0),
    COALESCE((payload->>'total_amount')::numeric, 0),
    COALESCE((payload->>'advance_amount')::numeric, 0),
    COALESCE((payload->>'balance_amount')::numeric, 0),
    COALESCE((payload->>'total_room_charges')::numeric, 0),
    NULLIF(payload->>'bill_type',''),
    CASE WHEN jsonb_typeof(payload->'line_discounts') IN ('object','array')
         THEN payload->'line_discounts' ELSE NULL END,
    NULLIF(payload->>'advance_payment_mode',''),
    NULLIF(payload->>'notes',''), auth.uid()
  ) RETURNING id, booking_number INTO v_bid, v_bknum;

  IF jsonb_typeof(payload->'extras') = 'array' THEN
    FOR v_extra IN SELECT * FROM jsonb_array_elements(payload->'extras') LOOP
      IF COALESCE(NULLIF(btrim(COALESCE(v_extra->>'point_name','')),''), '') <> ''
         AND COALESCE((v_extra->>'amount')::numeric, 0) > 0 THEN
        INSERT INTO public.banquet_extra_charges
          (booking_id, property_id, point_name, amount, sort_order, created_by)
        VALUES (v_bid, v_prop, btrim(v_extra->>'point_name'),
                (v_extra->>'amount')::numeric, v_i, auth.uid());
        v_i := v_i + 1;
      END IF;
    END LOOP;
  END IF;

  PERFORM public.seed_event_folio_charges(v_bid);

  RETURN jsonb_build_object('booking_id', v_bid, 'banquet_booking_id', v_bid,
                            'banquet_number', NULL, 'booking_number', v_bknum);
END
$function$;

-- 3. BANQUET: number the event when its master bill is settled -----------
CREATE OR REPLACE FUNCTION public.tg_event_number_on_master_bill_settle()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.bookings
     SET banquet_number = public.generate_bill_number(property_id, 'banquet')
   WHERE id = NEW.booking_id
     AND COALESCE(NULLIF(btrim(banquet_number), ''), '') = '';
  RETURN NEW;
END $function$;

REVOKE EXECUTE ON FUNCTION public.tg_event_number_on_master_bill_settle() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS trg_event_number_on_master_bill_settle ON public.banquet_master_bills;
CREATE TRIGGER trg_event_number_on_master_bill_settle
AFTER UPDATE OF status ON public.banquet_master_bills
FOR EACH ROW
WHEN (NEW.status IN ('settled','paid') AND OLD.status IS DISTINCT FROM NEW.status)
EXECUTE FUNCTION public.tg_event_number_on_master_bill_settle();