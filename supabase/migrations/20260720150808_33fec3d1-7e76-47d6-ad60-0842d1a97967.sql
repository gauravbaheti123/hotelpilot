
-- Add discount limit type + fixed-amount cap on roles
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS max_discount_type text NOT NULL DEFAULT 'percentage'
    CHECK (max_discount_type IN ('percentage','fixed_amount','none'));

ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS max_discount_amount numeric(12,2) NOT NULL DEFAULT 0;

-- Effective discount limit for a user in a property.
-- Returns the most permissive of the user's roles (owner/superadmin => unlimited).
CREATE OR REPLACE FUNCTION public.user_discount_limit(_user_id uuid, _property_id uuid)
RETURNS TABLE(limit_type text, limit_value numeric, unlimited boolean)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_type text;
  v_value numeric;
BEGIN
  IF public.is_superadmin(_user_id) OR public.has_role(_user_id, 'owner'::app_role) THEN
    limit_type := 'percentage'; limit_value := 100; unlimited := true; RETURN NEXT; RETURN;
  END IF;

  -- Prefer the most permissive limit across all of the user's roles:
  --  * any percentage/fixed_amount role beats 'none'
  --  * among percentage roles, highest percent wins
  --  * among fixed_amount roles, highest rupee value wins
  --  * if both types exist we return the percentage row (percent is generally more useful);
  --    UI enforces both, so callers can also read raw rows if needed.
  SELECT r.max_discount_type,
         CASE r.max_discount_type
           WHEN 'percentage'   THEN COALESCE(r.max_discount_pct, 0)
           WHEN 'fixed_amount' THEN COALESCE(r.max_discount_amount, 0)
           ELSE 0
         END
    INTO v_type, v_value
    FROM public.user_roles ur
    JOIN public.roles r ON r.id = ur.role_id
   WHERE ur.user_id = _user_id
     AND (ur.property_id = _property_id OR ur.property_id IS NULL)
     AND r.max_discount_type <> 'none'
   ORDER BY
     CASE r.max_discount_type WHEN 'percentage' THEN 0 ELSE 1 END,
     CASE r.max_discount_type
       WHEN 'percentage'   THEN COALESCE(r.max_discount_pct, 0)
       WHEN 'fixed_amount' THEN COALESCE(r.max_discount_amount, 0)
       ELSE 0
     END DESC
   LIMIT 1;

  IF v_type IS NULL THEN
    -- Every role for the user is 'none' (or user has no roles here).
    limit_type := 'none'; limit_value := 0; unlimited := false; RETURN NEXT; RETURN;
  END IF;

  limit_type := v_type; limit_value := COALESCE(v_value, 0); unlimited := false;
  RETURN NEXT;
END $$;

REVOKE EXECUTE ON FUNCTION public.user_discount_limit(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.user_discount_limit(uuid, uuid) TO authenticated, service_role;

-- Keep the legacy % helper in sync with the new type so old call sites keep working.
CREATE OR REPLACE FUNCTION public.user_max_discount_pct(_user_id uuid, _property_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN public.is_superadmin(_user_id) THEN 100
    WHEN public.has_role(_user_id, 'owner'::app_role) THEN 100
    ELSE COALESCE((
      SELECT MAX(r.max_discount_pct)
        FROM public.user_roles ur
        JOIN public.roles r ON r.id = ur.role_id
       WHERE ur.user_id = _user_id
         AND (ur.property_id = _property_id OR ur.property_id IS NULL)
         AND r.max_discount_type = 'percentage'
    ), 0)
  END
$$;
