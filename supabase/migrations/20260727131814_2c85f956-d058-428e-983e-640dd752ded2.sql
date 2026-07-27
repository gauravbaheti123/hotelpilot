
INSERT INTO public.pos_categories (property_id, name, is_active)
SELECT p.id, cat.name, TRUE
FROM public.properties p
CROSS JOIN (VALUES
  ('Mini-bar'),
  ('Spa & Wellness'),
  ('Transport / Cab'),
  ('Telephone'),
  ('Business centre')
) AS cat(name)
WHERE NOT EXISTS (
  SELECT 1 FROM public.pos_categories pc
  WHERE pc.property_id = p.id AND LOWER(pc.name) = LOWER(cat.name)
);
