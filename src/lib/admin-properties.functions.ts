import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

interface DeletePropertyInput {
  property_id: string;
  confirm_name: string;
}

/**
 * Superadmin-only: hard-delete a property and ALL its data.
 * Foreign keys on every related table use ON DELETE CASCADE, so a single
 * DELETE on `properties` removes bookings, rooms, staff, folios, etc.
 */
export const deleteProperty = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: DeletePropertyInput) => {
    if (!input?.property_id) throw new Error("property_id required");
    if (!input?.confirm_name) throw new Error("confirm_name required");
    return input;
  })
  .handler(async ({ data, context }) => {
    const { data: isSuper } = await context.supabase.rpc("is_superadmin", {
      _uid: context.userId,
    });
    if (!isSuper) throw new Error("Only superadmin can delete a property");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");

    const { data: prop, error: fetchErr } = await supabaseAdmin
      .from("properties")
      .select("id, name")
      .eq("id", data.property_id)
      .maybeSingle();
    if (fetchErr) throw fetchErr;
    if (!prop) throw new Error("Property not found");
    if ((prop as { name: string }).name !== data.confirm_name) {
      throw new Error("Confirmation name does not match");
    }

    const { error: delErr } = await supabaseAdmin
      .from("properties")
      .delete()
      .eq("id", data.property_id);
    if (delErr) throw delErr;

    return { ok: true, deleted_id: data.property_id };
  });