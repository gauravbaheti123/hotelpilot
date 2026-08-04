import { supabase } from "@/integrations/supabase/client";
import { resolveEdgeError } from "@/lib/errorMessage";

export interface GenerateResponse {
  secret: string;
  otpauthUri: string;
  qrCodeSvg: string;
}

export async function generateTotpSecret(targetUserId: string): Promise<GenerateResponse> {
  const { data, error } = await supabase.functions.invoke("generate-totp-secret", {
    body: { targetUserId },
  });
  if (error) throw new Error((await resolveEdgeError(error, "generating the 2FA secret")).message);
  if (!data?.secret) throw new Error(data?.error ?? "Failed to generate secret");
  return data as GenerateResponse;
}

export async function verifyAndEnableTotp(targetUserId: string, code: string): Promise<boolean> {
  const { data, error } = await supabase.functions.invoke("verify-and-enable-totp", {
    body: { targetUserId, code },
  });
  if (error) throw new Error((await resolveEdgeError(error, "verifying the 2FA code")).message);
  return !!data?.success;
}

export interface LoginVerifyResult {
  success: boolean;
  attemptsRemaining?: number;
  locked?: boolean;
  lockedUntil?: string | null;
  remainingSeconds?: number;
  error?: string;
}
export async function verifyTotpLogin(userId: string, code: string): Promise<LoginVerifyResult> {
  const { data, error } = await supabase.functions.invoke("verify-totp-login", {
    body: { userId, code },
  });
  if (error) throw new Error((await resolveEdgeError(error, "verifying the 2FA code")).message);
  return (data ?? { success: false }) as LoginVerifyResult;
}

/** True if the signed-in user must complete a TOTP challenge. */
export async function currentUserTotpRequired(): Promise<boolean> {
  const { data, error } = await supabase.rpc("current_user_totp_required");
  if (error) return false;
  return !!data;
}

const KEY = "hp_totp_verified";
export function markTotpVerified(userId: string) {
  try { sessionStorage.setItem(KEY, userId); } catch { /* ignore */ }
}
export function isTotpVerifiedForUser(userId: string): boolean {
  try { return sessionStorage.getItem(KEY) === userId; } catch { return false; }
}
export function clearTotpVerified() {
  try { sessionStorage.removeItem(KEY); } catch { /* ignore */ }
}