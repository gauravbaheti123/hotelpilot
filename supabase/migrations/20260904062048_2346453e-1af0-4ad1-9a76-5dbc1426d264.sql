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
  IF NOT public.is_owner_or_super(v_uid) THEN
    RAISE EXCEPTION 'Owner or Superadmin required to override locked records';
  END IF;

  SELECT COALESCE(name, email, 'Owner') INTO v_name
    FROM public.profiles WHERE id = v_uid;

  INSERT INTO public.activity_log (
    property_id, user_id, user_name, action_type, module,
    reference_id, reference_label, details
  ) VALUES (
    _property_id, v_uid, COALESCE(v_name,'Owner'),
    'OWNER_OVERRIDE', _table_name,
    _record_id::uuid, _table_name || ':' || _record_id,
    jsonb_build_object(
      'action', _action,
      'old', COALESCE(_old, '{}'::jsonb),
      'new', COALESCE(_new, '{}'::jsonb),
      'reason', COALESCE(_reason,'')
    )
  ) RETURNING id INTO v_id;
  RETURN v_id;
END $function$;