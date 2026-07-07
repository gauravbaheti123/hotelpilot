import { useEffect, useMemo, useState } from "react";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useAuth } from "@/hooks/use-auth";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { Loader2, BedDouble, Sparkles } from "lucide-react";

interface RoomOption {
  id: string;
  room_number: string;
  category_id: string | null;
  category_name: string;
  base_rate: number;
  status: string;
  housekeeping_status: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  bookingRoomId: string;
  propertyId: string;
  bookingId: string;
  bookingNumber?: string | null;
  categoryId: string | null;
  categoryName?: string | null;
  currentRate: number;
  checkIn: string;
  checkOut: string;
  onDone?: () => void;
}

/**
 * Assigns a specific room to a booking_rooms row that was created with
 * room_id = NULL. Suggests vacant rooms of the same category first; allows
 * picking a different-category room with a rate-choice prompt (keep current
 * rate vs. apply the new category's base rate).
 */
export function AssignRoomDialog({
  open, onOpenChange, bookingRoomId, propertyId, bookingId, bookingNumber,
  categoryId, categoryName, currentRate, checkIn, checkOut, onDone,
}: Props) {
  const { user } = useAuth();
  const [rooms, setRooms] = useState<RoomOption[]>([]);
  const [pickedId, setPickedId] = useState<string>("");
  const [rateChoice, setRateChoice] = useState<"keep" | "new_standard">("keep");
  const [search, setSearch] = useState("");
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!open) return;
    setPickedId("");
    setRateChoice("keep");
    setSearch("");
    (async () => {
      setLoading(true);
      // Fetch all vacant rooms; RLS scopes to the property.
      const { data, error } = await supabase
        .from("rooms")
        .select("id,room_number,category_id,status,housekeeping_status,room_categories(name,base_rate)")
        .eq("property_id", propertyId)
        .eq("is_active", true)
        .eq("status", "vacant")
        .order("room_number");
      if (error) toast.error(error.message);
      // Exclude rooms already booked for the same date window.
      const roomIds = (data ?? []).map((r: any) => r.id);
      let busyIds = new Set<string>();
      if (roomIds.length > 0) {
        const { data: br } = await supabase
          .from("booking_rooms")
          .select("room_id,check_in,check_out,status,bookings!inner(status)")
          .in("room_id", roomIds)
          .lt("check_in", checkOut)
          .gt("check_out", checkIn);
        for (const row of (br ?? []) as any[]) {
          const bStatus = row.bookings?.status;
          const brStatus = row.status;
          if (
            !["cancelled", "checked_out", "no_show"].includes(bStatus) &&
            ["active", "reserved", "checked_in"].includes(brStatus)
          ) {
            if (row.room_id) busyIds.add(row.room_id);
          }
        }
      }
      const opts: RoomOption[] = (data ?? [])
        .filter((r: any) => !busyIds.has(r.id))
        .map((r: any) => ({
          id: r.id,
          room_number: r.room_number,
          category_id: r.category_id,
          category_name: r.room_categories?.name ?? "—",
          base_rate: Number(r.room_categories?.base_rate ?? 0),
          status: r.status,
          housekeeping_status: r.housekeeping_status,
        }));
      setRooms(opts);
      // Auto-pick first same-category room as the suggestion default.
      const suggested = opts.find((r) => r.category_id === categoryId);
      if (suggested) setPickedId(suggested.id);
      setLoading(false);
    })();
  }, [open, propertyId, categoryId, checkIn, checkOut]);

  const sameCat = useMemo(
    () => rooms.filter((r) => r.category_id === categoryId),
    [rooms, categoryId],
  );
  const otherCat = useMemo(
    () => rooms.filter((r) => r.category_id !== categoryId),
    [rooms, categoryId],
  );

  const picked = rooms.find((r) => r.id === pickedId);
  const isDifferentCat = !!picked && picked.category_id !== categoryId;
  const newRate = isDifferentCat && rateChoice === "new_standard"
    ? picked!.base_rate
    : currentRate;

  function filterMatch(r: RoomOption) {
    if (!search.trim()) return true;
    const s = search.trim().toLowerCase();
    return (
      r.room_number.toLowerCase().includes(s) ||
      r.category_name.toLowerCase().includes(s)
    );
  }

  async function assign() {
    if (!pickedId || !picked) {
      toast.error("Pick a room first");
      return;
    }
    setBusy(true);
    try {
      const update: Record<string, unknown> = {
        room_id: pickedId,
        updated_at: new Date().toISOString(),
      };
      if (isDifferentCat) {
        update.category_id = picked.category_id;
        if (rateChoice === "new_standard" && picked.base_rate > 0) {
          update.rate = picked.base_rate;
        }
      }
      const { error } = await supabase
        .from("booking_rooms")
        .update(update as any)
        .eq("id", bookingRoomId);
      if (error) throw error;
      logActivity({
        property_id: propertyId,
        user_id: user?.id ?? "",
        user_name: userDisplayName(user as any),
        action_type: "ROOM_ASSIGNED",
        module: "Front Desk",
        reference_id: bookingId,
        reference_label: bookingNumber ?? null,
        details: {
          booking_room_id: bookingRoomId,
          to_room_id: pickedId,
          to_room_number: picked.room_number,
          from_category: categoryName ?? null,
          to_category: picked.category_name,
          rate_choice: isDifferentCat ? rateChoice : "same_category",
          new_rate: newRate,
        },
      });
      toast.success(`Assigned room ${picked.room_number}`);
      onOpenChange(false);
      onDone?.();
    } catch (e: any) {
      toast.error(e.message ?? "Could not assign room");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BedDouble className="h-5 w-5" />
            Assign Room
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="rounded border bg-muted/30 p-2 text-xs">
            <div>
              Reservation category:{" "}
              <span className="font-medium">{categoryName ?? "—"}</span>
            </div>
            <div>
              Stay:{" "}
              <span className="font-medium">
                {checkIn} → {checkOut}
              </span>{" "}
              · Current rate: <span className="font-medium">₹{currentRate}</span>
            </div>
          </div>

          <Input
            placeholder="Search room number or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />

          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Loading vacant rooms…
            </div>
          ) : (
            <div className="space-y-3 max-h-72 overflow-y-auto">
              <div>
                <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1 flex items-center gap-1">
                  <Sparkles className="h-3 w-3" /> Suggested — same category
                </div>
                {sameCat.filter(filterMatch).length === 0 ? (
                  <div className="text-xs text-muted-foreground italic">
                    No vacant rooms in this category.
                  </div>
                ) : (
                  <div className="grid gap-1">
                    {sameCat.filter(filterMatch).map((r) => (
                      <RoomTile
                        key={r.id}
                        r={r}
                        active={pickedId === r.id}
                        onClick={() => setPickedId(r.id)}
                      />
                    ))}
                  </div>
                )}
              </div>

              {otherCat.length > 0 && (
                <div>
                  <div className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
                    Other categories
                  </div>
                  <div className="grid gap-1">
                    {otherCat.filter(filterMatch).map((r) => (
                      <RoomTile
                        key={r.id}
                        r={r}
                        active={pickedId === r.id}
                        onClick={() => setPickedId(r.id)}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {isDifferentCat && (
            <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-2">
              <div className="text-xs font-medium text-amber-800">
                Room {picked!.room_number} is in a different category (
                {picked!.category_name}). Pick a rate:
              </div>
              <div className="flex gap-2 text-xs">
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="rateChoice"
                    checked={rateChoice === "keep"}
                    onChange={() => setRateChoice("keep")}
                  />
                  Keep ₹{currentRate}/night
                </label>
                <label className="flex items-center gap-1 cursor-pointer">
                  <input
                    type="radio"
                    name="rateChoice"
                    checked={rateChoice === "new_standard"}
                    onChange={() => setRateChoice("new_standard")}
                    disabled={picked!.base_rate <= 0}
                  />
                  Use category base ₹{picked!.base_rate}/night
                </label>
              </div>
            </div>
          )}

          {picked && (
            <div className="rounded border p-2 text-xs">
              <div>
                Selected: <b>Room {picked.room_number}</b> ·{" "}
                <Badge variant="outline" className="text-[10px]">
                  {picked.category_name}
                </Badge>
              </div>
              <div className="text-muted-foreground mt-0.5">
                Rate on assignment:{" "}
                <span className="font-medium text-foreground">
                  ₹{newRate}/night
                </span>
              </div>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={assign} disabled={busy || !pickedId}>
            {busy && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
            Assign Room
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  function RoomTile({
    r, active, onClick,
  }: {
    r: RoomOption;
    active: boolean;
    onClick: () => void;
  }) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`w-full text-left rounded border p-2 text-sm flex items-center justify-between ${
          active ? "border-primary bg-primary/5" : "hover:bg-accent/50"
        }`}
      >
        <div>
          <div className="font-medium">Room {r.room_number}</div>
          <div className="text-[10px] text-muted-foreground">
            {r.category_name} · ₹{r.base_rate}/night ·{" "}
            <span className="uppercase">{r.housekeeping_status}</span>
          </div>
        </div>
        {active && <Badge variant="outline" className="text-[10px]">Picked</Badge>}
      </button>
    );
  }
}

/**
 * Loads all booking_rooms with room_id = NULL for a property and returns
 * the shape needed by the Unassigned Reservations panel.
 */
export interface UnassignedReservation {
  booking_id: string;
  booking_number: string;
  status: string;
  guest_name: string | null;
  category_id: string | null;
  category_name: string;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  rate: number;
  booking_room_id: string;
}

export async function loadUnassignedReservations(
  propertyId: string,
): Promise<UnassignedReservation[]> {
  const todayIso = new Date().toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("booking_rooms")
    .select(
      "id,category_id,check_in,check_out,rate,adults,children,room_categories(name)," +
      "bookings!inner(id,booking_number,status,check_out,guests:guest_id(name))",
    )
    .eq("property_id", propertyId)
    .is("room_id", null)
    .gte("check_out", todayIso);
  if (error) {
    console.warn("loadUnassignedReservations failed", error);
    return [];
  }
  return ((data ?? []) as any[])
    .filter((row) =>
      ["reserved", "checked_in"].includes(row.bookings?.status),
    )
    .map((row) => ({
      booking_id: row.bookings.id,
      booking_number: row.bookings.booking_number,
      status: row.bookings.status,
      guest_name: row.bookings.guests?.name ?? null,
      category_id: row.category_id,
      category_name: row.room_categories?.name ?? "—",
      check_in: row.check_in,
      check_out: row.check_out,
      adults: row.adults,
      children: row.children,
      rate: Number(row.rate),
      booking_room_id: row.id,
    }));
}