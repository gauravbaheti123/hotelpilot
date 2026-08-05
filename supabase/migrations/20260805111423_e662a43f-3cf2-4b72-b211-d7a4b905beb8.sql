ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS id_document_back_url text,
  ADD COLUMN IF NOT EXISTS id_document_back_name text,
  ADD COLUMN IF NOT EXISTS id_document_back_uploaded_at timestamptz;

ALTER TABLE public.guest_documents
  ADD COLUMN IF NOT EXISTS side text NOT NULL DEFAULT 'front';

UPDATE public.guest_documents SET side = 'front' WHERE side IS NULL OR side NOT IN ('front','back');

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'guest_documents_side_chk'
  ) THEN
    ALTER TABLE public.guest_documents
      ADD CONSTRAINT guest_documents_side_chk CHECK (side IN ('front','back'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS guest_documents_guest_side_idx
  ON public.guest_documents (guest_id, side, uploaded_at DESC);