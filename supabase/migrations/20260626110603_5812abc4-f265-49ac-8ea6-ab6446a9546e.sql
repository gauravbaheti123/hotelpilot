
-- 1. New module catalog
WITH new_modules(module, label) AS (VALUES
  ('dashboard','Dashboard'),
  ('bookings','Bookings'),
  ('calendar','Calendar'),
  ('inhouse','In-house'),
  ('food_dashboard','Food Dashboard'),
  ('all_kots','All KOTs'),
  ('new_kot','New KOT'),
  ('pending_bills','Pending Bills'),
  ('pos','POS'),
  ('restaurant_billing','Restaurant Billing'),
  ('invoices','Invoices'),
  ('mis_ac','MIS A/c'),
  ('reports','Reports'),
  ('day_close','Day Close'),
  ('room_board','Room Board'),
  ('tasks','Tasks'),
  ('guest_crm','Guest CRM'),
  ('inventory','Inventory'),
  ('expenses','Expenses'),
  ('staff_hr','Staff HR'),
  ('banquet','Banquet/Events'),
  ('master_data','Master Data'),
  ('settings_business','Settings - Business'),
  ('settings_whatsapp','Settings - WhatsApp'),
  ('settings_invoice','Settings - Invoice'),
  ('roles_permissions','Roles & Permissions'),
  ('user_management','User Management'),
  ('security_wipe','Security / Wipe')
)
INSERT INTO public.permissions (module, action)
SELECT m.module, a.action
FROM new_modules m
CROSS JOIN (VALUES ('view'),('create'),('edit'),('delete')) AS a(action)
ON CONFLICT DO NOTHING;

-- Remove orphan permissions no longer in the catalog (keeps role_permissions clean via FK cascade if present; else delete row-by-row)
DELETE FROM public.role_permissions
 WHERE permission_id IN (
   SELECT id FROM public.permissions
    WHERE module NOT IN (
      'dashboard','bookings','calendar','inhouse','food_dashboard','all_kots','new_kot',
      'pending_bills','pos','restaurant_billing','invoices','mis_ac','reports','day_close',
      'room_board','tasks','guest_crm','inventory','expenses','staff_hr','banquet','master_data',
      'settings_business','settings_whatsapp','settings_invoice','roles_permissions',
      'user_management','security_wipe'
    )
 );
DELETE FROM public.permissions
 WHERE module NOT IN (
   'dashboard','bookings','calendar','inhouse','food_dashboard','all_kots','new_kot',
   'pending_bills','pos','restaurant_billing','invoices','mis_ac','reports','day_close',
   'room_board','tasks','guest_crm','inventory','expenses','staff_hr','banquet','master_data',
   'settings_business','settings_whatsapp','settings_invoice','roles_permissions',
   'user_management','security_wipe'
 );

-- 2. Ensure system roles exist
INSERT INTO public.roles (name, description, is_system)
VALUES
  ('Owner','Full access — property owner', true),
  ('Manager','Operational manager', true),
  ('Receptionist','Front desk staff', true)
ON CONFLICT DO NOTHING;

-- 3. Seed defaults for Manager
WITH mgr AS (SELECT id FROM public.roles WHERE name ILIKE 'Manager' AND is_system = true LIMIT 1),
mgr_off(module, action) AS (VALUES
  ('roles_permissions','view'),('roles_permissions','create'),('roles_permissions','edit'),('roles_permissions','delete'),
  ('user_management','view'),('user_management','create'),('user_management','edit'),('user_management','delete'),
  ('security_wipe','view'),('security_wipe','create'),('security_wipe','edit'),('security_wipe','delete'),
  ('settings_business','create'),('settings_business','edit'),('settings_business','delete')
)
INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT (SELECT id FROM mgr), p.id,
  NOT EXISTS (SELECT 1 FROM mgr_off o WHERE o.module=p.module AND o.action=p.action)
FROM public.permissions p
WHERE EXISTS (SELECT 1 FROM mgr)
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;

-- 4. Seed defaults for Receptionist
WITH rec AS (SELECT id FROM public.roles WHERE name ILIKE 'Receptionist' AND is_system = true LIMIT 1),
rec_on(module, action) AS (VALUES
  ('dashboard','view'),
  ('bookings','view'),('bookings','create'),
  ('calendar','view'),
  ('inhouse','view'),('inhouse','create'),('inhouse','edit'),
  ('food_dashboard','view'),
  ('all_kots','view'),
  ('new_kot','create'),
  ('pending_bills','view'),
  ('pos','create'),
  ('room_board','view'),('room_board','edit'),
  ('tasks','view'),('tasks','create')
)
INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT (SELECT id FROM rec), p.id,
  EXISTS (SELECT 1 FROM rec_on o WHERE o.module=p.module AND o.action=p.action)
FROM public.permissions p
WHERE EXISTS (SELECT 1 FROM rec)
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;

-- 5. Allow owners to edit non-privileged role permissions (system role except Owner/Superadmin, OR custom property role)
DROP POLICY IF EXISTS role_permissions_manage_admins ON public.role_permissions;
CREATE POLICY role_permissions_manage_admins ON public.role_permissions
FOR ALL TO authenticated
USING (
  public.is_superadmin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.roles r
     WHERE r.id = role_permissions.role_id
       AND public.is_owner_or_super(auth.uid())
       AND r.name !~* '^(owner|superadmin)$'
  )
)
WITH CHECK (
  public.is_superadmin(auth.uid())
  OR EXISTS (
    SELECT 1 FROM public.roles r
     WHERE r.id = role_permissions.role_id
       AND public.is_owner_or_super(auth.uid())
       AND r.name !~* '^(owner|superadmin)$'
  )
);

-- 6. Allow owners to update roles table for non-privileged roles (for description edits)
DROP POLICY IF EXISTS roles_manage_admins ON public.roles;
CREATE POLICY roles_manage_admins ON public.roles
FOR ALL TO authenticated
USING (
  public.is_superadmin(auth.uid())
  OR (public.is_owner_or_super(auth.uid()) AND name !~* '^(owner|superadmin)$')
)
WITH CHECK (
  public.is_superadmin(auth.uid())
  OR (public.is_owner_or_super(auth.uid()) AND name !~* '^(owner|superadmin)$')
);

-- 7. Allow owners (and superadmins) to manage user_roles within their property
DROP POLICY IF EXISTS "superadmin manage roles" ON public.user_roles;
DROP POLICY IF EXISTS user_roles_manage_owner_super ON public.user_roles;
CREATE POLICY user_roles_manage_owner_super ON public.user_roles
FOR ALL TO authenticated
USING (
  public.is_superadmin(auth.uid())
  OR (public.is_owner_or_super(auth.uid())
      AND (property_id IS NULL OR public.user_has_property(auth.uid(), property_id)))
)
WITH CHECK (
  public.is_superadmin(auth.uid())
  OR (public.is_owner_or_super(auth.uid())
      AND (property_id IS NULL OR public.user_has_property(auth.uid(), property_id))
      AND role <> 'superadmin'::app_role)
);
