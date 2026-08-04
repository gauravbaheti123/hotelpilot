ALTER TABLE public.kot_orders ALTER COLUMN voided_at SET DEFAULT NULL;

CREATE OR REPLACE FUNCTION public.tg_force_server_time_kot()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'void' AND (OLD.status IS DISTINCT FROM 'void') THEN
    NEW.voided_at := now();
  ELSIF NEW.status <> 'void' THEN
    NEW.voided_at := OLD.voided_at;
  ELSIF NEW.voided_at IS DISTINCT FROM OLD.voided_at THEN
    NEW.voided_at := OLD.voided_at;
  END IF;

  IF NEW.printed_at IS DISTINCT FROM OLD.printed_at AND NEW.printed_at IS NOT NULL THEN
    NEW.printed_at := now();
  END IF;
  IF NEW.served_at IS DISTINCT FROM OLD.served_at AND NEW.served_at IS NOT NULL THEN
    NEW.served_at := now();
  END IF;
  IF NEW.billed_at IS DISTINCT FROM OLD.billed_at AND NEW.billed_at IS NOT NULL THEN
    NEW.billed_at := now();
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_force_server_time_kot ON public.kot_orders;
CREATE TRIGGER trg_force_server_time_kot
BEFORE UPDATE ON public.kot_orders
FOR EACH ROW EXECUTE FUNCTION public.tg_force_server_time_kot();