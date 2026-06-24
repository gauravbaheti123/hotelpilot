
CREATE TABLE public.message_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  name text NOT NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  subject text,
  body text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT message_templates_channel_chk CHECK (channel IN ('sms','whatsapp','email','call','in_app'))
);
CREATE INDEX message_templates_property_idx ON public.message_templates(property_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.message_templates TO authenticated;
GRANT ALL ON public.message_templates TO service_role;

ALTER TABLE public.message_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "message_templates_select" ON public.message_templates
  FOR SELECT TO authenticated USING (public.can_front_desk(auth.uid()));
CREATE POLICY "message_templates_write" ON public.message_templates
  FOR ALL TO authenticated
  USING (public.can_manage_masters(auth.uid()))
  WITH CHECK (public.can_manage_masters(auth.uid()));

CREATE TRIGGER message_templates_set_updated_at
  BEFORE UPDATE ON public.message_templates
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


CREATE TABLE public.communications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.message_templates(id) ON DELETE SET NULL,
  channel text NOT NULL DEFAULT 'whatsapp',
  direction text NOT NULL DEFAULT 'outbound',
  recipient text NOT NULL,
  recipient_name text,
  subject text,
  body text NOT NULL,
  status text NOT NULL DEFAULT 'draft',
  queued_at timestamptz,
  sent_at timestamptz,
  delivered_at timestamptz,
  error_message text,
  notes text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT communications_channel_chk CHECK (channel IN ('sms','whatsapp','email','call','in_app')),
  CONSTRAINT communications_direction_chk CHECK (direction IN ('outbound','inbound')),
  CONSTRAINT communications_status_chk CHECK (status IN ('draft','queued','sent','delivered','read','failed','received'))
);
CREATE INDEX communications_property_idx ON public.communications(property_id, created_at DESC);
CREATE INDEX communications_booking_idx ON public.communications(booking_id);
CREATE INDEX communications_guest_idx ON public.communications(guest_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.communications TO authenticated;
GRANT ALL ON public.communications TO service_role;

ALTER TABLE public.communications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "communications_select" ON public.communications
  FOR SELECT TO authenticated USING (public.can_front_desk(auth.uid()));
CREATE POLICY "communications_insert" ON public.communications
  FOR INSERT TO authenticated WITH CHECK (public.can_front_desk(auth.uid()));
CREATE POLICY "communications_update" ON public.communications
  FOR UPDATE TO authenticated
  USING (public.can_front_desk(auth.uid()))
  WITH CHECK (public.can_front_desk(auth.uid()));
CREATE POLICY "communications_delete" ON public.communications
  FOR DELETE TO authenticated USING (public.can_manage_masters(auth.uid()));

CREATE TRIGGER communications_set_updated_at
  BEFORE UPDATE ON public.communications
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
