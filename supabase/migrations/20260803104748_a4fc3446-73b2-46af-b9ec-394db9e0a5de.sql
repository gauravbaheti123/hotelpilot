REVOKE ALL ON FUNCTION public.banquet_visibility(uuid) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_update_folio_charge(uuid, text, numeric, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_update_bill_item(uuid, text, numeric, numeric, numeric, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_update_folio_header(uuid, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.owner_void_banquet_document(text, uuid, text) FROM PUBLIC, anon;

GRANT EXECUTE ON FUNCTION public.banquet_visibility(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.owner_update_folio_charge(uuid, text, numeric, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_update_bill_item(uuid, text, numeric, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_update_folio_header(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_void_banquet_document(text, uuid, text) TO authenticated;