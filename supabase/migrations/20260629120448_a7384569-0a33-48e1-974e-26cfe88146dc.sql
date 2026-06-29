
CREATE TABLE IF NOT EXISTS public.printer_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.printer_roles TO authenticated;
GRANT ALL ON public.printer_roles TO service_role;

ALTER TABLE public.printer_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY printer_roles_select ON public.printer_roles
  FOR SELECT TO authenticated
  USING (public.user_has_property(auth.uid(), property_id));

CREATE POLICY printer_roles_write ON public.printer_roles
  FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid(), property_id))
  WITH CHECK (public.can_manage_masters(auth.uid(), property_id));

CREATE TRIGGER printer_roles_set_updated_at
  BEFORE UPDATE ON public.printer_roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed default roles for each existing property
INSERT INTO public.printer_roles (property_id, name, sort_order)
SELECT p.id, x.name, x.sort_order
FROM public.properties p
CROSS JOIN (VALUES
  ('Hotel Kitchen', 1),
  ('Restaurant Kitchen', 2),
  ('Banquet Kitchen', 3),
  ('Bar', 4),
  ('Reception (Bill)', 5),
  ('Housekeeping', 6)
) AS x(name, sort_order)
ON CONFLICT (property_id, name) DO NOTHING;

-- Auto-seed for new properties
CREATE OR REPLACE FUNCTION public.seed_printer_roles_for_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  INSERT INTO public.printer_roles (property_id, name, sort_order) VALUES
    (NEW.id, 'Hotel Kitchen', 1),
    (NEW.id, 'Restaurant Kitchen', 2),
    (NEW.id, 'Banquet Kitchen', 3),
    (NEW.id, 'Bar', 4),
    (NEW.id, 'Reception (Bill)', 5),
    (NEW.id, 'Housekeeping', 6)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS seed_printer_roles_after_property_insert ON public.properties;
CREATE TRIGGER seed_printer_roles_after_property_insert
  AFTER INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.seed_printer_roles_for_property();
