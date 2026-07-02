import {
  adminClient, corsHeaders, decryptSecret, getCallerUserId, isSuperadmin, json, verifyTotp,
} from "../_shared/totp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const callerId = await getCallerUserId(req);
    if (!callerId) return json({ error: "Unauthorized" }, 401);
    if (!(await isSuperadmin(callerId))) return json({ error: "Superadmin only" }, 403);

    const { targetUserId, code } = await req.json().catch(() => ({}));
    if (!targetUserId || !code) return json({ error: "targetUserId and code required" }, 400);

    const admin = adminClient();
    const { data: row, error } = await admin
      .from("user_totp_secrets")
      .select("secret_encrypted")
      .eq("user_id", targetUserId)
      .maybeSingle();
    if (error || !row) return json({ success: false, error: "No pending secret" }, 404);

    const secret = await decryptSecret(row.secret_encrypted);
    const ok = await verifyTotp(secret, String(code));
    if (!ok) return json({ success: false, error: "Invalid code" }, 200);

    await admin.from("user_totp_secrets").update({
      enabled: true, failed_attempts: 0, locked_until: null, last_verified_at: new Date().toISOString(),
    }).eq("user_id", targetUserId);

    return json({ success: true });
  } catch (e) {
    console.error("verify-and-enable-totp error", e);
    return json({ error: (e as Error).message }, 500);
  }
});