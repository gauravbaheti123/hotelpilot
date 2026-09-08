DO $$
DECLARE
  r record;
  keep text[] := ARRAY[
    'check_login_allowed','record_login_attempt','log_auth_event',
    'has_permission','has_role','permitted_property_ids','my_property_ids',
    'is_superadmin','is_owner_or_super','is_global_owner','banquet_visibility',
    'can_billing','can_food','can_front_desk','can_housekeeping','can_manage_masters',
    'handle_new_user','set_updated_at'
  ];
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proname
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef
      AND NOT (p.proname = ANY (keep))
      AND has_function_privilege('anon', p.oid, 'execute')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon, PUBLIC', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated, service_role', r.sig);
  END LOOP;
END $$;

ALTER FUNCTION public.is_conforming_bill_number(text, text) SET search_path = public;
ALTER FUNCTION public.is_hold_payment_mode(text) SET search_path = public;
ALTER FUNCTION public.tg_folios_balance_before_write() SET search_path = public;