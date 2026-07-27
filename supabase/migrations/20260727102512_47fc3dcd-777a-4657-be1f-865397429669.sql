-- Phase 3: Housekeeping room notes
CREATE TABLE IF NOT EXISTS public.housekeeping_room_notes (
  room_id uuid PRIMARY KEY REFERENCES public.rooms(id) ON DELETE CASCADE,
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  note text NOT NULL DEFAULT '',
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.housekeeping_room_notes TO authenticated;
GRANT ALL ON public.housekeeping_room_notes TO service_role;

ALTER TABLE public.housekeeping_room_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "hk_notes_select" ON public.housekeeping_room_notes
  FOR SELECT TO authenticated
  USING (public.user_has_property(auth.uid(), property_id));

CREATE POLICY "hk_notes_insert" ON public.housekeeping_room_notes
  FOR INSERT TO authenticated
  WITH CHECK (
    public.user_has_property(auth.uid(), property_id)
    AND public.has_permission(auth.uid(), property_id, 'housekeeping', 'edit')
  );

CREATE POLICY "hk_notes_update" ON public.housekeeping_room_notes
  FOR UPDATE TO authenticated
  USING (
    public.user_has_property(auth.uid(), property_id)
    AND public.has_permission(auth.uid(), property_id, 'housekeeping', 'edit')
  )
  WITH CHECK (
    public.user_has_property(auth.uid(), property_id)
    AND public.has_permission(auth.uid(), property_id, 'housekeeping', 'edit')
  );

CREATE POLICY "hk_notes_delete" ON public.housekeeping_room_notes
  FOR DELETE TO authenticated
  USING (
    public.user_has_property(auth.uid(), property_id)
    AND public.has_permission(auth.uid(), property_id, 'housekeeping', 'edit')
  );

CREATE TRIGGER trg_hk_notes_touch
  BEFORE UPDATE ON public.housekeeping_room_notes
  FOR EACH ROW EXECUTE FUNCTION public.tg_touch_updated_at();