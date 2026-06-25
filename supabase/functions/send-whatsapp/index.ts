// AiSensy outbound + cron-driven feedback dispatcher.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const AISENSY_URL = "https://backend.aisensy.com/campaign/t1/api/v2";

interface SendInput {
  property_id: string;
  destination: string;          // E.164 e.g. 919812345678
  template_event?: string;      // booking_confirm | checkin_welcome | ...
  campaign_name?: string;
  user_name?: string;
  template_params?: string[];
  media?: { url: string; filename?: string };
  guest_id?: string | null;
  booking_id?: string | null;
  body_preview?: string;
}

function renderTemplate(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (_m, k) => vars[k] ?? "");
}

function paramsFromTemplate(body: string, vars: Record<string, string>): string[] {
  const keys: string[] = [];
  body.replace(/\{\{?\s*(\w+)\s*\}?\}/g, (_m, k) => { keys.push(k); return ""; });
  return keys.map((k) => vars[k] ?? "");
}

async function dispatch(supabase: any, input: SendInput) {
  // Load property config
  const { data: property, error: pErr } = await supabase
    .from("properties")
    .select("id,name,phone,aisensy_api_key,wa_number,wifi_password")
    .eq("id", input.property_id)
    .maybeSingle();
  if (pErr || !property) return { ok: false, error: `Property not found: ${pErr?.message ?? ""}` };
  if (!property.aisensy_api_key) return { ok: false, error: "AiSensy API key not configured for this property" };

  // Optional template lookup
  let templateBody = "";
  let campaignName = input.campaign_name ?? input.template_event ?? "";
  let templateName: string | null = null;
  if (input.template_event) {
    const { data: tpl } = await supabase
      .from("message_templates")
      .select("id,name,body,aisensy_campaign_name,is_active")
      .eq("property_id", input.property_id)
      .eq("trigger_event", input.template_event)
      .eq("is_active", true)
      .maybeSingle();
    if (tpl) {
      templateBody = tpl.body;
      templateName = tpl.name;
      if (tpl.aisensy_campaign_name) campaignName = tpl.aisensy_campaign_name;
    }
  }

  // Optional guest info for variables
  let guestName = input.user_name ?? "Guest";
  let bookingMeta: Record<string, string> = {};
  if (input.booking_id) {
    const { data: b } = await supabase
      .from("bookings")
      .select("booking_number,check_in,check_out,guests(name),booking_rooms(rooms(room_number))")
      .eq("id", input.booking_id)
      .maybeSingle();
    if (b) {
      bookingMeta = {
        booking_number: b.booking_number ?? "",
        checkin_date: b.check_in ?? "",
        checkout_date: b.check_out ?? "",
        room_no: b.booking_rooms?.[0]?.rooms?.room_number ?? "",
      };
      if (b.guests?.name) guestName = b.guests.name;
    }
  }

  const vars: Record<string, string> = {
    guest_name: guestName,
    hotel_name: property.name ?? "",
    property_phone: property.phone ?? "",
    wifi_password: property.wifi_password ?? "",
    ...bookingMeta,
  };

  const templateParams = input.template_params
    ?? (templateBody ? paramsFromTemplate(templateBody, vars) : []);
  const bodyPreview = input.body_preview
    ?? (templateBody ? renderTemplate(templateBody, vars) : campaignName);

  // Queue log row
  const { data: logRow } = await supabase.from("whatsapp_messages").insert({
    property_id: input.property_id,
    guest_id: input.guest_id ?? null,
    booking_id: input.booking_id ?? null,
    wa_number: input.destination,
    direction: "outbound",
    content: bodyPreview,
    template_name: templateName,
    campaign_name: campaignName,
    media_url: input.media?.url ?? null,
    status: "queued",
  }).select("id").single();

  const payload = {
    apiKey: property.aisensy_api_key,
    campaignName,
    destination: input.destination,
    userName: guestName,
    templateParams,
    source: "hotelpilot",
    media: input.media ?? undefined,
    tags: [],
    attributes: {},
  };

  const res = await fetch(AISENSY_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const responseText = await res.text();

  if (logRow?.id) {
    await supabase.from("whatsapp_messages").update({
      status: res.ok ? "sent" : "failed",
      sent_at: res.ok ? new Date().toISOString() : null,
      error_message: res.ok ? null : responseText.slice(0, 500),
      external_id: res.ok ? (() => { try { return JSON.parse(responseText)?.requestId ?? null; } catch { return null; } })() : null,
    }).eq("id", logRow.id);
  }

  return { ok: res.ok, status: res.status, body: responseText, id: logRow?.id };
}

async function runFeedbackCron(supabase: any) {
  // Find bookings checked out 2h–3h ago without a feedback_request sent
  const now = new Date();
  const from = new Date(now.getTime() - 3 * 3600_000).toISOString();
  const to = new Date(now.getTime() - 2 * 3600_000).toISOString();
  const { data: bookings } = await supabase
    .from("bookings")
    .select("id,property_id,guest_id,checked_out_at,guests(name,mobile)")
    .eq("status", "checked_out")
    .gte("checked_out_at", from)
    .lte("checked_out_at", to);
  const results: any[] = [];
  for (const b of bookings ?? []) {
    const mobile = b.guests?.mobile;
    if (!mobile) continue;
    const { data: existing } = await supabase
      .from("whatsapp_messages")
      .select("id")
      .eq("booking_id", b.id)
      .eq("template_name", "Feedback Request")
      .limit(1);
    if (existing && existing.length > 0) continue;
    const r = await dispatch(supabase, {
      property_id: b.property_id,
      destination: mobile.replace(/[^0-9]/g, ""),
      template_event: "feedback_request",
      booking_id: b.id,
      guest_id: b.guest_id,
    });
    results.push({ booking: b.id, ...r });
  }
  return { cron: "feedback_2h", processed: results.length, results };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json().catch(() => ({}));

    if (body.cron === "feedback_2h" || body.test === true) {
      if (body.test === true) {
        // Test ping still requires either a valid JWT or the cron secret
        const cronSecret = req.headers.get("x-cron-secret") ?? "";
        const authHeader = req.headers.get("Authorization") ?? "";
        const expected = Deno.env.get("WHATSAPP_CRON_SECRET") ?? "";
        const hasCron = expected && cronSecret === expected;
        let hasUser = false;
        if (!hasCron && authHeader.startsWith("Bearer ")) {
          const userClient = createClient(
            Deno.env.get("SUPABASE_URL")!,
            Deno.env.get("SUPABASE_ANON_KEY")!,
            { global: { headers: { Authorization: authHeader } } },
          );
          const { data } = await userClient.auth.getUser();
          hasUser = !!data?.user;
        }
        if (!hasCron && !hasUser) {
          return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
            status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ ok: true, message: "Edge function reachable" }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      // Cron path: require shared cron secret header
      const cronSecret = req.headers.get("x-cron-secret") ?? "";
      const expected = Deno.env.get("WHATSAPP_CRON_SECRET") ?? "";
      if (!expected || cronSecret !== expected) {
        return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      const out = await runFeedbackCron(supabase);
      return new Response(JSON.stringify(out), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Outbound send path: require an authenticated user
    const authHeader = req.headers.get("Authorization") ?? "";
    if (!authHeader.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userClient = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: userRes, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userRes?.user) {
      return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    // Verify caller has access to the target property
    const { data: roles } = await supabase
      .from("user_roles").select("role,property_id").eq("user_id", userRes.user.id);
    const isSuper = (roles ?? []).some((r: any) => r.role === "superadmin");
    const hasProperty = (roles ?? []).some((r: any) => r.property_id === body.property_id);
    if (!isSuper && !hasProperty) {
      return new Response(JSON.stringify({ ok: false, error: "Forbidden" }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!body.property_id || !body.destination) {
      return new Response(JSON.stringify({ ok: false, error: "property_id and destination are required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await dispatch(supabase, body as SendInput);
    return new Response(JSON.stringify(result), {
      status: result.ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});