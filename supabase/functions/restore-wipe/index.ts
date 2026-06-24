// Restore a previously executed wipe. Superadmin only.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userRes.user.id;
    const admin = createClient(SUPABASE_URL, SERVICE);

    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const roleList = (roles ?? []).map((r: any) => r.role);
    if (!roleList.includes("superadmin")) {
      return new Response(JSON.stringify({ error: "Forbidden: superadmin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const { wipe_log_id } = await req.json();
    if (!wipe_log_id) throw new Error("wipe_log_id required");

    const { data: log } = await admin.from("wipe_logs").select("id,is_restored").eq("id", wipe_log_id).single();
    if (!log) throw new Error("Wipe log not found");
    if (log.is_restored) throw new Error("Already restored");

    const { data: archive, error: aErr } = await admin
      .from("wiped_data_archive")
      .select("table_name,record_id,original_data")
      .eq("wipe_log_id", wipe_log_id);
    if (aErr) throw aErr;

    // Group by table
    const byTable: Record<string, { id: string; original: any }[]> = {};
    for (const row of archive ?? []) {
      (byTable[row.table_name] ??= []).push({ id: row.record_id, original: row.original_data });
    }

    let restored = 0;
    for (const [table, rows] of Object.entries(byTable)) {
      const ids = rows.map((r) => r.id);
      // Restore is_wiped flags; also restore guest name from original if masked
      const { error: uErr2 } = await admin.from(table).update({ is_wiped: false, wiped_at: null, wipe_log_id: null }).in("id", ids);
      if (uErr2) { console.error("restore update error", table, uErr2); continue; }
      if (table === "guests") {
        for (const r of rows) {
          const orig = r.original ?? {};
          if (orig.name && orig.name !== "Guest") {
            await admin.from("guests").update({ name: orig.name }).eq("id", r.id);
          }
        }
      }
      restored += ids.length;
    }

    await admin.from("wipe_logs").update({
      is_restored: true,
      restored_at: new Date().toISOString(),
      restored_by: userId,
    }).eq("id", wipe_log_id);

    return new Response(JSON.stringify({ ok: true, restored }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("restore-wipe error", e);
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});