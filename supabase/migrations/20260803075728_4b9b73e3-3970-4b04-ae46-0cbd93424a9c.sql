ALTER TABLE public.folios
  ADD COLUMN IF NOT EXISTS billing_guest_id uuid NULL REFERENCES public.guests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS folios_billing_guest_id_idx ON public.folios(billing_guest_id);