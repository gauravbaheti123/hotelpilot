import {
  adminClient, corsHeaders, encryptSecret, getCallerUserId, isSuperadmin, json,
  otpauthUri, qrSvg, randomBase32Secret,
} from "../_shared/totp.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const callerId = await getCallerUserId(req);
    if (!callerId) return json({ error: "Unauthorized" }, 401);
    if (!(await isSuperadmin(callerId))) return json({ error: "Superadmin only" }, 403);

    const body = await req.json().catch(() => ({}));
    const targetUserId = body?.targetUserId as string | undefined;
    if (!targetUserId) return json({ error: "targetUserId required" }, 400);

    const admin = adminClient();
    const { data: userRes, error: userErr } = await admin.auth.admin.getUserById(targetUserId);
    if (userErr || !userRes?.user) return json({ error: "Target user not found" }, 404);
    const email = userRes.user.email ?? targetUserId;

    const secret = randomBase32Secret(20);
    const encrypted = await encryptSecret(secret);

    const { error: upErr } = await admin.from("user_totp_secrets").upsert({
      user_id: targetUserId,
      secret_encrypted: encrypted,
      enabled: false,
      created_by: callerId,
      failed_attempts: 0,
      locked_until: null,
      last_verified_at: null,
    }, { onConflict: "user_id" });
    if (upErr) {
      console.error("upsert totp secret failed", upErr);
      return json({ error: "Failed to store secret" }, 500);
    }

    const uri = otpauthUri(email, secret);
    const svg = qrSvg(uri);
    return json({ secret, otpauthUri: uri, qrCodeSvg: svg });
  } catch (e) {
    console.error("generate-totp-secret error", e);
    return json({ error: (e as Error).message }, 500);
  }
});