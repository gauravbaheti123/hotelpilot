
CREATE TABLE IF NOT EXISTS public.user_totp_secrets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE,
  secret_encrypted text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  last_verified_at timestamptz,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.user_totp_secrets TO authenticated;
GRANT ALL ON public.user_totp_secrets TO service_role;

ALTER TABLE public.user_totp_secrets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "superadmin_all_totp"
  ON public.user_totp_secrets FOR ALL
  USING (public.is_superadmin(auth.uid()))
  WITH CHECK (public.is_superadmin(auth.uid()));

CREATE TRIGGER trg_user_totp_secrets_updated_at
  BEFORE UPDATE ON public.user_totp_secrets
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Lets the current signed-in user check whether their own account
-- requires TOTP at login. Returns bool only, never the secret.
CREATE OR REPLACE FUNCTION public.current_user_totp_required()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_totp_secrets
     WHERE user_id = auth.uid() AND enabled = true
  )
$$;

REVOKE ALL ON FUNCTION public.current_user_totp_required() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.current_user_totp_required() TO authenticated;
