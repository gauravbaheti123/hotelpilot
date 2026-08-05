import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { usePropertyId } from "./use-property";
import {
  applyRoomStatusColorOverrides,
  type RoomStatusColorOverride,
} from "@/lib/roomStatusColors";

export const ROOM_STATUS_COLORS_QK = "room-status-colors";

/**
 * Loads the current property's room-status colour overrides and applies them
 * to the shared palette (src/lib/roomStatusColors.ts). Mounted once in
 * AppShell so every screen using the palette picks the overrides up.
 */
export function useRoomStatusColorOverrides() {
  const propertyId = usePropertyId();
  const { data } = useQuery({
    queryKey: [ROOM_STATUS_COLORS_QK, propertyId],
    enabled: !!propertyId,
    staleTime: 5 * 60_000,
    gcTime: 30 * 60_000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("room_status_color_settings")
        .select("status,bg_color,fg_color")
        .eq("property_id", propertyId!);
      if (error) return [] as RoomStatusColorOverride[];
      return (data ?? []) as RoomStatusColorOverride[];
    },
  });

  // Apply synchronously during render so the first paint after the fetch
  // already uses the custom palette.
  applyRoomStatusColorOverrides(data ?? []);
  useEffect(() => {
    applyRoomStatusColorOverrides(data ?? []);
  }, [data]);

  return data ?? [];
}

export function useInvalidateRoomStatusColors() {
  const qc = useQueryClient();
  return () => qc.invalidateQueries({ queryKey: [ROOM_STATUS_COLORS_QK] });
}
