// Inbound AiSensy webhook → whatsapp_messages + auto-routing.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type Category = "housekeeping" | "food" | "checkout" | "general";

function classify(text: string): Category {
  const t = (text || "").toLowerCase();
  if (/\b(pillow|towel|housekeeping|clean|laundry|toiletries|amenities)\b/.test(t)) return "housekeeping";
  if (/\b(food|menu|order|breakfast|lunch|dinner|coffee|tea|snack)\b/.test(t)) return "food";
  if (/\b(bill|invoice|checkout|check\s?out|payment|receipt)\b/.test(t)) return "checkout";
  return "general";
}

function digits(n: string): string { return (n || "").replace(/[^0-9]/g, ""); }

async function findGuestBooking(supabase: any, propertyId: string, fromNumber: string) {
  const num = digits(fromNumber);
  if (!num) return { guest: null, booking: null };
  // Try guests table for property
  const { data: guests } = await supabase
    .from("guests").select("id,mobile,name")
    .eq("property_id", propertyId)
    .limit(50);
  const guest = (guests ?? []).find((g: any) => digits(g.mobile ?? "").endsWith(num.slice(-10))) ?? null;
  let booking = null;
  if (guest) {
    const { data: bks } = await supabase
      .from("bookings")
      .select("id,property_id,status")
      .eq("guest_id", guest.id)
      .in("status", ["checked_in", "reserved"])
      .order("created_at", { ascending: false }).limit(1);
    booking = bks?.[0] ?? null;
  }
  return { guest, booking };
}

async function resolveProperty(supabase: any, payload: any) {
  // Prefer waNumber on payload; else first property with that number
  const waNumber = payload.businessNumber || payload.waNumber || payload.to || null;
  if (waNumber) {
    const num = digits(waNumber);
    const { data: props } = await supabase
      .from("properties").select("id,wa_number").not("wa_number", "is", null);
    const p = (props ?? []).find((x: any) => digits(x.wa_number).endsWith(num.slice(-10)));
    if (p) return p.id;
  }
  // Fallback: most-recently-updated property with WA configured
  const { data: any1 } = await supabase
    .from("properties").select("id").not("aisensy_api_key", "is", null)
    .order("updated_at", { ascending: false }).limit(1);
  return any1?.[0]?.id ?? null;
}

async function autoRoute(supabase: any, opts: {
  category: Category;
  text: string;
  property_id: string;
  guest_id: string | null;
  booking_id: string | null;
}) {
  const { category, text, property_id, guest_id, booking_id } = opts;
  if (category === "housekeeping" && booking_id) {
    // Lookup booking's first room
    const { data: br } = await supabase
      .from("booking_rooms").select("room_id").eq("booking_id", booking_id).limit(1);
    const room_id = br?.[0]?.room_id ?? null;
    if (room_id) {
      await supabase.from("housekeeping_tasks").insert({
        property_id, room_id, task_type: "cleaning",
        priority: "high", status: "pending",
        notes: `Guest WhatsApp request: ${text.slice(0, 200)}`,
      });
    }
  }
  if (category === "food") {
    // Lightweight notification via guest_feedback or comms log already; just tag
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405, headers: corsHeaders });

  // Verify caller identity via a shared webhook secret (configure as a query
  // string or header in the AiSensy webhook URL, e.g. ?secret=... or X-Webhook-Secret).
  const expected = Deno.env.get("AISENSY_WEBHOOK_SECRET") ?? "";
  const provided =
    req.headers.get("x-webhook-secret") ??
    req.headers.get("x-aisensy-secret") ??
    new URL(req.url).searchParams.get("secret") ??
    "";
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
      status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  try {
    const payload = await req.json().catch(() => ({}));
    // AiSensy posts varying shapes; normalise common fields:
    const type = payload.eventType || payload.type || payload.status_type || "message";
    const from = payload.userMobile || payload.from || payload.mobile || payload.destination || "";
    const text = payload.message || payload.body || payload.text || payload.content || "";
    const externalId = payload.requestId || payload.messageId || payload.id || null;

    const property_id = await resolveProperty(supabase, payload);
    if (!property_id) {
      return new Response(JSON.stringify({ ok: false, error: "No property configured" }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Delivery status callback for an existing outbound row
    if (/^(sent|delivered|read|failed)$/i.test(String(type)) && externalId) {
      const status = String(type).toLowerCase();
      const patch: any = { status };
      if (status === "delivered") patch.delivered_at = new Date().toISOString();
      if (status === "read") patch.read_at = new Date().toISOString();
      if (status === "sent") patch.sent_at = new Date().toISOString();
      await supabase.from("whatsapp_messages").update(patch).eq("external_id", externalId);
      return new Response(JSON.stringify({ ok: true, updated: status }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Inbound user message
    const { guest, booking } = await findGuestBooking(supabase, property_id, from);
    const category = classify(text);

    await supabase.from("whatsapp_messages").insert({
      property_id,
      guest_id: guest?.id ?? null,
      booking_id: booking?.id ?? null,
      wa_number: from,
      direction: "inbound",
      content: text,
      category,
      status: "received",
      external_id: externalId,
    });

    await autoRoute(supabase, {
      category, text, property_id,
      guest_id: guest?.id ?? null,
      booking_id: booking?.id ?? null,
    });

    return new Response(JSON.stringify({ ok: true, category }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});