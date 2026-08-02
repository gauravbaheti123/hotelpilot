CREATE OR REPLACE FUNCTION public.sync_guest_company_to_billing()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_company text := nullif(btrim(coalesce(NEW.company, '')), '');
  v_gstin   text := nullif(btrim(upper(coalesce(NEW.gst_number, ''))), '');
  v_match   public.billing_companies%ROWTYPE;
BEGIN
  IF v_company IS NULL OR NEW.property_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_gstin IS NOT NULL THEN
    SELECT * INTO v_match FROM public.billing_companies
     WHERE property_id = NEW.property_id AND upper(btrim(coalesce(gstin,''))) = v_gstin
     LIMIT 1;
  END IF;

  IF v_match.id IS NULL THEN
    SELECT * INTO v_match FROM public.billing_companies
     WHERE property_id = NEW.property_id AND lower(btrim(name)) = lower(v_company)
     LIMIT 1;
  END IF;

  IF v_match.id IS NULL THEN
    INSERT INTO public.billing_companies (property_id, name, gstin, address, is_active)
    VALUES (NEW.property_id, v_company, v_gstin, nullif(btrim(coalesce(NEW.address,'')), ''), true);
    RETURN NEW;
  END IF;

  -- Existing entry: never overwrite curated data. Flag GSTIN mismatch only.
  IF v_gstin IS NOT NULL
     AND nullif(btrim(coalesce(v_match.gstin,'')), '') IS NOT NULL
     AND upper(btrim(v_match.gstin)) <> v_gstin THEN
    INSERT INTO public.activity_log (property_id, user_id, action_type, module, reference_id, reference_label, details)
    VALUES (
      NEW.property_id, auth.uid(), 'COMPANY_GSTIN_MISMATCH', 'billing_companies', v_match.id, v_match.name,
      jsonb_build_object(
        'guest_id', NEW.id,
        'guest_name', NEW.name,
        'guest_gstin', v_gstin,
        'billing_company_gstin', v_match.gstin,
        'note', 'Guest-entered GSTIN differs from Billing Company master. Not auto-corrected.'
      )
    );
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_guest_company_to_billing ON public.guests;
CREATE TRIGGER trg_sync_guest_company_to_billing
AFTER INSERT OR UPDATE OF company, gst_number ON public.guests
FOR EACH ROW EXECUTE FUNCTION public.sync_guest_company_to_billing();

-- One-time backfill (dedupe by GSTIN, else case-insensitive name)
WITH src AS (
  SELECT DISTINCT ON (g.property_id, coalesce(nullif(upper(btrim(coalesce(g.gst_number,''))),''), lower(btrim(g.company))))
         g.property_id,
         btrim(g.company) AS name,
         nullif(upper(btrim(coalesce(g.gst_number,''))),'') AS gstin,
         nullif(btrim(coalesce(g.address,'')),'') AS address
    FROM public.guests g
   WHERE nullif(btrim(coalesce(g.company,'')),'') IS NOT NULL
     AND g.property_id IS NOT NULL
   ORDER BY g.property_id,
            coalesce(nullif(upper(btrim(coalesce(g.gst_number,''))),''), lower(btrim(g.company))),
            g.created_at
)
INSERT INTO public.billing_companies (property_id, name, gstin, address, is_active)
SELECT s.property_id, s.name, s.gstin, s.address, true
  FROM src s
 WHERE NOT EXISTS (
   SELECT 1 FROM public.billing_companies bc
    WHERE bc.property_id = s.property_id
      AND (
        (s.gstin IS NOT NULL AND upper(btrim(coalesce(bc.gstin,''))) = s.gstin)
        OR lower(btrim(bc.name)) = lower(s.name)
      )
 );