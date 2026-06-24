import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

type AppRole =
  | "superadmin"
  | "owner"
  | "manager"
  | "receptionist"
  | "housekeeping"
  | "kitchen";

interface CreateOwnerInput {
  email: string;
  password: string;
  role: AppRole;
  property_id: string;
  name?: string;
}

export const createOwnerLogin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: CreateOwnerInput) => {
    if (!input?.email || !input?.password || !input?.role || !input?.property_id) {
      throw new Error("email, password, role, property_id required");
    }
    if (input.password.length < 8) throw new Error("Password must be 8+ chars");
    return input;
  })
  .handler(async ({ data, context }) => {
    // Authorize: only superadmin / owner / manager can mint logins
    const { data: allowed } = await context.supabase.rpc("can_manage_masters", {
      _user_id: context.userId,
    });
    if (!allowed) throw new Error("Not authorised");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    // Try to create the auth user; if it already exists, look it up.
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
        // Find existing user by email
        let page = 1;
        while (page <= 20 && !userId) {
          const { data: list, error } = await supabaseAdmin.auth.admin.listUsers({
            page,
            perPage: 200,
          });
          if (error) throw error;
          const found = list.users.find(
            (u) => (u.email ?? "").toLowerCase() === data.email.toLowerCase(),
          );
          if (found) {
            userId = found.id;
            break;
          }
          if (list.users.length < 200) break;
          page++;
        }
        if (!userId) throw new Error("User exists but could not be located");
      } else {
        throw created.error;
      }
    } else {
      userId = created.data.user?.id ?? null;
    }
    if (!userId) throw new Error("Failed to create user");

    const { error: roleErr } = await supabaseAdmin
      .from("user_roles")
      .upsert(
        { user_id: userId, role: data.role, property_id: data.property_id },
        { onConflict: "user_id,role,property_id" },
      );
    if (roleErr) throw roleErr;

    return { user_id: userId, email: data.email, role: data.role };
  });