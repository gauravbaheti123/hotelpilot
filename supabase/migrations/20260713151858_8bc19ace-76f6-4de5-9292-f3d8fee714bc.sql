
-- 1. GRC records table
CREATE TABLE public.grc_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_id uuid NOT NULL REFERENCES public.bookings(id) ON DELETE CASCADE,
  grc_number text,
  designation text,
  address text,
  company text,
  arrival_from text,
  preceding_to text,
  mode_of_payment text,
  purpose_of_visit text,
  billing_instruction text,
  discount_note text,
  duty_manager_name text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (booking_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.grc_records TO authenticated;
GRANT ALL ON public.grc_records TO service_role;

ALTER TABLE public.grc_records ENABLE ROW LEVEL SECURITY;

CREATE POLICY "grc_records select" ON public.grc_records FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'grc', 'view'));
CREATE POLICY "grc_records insert" ON public.grc_records FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'grc', 'create'));
CREATE POLICY "grc_records update" ON public.grc_records FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'grc', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'grc', 'edit'));
CREATE POLICY "grc_records delete" ON public.grc_records FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'grc', 'delete'));

CREATE TRIGGER trg_grc_records_updated_at
  BEFORE UPDATE ON public.grc_records
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 2. Auto-assign grc_number: GRC-{short_code}-NNN (MAX-based per property)
CREATE OR REPLACE FUNCTION public.tg_assign_grc_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_next int;
  v_code text;
  v_prefix text;
BEGIN
  IF NEW.grc_number IS NOT NULL AND NEW.grc_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(NULLIF(short_code, ''), 'GRC') INTO v_code
    FROM public.properties WHERE id = NEW.property_id;
  v_prefix := 'GRC-' || v_code || '-';
  SELECT COALESCE(
           MAX(NULLIF(regexp_replace(grc_number, '^' || v_prefix, ''), '')::int),
           0
         ) + 1
    INTO v_next
    FROM public.grc_records
   WHERE property_id = NEW.property_id
     AND grc_number LIKE v_prefix || '%';
  NEW.grc_number := v_prefix || LPAD(v_next::text, 3, '0');
  RETURN NEW;
END $$;

CREATE TRIGGER trg_grc_records_number
  BEFORE INSERT ON public.grc_records
  FOR EACH ROW EXECUTE FUNCTION public.tg_assign_grc_number();

-- 3. Property-level GRC T&C text (fallback used in code when null)
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS grc_terms text;

-- 4. Register 'grc' module permissions + grant to Owner/Manager by default
INSERT INTO public.permissions (module, action)
VALUES ('grc','view'), ('grc','create'), ('grc','edit'), ('grc','delete')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
  FROM public.roles r
  CROSS JOIN public.permissions p
 WHERE p.module = 'grc'
   AND lower(r.name) IN ('owner','manager','receptionist')
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;
