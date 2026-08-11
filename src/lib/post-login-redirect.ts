import type { QueryClient } from "@tanstack/react-query";
import {
  currentPropertyIdFromStorage,
  fetchPermissionMapForRoles,
  fetchRoleContext,
  permissionsQueryKey,
} from "@/lib/permission-map";

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
export async function resolvePostLoginRedirect(
  userId: string,
  queryClient?: QueryClient,
): Promise<string> {
  const propertyId = currentPropertyIdFromStorage();

  // 1. Roles: owner/superadmin bypass the permission grid entirely.
  const ctx = await fetchRoleContext(userId, propertyId);
  if (ctx.roleNames.includes("superadmin") || ctx.roleNames.includes("owner")) {
    return "/dashboard";
  }

  // Explicit per-role landing page wins when configured.
  if (ctx.defaultRoute) return ctx.defaultRoute;
  if (ctx.roleIds.length === 0) return "/access-denied";

  // 2. Permission map from role_permissions — seeded into the same React
  //    Query cache entry usePermissions() reads, so the app does not issue a
  //    second identical request right after login.
  const map = await fetchPermissionMapForRoles(ctx.roleIds);
  queryClient?.setQueryData(permissionsQueryKey(userId, propertyId), {
    map,
    roleIds: ctx.roleIds,
  });

  for (const entry of MODULE_ROUTES) {
    if (map[entry.module]?.view) return entry.to;
  }
  return "/access-denied";
}
