
CREATE OR REPLACE FUNCTION public.staff_can_correct(_prop uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_owner_or_super(auth.uid())
      OR EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = auth.uid()
          AND (ur.property_id = _prop OR ur.property_id IS NULL)
      );
$$;
REVOKE ALL ON FUNCTION public.staff_can_correct(uuid) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.staff_can_correct(uuid) TO authenticated;

-- Charge line: allow open-bill corrections by property staff; add date + HSN
CREATE OR REPLACE FUNCTION public.owner_update_folio_charge(
  _charge_id uuid, _description text, _qty numeric, _rate numeric, _gst_rate numeric, _reason text,
  _charged_on date DEFAULT NULL, _hsn_code text DEFAULT NULL)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _old jsonb; _new jsonb; _folio uuid; _prop uuid; _amt numeric; _status text;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT to_jsonb(fc), fc.folio_id INTO _old, _folio
  FROM public.folio_charges fc WHERE fc.id = _charge_id;
  IF _old IS NULL THEN RAISE EXCEPTION 'Charge not found'; END IF;

  SELECT f.property_id, f.status::text INTO _prop, _status FROM public.folios f WHERE f.id = _folio;

  IF _status = 'open' THEN
    IF NOT public.staff_can_correct(_prop) THEN
      RAISE EXCEPTION 'You do not have access to this property';
    END IF;
  ELSIF NOT public.is_owner_or_super(auth.uid())
        AND NOT public.has_permission(auth.uid(), 'invoices', 'edit_room_rate_locked') THEN
    RAISE EXCEPTION 'This bill is settled — Manager or Owner rights are required to edit it';
  END IF;

  _amt := COALESCE(_qty, 1) * COALESCE(_rate, 0);

  UPDATE public.folio_charges
     SET description = COALESCE(_description, description),
         qty = COALESCE(_qty, qty),
         rate = COALESCE(_rate, rate),
         amount = _amt,
         gst_rate = COALESCE(_gst_rate, gst_rate),
         gst_amount = round(_amt * COALESCE(_gst_rate, gst_rate, 0) / 100.0, 2),
         charged_on = COALESCE(_charged_on, charged_on),
         hsn_code = COALESCE(NULLIF(btrim(_hsn_code), ''), hsn_code)
   WHERE id = _charge_id;

  SELECT to_jsonb(fc) INTO _new FROM public.folio_charges fc WHERE fc.id = _charge_id;

  PERFORM public.recompute_folio_totals(_folio);
  PERFORM public.log_owner_override(_prop, 'folio_charges', _charge_id::text, 'UPDATE', _old, _new, _reason);
  RETURN jsonb_build_object('ok', true, 'folio_id', _folio);
END;
$function$;
REVOKE ALL ON FUNCTION public.owner_update_folio_charge(uuid,text,numeric,numeric,numeric,text,date,text) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_update_folio_charge(uuid,text,numeric,numeric,numeric,text,date,text) TO authenticated;

-- Folio header (Bill-To company / GSTIN / notes)
CREATE OR REPLACE FUNCTION public.owner_update_folio_header(_folio_id uuid, _guest_company text, _guest_gstin text, _notes text, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _old jsonb; _new jsonb; _prop uuid; _status text;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT to_jsonb(f), f.property_id, f.status::text INTO _old, _prop, _status
    FROM public.folios f WHERE f.id = _folio_id;
  IF _old IS NULL THEN RAISE EXCEPTION 'Folio not found'; END IF;

  IF _status = 'open' THEN
    IF NOT public.staff_can_correct(_prop) THEN
      RAISE EXCEPTION 'You do not have access to this property';
    END IF;
  ELSIF NOT public.is_owner_or_super(auth.uid())
        AND NOT public.has_permission(auth.uid(), 'invoices', 'edit_billto_locked') THEN
    RAISE EXCEPTION 'This bill is settled — Manager or Owner rights are required to edit it';
  END IF;

  UPDATE public.folios
     SET guest_company = _guest_company,
         guest_gstin = _guest_gstin,
         notes = _notes,
         updated_at = now()
   WHERE id = _folio_id;

  SELECT to_jsonb(f) INTO _new FROM public.folios f WHERE f.id = _folio_id;
  PERFORM public.log_owner_override(_prop, 'folios', _folio_id::text, 'UPDATE', _old, _new, _reason);
  RETURN jsonb_build_object('ok', true);
END;
$function$;

-- Guest name
CREATE OR REPLACE FUNCTION public.owner_update_guest_name(_guest_id uuid, _name text, _reason text)
 RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE _old jsonb; _new jsonb; _prop uuid;
BEGIN
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;
  IF _name IS NULL OR length(btrim(_name)) = 0 THEN
    RAISE EXCEPTION 'Guest name cannot be empty';
  END IF;

  SELECT to_jsonb(g), g.property_id INTO _old, _prop
    FROM public.guests g WHERE g.id = _guest_id FOR UPDATE;
  IF _old IS NULL THEN RAISE EXCEPTION 'Guest not found'; END IF;

  IF NOT public.staff_can_correct(_prop) THEN
    RAISE EXCEPTION 'You do not have access to this property';
  END IF;

  UPDATE public.guests SET name = btrim(_name), updated_at = now() WHERE id = _guest_id;

  SELECT to_jsonb(g) INTO _new FROM public.guests g WHERE g.id = _guest_id;
  PERFORM public.log_owner_override(_prop, 'guests', _guest_id::text, 'UPDATE', _old, _new, _reason);
  RETURN jsonb_build_object('ok', true);
END;
$function$;
