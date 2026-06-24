
CREATE TABLE public.sundry_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'mini_bar',
  rate numeric(12,2) NOT NULL DEFAULT 0,
  gst_rate numeric(5,2) NOT NULL DEFAULT 0,
  unit text NOT NULL DEFAULT 'pcs',
  sku text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sundry_items_category_chk CHECK (category IN ('mini_bar','laundry','spa','transport','telephone','business','damage','other'))
);
CREATE INDEX sundry_items_property_idx ON public.sundry_items(property_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sundry_items TO authenticated;
GRANT ALL ON public.sundry_items TO service_role;

ALTER TABLE public.sundry_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sundry_items_select" ON public.sundry_items
  FOR SELECT TO authenticated USING (public.can_front_desk(auth.uid()));
CREATE POLICY "sundry_items_write" ON public.sundry_items
  FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid()))
  WITH CHECK (public.can_manage_masters(auth.uid()));

CREATE TRIGGER sundry_items_set_updated_at
  BEFORE UPDATE ON public.sundry_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
