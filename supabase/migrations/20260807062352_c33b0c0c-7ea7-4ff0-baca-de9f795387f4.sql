INSERT INTO public.permissions (module, action)
VALUES ('invoices', 'edit_billto_locked')
ON CONFLICT DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.module = 'invoices' AND p.action = 'edit_billto_locked'
  AND r.name IN ('Owner', 'Manager')
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = true;