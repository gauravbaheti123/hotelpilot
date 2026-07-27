
-- Phase 5.1: Shift Handover tables ------------------------------------------------

CREATE TABLE public.shift_handovers (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  property_id UUID NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  outgoing_user_id UUID NOT NULL,
  outgoing_user_name TEXT NOT NULL,
  incoming_user_id UUID,
  incoming_user_name TEXT,
  window_start TIMESTAMPTZ NOT NULL,
  window_end   TIMESTAMPTZ NOT NULL DEFAULT now(),
  total_system NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_manual NUMERIC(14,2) NOT NULL DEFAULT 0,
  total_difference NUMERIC(14,2) NOT NULL DEFAULT 0,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shift_handovers_property_created_idx ON public.shift_handovers (property_id, created_at DESC);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_handovers TO authenticated;
GRANT ALL ON public.shift_handovers TO service_role;
ALTER TABLE public.shift_handovers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_handovers_select" ON public.shift_handovers FOR SELECT TO authenticated
  USING (
    public.user_has_property(auth.uid(), property_id)
    AND (
      public.is_owner_or_super(auth.uid())
      OR outgoing_user_id = auth.uid()
      OR incoming_user_id = auth.uid()
      OR public.has_permission(auth.uid(), property_id, 'shift_handover', 'view')
    )
  );

CREATE POLICY "shift_handovers_insert" ON public.shift_handovers FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_property(auth.uid(), property_id)
    AND outgoing_user_id = auth.uid()
    AND (
      public.is_owner_or_super(auth.uid())
      OR public.has_permission(auth.uid(), property_id, 'shift_handover', 'create')
    )
  );

-- Immutable to regular roles; owner/superadmin may override (log via log_owner_override in app code)
CREATE POLICY "shift_handovers_update_owner" ON public.shift_handovers FOR UPDATE TO authenticated
  USING (public.is_owner_or_super(auth.uid()) AND public.user_has_property(auth.uid(), property_id))
  WITH CHECK (public.is_owner_or_super(auth.uid()) AND public.user_has_property(auth.uid(), property_id));

CREATE POLICY "shift_handovers_delete_owner" ON public.shift_handovers FOR DELETE TO authenticated
  USING (public.is_owner_or_super(auth.uid()) AND public.user_has_property(auth.uid(), property_id));

CREATE TRIGGER shift_handovers_touch_updated
  BEFORE UPDATE ON public.shift_handovers
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE public.shift_handover_lines (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  handover_id UUID NOT NULL REFERENCES public.shift_handovers(id) ON DELETE CASCADE,
  mode TEXT NOT NULL,
  system_total NUMERIC(14,2) NOT NULL DEFAULT 0,
  manual_entry NUMERIC(14,2) NOT NULL DEFAULT 0,
  difference   NUMERIC(14,2) NOT NULL DEFAULT 0,
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX shift_handover_lines_handover_idx ON public.shift_handover_lines (handover_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.shift_handover_lines TO authenticated;
GRANT ALL ON public.shift_handover_lines TO service_role;
ALTER TABLE public.shift_handover_lines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "shift_handover_lines_select" ON public.shift_handover_lines FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shift_handovers h
    WHERE h.id = shift_handover_lines.handover_id
      AND public.user_has_property(auth.uid(), h.property_id)
      AND (
        public.is_owner_or_super(auth.uid())
        OR h.outgoing_user_id = auth.uid()
        OR h.incoming_user_id = auth.uid()
        OR public.has_permission(auth.uid(), h.property_id, 'shift_handover', 'view')
      )
  ));

CREATE POLICY "shift_handover_lines_insert" ON public.shift_handover_lines FOR INSERT TO authenticated
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.shift_handovers h
    WHERE h.id = shift_handover_lines.handover_id
      AND h.outgoing_user_id = auth.uid()
      AND public.user_has_property(auth.uid(), h.property_id)
  ));

CREATE POLICY "shift_handover_lines_update_owner" ON public.shift_handover_lines FOR UPDATE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shift_handovers h WHERE h.id = shift_handover_lines.handover_id
      AND public.is_owner_or_super(auth.uid())
      AND public.user_has_property(auth.uid(), h.property_id)
  ))
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.shift_handovers h WHERE h.id = shift_handover_lines.handover_id
      AND public.is_owner_or_super(auth.uid())
      AND public.user_has_property(auth.uid(), h.property_id)
  ));

CREATE POLICY "shift_handover_lines_delete_owner" ON public.shift_handover_lines FOR DELETE TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.shift_handovers h WHERE h.id = shift_handover_lines.handover_id
      AND public.is_owner_or_super(auth.uid())
      AND public.user_has_property(auth.uid(), h.property_id)
  ));


-- Helper: last handover window start for a property (last created_at or start of today)
CREATE OR REPLACE FUNCTION public.last_handover_window_start(_property_id UUID)
RETURNS TIMESTAMPTZ
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    (SELECT MAX(created_at) FROM public.shift_handovers WHERE property_id = _property_id),
    date_trunc('day', now())
  );
$$;
GRANT EXECUTE ON FUNCTION public.last_handover_window_start(uuid) TO authenticated, service_role;


-- Permissions module + default Owner grants
INSERT INTO public.permissions (module, action) VALUES
  ('shift_handover', 'view'),
  ('shift_handover', 'create'),
  ('shift_handover', 'edit'),
  ('shift_handover', 'delete')
ON CONFLICT (module, action) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
CROSS JOIN public.permissions p
WHERE r.name = 'Owner' AND r.property_id IS NULL AND p.module = 'shift_handover'
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;

INSERT INTO public.role_permissions (role_id, permission_id, allowed)
SELECT r.id, p.id, true
FROM public.roles r
JOIN public.permissions p ON p.module = 'shift_handover' AND p.action IN ('view','create')
WHERE r.name = 'Manager' AND r.property_id IS NULL
ON CONFLICT (role_id, permission_id) DO UPDATE SET allowed = EXCLUDED.allowed;
