import { supabase } from "@/integrations/supabase/client";

/**
 * Transactional booking creation.
 *
 * Everything that used to be ~13 sequential client writes in
 * `front-desk.new.tsx` now happens inside one Postgres function
 * (`public.create_booking`), so a mid-chain failure can no longer leave
 * orphan guests/bookings behind.
 *
 * Deliberately NOT included (they don't belong in a DB transaction):
 *  - Google Drive ID-document upload
 *  - WhatsApp trigger fire
 * Both stay as client-side calls made AFTER this resolves.
 */
export interface CreateBookingGuest {
  /** Existing guest to update; omit to create/dedupe. */
  guest_id?: string | null;
  name: string;
  mobile?: string | null;
  email?: string | null;
  dob?: string | null;
  id_proof_type?: string | null;
  id_proof_number?: string | null;
  address?: string | null;
  city?: string | null;
  state?: string | null;
  /** Single source of truth — written to BOTH `nationality` and `country`. */
  nation?: string | null;
  gst_number?: string | null;
  company?: string | null;
  notes?: string | null;
  tags?: string[];
}

export interface CreateBookingExtraGuest {
  name: string;
  age?: string | number | null;
  id_proof_type?: string | null;
  id_proof_number?: string | null;
  relation?: string | null;
}

/** One room line of a (possibly multi-room) booking. */
export interface CreateBookingRoom {
  category_id?: string | null;
  room_id?: string | null;
  assign_later?: boolean;
  tariff_id?: string | null;
  meal_plan?: string;
  rate?: number;
  check_in?: string;
  check_out?: string;
  adults?: number;
  children?: number;
}

export interface CreateBookingPayload {
  property_id: string;
  check_in_now: boolean;
  guest: CreateBookingGuest;
  /** When false, an exact mobile/ID match is ignored and a new guest is created. */
  reuse_duplicate_guest?: boolean;

  check_in: string;
  check_out: string;
  adults?: number;
  children?: number;
  category_id?: string | null;
  room_id?: string | null;
  assign_later?: boolean;
  tariff_id?: string | null;
  meal_plan?: string;
  rate?: number;
  rate_type?: "exclusive" | "inclusive";
  /**
   * Multi-room bookings. When present and non-empty this replaces the
   * single-room fields above; both are handled inside the same transaction.
   */
  rooms?: CreateBookingRoom[];

  extra_bed_qty?: number;
  extra_bed_rate?: number;
  /** Per-room extra beds (wizard). Each becomes a booking_extra_beds row. */
  extra_beds?: Array<{ qty: number; rate: number; from_date?: string | null }>;
  /** Early check-in charges posted to the folio in the same transaction. */
  early_checkins?: Array<{ amount: number; description?: string | null; charged_on?: string | null }>;

  total_amount?: number;
  balance_amount?: number;
  advance?: number;
  payment_mode?: string;
  payment_ref?: string | null;

  source?: string;
  ota_partner_name?: string | null;
  billing_company_id?: string | null;
  notes?: string | null;
  custom_remark?: string | null;
  event_id?: string | null;
  block_id?: string | null;
  extra_guests?: CreateBookingExtraGuest[];
  /** Display name of the acting user, for the activity trail. */
  actor_name?: string | null;
}

export interface CreateBookingResult {
  booking_id: string;
  booking_number: string | null;
  guest_id: string;
  room_id: string | null;
  folio_id: string | null;
}

export async function createBooking(payload: CreateBookingPayload): Promise<CreateBookingResult> {
  const { data, error } = await supabase.rpc("create_booking" as never, {
    payload: payload as unknown as Record<string, unknown>,
  } as never);
  if (error) throw error;
  return data as unknown as CreateBookingResult;
}