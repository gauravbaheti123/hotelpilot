CREATE TABLE IF NOT EXISTS public.restaurant_outlets (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_outlets TO authenticated;
GRANT ALL ON public.restaurant_outlets TO service_role;

ALTER TABLE public.restaurant_outlets ENABLE ROW LEVEL SECURITY;

CREATE POLICY restaurant_outlets_view ON public.restaurant_outlets FOR SELECT TO authenticated
USING (
  has_permission(auth.uid(), property_id, 'master_data', 'view')
  OR has_permission(auth.uid(), property_id, 'pos', 'view')
  OR is_superadmin(auth.uid())
  OR EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = auth.uid() AND ur.property_id = restaurant_outlets.property_id)
);
CREATE POLICY restaurant_outlets_create ON public.restaurant_outlets FOR INSERT TO authenticated
WITH CHECK (has_permission(auth.uid(), property_id, 'master_data', 'create'));
CREATE POLICY restaurant_outlets_edit ON public.restaurant_outlets FOR UPDATE TO authenticated
USING (has_permission(auth.uid(), property_id, 'master_data', 'edit'))
WITH CHECK (has_permission(auth.uid(), property_id, 'master_data', 'edit'));
CREATE POLICY restaurant_outlets_delete ON public.restaurant_outlets FOR DELETE TO authenticated
USING (has_permission(auth.uid(), property_id, 'master_data', 'delete'));

DROP TRIGGER IF EXISTS trg_restaurant_outlets_updated_at ON public.restaurant_outlets;
CREATE TRIGGER trg_restaurant_outlets_updated_at
  BEFORE UPDATE ON public.restaurant_outlets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed existing properties
INSERT INTO public.restaurant_outlets (property_id, name, sort_order)
SELECT p.id, c.name, c.ord
FROM public.properties p
CROSS JOIN (VALUES ('Fast Food', 1), ('Restaurant', 2), ('Sweets', 3)) AS c(name, ord)
ON CONFLICT DO NOTHING;

-- Auto-seed for new properties
CREATE OR REPLACE FUNCTION public.seed_restaurant_outlets_for_property()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.restaurant_outlets (property_id, name, sort_order)
  VALUES (NEW.id, 'Fast Food', 1), (NEW.id, 'Restaurant', 2), (NEW.id, 'Sweets', 3)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_restaurant_outlets ON public.properties;
CREATE TRIGGER trg_seed_restaurant_outlets
  AFTER INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.seed_restaurant_outlets_for_property();

-- Link charges to outlet
ALTER TABLE public.restaurant_direct_charges
  ADD COLUMN IF NOT EXISTS outlet_id uuid REFERENCES public.restaurant_outlets(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_restaurant_outlets_property ON public.restaurant_outlets(property_id, sort_order);
CREATE INDEX IF NOT EXISTS idx_rdc_outlet ON public.restaurant_direct_charges(outlet_id);