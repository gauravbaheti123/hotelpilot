
CREATE TABLE IF NOT EXISTS public.banquet_master_bills (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL,
  banquet_booking_id uuid NOT NULL REFERENCES public.banquet_bookings(id) ON DELETE CASCADE,
  bill_number text NOT NULL,
  food_subtotal numeric NOT NULL DEFAULT 0,
  gst_amount numeric NOT NULL DEFAULT 0,
  total_amount numeric NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'open',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (banquet_booking_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_master_bills TO authenticated;
GRANT ALL ON public.banquet_master_bills TO service_role;
ALTER TABLE public.banquet_master_bills ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banquet_master_bills view" ON public.banquet_master_bills FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'view'));
CREATE POLICY "banquet_master_bills insert" ON public.banquet_master_bills FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'banquet', 'create'));
CREATE POLICY "banquet_master_bills update" ON public.banquet_master_bills FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'banquet', 'edit'));
CREATE POLICY "banquet_master_bills delete" ON public.banquet_master_bills FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'banquet', 'delete'));

CREATE TABLE IF NOT EXISTS public.banquet_master_bill_items (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  master_bill_id uuid NOT NULL REFERENCES public.banquet_master_bills(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL,
  room_number text NOT NULL,
  room_category text,
  food_amount numeric NOT NULL DEFAULT 0,
  gst_amount numeric NOT NULL DEFAULT 0,
  food_bill_number text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (master_bill_id, booking_id)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.banquet_master_bill_items TO authenticated;
GRANT ALL ON public.banquet_master_bill_items TO service_role;
ALTER TABLE public.banquet_master_bill_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "banquet_master_bill_items view" ON public.banquet_master_bill_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.banquet_master_bills mb
                  WHERE mb.id = master_bill_id
                    AND public.has_permission(auth.uid(), mb.property_id, 'banquet', 'view')));
CREATE POLICY "banquet_master_bill_items write" ON public.banquet_master_bill_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.banquet_master_bills mb
                  WHERE mb.id = master_bill_id
                    AND public.has_permission(auth.uid(), mb.property_id, 'banquet', 'edit')))
  WITH CHECK (EXISTS (SELECT 1 FROM public.banquet_master_bills mb
                       WHERE mb.id = master_bill_id
                         AND public.has_permission(auth.uid(), mb.property_id, 'banquet', 'edit')));

CREATE OR REPLACE FUNCTION public.get_next_bill_number(p_property_id uuid, p_type text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE v_next INTEGER; v_prefix TEXT; v_pad INT;
BEGIN
  INSERT INTO public.bill_sequences (property_id, sequence_type, last_number, prefix)
  VALUES (p_property_id, p_type, 0,
          CASE p_type
            WHEN 'event' THEN 'EVENT'
            WHEN 'banquet_master' THEN 'BM-'
            ELSE 'BILL'
          END)
  ON CONFLICT (property_id, sequence_type) DO NOTHING;
  UPDATE public.bill_sequences
     SET last_number = last_number + 1, updated_at = now()
   WHERE property_id = p_property_id AND sequence_type = p_type
   RETURNING last_number, prefix INTO v_next, v_prefix;
  v_pad := CASE WHEN p_type = 'banquet_master' THEN 4 ELSE 3 END;
  RETURN v_prefix || LPAD(v_next::TEXT, v_pad, '0');
END $function$;

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
  IF NEW.status <> 'checked_out' OR COALESCE(OLD.status,'') = 'checked_out' THEN
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

DROP TRIGGER IF EXISTS trg_banquet_master_bill_on_checkout ON public.bookings;
CREATE TRIGGER trg_banquet_master_bill_on_checkout
  AFTER UPDATE OF status ON public.bookings
  FOR EACH ROW EXECUTE FUNCTION public.tg_banquet_master_bill_on_checkout();

CREATE OR REPLACE FUNCTION public.tg_touch_updated_at()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS
$function$ BEGIN NEW.updated_at = now(); RETURN NEW; END $function$;

DROP TRIGGER IF EXISTS trg_update_banquet_master_bills_updated_at ON public.banquet_master_bills;
CREATE TRIGGER trg_update_banquet_master_bills_updated_at
  BEFORE UPDATE ON public.banquet_master_bills
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();

DROP TRIGGER IF EXISTS trg_update_banquet_master_bill_items_updated_at ON public.banquet_master_bill_items;
CREATE TRIGGER trg_update_banquet_master_bill_items_updated_at
  BEFORE UPDATE ON public.banquet_master_bill_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();
