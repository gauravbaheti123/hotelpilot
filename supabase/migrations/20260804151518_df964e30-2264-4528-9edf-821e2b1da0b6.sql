REVOKE EXECUTE ON FUNCTION public.create_event_booking(jsonb) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.resolve_event_ids(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_event_booking(jsonb) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.resolve_event_ids(uuid) TO authenticated, service_role;