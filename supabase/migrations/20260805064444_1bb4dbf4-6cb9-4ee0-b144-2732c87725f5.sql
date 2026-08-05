-- 1. guests.guest_type
ALTER TABLE public.guests
  ADD COLUMN IF NOT EXISTS guest_type text NOT NULL DEFAULT 'regular';

ALTER TABLE public.guests
  DROP CONSTRAINT IF EXISTS guests_guest_type_check;
ALTER TABLE public.guests
  ADD CONSTRAINT guests_guest_type_check CHECK (guest_type IN ('regular','corporate'));

UPDATE public.guests
   SET guest_type = 'corporate'
 WHERE guest_type <> 'corporate'
   AND tags IS NOT NULL
   AND EXISTS (
     SELECT 1 FROM unnest(tags) t WHERE lower(btrim(t)) = 'corporate'
   );

CREATE INDEX IF NOT EXISTS idx_guests_guest_type ON public.guests (property_id, guest_type);

-- 2. tariff_plans.plan_type
ALTER TABLE public.tariff_plans
  ADD COLUMN IF NOT EXISTS plan_type text;

ALTER TABLE public.tariff_plans
  DROP CONSTRAINT IF EXISTS tariff_plans_plan_type_check;
ALTER TABLE public.tariff_plans
  ADD CONSTRAINT tariff_plans_plan_type_check CHECK (plan_type IS NULL OR plan_type IN ('regular','corporate'));

UPDATE public.tariff_plans
   SET plan_type = CASE WHEN lower(btrim(name)) = 'corporate' THEN 'corporate' ELSE 'regular' END
 WHERE plan_type IS NULL;

-- 3. Auto-mark the primary guest as corporate whenever a booking room is
--    created or re-tariffed onto a corporate plan (covers create_booking,
--    booking edit and room shift in one place).
CREATE OR REPLACE FUNCTION public.tg_booking_room_sync_guest_type()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $fn$
DECLARE
  _is_corp boolean;
BEGIN
  IF NEW.tariff_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT (lower(COALESCE(tp.plan_type, '')) = 'corporate')
    INTO _is_corp
    FROM public.tariff_plans tp
   WHERE tp.id = NEW.tariff_id;

  IF COALESCE(_is_corp, false) THEN
    UPDATE public.guests gg
       SET guest_type = 'corporate'
      FROM public.bookings b
     WHERE b.id = NEW.booking_id
       AND gg.id = b.guest_id
       AND gg.guest_type <> 'corporate';
  END IF;

  RETURN NEW;
END $fn$;

DROP TRIGGER IF EXISTS trg_booking_room_sync_guest_type ON public.booking_rooms;
CREATE TRIGGER trg_booking_room_sync_guest_type
AFTER INSERT OR UPDATE OF tariff_id ON public.booking_rooms
FOR EACH ROW EXECUTE FUNCTION public.tg_booking_room_sync_guest_type();

-- 4. create_booking: stop wiping guests.tags when the payload omits them.
DO $do$
DECLARE
  _def   text;
  _old   text := $q$      tags = COALESCE(
        (SELECT array_agg(x)::text[] FROM jsonb_array_elements_text(COALESCE(g->'tags','[]'::jsonb)) x),
        '{}'::text[]
      )$q$;
  _new   text := $q$      tags = CASE
        WHEN g ? 'tags' AND jsonb_typeof(g->'tags') = 'array'
          THEN COALESCE((SELECT array_agg(x)::text[] FROM jsonb_array_elements_text(g->'tags') x), '{}'::text[])
        ELSE tags
      END$q$;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'create_booking';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'create_booking not found';
  END IF;

  IF position(_old in _def) = 0 THEN
    RAISE NOTICE 'create_booking tags block not found - skipping (already patched?)';
    RETURN;
  END IF;

  _def := replace(_def, _old, _new);
  EXECUTE _def;
END $do$;