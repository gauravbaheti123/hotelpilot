ALTER TABLE public.user_roles ADD COLUMN IF NOT EXISTS property_id uuid REFERENCES public.properties(id) ON DELETE CASCADE;
ALTER TABLE public.user_roles DROP CONSTRAINT IF EXISTS user_roles_user_id_role_key;
CREATE UNIQUE INDEX IF NOT EXISTS user_roles_user_role_property_uk
  ON public.user_roles (user_id, role, COALESCE(property_id, '00000000-0000-0000-0000-000000000000'::uuid));