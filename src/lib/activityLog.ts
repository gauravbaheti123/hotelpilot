/* eslint-disable @typescript-eslint/no-explicit-any */
import { supabase } from "@/integrations/supabase/client";

export interface ActivityLogInput {
  property_id: string;
  user_id: string;
  user_name: string;
  action_type: string;
  module: string;
  reference_id?: string | null;
  reference_label?: string | null;
  details?: Record<string, any>;
}

/**
 * Fire-and-forget activity log writer. Never throws — failures are logged
 * to the console so we never block a successful mutation on logging.
 */
export async function logActivity(input: ActivityLogInput): Promise<void> {
  try {
    if (!input.property_id || !input.user_id) return;
    await supabase.from("activity_log" as any).insert({
      property_id: input.property_id,
      user_id: input.user_id,
      user_name: input.user_name || "Unknown",
      action_type: input.action_type,
      module: input.module,
      reference_id: input.reference_id ?? null,
      reference_label: input.reference_label ?? null,
      details: input.details ?? {},
    } as any);
  } catch (err) {
    console.warn("[activityLog] failed", err);
  }
}

/** Resolve a friendly display name for the current user. */
export function userDisplayName(user: { email?: string | null; user_metadata?: any } | null): string {
  if (!user) return "System";
  const meta = user.user_metadata ?? {};
  return meta.name || meta.full_name || user.email || "Unknown";
}

export const ACTIVITY = {
  BOOKING_CREATED: { action_type: "BOOKING_CREATED", module: "Front Desk" },
  BOOKING_MODIFIED: { action_type: "BOOKING_MODIFIED", module: "Front Desk" },
  CHECKIN: { action_type: "CHECKIN", module: "Front Desk" },
  CHECKOUT: { action_type: "CHECKOUT", module: "Front Desk" },
  BILL_CREATED: { action_type: "BILL_CREATED", module: "Billing" },
  PAYMENT_RECEIVED: { action_type: "PAYMENT_RECEIVED", module: "Billing" },
  KOT_CREATED: { action_type: "KOT_CREATED", module: "Food" },
  KOT_EDITED: { action_type: "KOT_EDITED", module: "Food" },
  KOT_VOIDED: { action_type: "KOT_VOIDED", module: "Food" },
  KOT_DELETED: { action_type: "KOT_DELETED", module: "Food" },
  ROOM_STATUS_CHANGED: { action_type: "ROOM_STATUS_CHANGED", module: "Rooms" },
  BILL_VOIDED: { action_type: "BILL_VOIDED", module: "Billing" },
  BILL_DELETED: { action_type: "BILL_DELETED", module: "Billing" },
  BILL_NUMBER_EDITED: { action_type: "BILL_NUMBER_EDITED", module: "Billing" },
  PAYMENT_MODE_CHANGED: { action_type: "PAYMENT_MODE_CHANGED", module: "Billing" },
  BILL_TO_CHANGED: { action_type: "BILL_TO_CHANGED", module: "Billing" },
  EARLY_CHECKOUT_CHOICE: { action_type: "EARLY_CHECKOUT_CHOICE", module: "Front Desk" },
} as const;