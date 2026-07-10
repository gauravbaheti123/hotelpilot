
CREATE TABLE public.label_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  mrp numeric(12,2),
  batch_no text,
  ingredients text,
  fssai_no text,
  shelf_life_days integer NOT NULL DEFAULT 7,
  storage_instructions text,
  allergen_info text,
  net_weight text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX label_products_property_idx ON public.label_products(property_id, is_active);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_products TO authenticated;
GRANT ALL ON public.label_products TO service_role;
ALTER TABLE public.label_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "label_products_select" ON public.label_products FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'label_printing', 'view'));
CREATE POLICY "label_products_insert" ON public.label_products FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'label_printing', 'create'));
CREATE POLICY "label_products_update" ON public.label_products FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'label_printing', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'label_printing', 'edit'));
CREATE POLICY "label_products_delete" ON public.label_products FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'label_printing', 'delete'));

CREATE TRIGGER label_products_updated_at BEFORE UPDATE ON public.label_products
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.label_print_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES public.label_products(id) ON DELETE RESTRICT,
  quantity integer NOT NULL CHECK (quantity > 0),
  packed_on date NOT NULL DEFAULT CURRENT_DATE,
  expiry_on date NOT NULL,
  batch_no text,
  mrp numeric(12,2),
  notes text,
  printed_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX label_batches_property_date_idx ON public.label_print_batches(property_id, packed_on DESC);
CREATE INDEX label_batches_product_idx ON public.label_print_batches(product_id);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.label_print_batches TO authenticated;
GRANT ALL ON public.label_print_batches TO service_role;
ALTER TABLE public.label_print_batches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "label_batches_select" ON public.label_print_batches FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'label_printing', 'view'));
CREATE POLICY "label_batches_insert" ON public.label_print_batches FOR INSERT TO authenticated
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'label_printing', 'create'));
CREATE POLICY "label_batches_update" ON public.label_print_batches FOR UPDATE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'label_printing', 'edit'))
  WITH CHECK (public.has_permission(auth.uid(), property_id, 'label_printing', 'edit'));
CREATE POLICY "label_batches_delete" ON public.label_print_batches FOR DELETE TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'label_printing', 'delete'));

INSERT INTO public.permissions (module, action) VALUES
  ('label_printing', 'view'),
  ('label_printing', 'create'),
  ('label_printing', 'edit'),
  ('label_printing', 'delete')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'Owner' AND r.property_id IS NULL AND p.module = 'label_printing'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;

INSERT INTO public.roles (name, property_id, description)
SELECT 'Label Operator', NULL, 'Prints labels for packaged products'
WHERE NOT EXISTS (SELECT 1 FROM public.roles WHERE name = 'Label Operator' AND property_id IS NULL);

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p
  ON p.module = 'label_printing' AND p.action IN ('view','create')
WHERE r.name = 'Label Operator' AND r.property_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;
