
-- ============================================================
-- POS Categories master table
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pos_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_categories_property ON public.pos_categories(property_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_categories TO authenticated;
GRANT ALL ON public.pos_categories TO service_role;

ALTER TABLE public.pos_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "managers manage pos_categories"
  ON public.pos_categories FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid(), property_id))
  WITH CHECK (public.can_manage_masters(auth.uid(), property_id));

CREATE POLICY "property members read pos_categories"
  ON public.pos_categories FOR SELECT TO authenticated
  USING (public.user_has_property(auth.uid(), property_id));

CREATE TRIGGER trg_pos_categories_updated_at
  BEFORE UPDATE ON public.pos_categories
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed defaults for every existing property
INSERT INTO public.pos_categories (property_id, name)
SELECT p.id, c.name
FROM public.properties p
CROSS JOIN (VALUES ('Laundry'), ('Mini Bar'), ('Damage'), ('Other')) AS c(name)
ON CONFLICT DO NOTHING;

-- Auto-seed for future properties
CREATE OR REPLACE FUNCTION public.seed_pos_categories_for_property()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.pos_categories (property_id, name)
  VALUES (NEW.id, 'Laundry'), (NEW.id, 'Mini Bar'),
         (NEW.id, 'Damage'),  (NEW.id, 'Other')
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_seed_pos_categories ON public.properties;
CREATE TRIGGER trg_seed_pos_categories
  AFTER INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.seed_pos_categories_for_property();

-- ============================================================
-- POS Charges intermediary table (mirrors kot_orders pattern)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.pos_charges (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.pos_categories(id) ON DELETE SET NULL,
  category_name text NOT NULL,
  description text NOT NULL,
  qty numeric(10,2) NOT NULL DEFAULT 1,
  rate numeric(12,2) NOT NULL DEFAULT 0,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  gst_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','billed','paid','cancelled')),
  folio_charge_id uuid REFERENCES public.folio_charges(id) ON DELETE SET NULL,
  billed_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pos_charges_property ON public.pos_charges(property_id);
CREATE INDEX IF NOT EXISTS idx_pos_charges_booking ON public.pos_charges(booking_id);
CREATE INDEX IF NOT EXISTS idx_pos_charges_status  ON public.pos_charges(status);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.pos_charges TO authenticated;
GRANT ALL ON public.pos_charges TO service_role;

ALTER TABLE public.pos_charges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "property members manage pos_charges"
  ON public.pos_charges FOR ALL TO authenticated
  USING (public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.user_has_property(auth.uid(), property_id));

CREATE TRIGGER trg_pos_charges_updated_at
  BEFORE UPDATE ON public.pos_charges
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
