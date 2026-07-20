import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AppRole = "manager" | "receptionist" | "housekeeping" | "kitchen";

/** Fire-and-forget activity log writer for server-fn callers. Never throws. */
async function logServerActivity(
  supabase: any,
  input: {
    property_id: string | null;
    user_id: string | null;
    action_type: string;
    module: string;
    reference_id?: string | null;
    reference_label?: string | null;
    details?: Record<string, unknown>;
  },
) {
  try {
    if (!input.property_id || !input.user_id) return;
    await supabase.from("activity_log").insert({
      property_id: input.property_id,
      user_id: input.user_id,
      user_name: "System",
      action_type: input.action_type,
      module: input.module,
      reference_id: input.reference_id ?? null,
      reference_label: input.reference_label ?? null,
      details: input.details ?? {},
    });
  } catch {
    /* ignore */
  }
}

async function assertCallerIsOwnerOrSuper(context: any) {
  const { data: isSuper } = await context.supabase.rpc("is_superadmin", { _uid: context.userId });
  if (isSuper) return true;
  const { data: isOwnerSuper } = await context.supabase.rpc("is_owner_or_super", { _user_id: context.userId });
  if (!isOwnerSuper) throw new Error("Not authorised");
  return false;
}

async function callerIsSuper(context: any): Promise<boolean> {
  const { data } = await context.supabase.rpc("is_superadmin", { _uid: context.userId });
  return !!data;
}

async function callerHasProperty(context: any, propertyId: string | null | undefined): Promise<boolean> {
  if (!propertyId) return await callerIsSuper(context);
  const { data } = await context.supabase.rpc("user_has_property", {
    _uid: context.userId,
    _prop: propertyId,
  });
  return !!data;
}

function isPrivilegedRoleName(name: string | null | undefined): boolean {
  return !!name && /^(owner|superadmin)$/i.test(name);
}

export const createStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: {
    name: string; email: string; password: string;
    role: AppRole; property_id: string; role_id?: string | null; active?: boolean;
  }) => {
    if (!i?.email || !i?.password || !i?.role || !i?.property_id) {
      throw new Error("email, password, role, property_id required");
    }
    if (i.password.length < 8) throw new Error("Password must be 8+ chars");
    if (i.role === ("superadmin" as any) || i.role === ("owner" as any)) {
      throw new Error("Cannot create privileged users here");
    }
    return i;
  })
  .handler(async ({ data, context }) => {
    await assertCallerIsOwnerOrSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    let userId: string | null = null;
    const created = await supabaseAdmin.auth.admin.createUser({
      email: data.email,
      password: data.password,
      email_confirm: true,
      user_metadata: data.name ? { name: data.name } : undefined,
    });
    if (created.error) {
      const msg = created.error.message.toLowerCase();
      if (msg.includes("already") || msg.includes("registered") || msg.includes("exists")) {
        let page = 1;
        while (page <= 20 && !userId) {
          const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({ page, perPage: 200 });
          if (error) throw error;
          const found = list.users.find((u) => (u.email ?? "").toLowerCase() === data.email.toLowerCase());
          if (found) { userId = found.id; break; }
          if (list.users.length < 200) break;
          page++;
        }
        if (!userId) throw new Error("User exists but could not be located");
      } else throw created.error;
    } else userId = created.data.user?.id ?? null;
    if (!userId) throw new Error("Failed to create user");

    const { data: existing } = await supabaseAdmin
      .from("user_roles").select("id")
      .eq("user_id", userId).eq("property_id", data.property_id)
      .eq("role", data.role).maybeSingle();
    if (!existing) {
      const { error: rErr } = await supabaseAdmin.from("user_roles").insert({
        user_id: userId, role: data.role, property_id: data.property_id,
        role_id: data.role_id ?? null,
      });
      if (rErr) throw rErr;
    } else if (data.role_id) {
      await supabaseAdmin.from("user_roles").update({ role_id: data.role_id }).eq("id", existing.id);
    }
    await logServerActivity(supabaseAdmin, {
      property_id: data.property_id,
      user_id: context.userId,
      action_type: "USER_CREATED",
      module: "Superadmin",
      reference_id: userId,
      reference_label: data.email,
      details: {
        user_id: userId,
        email: data.email,
        role_name: data.role,
        property_id: data.property_id,
        created_by: context.userId,
      },
    });
    await logServerActivity(supabaseAdmin, {
      property_id: data.property_id,
      user_id: context.userId,
      action_type: "USER_ROLE_ASSIGNED",
      module: "Superadmin",
      reference_id: userId,
      reference_label: data.email,
      details: {
        user_id: userId,
        email: data.email,
        role_name: data.role,
        property_id: data.property_id,
        created_by: context.userId,
      },
    });
    return { user_id: userId, email: data.email };
  });

export const resetStaffPassword = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { user_id: string; password: string }) => {
    if (!i?.user_id || !i?.password) throw new Error("user_id, password required");
    if (i.password.length < 8) throw new Error("Password must be 8+ chars");
    return i;
  })
  .handler(async ({ data, context }) => {
    await assertCallerIsOwnerOrSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    // Prevent targeting a superadmin unless caller is superadmin
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", data.user_id);
    const isTargetSuper = (targetRoles ?? []).some((r: any) => r.role === "superadmin");
    if (isTargetSuper) {
      const { data: callerSuper } = await context.supabase.rpc("is_superadmin", { _uid: context.userId });
      if (!callerSuper) throw new Error("Cannot modify a superadmin");
    }
    const { error } = await supabaseAdmin.auth.admin.updateUserById(data.user_id, { password: data.password });
    if (error) throw error;
    return { ok: true };
  });

export const deleteStaffUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { user_id: string }) => {
    if (!i?.user_id) throw new Error("user_id required");
    return i;
  })
  .handler(async ({ data, context }) => {
    await assertCallerIsOwnerOrSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles").select("role").eq("user_id", data.user_id);
    const hasPrivileged = (targetRoles ?? []).some((r: any) => r.role === "superadmin" || r.role === "owner");
    if (hasPrivileged) {
      const { data: callerSuper } = await context.supabase.rpc("is_superadmin", { _uid: context.userId });
      if (!callerSuper) throw new Error("Cannot delete an owner or superadmin");
    }
    if (data.user_id === context.userId) throw new Error("Cannot delete yourself");
    await supabaseAdmin.from("user_roles").delete().eq("user_id", data.user_id);
    const { error } = await supabaseAdmin.auth.admin.deleteUser(data.user_id);
    if (error) throw error;
    return { ok: true };
  });

/* -------------------------------------------------------------------------- */
/* Privileged table writes — replace direct browser supabase writes.          */
/* Every handler validates: caller role, target role, property ownership.     */
/* -------------------------------------------------------------------------- */

export const assignRoleTemplate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { ur_id: string; role_id: string | null }) => {
    if (!i?.ur_id) throw new Error("ur_id required");
    return i;
  })
  .handler(async ({ data, context }) => {
    await assertCallerIsOwnerOrSuper(context);
    const isSuper = await callerIsSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: ur, error: urErr } = await supabaseAdmin
      .from("user_roles")
      .select("id, user_id, role, property_id")
      .eq("id", data.ur_id)
      .maybeSingle();
    if (urErr) throw urErr;
    if (!ur) throw new Error("Assignment not found");

    // Block modifying privileged targets unless caller is superadmin.
    if ((ur.role === "owner" || ur.role === "superadmin") && !isSuper) {
      throw new Error("Cannot modify an owner or superadmin assignment");
    }
    // Property scope: non-superadmin caller must own the property.
    if (!isSuper && !(await callerHasProperty(context, ur.property_id))) {
      throw new Error("Not authorised for this property");
    }

    if (data.role_id) {
      const { data: tpl, error: tErr } = await supabaseAdmin
        .from("roles")
        .select("id, name, property_id")
        .eq("id", data.role_id)
        .maybeSingle();
      if (tErr) throw tErr;
      if (!tpl) throw new Error("Role template not found");
      if (isPrivilegedRoleName(tpl.name) && !isSuper) {
        throw new Error("Only a superadmin can assign an owner or superadmin template");
      }
      // Owners cannot assign a template from another property
      if (!isSuper && tpl.property_id && ur.property_id && tpl.property_id !== ur.property_id) {
        throw new Error("Role template belongs to a different property");
      }
    }

    const { error } = await supabaseAdmin
      .from("user_roles")
      .update({ role_id: data.role_id ?? null })
      .eq("id", data.ur_id);
    if (error) throw error;
    await logServerActivity(supabaseAdmin, {
      property_id: ur.property_id,
      user_id: context.userId,
      action_type: "USER_ROLE_ASSIGNED",
      module: "Superadmin",
      reference_id: ur.user_id,
      reference_label: null,
      details: {
        user_id: ur.user_id,
        role_name: ur.role,
        property_id: ur.property_id,
        role_template_id: data.role_id ?? null,
        created_by: context.userId,
      },
    });
    return { ok: true };
  });

export const setUserActive = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { user_id: string; active: boolean }) => {
    if (!i?.user_id) throw new Error("user_id required");
    return i;
  })
  .handler(async ({ data, context }) => {
    await assertCallerIsOwnerOrSuper(context);
    const isSuper = await callerIsSuper(context);
    if (data.user_id === context.userId) throw new Error("You cannot change your own status");
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: targetRoles } = await supabaseAdmin
      .from("user_roles").select("role, property_id").eq("user_id", data.user_id);
    const hasPrivileged = (targetRoles ?? []).some((r: any) => r.role === "owner" || r.role === "superadmin");
    if (hasPrivileged && !isSuper) throw new Error("Cannot modify an owner or superadmin");
    if (!isSuper) {
      // Owner must share at least one property with the target.
      const ok = await Promise.all(
        (targetRoles ?? []).map((r: any) => callerHasProperty(context, r.property_id)),
      );
      if (!ok.some(Boolean)) throw new Error("Not authorised for this user");
    }
    const { error } = await supabaseAdmin
      .from("profiles").update({ is_active: !!data.active }).eq("id", data.user_id);
    if (error) throw error;
    return { ok: true };
  });

export const createCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: {
    name: string;
    description?: string | null;
    property_id?: string | null;
    clone_from_role_id?: string | null;
  }) => {
    if (!i?.name?.trim()) throw new Error("Name required");
    return i;
  })
  .handler(async ({ data, context }) => {
    await assertCallerIsOwnerOrSuper(context);
    const isSuper = await callerIsSuper(context);
    if (isPrivilegedRoleName(data.name)) {
      throw new Error("Reserved role name");
    }
    let property_id = data.property_id ?? null;
    if (!isSuper) {
      if (!property_id) throw new Error("Property is required");
      if (!(await callerHasProperty(context, property_id))) {
        throw new Error("Not authorised for this property");
      }
    }
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: created, error } = await supabaseAdmin
      .from("roles")
      .insert({
        name: data.name.trim(),
        description: data.description?.trim() || null,
        is_system: false,
        property_id,
      })
      .select("id")
      .single();
    if (error) throw error;

    if (data.clone_from_role_id && created?.id) {
      const { data: src } = await supabaseAdmin
        .from("role_permissions").select("permission_id, allowed").eq("role_id", data.clone_from_role_id);
      if (src?.length) {
        await supabaseAdmin.from("role_permissions").upsert(
          src.map((r: any) => ({ role_id: created.id, permission_id: r.permission_id, allowed: r.allowed })),
          { onConflict: "role_id,permission_id" },
        );
      }
    }
    return { id: created!.id as string };
  });

export const updateRoleMeta = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: {
    role_id: string;
    name?: string;
    description?: string | null;
    max_discount_pct?: number;
    max_discount_type?: "percentage" | "fixed_amount" | "none";
    max_discount_amount?: number;
  }) => {
    if (!i?.role_id) throw new Error("role_id required");
    return i;
  })
  .handler(async ({ data, context }) => {
    await assertCallerIsOwnerOrSuper(context);
    const isSuper = await callerIsSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role, error: rErr } = await supabaseAdmin
      .from("roles").select("id, name, is_system, property_id").eq("id", data.role_id).maybeSingle();
    if (rErr) throw rErr;
    if (!role) throw new Error("Role not found");
    if (isPrivilegedRoleName(role.name) && !isSuper) {
      throw new Error("Cannot modify privileged roles");
    }
    if (role.is_system && !isSuper) throw new Error("System roles are read-only");
    if (!isSuper && role.property_id && !(await callerHasProperty(context, role.property_id))) {
      throw new Error("Not authorised for this property");
    }
    const patch: Record<string, unknown> = {};
    if (typeof data.name === "string") {
      const trimmed = data.name.trim();
      if (!trimmed) throw new Error("Name required");
      if (isPrivilegedRoleName(trimmed) && !isSuper) throw new Error("Reserved role name");
      patch.name = trimmed;
    }
    if (data.description !== undefined) {
      patch.description = (data.description ?? "").toString().trim() || null;
    }
    if (typeof data.max_discount_pct === "number") {
      patch.max_discount_pct = Math.max(0, Math.min(100, data.max_discount_pct));
    }
    if (data.max_discount_type && ["percentage","fixed_amount","none"].includes(data.max_discount_type)) {
      patch.max_discount_type = data.max_discount_type;
    }
    if (typeof data.max_discount_amount === "number") {
      patch.max_discount_amount = Math.max(0, data.max_discount_amount);
    }
    if (Object.keys(patch).length === 0) return { ok: true };
    const { error } = await supabaseAdmin.from("roles").update(patch as any).eq("id", data.role_id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteCustomRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: { role_id: string }) => {
    if (!i?.role_id) throw new Error("role_id required");
    return i;
  })
  .handler(async ({ data, context }) => {
    await assertCallerIsOwnerOrSuper(context);
    const isSuper = await callerIsSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("roles").select("id, name, is_system, property_id").eq("id", data.role_id).maybeSingle();
    if (!role) throw new Error("Role not found");
    if (role.is_system) throw new Error("System roles cannot be deleted");
    if (isPrivilegedRoleName(role.name)) throw new Error("Reserved role");
    if (!isSuper && role.property_id && !(await callerHasProperty(context, role.property_id))) {
      throw new Error("Not authorised for this property");
    }
    const { count } = await supabaseAdmin
      .from("user_roles").select("id", { count: "exact", head: true }).eq("role_id", data.role_id);
    if ((count ?? 0) > 0) throw new Error("Role still assigned to users");
    const { error } = await supabaseAdmin.from("roles").delete().eq("id", data.role_id);
    if (error) throw error;
    return { ok: true };
  });

export const upsertRolePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((i: {
    role_id: string;
    rows: { permission_id: string; allowed: boolean }[];
    max_discount_pct?: number;
    max_discount_type?: "percentage" | "fixed_amount" | "none";
    max_discount_amount?: number;
  }) => {
    if (!i?.role_id) throw new Error("role_id required");
    if (!Array.isArray(i.rows)) throw new Error("rows required");
    return i;
  })
  .handler(async ({ data, context }) => {
    await assertCallerIsOwnerOrSuper(context);
    const isSuper = await callerIsSuper(context);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { data: role } = await supabaseAdmin
      .from("roles").select("id, name, is_system, property_id").eq("id", data.role_id).maybeSingle();
    if (!role) throw new Error("Role not found");
    if (isPrivilegedRoleName(role.name) && !isSuper) {
      throw new Error("Cannot modify privileged roles");
    }
    if (!isSuper && role.property_id && !(await callerHasProperty(context, role.property_id))) {
      throw new Error("Not authorised for this property");
    }

    // Snapshot existing permissions to compute old_value per row.
    const permIds = data.rows.map((r) => r.permission_id);
    const prevMap = new Map<string, boolean>();
    if (permIds.length) {
      const { data: prevRows } = await supabaseAdmin
        .from("role_permissions")
        .select("permission_id, allowed")
        .eq("role_id", data.role_id)
        .in("permission_id", permIds);
      (prevRows ?? []).forEach((r: any) => {
        prevMap.set(r.permission_id as string, !!r.allowed);
      });
    }
    const { data: permMeta } = await supabaseAdmin
      .from("permissions")
      .select("id, module, action")
      .in("id", permIds.length ? permIds : ["00000000-0000-0000-0000-000000000000"]);
    const metaMap = new Map<string, { module: string; action: string }>();
    (permMeta ?? []).forEach((p: any) => metaMap.set(p.id as string, { module: p.module, action: p.action }));

    const rows = data.rows.map((r) => ({
      role_id: data.role_id,
      permission_id: r.permission_id,
      allowed: !!r.allowed,
    }));
    if (rows.length) {
      const { error } = await supabaseAdmin
        .from("role_permissions").upsert(rows, { onConflict: "role_id,permission_id" });
      if (error) throw error;
    }
    for (const r of data.rows) {
      const prev = prevMap.has(r.permission_id) ? prevMap.get(r.permission_id) : null;
      const next = !!r.allowed;
      if (prev === next) continue;
      const m = metaMap.get(r.permission_id);
      await logServerActivity(supabaseAdmin, {
        property_id: role.property_id,
        user_id: context.userId,
        action_type: "PERMISSION_CHANGED",
        module: "Superadmin",
        reference_id: data.role_id,
        reference_label: role.name,
        details: {
          role_name: role.name,
          module: m?.module ?? null,
          action: m?.action ?? null,
          old_value: prev,
          new_value: next,
          changed_by: context.userId,
        },
      });
    }
    if (!/owner/i.test(role.name)) {
      const patch: Record<string, unknown> = {};
      if (typeof data.max_discount_pct === "number") {
        patch.max_discount_pct = Math.max(0, Math.min(100, data.max_discount_pct));
      }
      if (data.max_discount_type && ["percentage","fixed_amount","none"].includes(data.max_discount_type)) {
        patch.max_discount_type = data.max_discount_type;
      }
      if (typeof data.max_discount_amount === "number") {
        patch.max_discount_amount = Math.max(0, data.max_discount_amount);
      }
      if (Object.keys(patch).length > 0) {
        const { error } = await supabaseAdmin
          .from("roles").update(patch as any).eq("id", data.role_id);
        if (error) throw error;
      }
    }
    return { ok: true };
  });