
-- 1. Activity log INSERT: require front-desk on the target property
DROP POLICY IF EXISTS "activity_log tenant insert" ON public.activity_log;
CREATE POLICY "activity_log tenant insert" ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_property(auth.uid(), property_id)
    AND user_id = auth.uid()
    AND public.can_front_desk(auth.uid(), property_id)
  );

-- 2. hotel-assets storage: scope role check to owning property prefix
DROP POLICY IF EXISTS "hotel-assets insert by masters" ON storage.objects;
DROP POLICY IF EXISTS "hotel-assets update by masters" ON storage.objects;
DROP POLICY IF EXISTS "hotel-assets delete by masters" ON storage.objects;

CREATE POLICY "hotel-assets insert by masters" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'hotel-assets'
    AND public.can_manage_masters(auth.uid(), NULLIF(split_part(name,'/',1),'')::uuid)
    AND public.user_has_property(auth.uid(), NULLIF(split_part(name,'/',1),'')::uuid)
  );

CREATE POLICY "hotel-assets update by masters" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'hotel-assets'
    AND public.can_manage_masters(auth.uid(), NULLIF(split_part(name,'/',1),'')::uuid)
    AND public.user_has_property(auth.uid(), NULLIF(split_part(name,'/',1),'')::uuid)
  )
  WITH CHECK (
    bucket_id = 'hotel-assets'
    AND public.can_manage_masters(auth.uid(), NULLIF(split_part(name,'/',1),'')::uuid)
    AND public.user_has_property(auth.uid(), NULLIF(split_part(name,'/',1),'')::uuid)
  );

CREATE POLICY "hotel-assets delete by masters" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'hotel-assets'
    AND public.can_manage_masters(auth.uid(), NULLIF(split_part(name,'/',1),'')::uuid)
    AND public.user_has_property(auth.uid(), NULLIF(split_part(name,'/',1),'')::uuid)
  );

-- 3. Revoke EXECUTE on internal SECURITY DEFINER helpers (triggers + internals).
-- Triggers run as table owner regardless of grants, so revoking is safe.
REVOKE EXECUTE ON FUNCTION public.seed_printer_roles_for_property() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.apply_stock_movement() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.recompute_folio_totals(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.sync_booking_balance(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.post_nightly_room_charges(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.get_next_bill_number(uuid, text) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.has_open_kot(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.is_day_locked(uuid, date) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.auto_cancel_incomplete_bookings() FROM PUBLIC, anon, authenticated;

-- Programmatically revoke EXECUTE on every tg_* and trigger-helper function in public
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND (
         p.proname LIKE 'tg\_%' ESCAPE '\'
         OR p.proname IN (
           'create_bill_sequences_for_property',
           'create_mis_for_property',
           'handle_new_user',
           'void_folio_safe',
           'set_updated_at'
         )
       )
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC, anon, authenticated', r.sig);
  END LOOP;
END $$;

-- 4. Ensure anon can ONLY execute the login bootstrap helpers
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.prosecdef
       AND has_function_privilege('anon', p.oid, 'EXECUTE')
       AND p.proname NOT IN ('check_login_allowed','record_login_attempt')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon', r.sig);
  END LOOP;
END $$;
