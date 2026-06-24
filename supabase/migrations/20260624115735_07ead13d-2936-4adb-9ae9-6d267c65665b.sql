
CREATE TABLE public.rate_seasons (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  season_type text NOT NULL DEFAULT 'normal',
  start_date date NOT NULL,
  end_date date NOT NULL,
  multiplier numeric(6,3) NOT NULL DEFAULT 1.000,
  priority int NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#3b82f6',
  is_active boolean NOT NULL DEFAULT true,
  applies_to_category_id uuid REFERENCES public.room_categories(id) ON DELETE CASCADE,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rate_seasons_dates_chk CHECK (end_date >= start_date),
  CONSTRAINT rate_seasons_mult_chk CHECK (multiplier > 0 AND multiplier <= 10)
);

CREATE INDEX rate_seasons_property_idx ON public.rate_seasons(property_id);
CREATE INDEX rate_seasons_range_idx ON public.rate_seasons(property_id, start_date, end_date);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.rate_seasons TO authenticated;
GRANT ALL ON public.rate_seasons TO service_role;

ALTER TABLE public.rate_seasons ENABLE ROW LEVEL SECURITY;

CREATE POLICY "rate_seasons_select_front_desk"
  ON public.rate_seasons FOR SELECT TO authenticated
  USING (public.can_front_desk(auth.uid()));

CREATE POLICY "rate_seasons_write_masters"
  ON public.rate_seasons FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid()))
  WITH CHECK (public.can_manage_masters(auth.uid()));

CREATE TRIGGER rate_seasons_set_updated_at
  BEFORE UPDATE ON public.rate_seasons
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
