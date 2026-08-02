REVOKE EXECUTE ON FUNCTION public.settle_segment_bill(uuid, uuid, boolean) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.settle_segment_bill(uuid, uuid, boolean) FROM anon;
GRANT EXECUTE ON FUNCTION public.settle_segment_bill(uuid, uuid, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_segment_bill(uuid, uuid, boolean) TO service_role;