CREATE OR REPLACE FUNCTION public.cleanup_empty_segment_bill(_bill_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  b record;
  n_items int;
  seq record;
  num int;
BEGIN
  SELECT * INTO b FROM public.segment_bills WHERE id = _bill_id;
  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF NOT (
    public.is_owner_or_super(auth.uid())
    OR public.can_billing(auth.uid(), b.property_id)
    OR public.has_permission(auth.uid(), b.property_id, 'all_kots', 'delete')
  ) THEN
    RAISE EXCEPTION 'Not allowed to clean up this bill';
  END IF;

  SELECT count(*) INTO n_items FROM public.segment_bill_items WHERE segment_bill_id = _bill_id;
  IF n_items > 0 OR b.status <> 'open' OR COALESCE(b.paid_amount, 0) > 0 THEN
    RETURN false;
  END IF;

  DELETE FROM public.folio_charges
   WHERE source_table = 'segment_bills' AND source_id = _bill_id;

  DELETE FROM public.segment_bills WHERE id = _bill_id;

  -- Rewind the numbering counter when this was the latest number in its series.
  IF b.bill_number IS NOT NULL THEN
    FOR seq IN
      SELECT * FROM public.bill_sequences
       WHERE property_id = b.property_id
         AND prefix IS NOT NULL
         AND b.bill_number LIKE prefix || '%'
    LOOP
      BEGIN
        num := (regexp_replace(b.bill_number, '^' || seq.prefix, ''))::int;
      EXCEPTION WHEN others THEN
        num := NULL;
      END;
      IF num IS NOT NULL AND seq.last_number = num THEN
        UPDATE public.bill_sequences SET last_number = num - 1 WHERE id = seq.id;
      END IF;
    END LOOP;
  END IF;

  IF b.folio_id IS NOT NULL THEN
    PERFORM public.recompute_folio_totals(b.folio_id);
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cleanup_empty_segment_bill(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.cleanup_empty_segment_bill(uuid) TO authenticated;