import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem,
  DropdownMenuTrigger, DropdownMenuLabel, DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { HK_STATUSES, HK_STATUS_TONE, ROOM_STATUS_TONE, type HkStatus } from "@/lib/housekeeping";
import { MoreVertical } from "lucide-react";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { useAuth } from "@/hooks/use-auth";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/housekeeping/board")({
  head: () => ({ meta: [{ title: "Room Status Board — HotelPilot" }] }),
  component: () => (<RequirePermission module="room_board"><BoardPage /></RequirePermission>),
});

interface RoomRow {
  id: string; room_number: string; floor: string | null;
  status: string; housekeeping_status: string;
  room_categories: { name: string } | null;
}

function BoardPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const { user } = useAuth();
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [filter, setFilter] = useState<"all" | HkStatus>("all");

  const load = useCallback(async () => {
    if (!propertyId) return;
    const { data } = await supabase.from("rooms")
      .select("id,room_number,floor,status,housekeeping_status,room_categories(name)")
      .eq("property_id", propertyId).eq("is_active", true)
      .order("floor", { ascending: true }).order("room_number", { ascending: true });
    setRooms((data ?? []) as unknown as RoomRow[]);
  }, [propertyId]);

  useEffect(() => { load(); }, [load]);

  const grouped = useMemo(() => {
    const filtered = filter === "all" ? rooms : rooms.filter((r) => r.housekeeping_status === filter);
    const map = new Map<string, RoomRow[]>();
    for (const r of filtered) {
      const key = r.floor ?? "Unassigned";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(r);
    }
    return Array.from(map.entries());
  }, [rooms, filter]);

  const counts = useMemo(() => {
    const c: Record<string, number> = { clean: 0, dirty: 0, inspected: 0, out_of_order: 0 };
    for (const r of rooms) c[r.housekeeping_status] = (c[r.housekeeping_status] ?? 0) + 1;
    return c;
  }, [rooms]);

  async function setHk(roomId: string, hk: HkStatus) {
    const prev = rooms.find((r) => r.id === roomId);
    const { error } = await supabase.from("rooms").update({ housekeeping_status: hk }).eq("id", roomId);
    if (error) toast.error(error.message);
    else {
      toast.success("Updated");
      if (propertyId && user && prev) {
        logActivity({
          property_id: propertyId,
          user_id: user.id,
          user_name: userDisplayName(user as never),
          action_type: "HK_STATUS_CHANGED",
          module: "Housekeeping",
          reference_id: roomId,
          reference_label: `Room ${prev.room_number}`,
          details: {
            room_id: roomId,
            room_number: prev.room_number,
            old_status: prev.housekeeping_status,
            new_status: hk,
          },
        });
      }
      load();
    }
  }

  if (!propertyId) return <AppShell title="Room Status Board"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="Room Status Board">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FilterChip label={`All (${rooms.length})`} active={filter === "all"} onClick={() => setFilter("all")} />
        {HK_STATUSES.map((s) => (
          <FilterChip key={s} label={`${s.replace("_", " ")} (${counts[s] ?? 0})`}
            active={filter === s} onClick={() => setFilter(s)} />
        ))}
      </div>

      {grouped.length === 0 && <p className="text-sm text-muted-foreground">No rooms.</p>}

      <div className="space-y-5">
        {grouped.map(([floor, list]) => (
          <div key={floor}>
            <div className="text-xs uppercase tracking-wider text-muted-foreground mb-2">Floor {floor}</div>
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6">
              {list.map((r) => (
                <Card key={r.id} className="overflow-hidden">
                  <CardContent className="p-3">
                    <div className="flex items-start justify-between">
                      <div>
                        <div className="font-semibold">{r.room_number}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{r.room_categories?.name ?? ""}</div>
                      </div>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-6 w-6"><MoreVertical className="h-3 w-3" /></Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Mark as</DropdownMenuLabel>
                          <DropdownMenuSeparator />
                          {HK_STATUSES.map((s) => (
                            <DropdownMenuItem key={s} onClick={() => setHk(r.id, s)}>
                              {s.replace("_", " ")}
                            </DropdownMenuItem>
                          ))}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <div className="flex flex-wrap gap-1 mt-2">
                      <Badge variant="outline" className={`${ROOM_STATUS_TONE[r.status]} text-[10px]`}>{r.status}</Badge>
                      <Badge variant="outline" className={`${HK_STATUS_TONE[r.housekeeping_status]} text-[10px]`}>
                        {r.housekeeping_status.replace("_", " ")}
                      </Badge>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} className={`px-3 py-1.5 rounded-md text-xs border transition-colors ${
      active ? "bg-primary text-primary-foreground border-primary" : "bg-card hover:bg-accent"}`}>
      {label}
    </button>
  );
}