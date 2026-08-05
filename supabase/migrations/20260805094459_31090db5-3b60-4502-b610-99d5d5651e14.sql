CREATE TABLE public.sundry_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT sundry_categories_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT sundry_categories_property_name_key UNIQUE (property_id, name),
  CONSTRAINT sundry_categories_id_property_key UNIQUE (id, property_id)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sundry_categories TO authenticated;
GRANT ALL ON public.sundry_categories TO service_role;

ALTER TABLE public.sundry_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY sundry_categories_view ON public.sundry_categories
FOR SELECT TO authenticated
USING (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((property_id IS NOT NULL) AND (SELECT public.is_global_owner(auth.uid())))
  OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'master_data', 'view'))
  OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'pos', 'view'))
);

CREATE POLICY sundry_categories_create ON public.sundry_categories
FOR INSERT TO authenticated
WITH CHECK (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((property_id IS NOT NULL) AND (SELECT public.is_global_owner(auth.uid())))
  OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'master_data', 'create'))
);

CREATE POLICY sundry_categories_edit ON public.sundry_categories
FOR UPDATE TO authenticated
USING (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((property_id IS NOT NULL) AND (SELECT public.is_global_owner(auth.uid())))
  OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'master_data', 'edit'))
)
WITH CHECK (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((property_id IS NOT NULL) AND (SELECT public.is_global_owner(auth.uid())))
  OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'master_data', 'edit'))
);

CREATE POLICY sundry_categories_delete ON public.sundry_categories
FOR DELETE TO authenticated
USING (
  (SELECT public.is_superadmin(auth.uid()))
  OR ((property_id IS NOT NULL) AND (SELECT public.is_global_owner(auth.uid())))
  OR property_id IN (SELECT public.permitted_property_ids(auth.uid(), 'master_data', 'delete'))
);

CREATE TRIGGER sundry_categories_set_updated_at
BEFORE UPDATE ON public.sundry_categories
FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

INSERT INTO public.sundry_categories (property_id, name, is_active)
SELECT property_id, name, is_active
FROM public.pos_categories
ON CONFLICT (property_id, name) DO UPDATE SET is_active = EXCLUDED.is_active;

INSERT INTO public.sundry_categories (property_id, name, is_active)
SELECT p.id, d.name, true
FROM public.properties p
CROSS JOIN (VALUES
  ('Business centre'),
  ('Damage'),
  ('Laundry'),
  ('Mini-bar'),
  ('Other'),
  ('Spa & Wellness'),
  ('Telephone'),
  ('Transport / Cab')
) AS d(name)
ON CONFLICT (property_id, name) DO NOTHING;

INSERT INTO public.sundry_categories (property_id, name, is_active)
SELECT DISTINCT si.property_id,
  CASE si.category
    WHEN 'mini_bar' THEN 'Mini-bar'
    WHEN 'laundry' THEN 'Laundry'
    WHEN 'spa' THEN 'Spa & Wellness'
    WHEN 'transport' THEN 'Transport / Cab'
    WHEN 'telephone' THEN 'Telephone'
    WHEN 'business' THEN 'Business centre'
    WHEN 'damage' THEN 'Damage'
    WHEN 'other' THEN 'Other'
    ELSE si.category
  END,
  true
FROM public.sundry_items si
WHERE NULLIF(btrim(si.category), '') IS NOT NULL
ON CONFLICT (property_id, name) DO NOTHING;

ALTER TABLE public.sundry_items DROP CONSTRAINT IF EXISTS sundry_items_category_chk;
ALTER TABLE public.sundry_items ADD COLUMN category_id uuid;

UPDATE public.sundry_items si
SET category_id = sc.id,
    category = sc.name
FROM public.sundry_categories sc
WHERE sc.property_id = si.property_id
  AND sc.name = CASE si.category
    WHEN 'mini_bar' THEN 'Mini-bar'
    WHEN 'laundry' THEN 'Laundry'
    WHEN 'spa' THEN 'Spa & Wellness'
    WHEN 'transport' THEN 'Transport / Cab'
    WHEN 'telephone' THEN 'Telephone'
    WHEN 'business' THEN 'Business centre'
    WHEN 'damage' THEN 'Damage'
    WHEN 'other' THEN 'Other'
    ELSE si.category
  END;

ALTER TABLE public.sundry_items ALTER COLUMN category DROP DEFAULT;
ALTER TABLE public.sundry_items ALTER COLUMN category_id SET NOT NULL;
ALTER TABLE public.sundry_items
  ADD CONSTRAINT sundry_items_category_property_fkey
  FOREIGN KEY (category_id, property_id)
  REFERENCES public.sundry_categories(id, property_id)
  ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE INDEX sundry_items_category_id_idx ON public.sundry_items(category_id);

CREATE OR REPLACE FUNCTION public.sync_sundry_item_category()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  resolved public.sundry_categories%ROWTYPE;
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT * INTO resolved
    FROM public.sundry_categories
    WHERE id = NEW.category_id AND property_id = NEW.property_id;
  ELSIF NULLIF(btrim(NEW.category), '') IS NOT NULL THEN
    SELECT * INTO resolved
    FROM public.sundry_categories
    WHERE property_id = NEW.property_id
      AND lower(name) = lower(btrim(NEW.category));
  END IF;

  IF resolved.id IS NULL THEN
    RAISE EXCEPTION 'Choose a valid Sundry / POS category for this property' USING ERRCODE = '23503';
  END IF;

  NEW.category_id := resolved.id;
  NEW.category := resolved.name;
  RETURN NEW;
END;
$$;

CREATE TRIGGER sundry_items_sync_category
BEFORE INSERT OR UPDATE OF category_id, category, property_id ON public.sundry_items
FOR EACH ROW EXECUTE FUNCTION public.sync_sundry_item_category();