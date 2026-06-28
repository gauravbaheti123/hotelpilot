import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AppRole = "manager" | "receptionist" | "housekeeping" | "kitchen";

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