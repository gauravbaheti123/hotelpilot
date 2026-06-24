
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS kot_station text NOT NULL DEFAULT 'kitchen' CHECK (kot_station IN ('kitchen','bar'));
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS station text CHECK (station IN ('kitchen','bar','reception','billing'));

CREATE OR REPLACE FUNCTION public.can_food(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT public.has_role(_user_id,'superadmin'::app_role)
      OR public.has_role(_user_id,'owner'::app_role)
      OR public.has_role(_user_id,'manager'::app_role)
      OR public.has_role(_user_id,'receptionist'::app_role)
      OR public.has_role(_user_id,'kitchen'::app_role)
$$;

CREATE TABLE IF NOT EXISTS public.kot_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  kot_number text NOT NULL DEFAULT '',
  kot_type text NOT NULL DEFAULT 'restaurant' CHECK (kot_type IN ('room','restaurant')),
  table_no text,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  guest_name text,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','printed','served','billed','void')),
  sub_total numeric(12,2) NOT NULL DEFAULT 0,
  gst_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  notes text,
  void_reason text,
  printed_at timestamptz,
  served_at timestamptz,
  billed_at timestamptz,
  voided_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kot_orders TO authenticated;
GRANT ALL ON public.kot_orders TO service_role;
ALTER TABLE public.kot_orders ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Food staff read kot_orders" ON public.kot_orders FOR SELECT TO authenticated
  USING (public.can_food(auth.uid()));
CREATE POLICY "Food staff write kot_orders" ON public.kot_orders FOR ALL TO authenticated
  USING (public.can_food(auth.uid())) WITH CHECK (public.can_food(auth.uid()));

CREATE TABLE IF NOT EXISTS public.kot_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kot_id uuid NOT NULL REFERENCES public.kot_orders(id) ON DELETE CASCADE,
  menu_item_id uuid REFERENCES public.menu_items(id) ON DELETE SET NULL,
  item_name text NOT NULL,
  qty numeric(10,2) NOT NULL DEFAULT 1,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  gst_rate numeric(5,2) NOT NULL DEFAULT 5,
  kot_station text NOT NULL DEFAULT 'kitchen',
  notes text,
  is_void boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.kot_items TO authenticated;
GRANT ALL ON public.kot_items TO service_role;
ALTER TABLE public.kot_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Food staff read kot_items" ON public.kot_items FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.kot_orders o WHERE o.id = kot_items.kot_id AND public.can_food(auth.uid())));
CREATE POLICY "Food staff write kot_items" ON public.kot_items FOR ALL TO authenticated
  USING (EXISTS (SELECT 1 FROM public.kot_orders o WHERE o.id = kot_items.kot_id AND public.can_food(auth.uid())))
  WITH CHECK (EXISTS (SELECT 1 FROM public.kot_orders o WHERE o.id = kot_items.kot_id AND public.can_food(auth.uid())));

CREATE OR REPLACE FUNCTION public.tg_assign_kot_number()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $$
DECLARE v_seq int; v_prefix text;
BEGIN
  IF NEW.kot_number IS NOT NULL AND NEW.kot_number <> '' THEN RETURN NEW; END IF;
  v_prefix := 'KOT-' || to_char(now(),'YYYYMMDD') || '-';
  SELECT COALESCE(MAX(NULLIF(regexp_replace(kot_number,'^'||v_prefix,''),'')::int),0)+1
    INTO v_seq FROM public.kot_orders
    WHERE property_id = NEW.property_id AND kot_number LIKE v_prefix||'%';
  NEW.kot_number := v_prefix || lpad(v_seq::text,4,'0');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_kot_number ON public.kot_orders;
CREATE TRIGGER tg_kot_number BEFORE INSERT ON public.kot_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_kot_number();

DROP TRIGGER IF EXISTS tg_kot_orders_updated ON public.kot_orders;
CREATE TRIGGER tg_kot_orders_updated BEFORE UPDATE ON public.kot_orders
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE OR REPLACE FUNCTION public.has_open_kot(_booking_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path=public AS $$
  SELECT EXISTS (SELECT 1 FROM public.kot_orders
    WHERE booking_id = _booking_id AND status IN ('open','printed','served'))
$$;

CREATE INDEX IF NOT EXISTS idx_kot_orders_property_status ON public.kot_orders(property_id,status);
CREATE INDEX IF NOT EXISTS idx_kot_orders_booking ON public.kot_orders(booking_id);
CREATE INDEX IF NOT EXISTS idx_kot_items_kot ON public.kot_items(kot_id);
