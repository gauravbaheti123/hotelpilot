-- Room charges for the SAME booking_rooms segment but DIFFERENT nights were
-- being silently dropped by this trigger, because it only compared source_id.
-- That removed every night after the first on a split child bill, which made
-- the split conservation check reject the whole split.
-- Now only a true duplicate (same segment AND same charge date AND same
-- amount) is skipped; genuine extra nights are allowed through.
CREATE OR REPLACE FUNCTION public.tg_folio_charges_block_dupe_room()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.charge_type = 'room'
     AND NEW.source_table = 'booking_rooms'
     AND NEW.source_id IS NOT NULL
     AND COALESCE(NEW.is_wiped, false) = false THEN
    IF EXISTS (
      SELECT 1 FROM public.folio_charges fc
       WHERE fc.folio_id = NEW.folio_id
         AND fc.charge_type = 'room'
         AND fc.source_table = 'booking_rooms'
         AND fc.source_id = NEW.source_id
         AND COALESCE(fc.is_wiped, false) = false
         AND fc.id <> NEW.id
         AND fc.charged_on IS NOT DISTINCT FROM NEW.charged_on
         AND ROUND(COALESCE(fc.amount, 0), 2) = ROUND(COALESCE(NEW.amount, 0), 2)
         AND ROUND(COALESCE(fc.qty, 0), 2) = ROUND(COALESCE(NEW.qty, 0), 2)
    ) THEN
      RETURN NULL; -- exact duplicate of an existing night: skip
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;
