CREATE TABLE IF NOT EXISTS public.activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id UUID REFERENCES public.properties(id) ON DELETE CASCADE,
  user_id UUID,
  user_name TEXT,
  action_type TEXT NOT NULL,
  module TEXT NOT NULL,
  reference_id UUID,
  reference_label TEXT,
  details JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.activity_log TO authenticated;
GRANT ALL ON public.activity_log TO service_role;

ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "activity_log tenant select" ON public.activity_log
  FOR SELECT TO authenticated
  USING (public.user_has_property(auth.uid(), property_id));

CREATE POLICY "activity_log tenant insert" ON public.activity_log
  FOR INSERT TO authenticated
  WITH CHECK (public.user_has_property(auth.uid(), property_id) AND user_id = auth.uid());

CREATE INDEX IF NOT EXISTS idx_activity_log_property
  ON public.activity_log(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_log_user
  ON public.activity_log(user_id, created_at DESC);