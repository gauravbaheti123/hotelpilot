// Edit wizard — Stay & Room step.
//
// This is a UI wrapper only. Saving is done by saveStayEdits() in
// src/lib/bookingEdit.ts, which replays the existing "Shift room" /
// "Modify dates" operations. Nothing here writes to the database.
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { supabase } from "@/integrations/supabase/client";
import { fetchAvailableRooms } from "@/lib/roomAvailability";
import { reportQueryError } from "@/lib/queryError";
import { isValidStayRange, nightsBetween } from "@/lib/front-desk";
import { useDiscountLimit } from "@/hooks/use-discount-limit";
import { usePermissions } from "@/hooks/use-permissions";
import { canApplyDiscount, describeLimit } from "@/lib/discountLimit";
import { findStayConflicts, stayHasChanges, type StayEdit, type StayRoomEdit } from "@/lib/bookingEdit";

interface RoomOption {
  id: string;
  room_number: string;
  category_id: string | null;
  category_name: string | null;
}

interface Props {
  propertyId: string;
  status: string;
  stay: StayEdit;
  onChange: (p: Partial<StayEdit>) => void;
  /** Reports validation problems so the shell can block Next / Save. */
  onBlockedChange: (blocked: boolean) => void;
}

export function StepEditStayRoom({ propertyId, status, stay, onChange, onBlockedChange }: Props) {
  const checkedIn = status === "checked_in";
  const { limit } = useDiscountLimit();
  const { can } = usePermissions();
  // Correcting the check-in date of an in-house guest is a high-trust
  // override, so it reuses the existing `bookings.delete` permission
  // (Manager / Admin / Owner in the role grid).
  const canEditCheckIn = !checkedIn || can("bookings", "delete");
  const [conflict, setConflict] = useState<string | null>(null);
  const [options, setOptions] = useState<RoomOption[]>([]);
  const [loading, setLoading] = useState(false);

  // Reserved: `available_rooms` for the (possibly new) date range.
  // Checked in: every vacant room, exactly what the Shift Room dialog offers —
  // it imposes no same-category constraint, so neither do we.
  useEffect(() => {
    let alive = true;
    (async () => {
      if (!propertyId) return;
      setLoading(true);
      try {
        if (checkedIn) {
          const { data, error } = await supabase
            .from("rooms")
            .select("id, room_number, category_id, status, room_categories(name)")
            .eq("property_id", propertyId)
            .eq("status", "vacant")
            .order("room_number");
          if (error) reportQueryError("rooms", error);
          if (!alive) return;
          setOptions(((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
            id: r.id as string,
            room_number: (r.room_number as string) ?? "",
            category_id: (r.category_id as string) ?? null,
            category_name: ((r.room_categories ?? null) as { name?: string } | null)?.name ?? null,
          })));
        } else {
          if (!isValidStayRange(stay.checkIn, stay.checkOut)) { setOptions([]); return; }
          const rows = await fetchAvailableRooms(propertyId, stay.checkIn, stay.checkOut);
          const { data: cats } = await supabase
            .from("room_categories").select("id,name").eq("property_id", propertyId);
          const nameById = new Map(((cats ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
          if (!alive) return;
          setOptions(rows.map((r) => ({
            id: r.id,
            room_number: r.room_number,
            category_id: r.category_id,
            category_name: r.category_id ? nameById.get(r.category_id) ?? null : null,
          })));
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [propertyId, checkedIn, stay.checkIn, stay.checkOut]);

  function patchRoom(idx: number, p: Partial<StayRoomEdit>) {
    const next = stay.rooms.map((r, i) => (i === idx ? { ...r, ...p } : r));
    onChange({ rooms: next });
  }

  const rateProblems = useMemo(() => {
    return stay.rooms.map((r) => {
      if (r.rate <= 0) return "Enter a nightly tariff";
      if (r.rate >= r.origRate - 0.01) return null;
      const chk = canApplyDiscount(limit, { discountRupees: r.origRate - r.rate, base: r.origRate });
      return chk.allowed ? null : (chk.reason ?? describeLimit(limit));
    });
  }, [stay.rooms, limit]);

  const datesValid = isValidStayRange(stay.checkIn, stay.checkOut);
  const checkInChanged = stay.checkIn !== stay.origCheckIn;

  // Double-booking guard for a moved check-in date.
  useEffect(() => {
    if (!checkInChanged || !datesValid) { setConflict(null); return; }
    let alive = true;
    const t = setTimeout(async () => {
      const clashes = await findStayConflicts("", stay.checkIn, stay.checkOut, stay.rooms.map((r) => ({
        roomId: r.roomId ?? r.origRoomId, roomNumber: r.roomNumber ?? r.origRoomNumber,
      })));
      if (!alive) return;
      setConflict(clashes.length ? `Room ${clashes.join(", ")} is already booked in this date range.` : null);
    }, 250);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [checkInChanged, datesValid, stay.checkIn, stay.checkOut]);

  const changed = stayHasChanges(stay);
  const needsReason = checkedIn && changed && !stay.reason.trim();
  const blocked =
    !datesValid ||
    !!conflict ||
    rateProblems.some(Boolean) ||
    needsReason ||
    stay.rooms.some((r) => checkedIn && r.roomId !== r.origRoomId && !r.roomId);

  useEffect(() => { onBlockedChange(blocked); }, [blocked, onBlockedChange]);

  return (
    <div className="space-y-6">
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">Check-in date</Label>
          <Input
            type="date"
            value={stay.checkIn}
            disabled={!canEditCheckIn}
            onChange={(e) => onChange({ checkIn: e.target.value })}
          />
          {checkedIn && !canEditCheckIn && (
            <p className="text-[11px] text-muted-foreground">
              Locked — the guest has already checked in. A manager can correct this date.
            </p>
          )}
          {checkedIn && canEditCheckIn && (
            <p className="text-[11px] text-muted-foreground">
              Correction only — room charges are recalculated for the new night count.
            </p>
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs">Check-out date</Label>
          <Input
            type="date"
            value={stay.checkOut}
            onChange={(e) => onChange({ checkOut: e.target.value })}
          />
        </div>
      </div>

      {!datesValid ? (
        <p className="text-xs text-destructive">Check-out must be after check-in.</p>
      ) : conflict ? (
        <p className="text-xs text-destructive">{conflict}</p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {nightsBetween(stay.checkIn, stay.checkOut)} night(s)
          {(stay.checkOut !== stay.origCheckOut || checkInChanged) && " · room charges will be refreshed for the new night count"}
        </p>
      )}

      <div className="space-y-4">
        {stay.rooms.map((r, idx) => {
          const picked = options.find((o) => o.id === r.roomId);
          const roomChanged = r.roomId !== r.origRoomId;
          return (
            <div key={r.bookingRoomId} className="rounded-md border p-3 space-y-3">
              <div className="text-xs text-muted-foreground">
                Currently Room {r.origRoomNumber ?? "—"} ({r.origCategoryName ?? "—"}) @ ₹{r.origRate}/night
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label className="text-xs">Room {checkedIn && <span className="text-muted-foreground">(vacant rooms only)</span>}</Label>
                  <SearchableSelect
                    value={r.roomId ?? ""}
                    onChange={(v) => {
                      const o = options.find((x) => x.id === v);
                      patchRoom(idx, {
                        roomId: v || null,
                        categoryId: o?.category_id ?? r.categoryId,
                        roomNumber: o?.room_number ?? null,
                        categoryName: o?.category_name ?? null,
                      });
                    }}
                    placeholder={loading ? "Loading rooms…" : "Keep current room"}
                    searchPlaceholder="Search by room number or category…"
                    options={options
                      .filter((o) => !stay.rooms.some((x, i) => i !== idx && x.roomId === o.id))
                      .map((o) => ({
                        value: o.id,
                        label: `Room ${o.room_number}`,
                        hint: o.category_name ?? undefined,
                        keywords: o.category_name ?? "",
                      })) as SearchableOption[]}
                  />
                  {roomChanged && (
                    <p className="text-[11px] text-muted-foreground">
                      {checkedIn
                        ? `Will be moved via Shift Room to ${picked ? `Room ${picked.room_number}` : "the selected room"}, transferring any open kitchen orders.`
                        : `Reassigned to ${picked ? `Room ${picked.room_number}` : "the selected room"}.`}
                    </p>
                  )}
                  {checkedIn && roomChanged && !r.roomId && (
                    <p className="text-[11px] text-destructive">Pick a target room.</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label className="text-xs">Nightly tariff (₹)</Label>
                  <Input
                    type="number"
                    min={0}
                    value={r.rate === 0 ? "" : String(r.rate)}
                    onChange={(e) => patchRoom(idx, { rate: Number(e.target.value) || 0 })}
                  />
                  {rateProblems[idx] ? (
                    <p className="text-[11px] text-destructive">{rateProblems[idx]}</p>
                  ) : (
                    Math.abs(r.rate - r.origRate) > 0.009 && (
                      <p className="text-[11px] text-muted-foreground">
                        {checkedIn
                          ? "Applies from today onward — nights already billed keep their original tariff."
                          : "Applies to the whole stay."}
                      </p>
                    )
                  )}
                </div>
              </div>
            </div>
          );
        })}
        {stay.rooms.length === 0 && (
          <p className="text-sm text-muted-foreground">No room lines on this booking.</p>
        )}
      </div>

      {checkedIn && changed && (
        <div className="space-y-1.5">
          <Label className="text-xs">Reason *</Label>
          <Textarea
            rows={2}
            value={stay.reason}
            onChange={(e) => onChange({ reason: e.target.value })}
            placeholder="e.g. Plumbing issue, guest upgrade request, extended stay"
          />
          <p className="text-[11px] text-muted-foreground flex items-center gap-1">
            <AlertTriangle className="h-3 w-3" /> Recorded on the room-shift audit trail.
          </p>
        </div>
      )}

      {loading && (
        <p className="text-xs text-muted-foreground flex items-center gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> Checking room availability…
        </p>
      )}
    </div>
  );
}
