
CREATE TABLE public.guest_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  guest_name text,
  feedback_date date NOT NULL DEFAULT CURRENT_DATE,
  source text NOT NULL DEFAULT 'in_person',
  overall_rating int NOT NULL,
  cleanliness_rating int,
  service_rating int,
  food_rating int,
  value_rating int,
  would_recommend boolean,
  comments text,
  response_text text,
  responded_at timestamptz,
  responded_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'new',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT guest_feedback_overall_chk CHECK (overall_rating BETWEEN 1 AND 5),
  CONSTRAINT guest_feedback_clean_chk CHECK (cleanliness_rating IS NULL OR cleanliness_rating BETWEEN 1 AND 5),
  CONSTRAINT guest_feedback_service_chk CHECK (service_rating IS NULL OR service_rating BETWEEN 1 AND 5),
  CONSTRAINT guest_feedback_food_chk CHECK (food_rating IS NULL OR food_rating BETWEEN 1 AND 5),
  CONSTRAINT guest_feedback_value_chk CHECK (value_rating IS NULL OR value_rating BETWEEN 1 AND 5),
  CONSTRAINT guest_feedback_status_chk CHECK (status IN ('new','acknowledged','resolved'))
);

CREATE INDEX guest_feedback_property_idx ON public.guest_feedback(property_id, feedback_date DESC);
CREATE INDEX guest_feedback_booking_idx ON public.guest_feedback(booking_id);
CREATE INDEX guest_feedback_guest_idx ON public.guest_feedback(guest_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.guest_feedback TO authenticated;
GRANT ALL ON public.guest_feedback TO service_role;

ALTER TABLE public.guest_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "guest_feedback_select_front_desk"
  ON public.guest_feedback FOR SELECT TO authenticated
  USING (public.can_front_desk(auth.uid()));

CREATE POLICY "guest_feedback_insert_front_desk"
  ON public.guest_feedback FOR INSERT TO authenticated
  WITH CHECK (public.can_front_desk(auth.uid()));

CREATE POLICY "guest_feedback_update_managers"
  ON public.guest_feedback FOR UPDATE TO authenticated
  USING (public.can_manage_masters(auth.uid()))
  WITH CHECK (public.can_manage_masters(auth.uid()));

CREATE POLICY "guest_feedback_delete_managers"
  ON public.guest_feedback FOR DELETE TO authenticated
  USING (public.can_manage_masters(auth.uid()));

CREATE TRIGGER guest_feedback_set_updated_at
  BEFORE UPDATE ON public.guest_feedback
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
