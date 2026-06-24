// Raid-protection wipe executor. Owner / Superadmin only.
// deno-lint-ignore-file no-explicit-any
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ALLOWED_TABLES = [
  "payments",
  "folio_charges",
  "kot_orders",
  "guests",
  "expenses",
  "bookings",
] as const;
type WipeTable = typeof ALLOWED_TABLES[number];

interface WipeInput {
  property_id: string | null;
  date_from: string; // YYYY-MM-DD
  date_to: string;
  percentage: number; // 1..100
  tables: WipeTable[];
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization") ?? "";
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // Verify caller
    const userClient = createClient(SUPABASE_URL, ANON, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: userRes, error: uErr } = await userClient.auth.getUser();
    if (uErr || !userRes?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const userId = userRes.user.id;

    const admin = createClient(SUPABASE_URL, SERVICE);

    // Role check
    const { data: roles } = await admin.from("user_roles").select("role").eq("user_id", userId);
    const roleList = (roles ?? []).map((r: any) => r.role);
    if (!roleList.includes("owner") && !roleList.includes("superadmin")) {
      return new Response(JSON.stringify({ error: "Forbidden: owner or superadmin only" }), { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const input = (await req.json()) as WipeInput;
    const tables = (input.tables ?? []).filter((t) => ALLOWED_TABLES.includes(t));
    if (!tables.length) throw new Error("No tables selected");
    const pct = Math.max(1, Math.min(100, Math.round(input.percentage ?? 100)));
    if (!input.date_from || !input.date_to) throw new Error("Date range required");

    // Create wipe log first (so we can attach wipe_log_id)
    const { data: logRow, error: logErr } = await admin
      .from("wipe_logs")
      .insert({
        property_id: input.property_id,
        initiated_by: userId,
        date_from: input.date_from,
        date_to: input.date_to,
        percentage: pct,
        tables_selected: tables,
        record_count: 0,
      })
      .select("id")
      .single();
    if (logErr || !logRow) throw logErr ?? new Error("Failed to create wipe log");
    const wipeLogId = logRow.id;

    let totalWiped = 0;
    const fromTs = `${input.date_from}T00:00:00Z`;
    const toTs = `${input.date_to}T23:59:59Z`;

    for (const table of tables) {
      // Fetch candidate rows in range, not already wiped, scoped by property when present
      let q: any = admin.from(table).select("*").gte("created_at", fromTs).lte("created_at", toTs).eq("is_wiped", false);
      if (input.property_id && table !== "folio_charges" && table !== "kot_items") {
        q = q.eq("property_id", input.property_id);
      }
      const { data: rows, error: rErr } = await q;
      if (rErr) {
        console.error("fetch error", table, rErr);
        continue;
      }
      if (!rows?.length) continue;

      // Sample subset by percentage
      let selected = rows;
      if (pct < 100) {
        const shuffled = [...rows].sort(() => Math.random() - 0.5);
        const take = Math.max(1, Math.floor((rows.length * pct) / 100));
        selected = shuffled.slice(0, take);
      }

      // Archive
      const archiveRows = selected.map((r: any) => ({
        wipe_log_id: wipeLogId,
        table_name: table,
        record_id: r.id,
        original_data: r,
      }));
      if (archiveRows.length) {
        const { error: aErr } = await admin.from("wiped_data_archive").insert(archiveRows);
        if (aErr) { console.error("archive error", table, aErr); continue; }
      }

      // Mark wiped (and mask guest name)
      const ids = selected.map((r: any) => r.id);
      const patch: any = { is_wiped: true, wiped_at: new Date().toISOString(), wipe_log_id: wipeLogId };
      if (table === "guests") patch.name = "Guest";
      const { error: uErr2 } = await admin.from(table).update(patch).in("id", ids);
      if (uErr2) { console.error("update error", table, uErr2); continue; }

      totalWiped += ids.length;
    }

    await admin.from("wipe_logs").update({ record_count: totalWiped }).eq("id", wipeLogId);

    return new Response(JSON.stringify({ ok: true, wipe_log_id: wipeLogId, records_wiped: totalWiped }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e: any) {
    console.error("execute-wipe error", e);
    return new Response(JSON.stringify({ error: e.message ?? String(e) }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});