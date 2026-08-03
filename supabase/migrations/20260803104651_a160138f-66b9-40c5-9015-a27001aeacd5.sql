-- 1. Event-level 48h visibility anchor for banquet (event_block) bookings
CREATE OR REPLACE FUNCTION public.banquet_visibility(_property_id uuid DEFAULT NULL)
RETURNS TABLE(booking_id uuid, event_id uuid, last_checkout_at timestamptz, expires_at timestamptz, expired boolean)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH eb AS (
    SELECT b.id AS booking_id,
           b.checked_out_at,
           (SELECT erb.banquet_booking_id FROM public.event_room_blocks erb
             WHERE erb.booking_id = b.id LIMIT 1) AS event_id
    FROM public.bookings b
    WHERE b.source = 'event_block'
      AND (_property_id IS NULL OR b.property_id = _property_id)
  ),
  grp AS (
    SELECT COALESCE(event_id::text, booking_id::text) AS gkey,
           bool_and(checked_out_at IS NOT NULL) AS all_out,
           max(checked_out_at) AS last_out
    FROM eb
    GROUP BY 1
  )
  SELECT eb.booking_id,
         eb.event_id,
         CASE WHEN g.all_out THEN g.last_out END,
         CASE WHEN g.all_out THEN g.last_out + interval '48 hours' END,
         COALESCE(g.all_out AND (g.last_out + interval '48 hours') < now(), false)
  FROM eb
  JOIN grp g ON g.gkey = COALESCE(eb.event_id::text, eb.booking_id::text);
$$;

GRANT EXECUTE ON FUNCTION public.banquet_visibility(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.banquet_visibility(uuid) TO service_role;

-- Helper: property of a banquet document + owner guard
CREATE OR REPLACE FUNCTION public.owner_update_folio_charge(
  _charge_id uuid, _description text, _qty numeric, _rate numeric, _gst_rate numeric, _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old jsonb; _new jsonb; _folio uuid; _prop uuid; _amt numeric;
BEGIN
  IF NOT public.is_owner_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Only owners may edit banquet charges';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT to_jsonb(fc), fc.folio_id INTO _old, _folio
  FROM public.folio_charges fc WHERE fc.id = _charge_id;
  IF _old IS NULL THEN RAISE EXCEPTION 'Charge not found'; END IF;

  SELECT f.property_id INTO _prop FROM public.folios f WHERE f.id = _folio;

  _amt := COALESCE(_qty, 1) * COALESCE(_rate, 0);

  UPDATE public.folio_charges
     SET description = COALESCE(_description, description),
         qty = COALESCE(_qty, qty),
         rate = COALESCE(_rate, rate),
         amount = _amt,
         gst_rate = COALESCE(_gst_rate, gst_rate),
         gst_amount = round(_amt * COALESCE(_gst_rate, gst_rate, 0) / 100.0, 2)
   WHERE id = _charge_id;

  SELECT to_jsonb(fc) INTO _new FROM public.folio_charges fc WHERE fc.id = _charge_id;

  PERFORM public.recompute_folio_totals(_folio);
  PERFORM public.log_owner_override(_prop, 'folio_charges', _charge_id::text, 'UPDATE', _old, _new, _reason);
  RETURN jsonb_build_object('ok', true, 'folio_id', _folio);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_update_bill_item(
  _item_id uuid, _description text, _qty numeric, _rate numeric, _gst_rate numeric, _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _old jsonb; _new jsonb; _bill uuid; _prop uuid; _amt numeric;
BEGIN
  IF NOT public.is_owner_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Only owners may edit banquet bill items';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT to_jsonb(i), i.segment_bill_id INTO _old, _bill
  FROM public.segment_bill_items i WHERE i.id = _item_id;
  IF _old IS NULL THEN RAISE EXCEPTION 'Item not found'; END IF;

  SELECT sb.property_id INTO _prop FROM public.segment_bills sb WHERE sb.id = _bill;

  _amt := COALESCE(_qty, 1) * COALESCE(_rate, 0);

  UPDATE public.segment_bill_items
     SET description = COALESCE(_description, description),
         qty = COALESCE(_qty, qty),
         rate = COALESCE(_rate, rate),
         amount = _amt,
         gst_rate = COALESCE(_gst_rate, gst_rate),
         gst_amount = round(_amt * COALESCE(_gst_rate, gst_rate, 0) / 100.0, 2)
   WHERE id = _item_id;

  SELECT to_jsonb(i) INTO _new FROM public.segment_bill_items i WHERE i.id = _item_id;

  UPDATE public.segment_bills sb
     SET sub_total = t.sub, gst_amount = t.gst,
         total_amount = round(t.sub + t.gst, 2),
         updated_at = now()
    FROM (SELECT COALESCE(sum(amount),0) AS sub, COALESCE(sum(gst_amount),0) AS gst
            FROM public.segment_bill_items WHERE segment_bill_id = _bill) t
   WHERE sb.id = _bill;

  PERFORM public.log_owner_override(_prop, 'segment_bill_items', _item_id::text, 'UPDATE', _old, _new, _reason);
  RETURN jsonb_build_object('ok', true, 'segment_bill_id', _bill);
END;
$$;

CREATE OR REPLACE FUNCTION public.owner_update_folio_header(
  _folio_id uuid, _guest_company text, _guest_gstin text, _notes text, _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _old jsonb; _new jsonb; _prop uuid;
BEGIN
  IF NOT public.is_owner_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Only owners may edit banquet bill headers';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  SELECT to_jsonb(f), f.property_id INTO _old, _prop FROM public.folios f WHERE f.id = _folio_id;
  IF _old IS NULL THEN RAISE EXCEPTION 'Folio not found'; END IF;

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
$$;

CREATE OR REPLACE FUNCTION public.owner_void_banquet_document(
  _kind text, _id uuid, _reason text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE _old jsonb; _new jsonb; _prop uuid; _paid numeric;
BEGIN
  IF NOT public.is_owner_or_super(auth.uid()) THEN
    RAISE EXCEPTION 'Only owners may delete banquet documents';
  END IF;
  IF _reason IS NULL OR length(btrim(_reason)) < 3 THEN
    RAISE EXCEPTION 'A reason is required';
  END IF;

  IF _kind = 'folio' THEN
    SELECT to_jsonb(f), f.property_id, COALESCE(f.paid_amount,0) INTO _old, _prop, _paid
      FROM public.folios f WHERE f.id = _id;
    IF _old IS NULL THEN RAISE EXCEPTION 'Folio not found'; END IF;
    IF _paid > 0 OR EXISTS (SELECT 1 FROM public.payments p WHERE p.folio_id = _id) THEN
      RAISE EXCEPTION 'Cannot delete: payments are attached to this bill';
    END IF;
    UPDATE public.folios SET status = 'void', voided_at = now(), void_reason = _reason, updated_at = now()
      WHERE id = _id;
    SELECT to_jsonb(f) INTO _new FROM public.folios f WHERE f.id = _id;
    PERFORM public.log_owner_override(_prop, 'folios', _id::text, 'VOID', _old, _new, _reason);

  ELSIF _kind = 'segment_bill' THEN
    SELECT to_jsonb(sb), sb.property_id, COALESCE(sb.paid_amount,0) INTO _old, _prop, _paid
      FROM public.segment_bills sb WHERE sb.id = _id;
    IF _old IS NULL THEN RAISE EXCEPTION 'Bill not found'; END IF;
    IF _paid > 0 THEN
      RAISE EXCEPTION 'Cannot delete: payments are attached to this bill';
    END IF;
    UPDATE public.segment_bills SET status = 'void', updated_at = now() WHERE id = _id;
    SELECT to_jsonb(sb) INTO _new FROM public.segment_bills sb WHERE sb.id = _id;
    PERFORM public.log_owner_override(_prop, 'segment_bills', _id::text, 'VOID', _old, _new, _reason);

  ELSIF _kind = 'master_bill' THEN
    SELECT to_jsonb(m), m.property_id INTO _old, _prop
      FROM public.banquet_master_bills m WHERE m.id = _id;
    IF _old IS NULL THEN RAISE EXCEPTION 'Master bill not found'; END IF;
    UPDATE public.banquet_master_bills SET status = 'void', updated_at = now() WHERE id = _id;
    SELECT to_jsonb(m) INTO _new FROM public.banquet_master_bills m WHERE m.id = _id;
    PERFORM public.log_owner_override(_prop, 'banquet_master_bills', _id::text, 'VOID', _old, _new, _reason);

  ELSE
    RAISE EXCEPTION 'Unknown document kind %', _kind;
  END IF;

  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.owner_update_folio_charge(uuid, text, numeric, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_update_bill_item(uuid, text, numeric, numeric, numeric, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_update_folio_header(uuid, text, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.owner_void_banquet_document(text, uuid, text) TO authenticated;