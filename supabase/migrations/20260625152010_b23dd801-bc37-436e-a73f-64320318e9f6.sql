ALTER TABLE public.guests ADD COLUMN IF NOT EXISTS created_by UUID REFERENCES public.profiles(id);
NOTIFY pgrst, 'reload schema';