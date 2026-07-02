import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) {
      throw redirect({ to: "/login" });
    }
    // Enforce admin-issued TOTP: if the user has enabled 2FA and this
    // browser session hasn't cleared the challenge yet, send them there.
    try {
      const { data: needs } = await supabase.rpc("current_user_totp_required");
      if (needs === true) {
        const verifiedFor = typeof window !== "undefined"
          ? window.sessionStorage.getItem("hp_totp_verified") : null;
        if (verifiedFor !== data.user.id) {
          throw redirect({ to: "/totp-challenge" });
        }
      }
    } catch (e) {
      if (e && typeof e === "object" && "to" in (e as any)) throw e;
      // rpc failure: fail closed only if user provably needs 2FA; otherwise allow.
    }
    return { user: data.user };
  },
  component: () => <Outlet />,
});