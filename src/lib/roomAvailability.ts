import { supabase } from "@/integrations/supabase/client";

export interface AvailableRoom {
  id: string;
  room_number: string;
  category_id: string | null;
  status: string;
  floor: string | null;
}

/**
 * Rooms genuinely bookable for a date range.
 *
 * Backed by the `available_rooms` RPC, which excludes:
 *  - rooms whose status is not `vacant` (dirty / maintenance / occupied)
 *  - rooms held by an overlapping, non-cancelled booking_rooms row
 *  - rooms blocked by a banquet event (`event_room_blocks`) for an
 *    overlapping range — an exclusion no client-side path performed before.
 */
export async function fetchAvailableRooms(
  propertyId: string,
  checkIn: string,
  checkOut: string,
  categoryId?: string | null,
): Promise<AvailableRoom[]> {
  const { data, error } = await supabase.rpc("available_rooms" as never, {
    _property_id: propertyId,
    _check_in: checkIn,
    _check_out: checkOut,
    _category_id: categoryId || null,
  } as never);
  if (error) throw error;
  return (data ?? []) as unknown as AvailableRoom[];
}