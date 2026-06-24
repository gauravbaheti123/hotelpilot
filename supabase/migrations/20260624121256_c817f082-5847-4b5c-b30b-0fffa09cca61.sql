
CREATE TABLE public.ota_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  code text NOT NULL,
  commission_pct numeric(5,2) NOT NULL DEFAULT 0,
  contact_email text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, code)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ota_channels TO authenticated;
GRANT ALL ON public.ota_channels TO service_role;
ALTER TABLE public.ota_channels ENABLE ROW LEVEL SECURITY;
CREATE POLICY "front_desk_view_channels" ON public.ota_channels FOR SELECT TO authenticated
  USING (public.can_front_desk(auth.uid()));
CREATE POLICY "managers_manage_channels" ON public.ota_channels FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid())) WITH CHECK (public.can_manage_masters(auth.uid()));
CREATE TRIGGER trg_ota_channels_updated BEFORE UPDATE ON public.ota_channels
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ota_channel_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  channel_id uuid NOT NULL REFERENCES public.ota_channels(id) ON DELETE CASCADE,
  category_id uuid REFERENCES public.room_categories(id) ON DELETE CASCADE,
  tariff_id uuid REFERENCES public.tariff_plans(id) ON DELETE SET NULL,
  ota_room_code text,
  ota_rate_code text,
  rate_offset_pct numeric(5,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ota_channel_mappings TO authenticated;
GRANT ALL ON public.ota_channel_mappings TO service_role;
ALTER TABLE public.ota_channel_mappings ENABLE ROW LEVEL SECURITY;
CREATE POLICY "front_desk_view_mappings" ON public.ota_channel_mappings FOR SELECT TO authenticated
  USING (public.can_front_desk(auth.uid()));
CREATE POLICY "managers_manage_mappings" ON public.ota_channel_mappings FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid())) WITH CHECK (public.can_manage_masters(auth.uid()));
CREATE TRIGGER trg_ota_mappings_updated BEFORE UPDATE ON public.ota_channel_mappings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.ota_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  channel_id uuid REFERENCES public.ota_channels(id) ON DELETE SET NULL,
  sync_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  message text,
  payload jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT ON public.ota_sync_logs TO authenticated;
GRANT ALL ON public.ota_sync_logs TO service_role;
ALTER TABLE public.ota_sync_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "front_desk_view_logs" ON public.ota_sync_logs FOR SELECT TO authenticated
  USING (public.can_front_desk(auth.uid()));
CREATE POLICY "front_desk_insert_logs" ON public.ota_sync_logs FOR INSERT TO authenticated
  WITH CHECK (public.can_front_desk(auth.uid()));
