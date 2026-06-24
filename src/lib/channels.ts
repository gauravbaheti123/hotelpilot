import { supabase } from "@/integrations/supabase/client";

export const CHANNEL_PRESETS: { code: string; name: string; commission_pct: number }[] = [
  { code: "booking", name: "Booking.com", commission_pct: 15 },
  { code: "mmt", name: "MakeMyTrip", commission_pct: 18 },
  { code: "goibibo", name: "Goibibo", commission_pct: 18 },
  { code: "agoda", name: "Agoda", commission_pct: 17 },
  { code: "expedia", name: "Expedia", commission_pct: 15 },
  { code: "airbnb", name: "Airbnb", commission_pct: 3 },
  { code: "direct", name: "Direct / Website", commission_pct: 0 },
];

export const SYNC_STATUS_LABEL: Record<string, string> = {
  pending: "Pending",
  success: "Success",
  failed: "Failed",
};

export const SYNC_STATUS_TONE: Record<string, string> = {
  pending: "bg-amber-100 text-amber-800",
  success: "bg-emerald-100 text-emerald-800",
  failed: "bg-rose-100 text-rose-800",
};

export const SYNC_TYPES = ["inventory", "rates", "availability", "bookings"] as const;
export type SyncType = typeof SYNC_TYPES[number];

export async function logSync(opts: {
  property_id: string;
  channel_id: string | null;
  sync_type: SyncType;
  status: "pending" | "success" | "failed";
  message?: string;
  payload?: Record<string, unknown>;
}) {
  return supabase.from("ota_sync_logs").insert({
    property_id: opts.property_id,
    channel_id: opts.channel_id,
    sync_type: opts.sync_type,
    status: opts.status,
    message: opts.message ?? null,
    payload: (opts.payload as never) ?? null,
    finished_at: opts.status !== "pending" ? new Date().toISOString() : null,
  });
}