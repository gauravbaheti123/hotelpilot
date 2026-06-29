
-- 1) Drop single-arg role helpers (no longer used by policies)
DROP FUNCTION IF EXISTS public.can_front_desk(uuid);
DROP FUNCTION IF EXISTS public.can_food(uuid);
DROP FUNCTION IF EXISTS public.can_billing(uuid);
DROP FUNCTION IF EXISTS public.can_manage_masters(uuid);
DROP FUNCTION IF EXISTS public.can_housekeeping(uuid);

-- 2) Tighten two-arg role helpers: remove "OR property_id IS NULL" branch.
-- Superadmins are still allowed via is_superadmin() short-circuit.
CREATE OR REPLACE FUNCTION public.can_manage_masters(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_superadmin(_user_id) OR (
    _property_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND property_id = _property_id
         AND role IN ('owner','manager')
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_billing(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_superadmin(_user_id) OR (
    _property_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND property_id = _property_id
         AND role IN ('owner','manager','receptionist')
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_front_desk(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_superadmin(_user_id) OR (
    _property_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND property_id = _property_id
         AND role IN ('owner','manager','receptionist')
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_food(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_superadmin(_user_id) OR (
    _property_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND property_id = _property_id
         AND role IN ('owner','manager','receptionist','kitchen')
    )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_housekeeping(_user_id uuid, _property_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public' AS $$
  SELECT public.is_superadmin(_user_id) OR (
    _property_id IS NOT NULL AND EXISTS (
      SELECT 1 FROM public.user_roles
       WHERE user_id = _user_id
         AND property_id = _property_id
         AND role IN ('owner','manager','receptionist','housekeeping')
    )
  )
$$;

-- 3) Allow kitchen staff (can_food) to read menu_categories and menu_items
CREATE POLICY "food role read menu_categories"
  ON public.menu_categories FOR SELECT TO authenticated
  USING (public.can_food(auth.uid(), property_id));

CREATE POLICY "food role read menu_items"
  ON public.menu_items FOR SELECT TO authenticated
  USING (public.can_food(auth.uid(), property_id));

-- 4) Restrict permissions catalogue read to users with at least one property
DROP POLICY IF EXISTS permissions_read_all_authenticated ON public.permissions;
CREATE POLICY "permissions read for property members"
  ON public.permissions FOR SELECT TO authenticated
  USING (public.is_superadmin(auth.uid()) OR EXISTS (
    SELECT 1 FROM public.user_roles WHERE user_id = auth.uid() AND property_id IS NOT NULL
  ));
