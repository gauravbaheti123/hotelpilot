UPDATE public.role_permissions rp
SET allowed = true
FROM public.roles r, public.permissions p
WHERE rp.role_id = r.id
  AND rp.permission_id = p.id
  AND r.name IN ('Receptionist','Manager')
  AND (
    (p.module = 'payments' AND p.action IN ('edit_amount','edit_date','delete'))
    OR (p.module = 'invoices' AND p.action IN ('edit','delete'))
  );

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p
  ON (p.module = 'payments' AND p.action IN ('edit_amount','edit_date','delete','edit_mode'))
  OR (p.module = 'invoices' AND p.action IN ('edit','delete'))
WHERE r.name IN ('Receptionist','Manager')
  AND NOT EXISTS (
    SELECT 1 FROM public.role_permissions rp
    WHERE rp.role_id = r.id AND rp.permission_id = p.id
  );