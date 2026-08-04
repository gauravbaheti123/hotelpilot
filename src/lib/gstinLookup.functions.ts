// Thin server-function wrapper for the GSTIN lookup.
import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import type { GstinLookupResult } from "@/lib/gstinLookup.server";

export const gstinLookup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: { gstin: string }) => input)
  .handler(async ({ data }): Promise<GstinLookupResult> => {
    const { isWellFormedGstin, lookupGstin, normalizeGstin } = await import("@/lib/gstinLookup.server");
    const gstin = normalizeGstin(data?.gstin ?? "");
    if (!isWellFormedGstin(gstin)) {
      return { status: 400, body: { error: "Invalid GSTIN format" } };
    }
    const apiKey = process.env["GSTINAPI_KEY"];
    if (!apiKey) return { status: 500, body: { error: "GST lookup is not configured." } };
    return lookupGstin(gstin, apiKey);
  });
