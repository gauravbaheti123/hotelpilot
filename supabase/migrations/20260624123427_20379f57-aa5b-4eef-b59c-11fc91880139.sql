
-- 1. printers role
ALTER TABLE public.printers ADD COLUMN IF NOT EXISTS printer_role text NOT NULL DEFAULT 'hotel_kitchen';

-- 2. menu_items kitchen_type
ALTER TABLE public.menu_items ADD COLUMN IF NOT EXISTS kitchen_type text NOT NULL DEFAULT 'hotel';

-- 3. kot_orders copies
ALTER TABLE public.kot_orders
  ADD COLUMN IF NOT EXISTS kot_copy text NOT NULL DEFAULT 'hotel_copy',
  ADD COLUMN IF NOT EXISTS parent_kot_id uuid REFERENCES public.kot_orders(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS kot_orders_parent_idx ON public.kot_orders(parent_kot_id);

-- 4. kot_audit_log
CREATE TABLE IF NOT EXISTS public.kot_audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  kot_order_id uuid REFERENCES public.kot_orders(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  message text NOT NULL,
  meta jsonb,
  actor uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.kot_audit_log TO authenticated;
GRANT ALL ON public.kot_audit_log TO service_role;
ALTER TABLE public.kot_audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "kot_audit read" ON public.kot_audit_log FOR SELECT TO authenticated USING (can_food(auth.uid()) OR can_front_desk(auth.uid()));
CREATE POLICY "kot_audit write" ON public.kot_audit_log FOR INSERT TO authenticated WITH CHECK (can_food(auth.uid()) OR can_front_desk(auth.uid()));

-- 5. restaurant_credits
CREATE TABLE IF NOT EXISTS public.restaurant_credits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  kot_order_id uuid REFERENCES public.kot_orders(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  date date NOT NULL DEFAULT CURRENT_DATE,
  description text,
  is_settled boolean NOT NULL DEFAULT false,
  settlement_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS rc_property_settled_idx ON public.restaurant_credits(property_id, is_settled, date);
CREATE INDEX IF NOT EXISTS rc_kot_idx ON public.restaurant_credits(kot_order_id);
GRANT SELECT, INSERT, UPDATE ON public.restaurant_credits TO authenticated;
GRANT ALL ON public.restaurant_credits TO service_role;
ALTER TABLE public.restaurant_credits ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rc read" ON public.restaurant_credits FOR SELECT TO authenticated USING (can_billing(auth.uid()) OR can_food(auth.uid()));
CREATE POLICY "rc write" ON public.restaurant_credits FOR ALL TO authenticated USING (can_billing(auth.uid())) WITH CHECK (can_billing(auth.uid()));
CREATE TRIGGER rc_set_updated_at BEFORE UPDATE ON public.restaurant_credits FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 6. restaurant_settlements
CREATE TABLE IF NOT EXISTS public.restaurant_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  month int NOT NULL,
  year int NOT NULL,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  settled_amount numeric(12,2) NOT NULL DEFAULT 0,
  settlement_date date NOT NULL DEFAULT CURRENT_DATE,
  payment_mode text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.restaurant_settlements TO authenticated;
GRANT ALL ON public.restaurant_settlements TO service_role;
ALTER TABLE public.restaurant_settlements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "rs read" ON public.restaurant_settlements FOR SELECT TO authenticated USING (can_billing(auth.uid()));
CREATE POLICY "rs write" ON public.restaurant_settlements FOR ALL TO authenticated USING (can_manage_masters(auth.uid())) WITH CHECK (can_manage_masters(auth.uid()));
CREATE TRIGGER rs_set_updated_at BEFORE UPDATE ON public.restaurant_settlements FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 7. Trigger: when a restaurant-copy KOT is marked billed (status='billed'), auto-create restaurant_credit
CREATE OR REPLACE FUNCTION public.tg_kot_create_restaurant_credit()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.kot_copy = 'restaurant_copy'
     AND NEW.status = 'billed'
     AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM 'billed') THEN
    IF NOT EXISTS (SELECT 1 FROM public.restaurant_credits WHERE kot_order_id = NEW.id) THEN
      INSERT INTO public.restaurant_credits(property_id, booking_id, room_id, kot_order_id, amount, date, description)
      VALUES (NEW.property_id, NEW.booking_id, NEW.room_id, NEW.id, COALESCE(NEW.total_amount,0), CURRENT_DATE,
              'Auto-credit from KOT ' || COALESCE(NEW.kot_number, NEW.id::text));
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS tg_kot_restaurant_credit ON public.kot_orders;
CREATE TRIGGER tg_kot_restaurant_credit
AFTER INSERT OR UPDATE OF status ON public.kot_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_kot_create_restaurant_credit();
