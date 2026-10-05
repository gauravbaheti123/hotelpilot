CREATE OR REPLACE FUNCTION public.owner_edit_settled_night_tariff(_booking_id uuid, _source_id uuid, _night date, _new_rate numeric)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $fn$
DECLARE
  c public.folio_charges%ROWTYPE;
  v_prop uuid; v_head numeric; v_tail numeric; v_new uuid; v_old jsonb;
BEGIN
  SELECT property_id INTO v_prop FROM public.bookings WHERE id = _booking_id;
  IF NOT (public.is_superadmin(auth.uid()) OR public.is_global_owner(auth.uid())
       OR public.has_role(auth.uid(),'owner'::app_role) OR public.has_role(auth.uid(),'manager'::app_role)
       OR public.has_permission(auth.uid(), v_prop, 'invoices', 'edit_room_rate_locked')) THEN
    RAISE EXCEPTION 'Bill is settled — only Owner/Manager can correct the tariff';
  END IF;

  SELECT fc.* INTO c FROM public.folio_charges fc JOIN public.folios f ON f.id = fc.folio_id
   WHERE f.booking_id = _booking_id AND COALESCE(f.is_deleted,false) = false AND f.status <> 'void'
     AND fc.charge_type = 'room' AND COALESCE(fc.is_wiped,false) = false
     AND _night >= fc.charged_on AND _night < fc.charged_on + GREATEST(1, ceil(fc.qty))::int
   ORDER BY (fc.source_id = _source_id) DESC, fc.created_at DESC
   LIMIT 1 FOR UPDATE OF fc;
  IF NOT FOUND THEN RAISE EXCEPTION 'No room charge found on the bill for that night'; END IF;
  v_old := to_jsonb(c);

  v_head := _night - c.charged_on;
  v_tail := GREATEST(1, ceil(c.qty))::int - v_head - 1;

  IF v_head = 0 AND v_tail = 0 THEN
    UPDATE public.folio_charges SET rate=_new_rate, amount=c.qty*_new_rate,
      gst_amount=round(c.qty*_new_rate*COALESCE(c.gst_rate,0)/100.0,2) WHERE id=c.id;
    v_new := c.id;
  ELSE
    IF v_head > 0 THEN
      UPDATE public.folio_charges SET qty=v_head, amount=v_head*c.rate,
        gst_amount=round(v_head*c.rate*COALESCE(c.gst_rate,0)/100.0,2),
        discount_amount = 0, discount_type = NULL, discount_value = 0 WHERE id=c.id;
    ELSE
      UPDATE public.folio_charges SET qty=v_tail, charged_on=_night+1, amount=v_tail*c.rate,
        gst_amount=round(v_tail*c.rate*COALESCE(c.gst_rate,0)/100.0,2),
        discount_amount = 0, discount_type = NULL, discount_value = 0 WHERE id=c.id;
      v_tail := 0;
    END IF;
    INSERT INTO public.folio_charges(folio_id,charge_type,description,qty,rate,amount,gst_rate,gst_amount,source_table,source_id,charged_on,created_by,hsn_code)
    VALUES (c.folio_id,'room',c.description,1,_new_rate,_new_rate,c.gst_rate,round(_new_rate*COALESCE(c.gst_rate,0)/100.0,2),c.source_table,c.source_id,_night,auth.uid(),c.hsn_code)
    RETURNING id INTO v_new;
    IF v_tail > 0 THEN
      INSERT INTO public.folio_charges(folio_id,charge_type,description,qty,rate,amount,gst_rate,gst_amount,source_table,source_id,charged_on,created_by,hsn_code)
      VALUES (c.folio_id,'room',c.description,v_tail,c.rate,v_tail*c.rate,c.gst_rate,round(v_tail*c.rate*COALESCE(c.gst_rate,0)/100.0,2),c.source_table,c.source_id,_night+1,auth.uid(),c.hsn_code);
    END IF;
  END IF;

  PERFORM public.recompute_folio_totals(c.folio_id);
  PERFORM public.log_owner_override(v_prop, 'folio_charges', c.id::text, 'UPDATE', v_old,
    jsonb_build_object('night', _night, 'new_rate', _new_rate), 'Tariff correction on settled bill');
  RETURN v_new;
END;
$fn$;
REVOKE ALL ON FUNCTION public.owner_edit_settled_night_tariff(uuid,uuid,date,numeric) FROM public, anon;
GRANT EXECUTE ON FUNCTION public.owner_edit_settled_night_tariff(uuid,uuid,date,numeric) TO authenticated;

DO $do$
DECLARE d text;
BEGIN
  d := pg_get_functiondef('public.split_room_night(uuid,date,numeric)'::regprocedure);
  d := replace(d, $r$    RAISE EXCEPTION 'Bill is already settled — use Undo Checkout / reopen the bill first, then edit the tariff';$r$,
    $r$    IF _night < v_br.check_in OR _night >= v_br.check_out THEN
      RAISE EXCEPTION 'That night is not part of this stay';
    END IF;
    RETURN public.owner_edit_settled_night_tariff(v_br.booking_id, v_br.id, _night, _new_rate);$r$);
  EXECUTE d;
END $do$;