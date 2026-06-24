
CREATE OR REPLACE FUNCTION public.can_housekeeping(_user_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT public.has_role(_user_id,'superadmin'::app_role)
      OR public.has_role(_user_id,'owner'::app_role)
      OR public.has_role(_user_id,'manager'::app_role)
      OR public.has_role(_user_id,'receptionist'::app_role)
      OR public.has_role(_user_id,'housekeeping'::app_role)
$$;

CREATE TABLE public.housekeeping_tasks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  room_id uuid REFERENCES public.rooms(id) ON DELETE SET NULL,
  task_type text NOT NULL DEFAULT 'cleaning'
    CHECK (task_type IN ('cleaning','inspection','maintenance','laundry','other')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','in_progress','done','skipped')),
  priority text NOT NULL DEFAULT 'normal'
    CHECK (priority IN ('low','normal','high','urgent')),
  due_date date,
  assigned_to uuid REFERENCES public.staff(id) ON DELETE SET NULL,
  notes text,
  completed_at timestamp with time zone,
  completed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.housekeeping_tasks TO authenticated;
GRANT ALL ON public.housekeeping_tasks TO service_role;

ALTER TABLE public.housekeeping_tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Housekeeping read tasks" ON public.housekeeping_tasks
  FOR SELECT TO authenticated USING (public.can_housekeeping(auth.uid()));
CREATE POLICY "Housekeeping write tasks" ON public.housekeeping_tasks
  FOR INSERT TO authenticated WITH CHECK (public.can_housekeeping(auth.uid()));
CREATE POLICY "Housekeeping update tasks" ON public.housekeeping_tasks
  FOR UPDATE TO authenticated USING (public.can_housekeeping(auth.uid()))
  WITH CHECK (public.can_housekeeping(auth.uid()));
CREATE POLICY "Housekeeping delete tasks" ON public.housekeeping_tasks
  FOR DELETE TO authenticated USING (public.can_housekeeping(auth.uid()));

CREATE INDEX idx_hk_tasks_prop_status ON public.housekeeping_tasks (property_id, status, due_date);
CREATE INDEX idx_hk_tasks_room ON public.housekeeping_tasks (room_id);

CREATE TRIGGER trg_hk_tasks_updated
  BEFORE UPDATE ON public.housekeeping_tasks
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_updated_at();

-- Allow housekeeping users to update room status/HK status
CREATE POLICY "Housekeeping update rooms" ON public.rooms
  FOR UPDATE TO authenticated
  USING (public.can_housekeeping(auth.uid()))
  WITH CHECK (public.can_housekeeping(auth.uid()));
