ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS state_code text;
ALTER TABLE public.billing_companies ADD COLUMN IF NOT EXISTS state_code text;

-- Canonical Indian state / UT name -> GST state code
CREATE OR REPLACE FUNCTION public.gst_state_code_from_name(_name text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE regexp_replace(lower(btrim(coalesce(_name, ''))), '[^a-z]', '', 'g')
    WHEN 'jammuandkashmir' THEN '01'
    WHEN 'himachalpradesh' THEN '02'
    WHEN 'punjab' THEN '03'
    WHEN 'chandigarh' THEN '04'
    WHEN 'uttarakhand' THEN '05'
    WHEN 'uttaranchal' THEN '05'
    WHEN 'haryana' THEN '06'
    WHEN 'delhi' THEN '07'
    WHEN 'newdelhi' THEN '07'
    WHEN 'rajasthan' THEN '08'
    WHEN 'uttarpradesh' THEN '09'
    WHEN 'bihar' THEN '10'
    WHEN 'sikkim' THEN '11'
    WHEN 'arunachalpradesh' THEN '12'
    WHEN 'nagaland' THEN '13'
    WHEN 'manipur' THEN '14'
    WHEN 'mizoram' THEN '15'
    WHEN 'tripura' THEN '16'
    WHEN 'meghalaya' THEN '17'
    WHEN 'assam' THEN '18'
    WHEN 'westbengal' THEN '19'
    WHEN 'jharkhand' THEN '20'
    WHEN 'odisha' THEN '21'
    WHEN 'orissa' THEN '21'
    WHEN 'chhattisgarh' THEN '22'
    WHEN 'chattisgarh' THEN '22'
    WHEN 'madhyapradesh' THEN '23'
    WHEN 'gujarat' THEN '24'
    WHEN 'dadraandnagarhavelianddamananddiu' THEN '26'
    WHEN 'damananddiu' THEN '26'
    WHEN 'dadraandnagarhaveli' THEN '26'
    WHEN 'maharashtra' THEN '27'
    WHEN 'maharastra' THEN '27'
    WHEN 'karnataka' THEN '29'
    WHEN 'goa' THEN '30'
    WHEN 'lakshadweep' THEN '31'
    WHEN 'kerala' THEN '32'
    WHEN 'tamilnadu' THEN '33'
    WHEN 'puducherry' THEN '34'
    WHEN 'pondicherry' THEN '34'
    WHEN 'andamanandnicobarislands' THEN '35'
    WHEN 'andamanandnicobar' THEN '35'
    WHEN 'telangana' THEN '36'
    WHEN 'andhrapradesh' THEN '37'
    WHEN 'ladakh' THEN '38'
    ELSE NULL
  END
$$;

-- 2-digit state code embedded in a GSTIN, validated against the known code list
CREATE OR REPLACE FUNCTION public.gst_state_code_from_gstin(_gstin text)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN btrim(coalesce(_gstin, '')) ~ '^[0-9]{2}[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}'
     AND substring(btrim(_gstin), 1, 2) IN (
       '01','02','03','04','05','06','07','08','09','10','11','12','13','14','15','16','17','18',
       '19','20','21','22','23','24','25','26','27','29','30','31','32','33','34','35','36','37','38'
     )
    THEN substring(btrim(_gstin), 1, 2)
    ELSE NULL
  END
$$;

-- Guests: fill state_code from GSTIN, else from the address state
CREATE OR REPLACE FUNCTION public.tg_guests_derive_state_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.state_code := COALESCE(
    public.gst_state_code_from_gstin(NEW.gst_number),
    public.gst_state_code_from_name(NEW.state)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_guests_derive_state_code ON public.guests;
CREATE TRIGGER trg_guests_derive_state_code
BEFORE INSERT OR UPDATE OF gst_number, state ON public.guests
FOR EACH ROW EXECUTE FUNCTION public.tg_guests_derive_state_code();

-- Billing companies: same rule
CREATE OR REPLACE FUNCTION public.tg_billing_companies_derive_state_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.state_code := COALESCE(
    public.gst_state_code_from_gstin(NEW.gstin),
    public.gst_state_code_from_name(NEW.state)
  );
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_billing_companies_derive_state_code ON public.billing_companies;
CREATE TRIGGER trg_billing_companies_derive_state_code
BEFORE INSERT OR UPDATE OF gstin, state ON public.billing_companies
FOR EACH ROW EXECUTE FUNCTION public.tg_billing_companies_derive_state_code();

-- Property: prefer a valid GSTIN code, else fall back to the address state name
CREATE OR REPLACE FUNCTION public.tg_properties_derive_state_code()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  derived text;
BEGIN
  derived := COALESCE(
    public.gst_state_code_from_gstin(NEW.gstin),
    public.gst_state_code_from_name(NEW.state)
  );

  IF NEW.state_code IS NULL OR btrim(NEW.state_code) = '' THEN
    NEW.state_code := derived;
  ELSIF TG_OP = 'UPDATE'
        AND (NEW.gstin IS DISTINCT FROM OLD.gstin OR NEW.state IS DISTINCT FROM OLD.state)
        AND NEW.state_code IS NOT DISTINCT FROM OLD.state_code
        AND derived IS NOT NULL THEN
    -- source fields changed and state_code wasn't manually overridden this write
    NEW.state_code := derived;
  END IF;

  RETURN NEW;
END $$;