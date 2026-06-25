import { ReactNode, useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { usePermissions, type PermAction } from "@/hooks/use-permissions";
import { toast } from "sonner";

/**
 * Blocks rendering of a route unless the current user has the required
 * module/action permission. Superadmins bypass. Redirects to /dashboard
 * with an "Access denied" toast when blocked.
 */
export function RequirePermission({
  module,
  action = "view",
  children,
}: {
  module: string;
  action?: PermAction;
  children: ReactNode;
}) {
  const navigate = useNavigate();
  const { can, loading, isSuperadmin, map } = usePermissions();
  const hasAnyAssignment = isSuperadmin || Object.keys(map).length > 0;
  const allowed = isSuperadmin || !hasAnyAssignment || can(module, action);

  useEffect(() => {
    if (loading) return;
    if (!allowed) {
      toast.error("Access denied");
      navigate({ to: "/dashboard", replace: true });
    }
  }, [loading, allowed, navigate]);

  if (loading || !allowed) return null;
  return <>{children}</>;
}