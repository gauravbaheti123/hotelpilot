-- 1) log_owner_override(): previously hard-failed with
--    'Owner or Superadmin required to override locked records' for any non-owner.
--    It is called at the END of owner_update_folio_charge() and by the Food/Laundry
--    cancel + edit dialogs, so a receptionist correcting an OPEN bill had the whole
--    transaction aborted even though the caller RPC had already authorised them.
--    Audit rows must still be written, so widen the check to property staff.
CREATE OR REPLACE FUNCTION public.log_owner_override(_property_id uuid, _table_name text, _record_id text, _action text, _old jsonb, _new jsonb, _reason text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_id uuid;
  v_uid uuid := auth.uid();
  v_name text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;
  IF NOT public.is_owner_or_super(v_uid)
     AND NOT public.staff_can_correct(_property_id) THEN
    RAISE EXCEPTION 'You do not have access to this property';
  END IF;

  SELECT COALESCE(name, email, 'Owner') INTO v_name
    FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.activity_log (
    property_id, user_id, user_name, action_type, module,
    reference_id, reference_label, details
  ) VALUES (
    _property_id, v_uid, COALESCE(v_name,'Staff'),
    'OWNER_OVERRIDE', _table_name,
    _record_id::uuid, _table_name || ':' || _record_id,
    jsonb_build_object(
      'action', _action,
      'old', COALESCE(_old, '{}'::jsonb),
      'new', COALESCE(_new, '{}'::jsonb),
      'reason', COALESCE(_reason,''),
      'by_owner', public.is_owner_or_super(v_uid)
    )
  ) RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.log_owner_override(uuid,text,text,text,jsonb,jsonb,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.log_owner_override(uuid,text,text,text,jsonb,jsonb,text) TO authenticated;

-- 2) Billing companies: reception raises Bill-To companies during booking, so any
--    staff member at the property may add/correct one (delete stays restricted).
DROP POLICY IF EXISTS billing_companies_create ON public.billing_companies;
CREATE POLICY billing_companies_create ON public.billing_companies FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','create'))
  OR public.staff_can_correct(property_id)
);

DROP POLICY IF EXISTS billing_companies_edit ON public.billing_companies;
CREATE POLICY billing_companies_edit ON public.billing_companies FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
  OR public.staff_can_correct(property_id)
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
  OR public.staff_can_correct(property_id)
);