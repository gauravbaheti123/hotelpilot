import {
  adminClient, corsHeaders, decryptSecret, json, verifyTotp,
} from "../_shared/totp.ts";

const MAX_ATTEMPTS = 3;
const LOCKOUT_MINUTES = 15;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const { userId, code } = await req.json().catch(() => ({}));
    if (!userId || !code) return json({ success: false, error: "userId and code required" }, 400);

    const admin = adminClient();
    const { data: row } = await admin.from("user_totp_secrets")
      .select("secret_encrypted, enabled, failed_attempts, locked_until")
      .eq("user_id", userId).maybeSingle();
    if (!row || !row.enabled) return json({ success: false, error: "2FA not enabled" }, 404);

    if (row.locked_until && new Date(row.locked_until).getTime() > Date.now()) {
      const remainingMs = new Date(row.locked_until).getTime() - Date.now();
      return json({
        success: false, locked: true, lockedUntil: row.locked_until,
        remainingSeconds: Math.ceil(remainingMs / 1000),
        error: "Account locked. Try again later.",
      }, 200);
    }

    const secret = await decryptSecret(row.secret_encrypted);
    const ok = await verifyTotp(secret, String(code));

    if (ok) {
      await admin.from("user_totp_secrets").update({
        failed_attempts: 0, locked_until: null, last_verified_at: new Date().toISOString(),
      }).eq("user_id", userId);
      return json({ success: true });
    }

    const nextAttempts = (row.failed_attempts ?? 0) + 1;
    const shouldLock = nextAttempts >= MAX_ATTEMPTS;
    const lockUntil = shouldLock
      ? new Date(Date.now() + LOCKOUT_MINUTES * 60_000).toISOString() : null;
    await admin.from("user_totp_secrets").update({
      failed_attempts: nextAttempts,
      locked_until: lockUntil,
    }).eq("user_id", userId);

    return json({
      success: false,
      attemptsRemaining: Math.max(0, MAX_ATTEMPTS - nextAttempts),
      locked: shouldLock,
      lockedUntil: lockUntil,
      error: shouldLock ? "Too many attempts. Account locked." : "Invalid code",
    }, 200);
  } catch (e) {
    console.error("verify-totp-login error", e);
    return json({ success: false, error: (e as Error).message }, 500);
  }
});