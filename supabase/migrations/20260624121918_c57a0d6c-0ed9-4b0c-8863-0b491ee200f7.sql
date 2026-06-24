
-- Properties: WhatsApp config
ALTER TABLE public.properties
  ADD COLUMN IF NOT EXISTS aisensy_api_key text,
  ADD COLUMN IF NOT EXISTS wa_number text,
  ADD COLUMN IF NOT EXISTS wifi_password text;

-- Message templates: trigger event + AiSensy campaign mapping
ALTER TABLE public.message_templates
  ADD COLUMN IF NOT EXISTS trigger_event text,
  ADD COLUMN IF NOT EXISTS aisensy_campaign_name text;

CREATE INDEX IF NOT EXISTS message_templates_trigger_idx
  ON public.message_templates(property_id, trigger_event)
  WHERE trigger_event IS NOT NULL;

-- WhatsApp messages inbox
CREATE TABLE IF NOT EXISTS public.whatsapp_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  property_id uuid NOT NULL REFERENCES public.properties(id) ON DELETE CASCADE,
  guest_id uuid REFERENCES public.guests(id) ON DELETE SET NULL,
  booking_id uuid REFERENCES public.bookings(id) ON DELETE SET NULL,
  wa_number text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('inbound','outbound')),
  content text,
  media_url text,
  template_name text,
  category text,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued','sent','delivered','read','failed','received')),
  error_message text,
  campaign_name text,
  external_id text,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS whatsapp_messages_prop_created_idx
  ON public.whatsapp_messages(property_id, created_at DESC);
CREATE INDEX IF NOT EXISTS whatsapp_messages_guest_idx
  ON public.whatsapp_messages(guest_id);
CREATE INDEX IF NOT EXISTS whatsapp_messages_number_idx
  ON public.whatsapp_messages(property_id, wa_number);

GRANT SELECT, INSERT, UPDATE ON public.whatsapp_messages TO authenticated;
GRANT ALL ON public.whatsapp_messages TO service_role;

ALTER TABLE public.whatsapp_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "wa_messages_select" ON public.whatsapp_messages
  FOR SELECT TO authenticated USING (public.can_front_desk(auth.uid()));
CREATE POLICY "wa_messages_insert" ON public.whatsapp_messages
  FOR INSERT TO authenticated WITH CHECK (public.can_front_desk(auth.uid()));
CREATE POLICY "wa_messages_update" ON public.whatsapp_messages
  FOR UPDATE TO authenticated USING (public.can_front_desk(auth.uid()));

CREATE TRIGGER whatsapp_messages_set_updated_at
  BEFORE UPDATE ON public.whatsapp_messages
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Seed default templates per property (skip if a template with same trigger already exists)
INSERT INTO public.message_templates (property_id, name, channel, body, trigger_event, aisensy_campaign_name, is_active)
SELECT p.id, t.name, 'whatsapp', t.body, t.trigger_event, t.campaign, true
FROM public.properties p
CROSS JOIN (VALUES
  ('Booking Confirmation','Hi {guest_name}, your booking at {hotel_name} is confirmed for {checkin_date} to {checkout_date}. Booking ref: {booking_number}. We look forward to hosting you!','booking_confirm','booking_confirm'),
  ('Check-in Welcome','Welcome {guest_name}! You are in room {room_no}. Wi-Fi password: {wifi_password}. Reception: {property_phone}. Enjoy your stay at {hotel_name}.','checkin_welcome','checkin_welcome'),
  ('Food Order Confirmation','Thanks {guest_name}, your food order for room {room_no} has been received and is being prepared. — {hotel_name}','food_ordered','food_ordered'),
  ('Checkout & Bill','Dear {guest_name}, thank you for staying with us. Your invoice for {amount} is attached. — {hotel_name}','checkout_bill','checkout_bill'),
  ('Payment Receipt','Hi {guest_name}, we have received your payment of {amount}. Thank you! — {hotel_name}','payment_receipt','payment_receipt'),
  ('Feedback Request','Hi {guest_name}, how was your stay at {hotel_name}? We''d love your feedback — reply here or leave us a review.','feedback_request','feedback_request')
) AS t(name, body, trigger_event, campaign)
WHERE NOT EXISTS (
  SELECT 1 FROM public.message_templates m
  WHERE m.property_id = p.id AND m.trigger_event = t.trigger_event
);

-- Hourly cron job for feedback requests 2h after checkout
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'wa-feedback-2h') THEN
    PERFORM cron.unschedule('wa-feedback-2h');
  END IF;
END $$;

SELECT cron.schedule(
  'wa-feedback-2h',
  '*/30 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://fjhvpzpahlcezcbksnpr.supabase.co/functions/v1/send-whatsapp',
    headers := jsonb_build_object(
      'Content-Type','application/json',
      'apikey','sb_publishable_6BzqDSbfXDzt725GKsIMHQ_NWS68tDQ',
      'Authorization','Bearer sb_publishable_6BzqDSbfXDzt725GKsIMHQ_NWS68tDQ'
    ),
    body := jsonb_build_object('cron','feedback_2h')
  );
  $$
);
