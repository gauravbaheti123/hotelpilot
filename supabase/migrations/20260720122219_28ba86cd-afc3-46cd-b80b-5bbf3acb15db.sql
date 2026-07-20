
CREATE OR REPLACE FUNCTION public.tg_folio_charges_sync()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_old_folio uuid;
  v_new_folio uuid;
  v_booking uuid;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_old_folio := OLD.folio_id;
  ELSIF TG_OP = 'UPDATE' THEN
    v_old_folio := OLD.folio_id;
    v_new_folio := NEW.folio_id;
  ELSE
    v_new_folio := NEW.folio_id;
  END IF;

  IF v_old_folio IS NOT NULL THEN
    PERFORM public.recompute_folio_totals(v_old_folio);
    SELECT booking_id INTO v_booking FROM public.folios WHERE id = v_old_folio;
    IF v_booking IS NOT NULL THEN PERFORM public.sync_booking_balance(v_booking); END IF;
  END IF;

  IF v_new_folio IS NOT NULL AND v_new_folio IS DISTINCT FROM v_old_folio THEN
    PERFORM public.recompute_folio_totals(v_new_folio);
    SELECT booking_id INTO v_booking FROM public.folios WHERE id = v_new_folio;
    IF v_booking IS NOT NULL THEN PERFORM public.sync_booking_balance(v_booking); END IF;
  ELSIF v_new_folio IS NOT NULL AND v_old_folio IS NULL THEN
    -- INSERT case handled above via v_new_folio
    NULL;
  END IF;

  RETURN COALESCE(NEW, OLD);
END $$;

DROP TRIGGER IF EXISTS trg_folio_charges_sync ON public.folio_charges;
CREATE TRIGGER trg_folio_charges_sync
AFTER INSERT OR UPDATE OR DELETE ON public.folio_charges
FOR EACH ROW EXECUTE FUNCTION public.tg_folio_charges_sync();

-- One-shot backfill: bring every non-deleted folio's totals in line with charges
DO $$
DECLARE r record;
BEGIN
  FOR r IN SELECT id FROM public.folios WHERE COALESCE(is_deleted, false) = false LOOP
    PERFORM public.recompute_folio_totals(r.id);
  END LOOP;
END $$;
