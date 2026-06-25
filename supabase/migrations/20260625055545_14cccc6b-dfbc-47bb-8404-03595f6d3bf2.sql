
-- Add new permission modules
INSERT INTO public.permissions (module, action)
SELECT m, a FROM (VALUES ('masters_sundry_items'),('settings_whatsapp')) AS mods(m),
                 (VALUES ('view'),('create'),('edit'),('delete')) AS acts(a)
ON CONFLICT DO NOTHING;

-- Owner: all ON
INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT '8b7a1cb2-4256-4933-9515-1baa05b8c365'::uuid, p.id, true
FROM public.permissions p
WHERE p.module IN ('masters_sundry_items','settings_whatsapp')
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;

-- Manager: masters_sundry_items view only, settings_whatsapp off
INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT 'f1597f6c-596f-46e4-8142-c0cacc419126'::uuid, p.id,
       (p.module = 'masters_sundry_items' AND p.action = 'view')
FROM public.permissions p
WHERE p.module IN ('masters_sundry_items','settings_whatsapp')
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;

-- Receptionist: all off
INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT '25ab518f-8c00-4b8f-961a-3f47f83018c0'::uuid, p.id, false
FROM public.permissions p
WHERE p.module IN ('masters_sundry_items','settings_whatsapp')
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;
