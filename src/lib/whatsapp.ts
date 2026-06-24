import { supabase } from "@/integrations/supabase/client";

export type TriggerEvent =
  | "booking_confirm"
  | "checkin_welcome"
  | "food_ordered"
  | "checkout_bill"
  | "payment_receipt"
  | "feedback_request";

export const TRIGGER_LABELS: Record<TriggerEvent, string> = {
  booking_confirm: "Booking confirmed",
  checkin_welcome: "Check-in welcome",
  food_ordered: "Food order placed",
  checkout_bill: "Checkout & invoice",
  payment_receipt: "Payment received",
  feedback_request: "Feedback (2h after checkout)",
};

export const TEMPLATE_VARIABLES = [
  "guest_name", "room_no", "checkin_date", "checkout_date",
  "amount", "hotel_name", "wifi_password", "property_phone",
  "booking_number",
] as const;

export interface SendWhatsAppOpts {
  property_id: string;
  destination: string;
  template_event?: TriggerEvent;
  user_name?: string;
  guest_id?: string | null;
  booking_id?: string | null;
  body_preview?: string;
  template_params?: string[];
  media?: { url: string; filename?: string };
}

function normalizePhone(n: string): string {
  return (n ?? "").replace(/[^0-9]/g, "");
}

/** Fire-and-forget send. Returns { ok, status, body } from edge function. */
export async function sendWhatsApp(opts: SendWhatsAppOpts) {
  const dest = normalizePhone(opts.destination);
  if (!dest) return { ok: false, error: "missing destination" };
  const { data, error } = await supabase.functions.invoke("send-whatsapp", {
    body: { ...opts, destination: dest },
  });
  if (error) return { ok: false, error: error.message };
  return data ?? { ok: true };
}

/** Convenience: fire trigger when an app event happens. Swallows errors so the
 *  primary action (booking/checkout/etc.) is never blocked by WhatsApp issues.
 */
export async function fireTrigger(
  event: TriggerEvent,
  ctx: { property_id: string; booking_id?: string; guest_id?: string | null; phone?: string | null; media_url?: string },
) {
  try {
    if (!ctx.phone) return;
    await sendWhatsApp({
      property_id: ctx.property_id,
      destination: ctx.phone,
      template_event: event,
      booking_id: ctx.booking_id ?? null,
      guest_id: ctx.guest_id ?? null,
      media: ctx.media_url ? { url: ctx.media_url } : undefined,
    });
  } catch {
    /* never block UX */
  }
}

export async function testAiSensy(property_id: string) {
  return supabase.functions.invoke("send-whatsapp", { body: { test: true, property_id } });
}