CREATE POLICY "owners read archive bucket"
ON storage.objects FOR SELECT
TO authenticated
USING (bucket_id = 'archive' AND public.is_owner_or_super(auth.uid()));