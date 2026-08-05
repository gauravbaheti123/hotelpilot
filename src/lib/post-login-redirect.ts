import { supabase } from "@/integrations/supabase/client";
import { reportQueryError } from "@/lib/queryError";

// Ordered by sidebar priority. First module the user has "view" access to wins.
const MODULE_ROUTES: Array<{ module: string; to: string }> = [
  { module: "dashboard", to: "/dashboard" },
  { module: "bookings", to: "/front-desk/bookings" },
  { module: "calendar", to: "/front-desk/calendar" },
  { module: "inhouse", to: "/front-desk/in-house" },
  { module: "restaurant_billing", to: "/restaurant" },
  { module: "invoices", to: "/billing/invoices" },
  { module: "reports", to: "/reports" },
  { module: "day_close", to: "/reports/night-audit" },
  { module: "room_board", to: "/housekeeping/board" },
  { module: "tasks", to: "/housekeeping/tasks" },
  { module: "guest_crm", to: "/guests" },
  { module: "inventory", to: "/inventory" },
  { module: "expenses", to: "/expenses" },
  { module: "staff_hr", to: "/staff" },
  { module: "banquet", to: "/banquet/bookings" },
  { module: "label_printing", to: "/label-printing" },
  { module: "master_data", to: "/masters" },
];

/**
 * Resolves the correct post-login destination based on the user's roles
 * and granted module permissions. Superadmins and owners always land on
 * /dashboard. Other roles land on the first module in sidebar-priority
 * order they have `view` access to. Falls back to /access-denied.
 */
export async function resolvePostLoginRedirect(userId: string): Promise<string> {
  // 1. Roles: owner/superadmin bypass the permission grid.
  const { data: userRoles, error: __qe1 } = await supabase
    .from("user_roles")
    .select("role, role_id, roles:roles!user_roles_role_id_fkey(default_route)")
    .eq("user_id", userId);
  if (__qe1) reportQueryError("user roles", __qe1);

  const roleNames = ((userRoles ?? []) as Array<{ role: string | null }>)
    .map((r) => r.role)
    .filter(Boolean) as string[];
  if (roleNames.includes("superadmin") || roleNames.includes("owner")) {
    return "/dashboard";
  }

  const roleIds = Array.from(
    new Set(
      ((userRoles ?? []) as Array<{ role_id: string | null }>)
        .map((r) => r.role_id)
        .filter(Boolean) as string[],
    ),
  );
  // Explicit per-role landing page wins when configured.
  const explicit = ((userRoles ?? []) as Array<{ roles?: { default_route?: string | null } | null }>)
    .map((r) => r.roles?.default_route)
    .find((v) => typeof v === "string" && v.trim().startsWith("/"));
  if (explicit) return explicit.trim();

  if (roleIds.length === 0) return "/access-denied";

  // 2. Permission map from role_permissions.
  const { data: rps, error: __qe2 } = await supabase
    .from("role_permissions")
    .select("allowed, permissions!role_permissions_permission_id_fkey(module, action)")
    .in("role_id", roleIds)
    .eq("allowed", true);
  if (__qe2) reportQueryError("role permissions", __qe2);

  const viewable = new Set<string>();
  for (const row of (rps ?? []) as any[]) {
    const p = row.permissions;
    if (p?.action === "view") viewable.add(p.module);
  }

  for (const entry of MODULE_ROUTES) {
    if (viewable.has(entry.module)) return entry.to;
  }
  return "/access-denied";
}
