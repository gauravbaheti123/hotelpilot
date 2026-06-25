
-- 1. Guest DOB (column already exists as 'dob' but ensure)
ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS dob DATE;

-- 2. Max discount % on roles
ALTER TABLE public.roles ADD COLUMN IF NOT EXISTS max_discount_pct NUMERIC(5,2) NOT NULL DEFAULT 0;

-- 3. Reminders table
CREATE TABLE IF NOT EXISTS public.reminders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  reminder_datetime TIMESTAMPTZ NOT NULL,
  notes TEXT,
  is_dismissed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.reminders TO authenticated;
GRANT ALL ON public.reminders TO service_role;

ALTER TABLE public.reminders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reminders_tenant_access" ON public.reminders;
CREATE POLICY "reminders_tenant_access" ON public.reminders
  TO authenticated
  USING (public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.user_has_property(auth.uid(), property_id));

DROP TRIGGER IF EXISTS trg_reminders_updated_at ON public.reminders;
CREATE TRIGGER trg_reminders_updated_at
  BEFORE UPDATE ON public.reminders
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_reminders_property_time
  ON public.reminders(property_id, reminder_datetime)
  WHERE is_dismissed = FALSE;

-- 4. Helper to get max discount % for current user in a property
CREATE OR REPLACE FUNCTION public.user_max_discount_pct(_user_id uuid, _property_id uuid)
RETURNS NUMERIC
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_superadmin(_user_id) THEN 100
    WHEN public.has_role(_user_id, 'owner'::app_role) THEN 100
    ELSE COALESCE((
      SELECT MAX(r.max_discount_pct)
      FROM public.user_roles ur
      JOIN public.roles r ON r.id = ur.role_id
      WHERE ur.user_id = _user_id
        AND (ur.property_id = _property_id OR ur.property_id IS NULL)
    ), 0)
  END
$$;

REVOKE EXECUTE ON FUNCTION public.user_max_discount_pct(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_max_discount_pct(uuid, uuid) TO authenticated, service_role;
