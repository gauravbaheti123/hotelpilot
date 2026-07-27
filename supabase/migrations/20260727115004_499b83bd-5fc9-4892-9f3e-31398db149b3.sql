CREATE TABLE public.client_error_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID,
  user_email TEXT,
  property_id UUID,
  route TEXT,
  message TEXT,
  stack TEXT,
  component_stack TEXT,
  user_agent TEXT,
  extra JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT ON public.client_error_log TO authenticated;
GRANT ALL ON public.client_error_log TO service_role;

CREATE INDEX client_error_log_created_at_idx ON public.client_error_log (created_at DESC);
CREATE INDEX client_error_log_property_idx ON public.client_error_log (property_id, created_at DESC);

ALTER TABLE public.client_error_log ENABLE ROW LEVEL SECURITY;

-- Anyone signed in can insert; user_id (nullable) must match auth.uid() when provided
CREATE POLICY "Authenticated users can log their own client errors"
  ON public.client_error_log
  FOR INSERT
  TO authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

-- Only owners/superadmins can read
CREATE POLICY "Owners and superadmins can view client error logs"
  ON public.client_error_log
  FOR SELECT
  TO authenticated
  USING (
    public.has_role(auth.uid(), 'superadmin'::app_role)
    OR public.has_role(auth.uid(), 'owner'::app_role)
  );