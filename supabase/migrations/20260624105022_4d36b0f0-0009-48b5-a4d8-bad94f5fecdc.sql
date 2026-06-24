
-- Helper: any staff-level role for master data writes
CREATE OR REPLACE FUNCTION public.can_manage_masters(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT public.has_role(_user_id, 'superadmin'::app_role)
      OR public.has_role(_user_id, 'owner'::app_role)
      OR public.has_role(_user_id, 'manager'::app_role)
$$;

-- =========================================================
-- ROOM CATEGORIES
-- =========================================================
CREATE TABLE public.room_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text,
  base_rate numeric NOT NULL DEFAULT 0,
  max_occupancy int NOT NULL DEFAULT 2,
  extra_bed_rate numeric NOT NULL DEFAULT 0,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_categories TO authenticated;
GRANT ALL ON public.room_categories TO service_role;
ALTER TABLE public.room_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view room_categories" ON public.room_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage room_categories" ON public.room_categories FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid())) WITH CHECK (public.can_manage_masters(auth.uid()));
CREATE TRIGGER trg_room_categories_updated BEFORE UPDATE ON public.room_categories
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- ROOMS
-- =========================================================
CREATE TYPE public.room_status AS ENUM ('vacant','occupied','blocked','maintenance');
CREATE TYPE public.housekeeping_status AS ENUM ('clean','dirty','inspected','out_of_order');

CREATE TABLE public.rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.room_categories(id) ON DELETE SET NULL,
  room_number text NOT NULL,
  floor text,
  status public.room_status NOT NULL DEFAULT 'vacant',
  housekeeping_status public.housekeeping_status NOT NULL DEFAULT 'clean',
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, room_number)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.rooms TO authenticated;
GRANT ALL ON public.rooms TO service_role;
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view rooms" ON public.rooms FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage rooms" ON public.rooms FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid())) WITH CHECK (public.can_manage_masters(auth.uid()));
CREATE TRIGGER trg_rooms_updated BEFORE UPDATE ON public.rooms
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- TARIFF PLANS
-- =========================================================
CREATE TYPE public.meal_plan AS ENUM ('EP','CP','MAP','AP');

CREATE TABLE public.tariff_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.room_categories(id) ON DELETE CASCADE,
  name text NOT NULL,
  meal_plan public.meal_plan NOT NULL DEFAULT 'EP',
  rate numeric NOT NULL DEFAULT 0,
  extra_adult_rate numeric NOT NULL DEFAULT 0,
  extra_child_rate numeric NOT NULL DEFAULT 0,
  valid_from date,
  valid_to date,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tariff_plans TO authenticated;
GRANT ALL ON public.tariff_plans TO service_role;
ALTER TABLE public.tariff_plans ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view tariff_plans" ON public.tariff_plans FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage tariff_plans" ON public.tariff_plans FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid())) WITH CHECK (public.can_manage_masters(auth.uid()));
CREATE TRIGGER trg_tariff_plans_updated BEFORE UPDATE ON public.tariff_plans
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- MENU
-- =========================================================
CREATE TYPE public.kot_type AS ENUM ('kitchen','bar','both');

CREATE TABLE public.menu_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  kot_type public.kot_type NOT NULL DEFAULT 'kitchen',
  sort_order int NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, name)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_categories TO authenticated;
GRANT ALL ON public.menu_categories TO service_role;
ALTER TABLE public.menu_categories ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view menu_categories" ON public.menu_categories FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage menu_categories" ON public.menu_categories FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid())) WITH CHECK (public.can_manage_masters(auth.uid()));
CREATE TRIGGER trg_menu_categories_updated BEFORE UPDATE ON public.menu_categories
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

CREATE TABLE public.menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.menu_categories(id) ON DELETE SET NULL,
  name text NOT NULL,
  code text,
  price numeric NOT NULL DEFAULT 0,
  gst_rate numeric NOT NULL DEFAULT 5,
  hsn_code text,
  is_veg boolean NOT NULL DEFAULT true,
  is_available boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.menu_items TO authenticated;
GRANT ALL ON public.menu_items TO service_role;
ALTER TABLE public.menu_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view menu_items" ON public.menu_items FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage menu_items" ON public.menu_items FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid())) WITH CHECK (public.can_manage_masters(auth.uid()));
CREATE TRIGGER trg_menu_items_updated BEFORE UPDATE ON public.menu_items
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- STAFF
-- =========================================================
CREATE TABLE public.staff (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  name text NOT NULL,
  mobile text,
  email text,
  designation text,
  department text,
  salary numeric DEFAULT 0,
  joining_date date,
  address text,
  id_proof text,
  photo_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff TO authenticated;
GRANT ALL ON public.staff TO service_role;
ALTER TABLE public.staff ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view staff" ON public.staff FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage staff" ON public.staff FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid())) WITH CHECK (public.can_manage_masters(auth.uid()));
CREATE TRIGGER trg_staff_updated BEFORE UPDATE ON public.staff
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- =========================================================
-- PRINTERS
-- =========================================================
CREATE TYPE public.printer_type AS ENUM ('kot','bill','both');

CREATE TABLE public.printers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  type public.printer_type NOT NULL DEFAULT 'bill',
  location text,
  ip_address text,
  port int DEFAULT 9100,
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.printers TO authenticated;
GRANT ALL ON public.printers TO service_role;
ALTER TABLE public.printers ENABLE ROW LEVEL SECURITY;
CREATE POLICY "view printers" ON public.printers FOR SELECT TO authenticated USING (true);
CREATE POLICY "manage printers" ON public.printers FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid())) WITH CHECK (public.can_manage_masters(auth.uid()));
CREATE TRIGGER trg_printers_updated BEFORE UPDATE ON public.printers
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
