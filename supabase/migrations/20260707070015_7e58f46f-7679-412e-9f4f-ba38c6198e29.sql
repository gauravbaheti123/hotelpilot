
-- 1) activity_log: prevent forged attribution by overwriting client-supplied user_id/user_name via trigger
CREATE OR REPLACE FUNCTION public.tg_activity_log_set_actor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE v_name text; v_email text;
BEGIN
  NEW.user_id := auth.uid();
  SELECT COALESCE(NULLIF(p.name, ''), p.email), p.email
    INTO v_name, v_email
    FROM public.profiles p
   WHERE p.id = auth.uid();
  NEW.user_name := COALESCE(v_name, v_email, 'unknown');
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS activity_log_set_actor ON public.activity_log;
CREATE TRIGGER activity_log_set_actor
  BEFORE INSERT OR UPDATE ON public.activity_log
  FOR EACH ROW EXECUTE FUNCTION public.tg_activity_log_set_actor();

-- 2) roles: restrict global role template visibility to admins/owners/superadmins
DROP POLICY IF EXISTS roles_read_authenticated ON public.roles;
CREATE POLICY roles_read_authenticated ON public.roles
FOR SELECT
TO authenticated
USING (
  is_superadmin(auth.uid())
  OR is_owner_or_super(auth.uid())
  OR (property_id IS NOT NULL AND user_has_property(auth.uid(), property_id))
);
