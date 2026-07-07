import { ReactNode } from "react";
import { Link } from "@tanstack/react-router";
import { usePermissions, type PermAction } from "@/hooks/use-permissions";
import { useAuth } from "@/hooks/use-auth";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

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
  const { loading: authLoading, roles } = useAuth();
  const { can, loading: permsLoading, isSuperadmin } = usePermissions();

  // Belt-and-suspenders bypass: an owner/superadmin (per useAuth's roles)
  // is always allowed, regardless of what usePermissions has finished loading.
  const roleBypass =
    roles.includes("superadmin") || roles.includes("owner");

  // Only render a definitive decision once BOTH auth and permissions have
  // resolved. Rendering "Access denied" on a transient loading/error state
  // is what caused the site-wide blank-page bug for non-owner roles.
  if (authLoading || permsLoading) return null;

  const allowed = roleBypass || isSuperadmin || can(module, action);
  if (allowed) return <>{children}</>;

  // Inline access-denied card — do NOT navigate away. Navigating to
  // /dashboard while the guard is itself mounted on /dashboard produced a
  // blank page with only the toast visible.
  return (
    <div className="min-h-[60vh] flex items-center justify-center p-6">
      <Card className="max-w-md w-full">
        <CardHeader>
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-destructive" />
            <CardTitle>Access denied</CardTitle>
          </div>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            Your role doesn't have permission to view this page. Ask an
            owner or administrator to enable the{" "}
            <span className="font-medium text-foreground">
              {module} · {action}
            </span>{" "}
            permission for your role.
          </p>
          <div className="pt-2">
            <Link to="/dashboard">
              <Button variant="secondary">Go to Dashboard</Button>
            </Link>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}