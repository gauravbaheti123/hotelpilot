import { createClient } from "@supabase/supabase-js";
import type { Database } from "@/integrations/supabase/types";
import { supabase } from "@/integrations/supabase/client";
import { reportQueryError } from "@/lib/queryError";

/**
 * Verifies that the given email+password belongs to a user with
 * manager / owner / superadmin role. Uses an ephemeral client so the
 * current user's session is not disturbed.
 */
export async function verifyManagerPassword(
  email: string,
  password: string,
): Promise<{ ok: boolean; userId?: string; reason?: string }> {
  const url = import.meta.env.VITE_SUPABASE_URL as string;
  const key = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string;
  if (!url || !key) return { ok: false, reason: "Backend not configured" };

  const ephemeral = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, storage: undefined },
  });

  const { data, error } = await ephemeral.auth.signInWithPassword({ email, password });
  if (error || !data.user) {
    return { ok: false, reason: "Incorrect manager password" };
  }
  const uid = data.user.id;
  // Use main client (with auth) to check role via SECURITY DEFINER rpc
  const [{ data: isMgr, error: __qp1 }, { data: isOwner, error: __qp2 }, { data: isSuper, error: __qp3 }] = await Promise.all([
    supabase.rpc("has_role", { _user_id: uid, _role: "manager" }),
    supabase.rpc("has_role", { _user_id: uid, _role: "owner" }),
    supabase.rpc("has_role", { _user_id: uid, _role: "superadmin" }),
  ]);
  if (__qp1) reportQueryError("is mgr", __qp1);
  if (__qp2) reportQueryError("is owner", __qp2);
  if (__qp3) reportQueryError("is super", __qp3);
  try { await ephemeral.auth.signOut(); } catch { /* ignore */ }
  if (!isMgr && !isOwner && !isSuper) {
    return { ok: false, reason: "User is not a manager" };
  }
  return { ok: true, userId: uid };
}