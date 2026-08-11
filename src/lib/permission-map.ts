import { supabase } from "@/integrations/supabase/client";

export type PermMap = Record<string, Record<string, boolean>>;

export interface PermissionsPayload {
  map: PermMap;
  roleIds: string[];
}

/** Single source of truth for the permissions query cache entry. */
export const permissionsQueryKey = (
  userId: string | null,
  propertyId: string | null,
) => ["permissions", userId, propertyId] as const;

export function currentPropertyIdFromStorage(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage.getItem("hp.currentPropertyId");
  } catch {
    return null;
  }
}

export interface RoleContext {
  roleNames: string[];
  /** Role ids effective for the given property (same rule as usePermissions). */
  roleIds: string[];
  defaultRoute: string | null;
}

/** One round trip: roles + role ids + per-role landing page. */
export async function fetchRoleContext(
  userId: string,
  propertyId: string | null,
): Promise<RoleContext> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role, role_id, property_id, roles:roles!user_roles_role_id_fkey(default_route)")
    .eq("user_id", userId);
  if (error) throw error;

  const rows = (data ?? []) as Array<{
    role: string | null;
    role_id: string | null;
    property_id: string | null;
    roles?: { default_route?: string | null } | null;
  }>;

  const roleNames = rows.map((r) => r.role).filter(Boolean) as string[];
  const assignments = rows.filter((r) => !!r.role_id);
  const matching = propertyId
    ? assignments.filter((r) => !r.property_id || r.property_id === propertyId)
    : [];
  const effective = matching.length > 0 ? matching : assignments;
  const roleIds = Array.from(new Set(effective.map((r) => r.role_id as string)));

  const defaultRoute =
    rows
      .map((r) => r.roles?.default_route)
      .find((v) => typeof v === "string" && v.trim().startsWith("/"))
      ?.trim() ?? null;

  return { roleNames, roleIds, defaultRoute };
}

export async function fetchPermissionMapForRoles(roleIds: string[]): Promise<PermMap> {
  if (roleIds.length === 0) return {};
  const { data, error } = await supabase
    .from("role_permissions")
    .select("allowed, permissions!role_permissions_permission_id_fkey(module, action)")
    .in("role_id", roleIds)
    .eq("allowed", true);
  if (error) throw error;
  const out: PermMap = {};
  for (const row of (data ?? []) as any[]) {
    const p = row.permissions;
    if (!p) continue;
    if (!out[p.module]) out[p.module] = { view: false, create: false, edit: false, delete: false };
    out[p.module][p.action as string] = true;
  }
  return out;
}

/** Full payload used as the ["permissions", userId, propertyId] cache value. */
export async function fetchPermissionsPayload(
  userId: string,
  propertyId: string | null,
): Promise<PermissionsPayload> {
  const ctx = await fetchRoleContext(userId, propertyId);
  const map = await fetchPermissionMapForRoles(ctx.roleIds);
  return { map, roleIds: ctx.roleIds };
}
