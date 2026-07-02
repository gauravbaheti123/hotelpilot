
-- 1. Guests: split policies so DELETE (wipe) requires owner/manager, not any front-desk user
DROP POLICY IF EXISTS "front desk manage guests" ON public.guests;

CREATE POLICY "front desk read guests" ON public.guests
  FOR SELECT USING (public.can_front_desk(auth.uid(), property_id));

CREATE POLICY "front desk insert guests" ON public.guests
  FOR INSERT WITH CHECK (public.can_front_desk(auth.uid(), property_id));

CREATE POLICY "front desk update guests" ON public.guests
  FOR UPDATE USING (public.can_front_desk(auth.uid(), property_id))
              WITH CHECK (public.can_front_desk(auth.uid(), property_id));

CREATE POLICY "managers delete guests" ON public.guests
  FOR DELETE USING (public.can_manage_masters(auth.uid(), property_id));

-- 2. KOT delivery proofs: restrict UPDATE to managers/owners (match DELETE policy)
DROP POLICY IF EXISTS "kot_proofs_update" ON storage.objects;
CREATE POLICY "kot_proofs_update" ON storage.objects
  FOR UPDATE
  USING (bucket_id = 'kot-delivery-proofs'
         AND public.can_manage_masters(auth.uid(), (split_part(name, '/', 1))::uuid))
  WITH CHECK (bucket_id = 'kot-delivery-proofs'
              AND public.can_manage_masters(auth.uid(), (split_part(name, '/', 1))::uuid));

-- 3. Properties: drop redundant superadmin SELECT policy (already covered by is_superadmin in linked_properties_select and "superadmin manage properties" ALL policy)
DROP POLICY IF EXISTS "superadmin_all_properties" ON public.properties;
