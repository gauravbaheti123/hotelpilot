
CREATE OR REPLACE FUNCTION public.tg_folios_balance_before_write()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.balance_amount := GREATEST(0, COALESCE(NEW.total_amount,0) - COALESCE(NEW.paid_amount,0));
  IF NEW.status NOT IN ('void','refunded') THEN
    IF NEW.balance_amount <= 0.01 AND COALESCE(NEW.paid_amount,0) > 0 THEN
      NEW.status := 'settled';
      IF NEW.settled_at IS NULL THEN NEW.settled_at := now(); END IF;
    ELSE
      NEW.status := 'open';
      NEW.settled_at := NULL;
    END IF;
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS folios_balance_before_write ON public.folios;
CREATE TRIGGER folios_balance_before_write
  BEFORE INSERT OR UPDATE OF total_amount, paid_amount ON public.folios
  FOR EACH ROW EXECUTE FUNCTION public.tg_folios_balance_before_write();
