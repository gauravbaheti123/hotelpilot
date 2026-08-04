import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { reportQueryError } from "@/lib/queryError";

/**
 * Pathless layout that gates the entire /superadmin/* subtree.
 * Only signed-in users with owner or superadmin role may pass.
 * Unauthorized users are redirected to /dashboard with an Access denied toast.
 */
export const Route = createFileRoute("/_authenticated/superadmin")({
  ssr: false,
  beforeLoad: async () => {
    const { data: u, error } = await supabase.auth.getUser();
    if (error || !u.user) {
      throw redirect({ to: "/login" });
    }
    const { data: allowed, error: __qe1 } = await supabase.rpc("is_owner_or_super", {
      _user_id: u.user.id,
    });
    if (__qe1) reportQueryError("is owner or super", __qe1);
    if (!allowed) {
      if (typeof window !== "undefined") {
        try { toast.error("Access denied"); } catch { /* ignore */ }
      }
      throw redirect({ to: "/dashboard" });
    }
  },
  component: () => <Outlet />,
});