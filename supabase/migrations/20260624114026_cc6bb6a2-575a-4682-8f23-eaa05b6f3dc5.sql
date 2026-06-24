CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql SET search_path = public AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TABLE public.vendors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  contact_person text, mobile text, email text, gstin text, address text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vendors TO authenticated;
GRANT ALL ON public.vendors TO service_role;
ALTER TABLE public.vendors ENABLE ROW LEVEL SECURITY;
CREATE POLICY "vendors_rw" ON public.vendors FOR ALL TO authenticated
  USING (public.can_billing(auth.uid()) OR public.can_housekeeping(auth.uid()))
  WITH CHECK (public.can_billing(auth.uid()) OR public.can_housekeeping(auth.uid()));
CREATE INDEX idx_vendors_property ON public.vendors(property_id);

CREATE TABLE public.inventory_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  sku text,
  category text NOT NULL DEFAULT 'general',
  unit text NOT NULL DEFAULT 'pcs',
  reorder_level numeric(12,2) NOT NULL DEFAULT 0,
  current_stock numeric(12,2) NOT NULL DEFAULT 0,
  last_rate numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.inventory_items TO authenticated;
GRANT ALL ON public.inventory_items TO service_role;
ALTER TABLE public.inventory_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "items_rw" ON public.inventory_items FOR ALL TO authenticated
  USING (public.can_billing(auth.uid()) OR public.can_housekeeping(auth.uid()))
  WITH CHECK (public.can_billing(auth.uid()) OR public.can_housekeeping(auth.uid()));
CREATE INDEX idx_items_property ON public.inventory_items(property_id);

CREATE TABLE public.stock_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  item_id uuid NOT NULL REFERENCES public.inventory_items(id) ON DELETE CASCADE,
  vendor_id uuid REFERENCES public.vendors(id) ON DELETE SET NULL,
  movement_type text NOT NULL CHECK (movement_type IN ('in','out','adjust')),
  quantity numeric(12,2) NOT NULL,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  reference text, reason text, department text,
  movement_date date NOT NULL DEFAULT CURRENT_DATE,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.stock_movements TO authenticated;
GRANT ALL ON public.stock_movements TO service_role;
ALTER TABLE public.stock_movements ENABLE ROW LEVEL SECURITY;
CREATE POLICY "moves_rw" ON public.stock_movements FOR ALL TO authenticated
  USING (public.can_billing(auth.uid()) OR public.can_housekeeping(auth.uid()))
  WITH CHECK (public.can_billing(auth.uid()) OR public.can_housekeeping(auth.uid()));
CREATE INDEX idx_moves_property_date ON public.stock_movements(property_id, movement_date DESC);
CREATE INDEX idx_moves_item ON public.stock_movements(item_id);

CREATE OR REPLACE FUNCTION public.apply_stock_movement()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE delta numeric(12,2);
BEGIN
  IF TG_OP = 'INSERT' THEN
    delta := CASE NEW.movement_type WHEN 'in' THEN NEW.quantity WHEN 'out' THEN -NEW.quantity WHEN 'adjust' THEN NEW.quantity END;
    UPDATE public.inventory_items
       SET current_stock = current_stock + delta,
           last_rate = CASE WHEN NEW.movement_type='in' AND NEW.rate>0 THEN NEW.rate ELSE last_rate END,
           updated_at = now()
     WHERE id = NEW.item_id;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    delta := CASE OLD.movement_type WHEN 'in' THEN -OLD.quantity WHEN 'out' THEN OLD.quantity WHEN 'adjust' THEN -OLD.quantity END;
    UPDATE public.inventory_items SET current_stock = current_stock + delta, updated_at = now() WHERE id = OLD.item_id;
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_stock_movement_apply
AFTER INSERT OR DELETE ON public.stock_movements
FOR EACH ROW EXECUTE FUNCTION public.apply_stock_movement();

CREATE TRIGGER trg_vendors_updated BEFORE UPDATE ON public.vendors
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
CREATE TRIGGER trg_items_updated BEFORE UPDATE ON public.inventory_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();