REVOKE ALL ON FUNCTION public.void_folio_safe(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_folio_safe(uuid, text, uuid) TO authenticated, service_role;