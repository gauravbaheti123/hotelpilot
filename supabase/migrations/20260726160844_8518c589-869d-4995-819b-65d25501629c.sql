CREATE OR REPLACE FUNCTION public.tg_banquet_master_bill_on_checkout()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_banquet_id uuid; v_property uuid; v_room_number text; v_room_category text;
  v_master_id uuid; v_bill_no text;
  v_food_amount numeric := 0; v_gst numeric := 0; v_food_bill text;
BEGIN
  -- OLD.status is a booking_status enum. Do not COALESCE it with '' text;
  -- that casts '' to booking_status and raises "invalid input value for enum".
  IF NEW.status IS DISTINCT FROM 'checked_out'::public.booking_status
     OR OLD.status IS NOT DISTINCT FROM 'checked_out'::public.booking_status THEN
    RETURN NEW;
  END IF;

  SELECT erb.banquet_booking_id, erb.property_id, erb.room_number, erb.room_category
    INTO v_banquet_id, v_property, v_room_number, v_room_category
    FROM public.event_room_blocks erb
    WHERE erb.booking_id = NEW.id LIMIT 1;
  IF v_banquet_id IS NULL THEN RETURN NEW; END IF;

  SELECT COALESCE(SUM(fc.amount),0), COALESCE(SUM(fc.gst_amount),0)
    INTO v_food_amount, v_gst
    FROM public.folio_charges fc
    JOIN public.folios f ON f.id = fc.folio_id
   WHERE f.booking_id = NEW.id
     AND COALESCE(fc.is_wiped,false) = false
     AND fc.charge_type NOT IN ('room','tax','discount');

  SELECT food_bill_number INTO v_food_bill
    FROM public.food_bills WHERE booking_id = NEW.id LIMIT 1;

  SELECT id INTO v_master_id FROM public.banquet_master_bills
    WHERE banquet_booking_id = v_banquet_id;
  IF v_master_id IS NULL THEN
    v_bill_no := public.get_next_bill_number(v_property, 'banquet_master');
    INSERT INTO public.banquet_master_bills (property_id, banquet_booking_id, bill_number)
      VALUES (v_property, v_banquet_id, v_bill_no) RETURNING id INTO v_master_id;
  END IF;

  INSERT INTO public.banquet_master_bill_items
    (master_bill_id, booking_id, room_number, room_category, food_amount, gst_amount, food_bill_number)
    VALUES (v_master_id, NEW.id, v_room_number, v_room_category, v_food_amount, v_gst, v_food_bill)
    ON CONFLICT (master_bill_id, booking_id) DO UPDATE
      SET food_amount = EXCLUDED.food_amount, gst_amount = EXCLUDED.gst_amount,
          food_bill_number = EXCLUDED.food_bill_number,
          room_number = EXCLUDED.room_number, room_category = EXCLUDED.room_category,
          updated_at = now();

  UPDATE public.banquet_master_bills
     SET food_subtotal = (SELECT COALESCE(SUM(food_amount),0) FROM public.banquet_master_bill_items WHERE master_bill_id = v_master_id),
         gst_amount    = (SELECT COALESCE(SUM(gst_amount),0)  FROM public.banquet_master_bill_items WHERE master_bill_id = v_master_id),
         total_amount  = (SELECT COALESCE(SUM(food_amount + gst_amount),0) FROM public.banquet_master_bill_items WHERE master_bill_id = v_master_id),
         updated_at    = now()
   WHERE id = v_master_id;

  RETURN NEW;
END $function$;

CREATE OR REPLACE FUNCTION public.get_or_create_folio(_booking_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_id uuid; v_prop uuid;
BEGIN
  -- Checkout must target the bill still needing collection after a split.
  -- If a failed retry already settled all split children, fall back to the
  -- largest live child bill instead of the newest small settled child.
  SELECT id INTO v_id
    FROM public.folios
   WHERE booking_id = _booking_id
     AND COALESCE(is_deleted, false) = false
     AND status NOT IN ('void','refunded')
   ORDER BY
     CASE WHEN status = 'open' AND COALESCE(balance_amount,0) > 0 THEN 0 ELSE 1 END,
     CASE WHEN status = 'open' THEN 0 ELSE 1 END,
     CASE WHEN COALESCE(parent_folio_id, '00000000-0000-0000-0000-000000000000'::uuid) <> '00000000-0000-0000-0000-000000000000'::uuid THEN 0 ELSE 1 END,
     COALESCE(balance_amount,0) DESC,
     COALESCE(total_amount,0) DESC,
     created_at DESC
   LIMIT 1;
  IF v_id IS NOT NULL THEN RETURN v_id; END IF;

  SELECT property_id INTO v_prop FROM public.bookings WHERE id = _booking_id;
  IF v_prop IS NULL THEN RAISE EXCEPTION 'Booking not found'; END IF;
  INSERT INTO public.folios (property_id, booking_id, created_by)
    VALUES (v_prop, _booking_id, auth.uid()) RETURNING id INTO v_id;
  RETURN v_id;
END $function$;

GRANT EXECUTE ON FUNCTION public.get_or_create_folio(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.tg_banquet_master_bill_on_checkout() TO service_role;