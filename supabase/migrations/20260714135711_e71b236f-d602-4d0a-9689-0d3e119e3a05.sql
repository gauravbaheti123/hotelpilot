
-- Auto-derive state_code from GSTIN on properties
CREATE OR REPLACE FUNCTION public.tg_properties_derive_state_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $$
BEGIN
  -- Only auto-derive when caller didn't explicitly set state_code this write.
  -- If gstin present and state_code missing (or matches old derivation), derive from gstin.
  IF NEW.gstin IS NOT NULL AND length(btrim(NEW.gstin)) >= 2 THEN
    IF NEW.state_code IS NULL OR btrim(NEW.state_code) = '' THEN
      NEW.state_code := substring(btrim(NEW.gstin), 1, 2);
    ELSIF TG_OP = 'UPDATE'
          AND NEW.gstin IS DISTINCT FROM OLD.gstin
          AND (OLD.state_code IS NULL OR NEW.state_code = OLD.state_code)
          AND NEW.state_code = COALESCE(substring(btrim(OLD.gstin), 1, 2), NEW.state_code) THEN
      -- gstin changed and user didn't manually change state_code → refresh it
      NEW.state_code := substring(btrim(NEW.gstin), 1, 2);
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS properties_derive_state_code ON public.properties;
CREATE TRIGGER properties_derive_state_code
BEFORE INSERT OR UPDATE OF gstin, state_code ON public.properties
FOR EACH ROW EXECUTE FUNCTION public.tg_properties_derive_state_code();

-- One-time backfill
UPDATE public.properties
   SET state_code = substring(btrim(gstin), 1, 2)
 WHERE gstin IS NOT NULL
   AND length(btrim(gstin)) >= 2
   AND (state_code IS NULL OR btrim(state_code) = '');
