
-- Read: any authenticated user with a role on that property
CREATE POLICY "hotel-assets read by property members"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'hotel-assets'
  AND public.user_has_property(auth.uid(), (split_part(name, '/', 1))::uuid)
);

-- Write/Update/Delete: only owner/manager/superadmin (can_manage_masters)
CREATE POLICY "hotel-assets insert by masters"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'hotel-assets'
  AND public.can_manage_masters(auth.uid())
  AND public.user_has_property(auth.uid(), (split_part(name, '/', 1))::uuid)
);

CREATE POLICY "hotel-assets update by masters"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'hotel-assets'
  AND public.can_manage_masters(auth.uid())
  AND public.user_has_property(auth.uid(), (split_part(name, '/', 1))::uuid)
);

CREATE POLICY "hotel-assets delete by masters"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'hotel-assets'
  AND public.can_manage_masters(auth.uid())
  AND public.user_has_property(auth.uid(), (split_part(name, '/', 1))::uuid)
);
