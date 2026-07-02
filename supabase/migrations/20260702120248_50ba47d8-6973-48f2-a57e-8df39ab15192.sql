
-- 1) Rewrite folio invoice number trigger: MAX + 1 from actual folios rows
CREATE OR REPLACE FUNCTION public.tg_assign_invoice_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_next int;
  v_prefix text := 'BILL';
BEGIN
  IF NEW.invoice_number IS NOT NULL AND NEW.invoice_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(
           MAX(NULLIF(regexp_replace(invoice_number, '^' || v_prefix, ''), '')::int),
           0
         ) + 1
    INTO v_next
    FROM public.folios
   WHERE property_id = NEW.property_id
     AND invoice_number LIKE v_prefix || '%'
     AND COALESCE(is_deleted, false) = false
     AND status <> 'void';
  NEW.invoice_number := v_prefix || LPAD(v_next::text, 3, '0');
  RETURN NEW;
END $function$;

-- 2) Rewrite banquet event number trigger similarly
CREATE OR REPLACE FUNCTION public.tg_assign_banquet_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_next int;
  v_prefix text := 'EVENT';
BEGIN
  IF NEW.banquet_number IS NOT NULL AND NEW.banquet_number <> '' THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(
           MAX(NULLIF(regexp_replace(banquet_number, '^' || v_prefix, ''), '')::int),
           0
         ) + 1
    INTO v_next
    FROM public.banquet_bookings
   WHERE property_id = NEW.property_id
     AND banquet_number LIKE v_prefix || '%';
  NEW.banquet_number := v_prefix || LPAD(v_next::text, 3, '0');
  RETURN NEW;
END $function$;

-- 3) Uniqueness for active bill numbers per property (per series prefix)
CREATE UNIQUE INDEX IF NOT EXISTS ux_folios_active_invoice_number
  ON public.folios (property_id, invoice_number)
  WHERE COALESCE(is_deleted, false) = false AND status <> 'void';

CREATE UNIQUE INDEX IF NOT EXISTS ux_banquet_active_number
  ON public.banquet_bookings (property_id, banquet_number);
