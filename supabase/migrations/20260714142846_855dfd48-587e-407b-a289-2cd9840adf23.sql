
-- 1) Table
CREATE TABLE IF NOT EXISTS public.payment_methods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  display_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_methods_name_not_blank CHECK (length(btrim(name)) > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS payment_methods_property_name_uniq
  ON public.payment_methods (property_id, lower(btrim(name)));

CREATE INDEX IF NOT EXISTS payment_methods_property_active_idx
  ON public.payment_methods (property_id, is_active, display_order);

-- 2) Grants
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payment_methods TO authenticated;
GRANT ALL ON public.payment_methods TO service_role;

-- 3) RLS
ALTER TABLE public.payment_methods ENABLE ROW LEVEL SECURITY;

CREATE POLICY payment_methods_view ON public.payment_methods
  FOR SELECT
  USING (
    public.is_superadmin(auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid()
        AND ur.property_id IS NOT NULL
        AND ur.property_id = payment_methods.property_id
    )
  );

CREATE POLICY payment_methods_create ON public.payment_methods
  FOR INSERT
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'create'));

CREATE POLICY payment_methods_edit ON public.payment_methods
  FOR UPDATE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'master_data', 'edit'));

CREATE POLICY payment_methods_delete ON public.payment_methods
  FOR DELETE
  USING (public.has_permission(auth.uid(), property_id, 'master_data', 'delete'));

-- 4) updated_at trigger
DROP TRIGGER IF EXISTS tg_payment_methods_updated_at ON public.payment_methods;
CREATE TRIGGER tg_payment_methods_updated_at
  BEFORE UPDATE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- 5) Guard: default rows cannot be deleted (deactivate instead)
CREATE OR REPLACE FUNCTION public.tg_payment_methods_protect_default_delete()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF OLD.is_default THEN
    RAISE EXCEPTION 'Default payment method "%" cannot be deleted. Deactivate it instead.', OLD.name
      USING ERRCODE = '23514';
  END IF;
  RETURN OLD;
END $$;

DROP TRIGGER IF EXISTS tg_payment_methods_protect_default_delete ON public.payment_methods;
CREATE TRIGGER tg_payment_methods_protect_default_delete
  BEFORE DELETE ON public.payment_methods
  FOR EACH ROW EXECUTE FUNCTION public.tg_payment_methods_protect_default_delete();

-- 6) Seed defaults for existing properties
INSERT INTO public.payment_methods (property_id, name, is_default, is_active, display_order)
SELECT p.id, v.name, true, true, v.ord
FROM public.properties p
CROSS JOIN (VALUES ('Cash', 1), ('Card', 2), ('UPI', 3)) AS v(name, ord)
ON CONFLICT DO NOTHING;

-- 7) Auto-seed defaults for new properties
CREATE OR REPLACE FUNCTION public.seed_payment_methods_for_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.payment_methods (property_id, name, is_default, is_active, display_order) VALUES
    (NEW.id, 'Cash', true, true, 1),
    (NEW.id, 'Card', true, true, 2),
    (NEW.id, 'UPI',  true, true, 3)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS tg_seed_payment_methods_for_property ON public.properties;
CREATE TRIGGER tg_seed_payment_methods_for_property
  AFTER INSERT ON public.properties
  FOR EACH ROW EXECUTE FUNCTION public.seed_payment_methods_for_property();

-- 8) Relax payments.mode CHECK constraint so custom method names can be stored
ALTER TABLE public.payments DROP CONSTRAINT IF EXISTS payments_mode_check;
ALTER TABLE public.payments
  ADD CONSTRAINT payments_mode_not_blank CHECK (length(btrim(mode)) > 0);
