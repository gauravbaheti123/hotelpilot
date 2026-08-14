CREATE TABLE IF NOT EXISTS public.restaurant_tables (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  capacity integer,
  area text,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.restaurant_tables TO authenticated;
GRANT ALL ON public.restaurant_tables TO service_role;

ALTER TABLE public.restaurant_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY restaurant_tables_view ON public.restaurant_tables FOR SELECT USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','view'))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'pos','view'))
  OR property_id IN (SELECT ur.property_id FROM public.user_roles ur WHERE ur.user_id = auth.uid())
);
CREATE POLICY restaurant_tables_create ON public.restaurant_tables FOR INSERT WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','create'))
);
CREATE POLICY restaurant_tables_edit ON public.restaurant_tables FOR UPDATE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
) WITH CHECK (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','edit'))
);
CREATE POLICY restaurant_tables_delete ON public.restaurant_tables FOR DELETE USING (
  (SELECT is_superadmin(auth.uid()))
  OR (property_id IS NOT NULL AND (SELECT is_global_owner(auth.uid())))
  OR property_id IN (SELECT permitted_property_ids(auth.uid(),'master_data','delete'))
);

DROP TRIGGER IF EXISTS trg_restaurant_tables_updated_at ON public.restaurant_tables;
CREATE TRIGGER trg_restaurant_tables_updated_at
  BEFORE UPDATE ON public.restaurant_tables
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE INDEX IF NOT EXISTS idx_restaurant_tables_property ON public.restaurant_tables(property_id, is_active);

ALTER TABLE public.segment_bills
  ADD COLUMN IF NOT EXISTS table_id uuid REFERENCES public.restaurant_tables(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_segment_bills_table ON public.segment_bills(table_id) WHERE table_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.settle_segment_bill_complimentary(
  _bill_id uuid,
  _reason text,
  _actor uuid DEFAULT NULL::uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  b RECORD;
  uid uuid := COALESCE(auth.uid(), _actor);
  item_count integer;
  sum_amount numeric := 0;
  sum_gst numeric := 0;
  removed integer := 0;
BEGIN
  IF _reason IS NULL OR btrim(_reason) = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'reason_required');
  END IF;

  -- Complimentary settlement is a routine food-service task (MAP/AP plan
  -- inclusions), so every food-service role may do it. Accountability lives in
  -- the mandatory reason + activity_log entry, not in role restriction.
  IF NOT (
    public.is_owner_or_super()
    OR public.has_role(uid, 'owner'::app_role)
    OR public.has_role(uid, 'manager'::app_role)
    OR public.has_role(uid, 'superadmin'::app_role)
    OR public.has_role(uid, 'receptionist'::app_role)
    OR public.has_role(uid, 'kitchen'::app_role)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_allowed');
  END IF;

  SELECT * INTO b FROM public.segment_bills WHERE id = _bill_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'not_found');
  END IF;

  SELECT COUNT(*), COALESCE(SUM(i.amount), 0), COALESCE(SUM(i.gst_amount), 0)
    INTO item_count, sum_amount, sum_gst
  FROM public.segment_bill_items i
  WHERE i.segment_bill_id = b.id;

  IF item_count = 0 THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'no_items', 'bill_number', b.bill_number);
  END IF;

  DELETE FROM public.folio_charges
  WHERE source_table = 'segment_bills' AND source_id = b.id;
  GET DIAGNOSTICS removed = ROW_COUNT;

  IF b.folio_id IS NOT NULL THEN
    BEGIN
      PERFORM public.recompute_folio_totals(b.folio_id);
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  UPDATE public.segment_bills
  SET status = 'settled',
      settled_at = COALESCE(settled_at, now()),
      total_amount = sum_amount,
      gst_amount = sum_gst,
      paid_amount = 0,
      payment_mode = 'complimentary',
      is_complimentary = true,
      complimentary_reason = btrim(_reason),
      complimentary_by = uid,
      complimentary_at = now(),
      updated_at = now()
  WHERE id = b.id;

  INSERT INTO public.activity_log (
    property_id, action_type, module, reference_id, reference_label, details
  ) VALUES (
    b.property_id,
    'BILL_MARKED_COMPLIMENTARY',
    CASE WHEN b.segment = 'food' THEN 'food' ELSE 'laundry' END,
    b.id,
    b.bill_number,
    jsonb_build_object(
      'segment', b.segment,
      'bill_number', b.bill_number,
      'amount', sum_amount,
      'gst_amount', sum_gst,
      'items', item_count,
      'reason', btrim(_reason),
      'folio_charges_removed', removed,
      'booking_id', b.booking_id,
      'folio_id', b.folio_id,
      'marked_at', now()
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'bill_id', b.id,
    'bill_number', b.bill_number,
    'total_amount', sum_amount,
    'gst_amount', sum_gst,
    'reason', btrim(_reason)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.settle_segment_bill_complimentary(uuid, text, uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.settle_segment_bill_complimentary(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.settle_segment_bill_complimentary(uuid, text, uuid) TO service_role;