DROP FUNCTION IF EXISTS public.void_folio_safe(uuid, text, uuid);
REVOKE ALL ON FUNCTION public.void_folio_safe(uuid, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_folio_safe(uuid, text, uuid, boolean) TO authenticated, service_role;