-- F1: Room shift rate tracking
ALTER TABLE public.room_shifts ADD COLUMN IF NOT EXISTS rate_applied numeric(10,2);
ALTER TABLE public.room_shifts ADD COLUMN IF NOT EXISTS rate_type varchar(20) DEFAULT 'new_rate';

-- Backfill from existing tariff_choice / new_rate
UPDATE public.room_shifts
   SET rate_applied = COALESCE(rate_applied, new_rate),
       rate_type = COALESCE(rate_type,
         CASE WHEN tariff_choice = 'keep' THEN 'original_rate' ELSE 'new_rate' END)
 WHERE rate_applied IS NULL OR rate_type IS NULL;

-- F5: Remove security_wipe permission entries (UI feature retired)
DELETE FROM public.role_permissions
 WHERE permission_id IN (SELECT id FROM public.permissions WHERE module = 'security_wipe');
DELETE FROM public.permissions WHERE module = 'security_wipe';