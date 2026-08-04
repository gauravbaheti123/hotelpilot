REVOKE ALL ON FUNCTION public.available_rooms(uuid, date, date, uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.create_booking(jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.available_rooms(uuid, date, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_booking(jsonb) TO authenticated;