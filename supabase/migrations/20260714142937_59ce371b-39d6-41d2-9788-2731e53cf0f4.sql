
CREATE OR REPLACE FUNCTION public.seed_payment_methods_for_property()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.payment_methods (property_id, name, is_default, is_active, display_order) VALUES
    (NEW.id, 'cash', true, true, 1),
    (NEW.id, 'card', true, true, 2),
    (NEW.id, 'upi',  true, true, 3)
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END $$;
