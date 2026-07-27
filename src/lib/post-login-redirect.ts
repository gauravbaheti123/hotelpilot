import { supabase } from "@/integrations/supabase/client";

// Ordered by sidebar priority. First module the user has "view" access to wins.
const MODULE_ROUTES: Array<{ module: string; to: string }> = [
  { module: "dashboard", to: "/dashboard" },
  { module: "bookings", to: "/front-desk/bookings" },
  { module: "calendar", to: "/front-desk/calendar" },
  { module: "inhouse", to: "/front-desk/in-house" },
  { module: "new_kot", to: "/food/new" },
  { module: "restaurant_billing", to: "/restaurant" },
  { module: "invoices", to: "/billing/invoices" },
  { module: "mis_ac", to: "/billing/mis" },
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
  const { data: userRoles } = await supabase
    .from("user_roles")
    .select("role, role_id")
    .eq("user_id", userId);

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
  if (roleIds.length === 0) return "/access-denied";

  // 2. Permission map from role_permissions.
  const { data: rps } = await supabase
    .from("role_permissions")
    .select("allowed, permissions!role_permissions_permission_id_fkey(module, action)")
    .in("role_id", roleIds)
    .eq("allowed", true);

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
