
ALTER TABLE public.kot_orders
  ADD COLUMN IF NOT EXISTS delivery_proof_url TEXT,
  ADD COLUMN IF NOT EXISTS delivery_photo_taken_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS delivery_photo_taken_by UUID REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS require_delivery_proof BOOLEAN NOT NULL DEFAULT false;

DROP POLICY IF EXISTS "kot_proofs_select" ON storage.objects;
CREATE POLICY "kot_proofs_select" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'kot-delivery-proofs'
    AND public.user_has_property(auth.uid(), (split_part(name, '/', 1))::uuid)
  );

DROP POLICY IF EXISTS "kot_proofs_insert" ON storage.objects;
CREATE POLICY "kot_proofs_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'kot-delivery-proofs'
    AND public.can_food(auth.uid(), (split_part(name, '/', 1))::uuid)
  );

DROP POLICY IF EXISTS "kot_proofs_update" ON storage.objects;
CREATE POLICY "kot_proofs_update" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'kot-delivery-proofs'
    AND public.can_food(auth.uid(), (split_part(name, '/', 1))::uuid)
  );

DROP POLICY IF EXISTS "kot_proofs_delete" ON storage.objects;
CREATE POLICY "kot_proofs_delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'kot-delivery-proofs'
    AND public.can_manage_masters(auth.uid(), (split_part(name, '/', 1))::uuid)
  );
