ALTER TABLE public.room_shifts
  ADD COLUMN IF NOT EXISTS old_rate numeric(12,2),
  ADD COLUMN IF NOT EXISTS new_rate numeric(12,2),
  ADD COLUMN IF NOT EXISTS tariff_choice text;

ALTER TABLE public.room_shifts
  ADD CONSTRAINT room_shifts_tariff_choice_chk
  CHECK (tariff_choice IS NULL OR tariff_choice IN ('keep','new_standard','custom')) NOT VALID;
