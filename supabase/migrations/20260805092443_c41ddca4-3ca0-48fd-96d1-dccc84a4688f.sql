CREATE TABLE public.room_status_color_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  status text NOT NULL CHECK (status IN ('vacant','occupied','dirty','maintenance','overdue','event','event_in')),
  bg_color text,
  fg_color text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (property_id, status)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.room_status_color_settings TO authenticated;
GRANT ALL ON public.room_status_color_settings TO service_role;

ALTER TABLE public.room_status_color_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rscs_select" ON public.room_status_color_settings
  FOR SELECT TO authenticated
  USING (public.has_permission(auth.uid(), property_id, 'dashboard', 'view')
      OR public.can_manage_masters(auth.uid(), property_id)
      OR public.is_owner_or_super(auth.uid()));

CREATE POLICY "rscs_insert" ON public.room_status_color_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.can_manage_masters(auth.uid(), property_id) OR public.is_owner_or_super(auth.uid()));

CREATE POLICY "rscs_update" ON public.room_status_color_settings
  FOR UPDATE TO authenticated
  USING (public.can_manage_masters(auth.uid(), property_id) OR public.is_owner_or_super(auth.uid()))
  WITH CHECK (public.can_manage_masters(auth.uid(), property_id) OR public.is_owner_or_super(auth.uid()));

CREATE POLICY "rscs_delete" ON public.room_status_color_settings
  FOR DELETE TO authenticated
  USING (public.can_manage_masters(auth.uid(), property_id) OR public.is_owner_or_super(auth.uid()));

CREATE TRIGGER trg_rscs_updated_at BEFORE UPDATE ON public.room_status_color_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();