CREATE OR REPLACE FUNCTION public.last_handover_window_start(_property_id uuid)
RETURNS timestamp with time zone
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT MAX(COALESCE(window_end, created_at))
       FROM public.shift_handovers
      WHERE property_id = _property_id),
    date_trunc('day', now())
  );
$$;

CREATE OR REPLACE FUNCTION public.delete_shift_handover(_id uuid, _reason text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _h public.shift_handovers%ROWTYPE;
  _latest uuid;
  _lines jsonb;
  _snapshot jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RAISE EXCEPTION 'A reason is required to delete a handover';
  END IF;

  SELECT * INTO _h FROM public.shift_handovers WHERE id = _id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Handover not found';
  END IF;

  IF NOT (public.is_owner_or_super(_uid)
          OR public.has_permission(_uid, _h.property_id, 'shift_handover', 'delete')) THEN
    RAISE EXCEPTION 'You do not have permission to delete handovers';
  END IF;

  SELECT id INTO _latest
    FROM public.shift_handovers
   WHERE property_id = _h.property_id
   ORDER BY COALESCE(window_end, created_at) DESC, created_at DESC
   LIMIT 1;

  IF _latest IS DISTINCT FROM _id THEN
    RAISE EXCEPTION 'Only the most recent handover can be deleted';
  END IF;

  SELECT COALESCE(jsonb_agg(to_jsonb(l)), '[]'::jsonb) INTO _lines
    FROM public.shift_handover_lines l WHERE l.handover_id = _id;

  _snapshot := jsonb_build_object('handover', to_jsonb(_h), 'lines', _lines);

  PERFORM public.log_owner_override(
    _h.property_id, 'shift_handovers', _id::text, 'delete', _snapshot, NULL::jsonb, btrim(_reason)
  );

  DELETE FROM public.shift_handovers WHERE id = _id;

  RETURN jsonb_build_object('ok', true, 'deleted_id', _id);
END;
$$;

GRANT EXECUTE ON FUNCTION public.delete_shift_handover(uuid, text) TO authenticated;