/**
 * Part 2 (perf) — shared, cached reads for the room master data that was
 * previously fetched independently by 10+ screens (3,645 DB calls for the
 * same rows). One TanStack Query cache entry per property, so navigating
 * between Front Desk / Housekeeping / Reports / Banquet reuses it.
 */
import { useCallback } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { reportQueryError } from "@/lib/queryError";
import { fetchTariffPlans, type TariffPlan } from "@/lib/tariff";

/**
 * Canonical room row — a superset of the columns the individual call sites
 * used to select, so every consumer can share one cache entry and filter
 * client-side (vacant-only, by category, …).
 */
export interface SharedRoom {
  id: string;
  room_number: string;
  floor: string | null;
  category_id: string | null;
  status: string;
  housekeeping_status: string;
  is_active: boolean;
  room_categories: { name: string } | null;
  /** Flattened convenience alias of room_categories.name. */
  category_name: string | null;
}

export interface SharedRoomCategory {
  id: string;
  name: string;
}

const ROOM_SELECT =
  "id,room_number,floor,category_id,status,housekeeping_status,is_active,room_categories(name)";

/** Rooms change on check-in/out, so keep this shorter than the masters. */
const ROOMS_STALE = 2 * 60_000;
/** Categories are master data — effectively static during a shift. */
const MASTER_STALE = 5 * 60_000;
const GC = 30 * 60_000;

export const roomsQueryKey = (propertyId: string | null | undefined) =>
  ["rooms", propertyId ?? null] as const;
export const roomCategoriesQueryKey = (propertyId: string | null | undefined) =>
  ["room-categories", propertyId ?? null] as const;
export const tariffPlansQueryKey = (propertyId: string | null | undefined) =>
  ["tariff-plans", propertyId ?? null] as const;

/**
 * All active rooms for a property, ordered by floor then room number.
 * Keyed by propertyId so switching property (superadmin) refetches.
 */
export function useRooms(propertyId: string | null | undefined) {
  const qc = useQueryClient();
  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: roomsQueryKey(propertyId),
    enabled: !!propertyId,
    staleTime: ROOMS_STALE,
    gcTime: GC,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SharedRoom[]> => {
      const { data, error } = await supabase
        .from("rooms")
        .select(ROOM_SELECT)
        .eq("property_id", propertyId!)
        .eq("is_active", true)
        .order("floor", { ascending: true })
        .order("room_number", { ascending: true });
      if (error) reportQueryError("rooms", error);
      return ((data ?? []) as unknown as SharedRoom[]).map((r) => ({
        ...r,
        category_name: r.room_categories?.name ?? null,
      }));
    },
  });

  /** Call after a mutation that changes room status / housekeeping status. */
  const reload = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: roomsQueryKey(propertyId) });
  }, [qc, propertyId]);

  return { rooms: data ?? [], loading: isLoading, fetching: isFetching, refetch, reload };
}

/** Room categories master (id + name), ordered by name. */
export function useRoomCategories(propertyId: string | null | undefined) {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: roomCategoriesQueryKey(propertyId),
    enabled: !!propertyId,
    staleTime: MASTER_STALE,
    gcTime: GC,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<SharedRoomCategory[]> => {
      const { data, error } = await supabase
        .from("room_categories")
        .select("id,name")
        .eq("property_id", propertyId!)
        .order("name");
      if (error) reportQueryError("room categories", error);
      return (data ?? []) as unknown as SharedRoomCategory[];
    },
  });
  const reload = useCallback(async () => {
    await qc.invalidateQueries({ queryKey: roomCategoriesQueryKey(propertyId) });
  }, [qc, propertyId]);
  return { categories: data ?? [], loading: isLoading, reload };
}

/** Active tariff plans — fetched alongside rooms on most of the same screens. */
export function useTariffPlans(propertyId: string | null | undefined) {
  const { data, isLoading } = useQuery({
    queryKey: tariffPlansQueryKey(propertyId),
    enabled: !!propertyId,
    staleTime: MASTER_STALE,
    gcTime: GC,
    refetchOnWindowFocus: false,
    queryFn: async (): Promise<TariffPlan[]> => {
      try {
        return await fetchTariffPlans(propertyId!);
      } catch (e) {
        reportQueryError("tariff plans", e as never);
        return [];
      }
    },
  });
  return { plans: data ?? [], loading: isLoading };
}