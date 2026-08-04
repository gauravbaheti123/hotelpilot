import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

const SS_USER_KEY = "hp_authed_user";
const SS_TOTP_KEY = "hp_totp_verified";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    // Fast path: if this tab has already verified the user (and TOTP if
    // needed), skip the network round-trips on every navigation. The root
    // onAuthStateChange listener clears sessionStorage on SIGNED_OUT.
    const cachedUserId = typeof window !== "undefined"
      ? window.sessionStorage.getItem(SS_USER_KEY)
      : null;
    if (cachedUserId) {
      return { user: { id: cachedUserId } as { id: string } };
    }

    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login" });
    }
    try {
      const { data: needs } = await supabase.rpc("current_user_totp_required");
      if (needs === true) {
        const verifiedFor = typeof window !== "undefined"
          ? window.sessionStorage.getItem(SS_TOTP_KEY) : null;
        if (verifiedFor !== data.user.id) {
          throw redirect({ to: "/totp-challenge" });
        }
      }
    } catch (e) {
      if (e && typeof e === "object" && "to" in (e as any)) throw e;
    }
    try { window.sessionStorage.setItem(SS_USER_KEY, data.user.id); } catch { /* ignore */ }
    return { user: data.user };
  },
  component: () => <Outlet />,
});