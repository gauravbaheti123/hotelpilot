DROP TRIGGER IF EXISTS create_mis_for_property ON public.properties;
DROP TRIGGER IF EXISTS trg_create_mis_for_property ON public.properties;
DROP FUNCTION IF EXISTS public.create_mis_for_property() CASCADE;
DELETE FROM public.role_permissions WHERE permission_id IN (SELECT id FROM public.permissions WHERE module = 'mis_ac');
DELETE FROM public.permissions WHERE module = 'mis_ac';
DROP TABLE IF EXISTS public.mis_ledger CASCADE;
DROP TABLE IF EXISTS public.mis_accounts CASCADE;