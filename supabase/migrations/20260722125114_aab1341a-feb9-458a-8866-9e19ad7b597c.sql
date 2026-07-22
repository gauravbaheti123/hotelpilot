
CREATE TABLE public.label_nutrient_master (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  key text NOT NULL,
  label text NOT NULL,
  unit text,
  rda_reference numeric,
  default_show_rda boolean NOT NULL DEFAULT false,
  display_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_nutrient_master TO authenticated;
GRANT ALL ON public.label_nutrient_master TO service_role;

ALTER TABLE public.label_nutrient_master ENABLE ROW LEVEL SECURITY;

CREATE POLICY "label_nutrient_master_select" ON public.label_nutrient_master
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'label_printing', 'view'));

CREATE POLICY "label_nutrient_master_insert" ON public.label_nutrient_master
  FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'label_printing', 'edit'));

CREATE POLICY "label_nutrient_master_update" ON public.label_nutrient_master
  FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'label_printing', 'edit'));

CREATE POLICY "label_nutrient_master_delete" ON public.label_nutrient_master
  FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'label_printing', 'edit'));

CREATE TRIGGER trg_label_nutrient_master_updated_at
  BEFORE UPDATE ON public.label_nutrient_master
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Auto-propagate a newly inserted nutrient onto every existing product for the same property.
CREATE OR REPLACE FUNCTION public.propagate_new_nutrient_to_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.label_products
     SET nutrition_info = COALESCE(nutrition_info, '{}'::jsonb) || jsonb_build_object(
           NEW.key,
           jsonb_build_object('value', 0, 'show_rda', NEW.default_show_rda, 'rda_override', null)
         )
   WHERE property_id = NEW.property_id
     AND NOT (COALESCE(nutrition_info, '{}'::jsonb) ? NEW.key);
  RETURN NEW;
END $$;

CREATE TRIGGER trg_propagate_new_nutrient
  AFTER INSERT ON public.label_nutrient_master
  FOR EACH ROW EXECUTE FUNCTION public.propagate_new_nutrient_to_products();

-- Seed the existing 11 hardcoded nutrients for every property that already has label printing set up.
INSERT INTO public.label_nutrient_master (property_id, key, label, unit, rda_reference, default_show_rda, display_order)
SELECT p.id, x.key, x.label, x.unit, x.rda_reference, x.default_show_rda, x.display_order
  FROM public.properties p
  CROSS JOIN (VALUES
    ('energy_kcal',            'Energy (kcal)',                        'kcal', 2000::numeric, false, 1),
    ('total_fat_g',            'Total Fat (g)',                        'g',    67::numeric,   true,  2),
    ('saturated_fat_g',        'Saturated Fat (g)',                    'g',    22::numeric,   true,  3),
    ('trans_fat_g',            'Trans Fat (g)',                        'g',    2.2::numeric,  false, 4),
    ('cholesterol_mg',         'Cholesterol (mg)',                     'mg',   300::numeric,  true,  5),
    ('monounsaturated_fat_g',  'Monounsaturated Fatty Acids (g)',      'g',    20::numeric,   true,  6),
    ('polyunsaturated_fat_g',  'Polyunsaturated Fatty Acids (g)',      'g',    20::numeric,   true,  7),
    ('sodium_mg',              'Sodium (mg)',                          'mg',   2000::numeric, true,  8),
    ('carbohydrate_g',         'Carbohydrate (g)',                     'g',    300::numeric,  true,  9),
    ('total_sugars_g',         'Total Sugars (g)',                     'g',    50::numeric,   false, 10),
    ('protein_g',              'Protein (g)',                          'g',    50::numeric,   false, 11)
  ) AS x(key, label, unit, rda_reference, default_show_rda, display_order)
ON CONFLICT (property_id, key) DO NOTHING;
