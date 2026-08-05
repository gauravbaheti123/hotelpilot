CREATE OR REPLACE FUNCTION public.ensure_billing_company(
  _property_id uuid,
  _payload jsonb,
  _company_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _id uuid;
  _name text := nullif(btrim(_payload->>'name'), '');
  _gstin text := nullif(upper(btrim(coalesce(_payload->>'gstin',''))), '');
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not signed in.' USING ERRCODE = '42501';
  END IF;
  IF _property_id IS NULL THEN
    RAISE EXCEPTION 'Property is required.' USING ERRCODE = '22023';
  END IF;

  -- Adding a Bill-To company is a sub-operation of booking create/edit, so
  -- booking permissions are sufficient; master_data rights also qualify.
  IF NOT (
    public.is_superadmin(_uid)
    OR public.is_global_owner(_uid)
    OR public.has_permission(_uid, _property_id, 'bookings', 'create')
    OR public.has_permission(_uid, _property_id, 'bookings', 'edit')
    OR public.has_permission(_uid, _property_id, 'master_data', 'create')
  ) THEN
    RAISE EXCEPTION 'You do not have permission to add or update a billing company. Ask an Owner or Manager.'
      USING ERRCODE = '42501';
  END IF;

  IF _company_id IS NOT NULL THEN
    _id := _company_id;
  ELSIF _gstin IS NOT NULL THEN
    SELECT id INTO _id FROM public.billing_companies
     WHERE property_id = _property_id AND upper(btrim(coalesce(gstin,''))) = _gstin
     LIMIT 1;
  END IF;

  IF _id IS NULL AND _name IS NOT NULL THEN
    SELECT id INTO _id FROM public.billing_companies
     WHERE property_id = _property_id AND lower(btrim(name)) = lower(_name)
     LIMIT 1;
  END IF;

  IF _id IS NULL THEN
    IF _name IS NULL THEN
      RAISE EXCEPTION 'Company name is required.' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.billing_companies (
      property_id, name, gstin, gst_status, address, email, city, state, nation, is_active
    ) VALUES (
      _property_id, _name, _gstin,
      nullif(btrim(coalesce(_payload->>'gst_status','')), ''),
      nullif(btrim(coalesce(_payload->>'address','')), ''),
      nullif(btrim(coalesce(_payload->>'email','')), ''),
      nullif(btrim(coalesce(_payload->>'city','')), ''),
      nullif(btrim(coalesce(_payload->>'state','')), ''),
      coalesce(nullif(btrim(coalesce(_payload->>'nation','')), ''), 'India'),
      true
    )
    RETURNING id INTO _id;
    RETURN _id;
  END IF;

  -- Refresh only the fields that were actually supplied.
  UPDATE public.billing_companies SET
    name       = coalesce(_name, name),
    gstin      = coalesce(_gstin, gstin),
    gst_status = coalesce(nullif(btrim(coalesce(_payload->>'gst_status','')), ''), gst_status),
    address    = coalesce(nullif(btrim(coalesce(_payload->>'address','')), ''), address),
    email      = coalesce(nullif(btrim(coalesce(_payload->>'email','')), ''), email),
    city       = coalesce(nullif(btrim(coalesce(_payload->>'city','')), ''), city),
    state      = coalesce(nullif(btrim(coalesce(_payload->>'state','')), ''), state),
    nation     = coalesce(nullif(btrim(coalesce(_payload->>'nation','')), ''), nation)
  WHERE id = _id AND property_id = _property_id;

  RETURN _id;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_billing_company(uuid, jsonb, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.ensure_billing_company(uuid, jsonb, uuid) TO authenticated;