DO $mig$
DECLARE
  r RECORD;
  nq TEXT;
  nw TEXT;
  stmt TEXT;
  pat TEXT := 'has_permission\(auth\.uid\(\), ([a-zA-Z0-9_\.]+), (''[^'']*''::text), (''[^'']*''::text)\)';
  rep TEXT := '((SELECT public.is_superadmin(auth.uid())) OR (\1 IS NOT NULL AND (SELECT public.is_global_owner(auth.uid()))) OR (\1 IN (SELECT public.permitted_property_ids(auth.uid(), \2, \3))))';
  cnt INT := 0;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual,'') ~ '(^|[^(])has_permission\('
         OR coalesce(with_check,'') ~ '(^|[^(])has_permission\(')
  LOOP
    nq := CASE WHEN r.qual IS NULL THEN NULL ELSE regexp_replace(r.qual, pat, rep, 'g') END;
    nw := CASE WHEN r.with_check IS NULL THEN NULL ELSE regexp_replace(r.with_check, pat, rep, 'g') END;

    IF coalesce(nq,'') ~ '(^|[^(])has_permission\(' OR coalesce(nw,'') ~ '(^|[^(])has_permission\(' THEN
      RAISE EXCEPTION 'Unrewritten has_permission remains in %.%', r.tablename, r.policyname;
    END IF;

    stmt := format('ALTER POLICY %I ON public.%I', r.policyname, r.tablename);
    IF nq IS NOT NULL THEN stmt := stmt || format(' USING (%s)', nq); END IF;
    IF nw IS NOT NULL THEN stmt := stmt || format(' WITH CHECK (%s)', nw); END IF;
    EXECUTE stmt;
    cnt := cnt + 1;
  END LOOP;

  RAISE NOTICE 'Rewrote % policies', cnt;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual,'') ~ '(^|[^(])has_permission\('
         OR coalesce(with_check,'') ~ '(^|[^(])has_permission\(')
  ) THEN
    RAISE EXCEPTION 'Unwrapped has_permission calls still present after batch 7';
  END IF;
END
$mig$;