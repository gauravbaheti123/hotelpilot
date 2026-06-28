
-- =========================================================
-- AUTH SECURITY: rate limiting, lockouts, audit, MFA-ready
-- =========================================================

-- 1) Login attempts log
CREATE TABLE IF NOT EXISTS public.auth_login_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email       text NOT NULL,
  success     boolean NOT NULL DEFAULT false,
  ip          text,
  user_agent  text,
  reason      text,
  attempted_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.auth_login_attempts TO authenticated;
GRANT ALL ON public.auth_login_attempts TO service_role;
ALTER TABLE public.auth_login_attempts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_attempts_super_read" ON public.auth_login_attempts;
CREATE POLICY "auth_attempts_super_read" ON public.auth_login_attempts
  FOR SELECT TO authenticated
  USING (public.is_owner_or_super(auth.uid()));
CREATE INDEX IF NOT EXISTS idx_login_attempts_email_time
  ON public.auth_login_attempts (lower(email), attempted_at DESC);

-- 2) Account lockouts
CREATE TABLE IF NOT EXISTS public.auth_lockouts (
  email          text PRIMARY KEY,
  failed_count   integer NOT NULL DEFAULT 0,
  last_failure_at timestamptz,
  locked_until   timestamptz,
  updated_at     timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.auth_lockouts TO authenticated;
GRANT ALL ON public.auth_lockouts TO service_role;
ALTER TABLE public.auth_lockouts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_lockouts_super_read" ON public.auth_lockouts;
CREATE POLICY "auth_lockouts_super_read" ON public.auth_lockouts
  FOR SELECT TO authenticated
  USING (public.is_owner_or_super(auth.uid()));

-- 3) Auth audit log (structured)
CREATE TABLE IF NOT EXISTS public.auth_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  email       text,
  event_type  text NOT NULL,
  ip          text,
  user_agent  text,
  metadata    jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT ON public.auth_audit_log TO authenticated;
GRANT ALL ON public.auth_audit_log TO service_role;
ALTER TABLE public.auth_audit_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "auth_audit_super_read" ON public.auth_audit_log;
CREATE POLICY "auth_audit_super_read" ON public.auth_audit_log
  FOR SELECT TO authenticated
  USING (public.is_owner_or_super(auth.uid()) OR user_id = auth.uid());
CREATE INDEX IF NOT EXISTS idx_auth_audit_user_time
  ON public.auth_audit_log (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_auth_audit_event_time
  ON public.auth_audit_log (event_type, created_at DESC);

-- 4) MFA settings (schema only — wiring deferred)
CREATE TABLE IF NOT EXISTS public.user_mfa_settings (
  user_id      uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  enabled      boolean NOT NULL DEFAULT false,
  factor_type  text NOT NULL DEFAULT 'totp',
  enrolled_at  timestamptz,
  last_used_at timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE ON public.user_mfa_settings TO authenticated;
GRANT ALL ON public.user_mfa_settings TO service_role;
ALTER TABLE public.user_mfa_settings ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mfa_self_read" ON public.user_mfa_settings;
CREATE POLICY "mfa_self_read" ON public.user_mfa_settings
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_owner_or_super(auth.uid()));
DROP POLICY IF EXISTS "mfa_self_upsert" ON public.user_mfa_settings;
CREATE POLICY "mfa_self_upsert" ON public.user_mfa_settings
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "mfa_self_update" ON public.user_mfa_settings;
CREATE POLICY "mfa_self_update" ON public.user_mfa_settings
  FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE TRIGGER trg_mfa_updated_at BEFORE UPDATE ON public.user_mfa_settings
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =========================================================
-- RPCs: callable by anon (login throttling) & authenticated
-- =========================================================

-- Configurable thresholds (constants inline)
--   MAX_FAILS_BEFORE_LOCK = 5
--   LOCK_DURATION = 15 minutes
--   WINDOW_FOR_RATE_LIMIT = 10 minutes
--   RATE_LIMIT_MAX_ATTEMPTS = 10 (within window)

CREATE OR REPLACE FUNCTION public.check_login_allowed(_email text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(_email));
  v_lock  public.auth_lockouts%ROWTYPE;
  v_recent int;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'invalid_email');
  END IF;

  SELECT * INTO v_lock FROM public.auth_lockouts WHERE email = v_email;
  IF v_lock.locked_until IS NOT NULL AND v_lock.locked_until > now() THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'reason', 'locked',
      'locked_until', v_lock.locked_until,
      'failed_count', v_lock.failed_count
    );
  END IF;

  -- Rate limit by recent attempts (window = 10 min, max = 10)
  SELECT count(*) INTO v_recent
    FROM public.auth_login_attempts
   WHERE lower(email) = v_email
     AND attempted_at > now() - interval '10 minutes';
  IF v_recent >= 10 THEN
    RETURN jsonb_build_object('allowed', false, 'reason', 'rate_limited', 'recent', v_recent);
  END IF;

  RETURN jsonb_build_object('allowed', true, 'failed_count', COALESCE(v_lock.failed_count, 0));
END $$;

REVOKE ALL ON FUNCTION public.check_login_allowed(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.check_login_allowed(text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.record_login_attempt(
  _email text, _success boolean, _ip text DEFAULT NULL, _user_agent text DEFAULT NULL, _reason text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(btrim(_email));
  v_new_count int;
  v_lock_until timestamptz;
BEGIN
  IF v_email IS NULL OR v_email = '' THEN
    RETURN jsonb_build_object('ok', false, 'reason', 'invalid_email');
  END IF;

  INSERT INTO public.auth_login_attempts (email, success, ip, user_agent, reason)
  VALUES (v_email, COALESCE(_success, false), _ip, _user_agent, _reason);

  IF _success THEN
    -- reset lockout on success
    UPDATE public.auth_lockouts
       SET failed_count = 0, locked_until = NULL, updated_at = now()
     WHERE email = v_email;
    INSERT INTO public.auth_audit_log(email, event_type, ip, user_agent, metadata)
    VALUES (v_email, 'login_success', _ip, _user_agent, jsonb_build_object('reason', _reason));
    RETURN jsonb_build_object('ok', true);
  END IF;

  -- failure path
  INSERT INTO public.auth_lockouts AS l (email, failed_count, last_failure_at, updated_at)
    VALUES (v_email, 1, now(), now())
    ON CONFLICT (email) DO UPDATE
      SET failed_count = l.failed_count + 1,
          last_failure_at = now(),
          updated_at = now()
    RETURNING failed_count INTO v_new_count;

  IF v_new_count >= 5 THEN
    v_lock_until := now() + interval '15 minutes';
    UPDATE public.auth_lockouts
       SET locked_until = v_lock_until, updated_at = now()
     WHERE email = v_email;
    INSERT INTO public.auth_audit_log(email, event_type, ip, user_agent, metadata)
    VALUES (v_email, 'account_locked', _ip, _user_agent,
            jsonb_build_object('failed_count', v_new_count, 'locked_until', v_lock_until));
  ELSE
    INSERT INTO public.auth_audit_log(email, event_type, ip, user_agent, metadata)
    VALUES (v_email, 'login_failure', _ip, _user_agent,
            jsonb_build_object('failed_count', v_new_count, 'reason', _reason));
  END IF;

  RETURN jsonb_build_object('ok', true, 'failed_count', v_new_count, 'locked_until', v_lock_until);
END $$;

REVOKE ALL ON FUNCTION public.record_login_attempt(text, boolean, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.record_login_attempt(text, boolean, text, text, text) TO anon, authenticated;

CREATE OR REPLACE FUNCTION public.log_auth_event(
  _event_type text, _metadata jsonb DEFAULT '{}'::jsonb, _ip text DEFAULT NULL, _user_agent text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_id uuid; v_email text;
BEGIN
  IF _event_type IS NULL OR length(btrim(_event_type)) = 0 THEN
    RAISE EXCEPTION 'event_type required';
  END IF;
  SELECT email INTO v_email FROM auth.users WHERE id = auth.uid();
  INSERT INTO public.auth_audit_log(user_id, email, event_type, ip, user_agent, metadata)
  VALUES (auth.uid(), v_email, _event_type, _ip, _user_agent, COALESCE(_metadata, '{}'::jsonb))
  RETURNING id INTO v_id;
  RETURN v_id;
END $$;

REVOKE ALL ON FUNCTION public.log_auth_event(text, jsonb, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.log_auth_event(text, jsonb, text, text) TO authenticated;
