
-- =========================================================
-- 1. permissions catalog
-- =========================================================
CREATE TABLE public.permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  module text NOT NULL,
  action text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (module, action)
);

GRANT SELECT ON public.permissions TO authenticated;
GRANT ALL ON public.permissions TO service_role;

ALTER TABLE public.permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "permissions_read_all_authenticated"
  ON public.permissions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "permissions_manage_superadmin"
  ON public.permissions FOR ALL
  TO authenticated
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

-- =========================================================
-- 2. roles (templates)
-- =========================================================
CREATE TABLE public.roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  is_system boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.roles TO authenticated;
GRANT ALL ON public.roles TO service_role;

ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "roles_read_authenticated"
  ON public.roles FOR SELECT
  TO authenticated
  USING (
    property_id IS NULL
    OR public.user_has_property(auth.uid(), property_id)
  );

CREATE POLICY "roles_manage_admins"
  ON public.roles FOR ALL
  TO authenticated
  USING (public.can_manage_masters(auth.uid()))
  WITH CHECK (public.can_manage_masters(auth.uid()));

CREATE TRIGGER trg_roles_updated_at
  BEFORE UPDATE ON public.roles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- 3. role_permissions
-- =========================================================
CREATE TABLE public.role_permissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id uuid NOT NULL REFERENCES public.roles(id) ON DELETE CASCADE,
  permission_id uuid NOT NULL REFERENCES public.permissions(id) ON DELETE CASCADE,
  allowed boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (role_id, permission_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.role_permissions TO authenticated;
GRANT ALL ON public.role_permissions TO service_role;

ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "role_permissions_read_authenticated"
  ON public.role_permissions FOR SELECT
  TO authenticated USING (true);

CREATE POLICY "role_permissions_manage_admins"
  ON public.role_permissions FOR ALL
  TO authenticated
  USING (public.can_manage_masters(auth.uid()))
  WITH CHECK (public.can_manage_masters(auth.uid()));

-- =========================================================
-- 4. user_roles.role_id (optional FK to custom role template)
-- =========================================================
ALTER TABLE public.user_roles
  ADD COLUMN IF NOT EXISTS role_id uuid REFERENCES public.roles(id) ON DELETE SET NULL;

-- =========================================================
-- 5. Helper: check if user has a permission
-- =========================================================
CREATE OR REPLACE FUNCTION public.user_has_permission(
  _user_id uuid,
  _property_id uuid,
  _module text,
  _action text
) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT
    public.is_superadmin(_user_id)
    OR EXISTS (
      SELECT 1
      FROM public.user_roles ur
      JOIN public.role_permissions rp ON rp.role_id = ur.role_id
      JOIN public.permissions p ON p.id = rp.permission_id
      WHERE ur.user_id = _user_id
        AND (ur.property_id = _property_id OR ur.property_id IS NULL)
        AND p.module = _module
        AND p.action = _action
        AND rp.allowed = true
    );
$$;

-- =========================================================
-- 6. Seed permissions catalog (33 modules × 4 actions)
-- =========================================================
INSERT INTO public.permissions (module, action)
SELECT m, a
FROM unnest(ARRAY[
  'dashboard','bookings','calendar','inhouse',
  'food_kot','pos_sundry','invoices','restaurant_billing',
  'reports_daily','reports_analytics','reports_sales','reports_gst',
  'night_audit','room_board','housekeeping_tasks',
  'guest_crm','communications','whatsapp_inbox',
  'inventory','masters_rooms','masters_tariff','masters_menu',
  'masters_halls','masters_staff','masters_printers',
  'masters_expense_categories','masters_ota_channels',
  'channel_manager','properties','staff_hr','payroll',
  'security_wipe','superadmin_panel'
]) AS m
CROSS JOIN unnest(ARRAY['view','create','edit','delete']) AS a
ON CONFLICT (module, action) DO NOTHING;

-- =========================================================
-- 7. Seed default global role templates
-- =========================================================
DO $$
DECLARE
  v_owner_id uuid;
  v_manager_id uuid;
  v_reception_id uuid;
  v_perm record;
  v_reception_modules text[] := ARRAY[
    'dashboard','bookings','calendar','inhouse',
    'food_kot','pos_sundry','room_board'
  ];
BEGIN
  -- Owner
  INSERT INTO public.roles (property_id, name, description, is_system)
    VALUES (NULL, 'Owner', 'Full access to all modules', true)
    ON CONFLICT (property_id, name) DO UPDATE SET description = EXCLUDED.description
    RETURNING id INTO v_owner_id;

  INSERT INTO public.role_permissions (role_id, permission_id, allowed)
  SELECT v_owner_id, id, true FROM public.permissions
  ON CONFLICT (role_id, permission_id) DO NOTHING;

  -- Manager
  INSERT INTO public.roles (property_id, name, description, is_system)
    VALUES (NULL, 'Manager', 'Operations + reports; no security/superadmin', true)
    ON CONFLICT (property_id, name) DO UPDATE SET description = EXCLUDED.description
    RETURNING id INTO v_manager_id;

  INSERT INTO public.role_permissions (role_id, permission_id, allowed)
  SELECT v_manager_id, id, true FROM public.permissions
  WHERE module NOT IN ('security_wipe','superadmin_panel')
    AND NOT (module = 'payroll' AND action <> 'view')
  ON CONFLICT (role_id, permission_id) DO NOTHING;

  -- Receptionist
  INSERT INTO public.roles (property_id, name, description, is_system)
    VALUES (NULL, 'Receptionist', 'Front desk operations only', true)
    ON CONFLICT (property_id, name) DO UPDATE SET description = EXCLUDED.description
    RETURNING id INTO v_reception_id;

  INSERT INTO public.role_permissions (role_id, permission_id, allowed)
  SELECT v_reception_id, id, true FROM public.permissions
  WHERE module = ANY(v_reception_modules) AND action = 'view'
  ON CONFLICT (role_id, permission_id) DO NOTHING;
END $$;
