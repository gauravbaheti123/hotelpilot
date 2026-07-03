
CREATE TABLE IF NOT EXISTS public.property_settings (
  property_id uuid PRIMARY KEY REFERENCES public.properties(id) ON DELETE CASCADE,
  room_grouping text NOT NULL DEFAULT 'category' CHECK (room_grouping IN ('category','floor')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.property_settings TO authenticated;
GRANT ALL ON public.property_settings TO service_role;

ALTER TABLE public.property_settings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "property_settings_select" ON public.property_settings
  FOR SELECT TO authenticated
  USING (public.user_has_property(auth.uid(), property_id));

CREATE POLICY "property_settings_upsert" ON public.property_settings
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_property(auth.uid(), property_id));

CREATE POLICY "property_settings_update" ON public.property_settings
  FOR UPDATE TO authenticated
  USING (public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.user_has_property(auth.uid(), property_id));

CREATE TRIGGER trg_property_settings_updated
  BEFORE UPDATE ON public.property_settings
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();
