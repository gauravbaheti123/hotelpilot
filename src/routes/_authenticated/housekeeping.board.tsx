import { createFileRoute } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { useRooms } from "@/hooks/use-rooms";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { HK_STATUSES, type HkStatus } from "@/lib/housekeeping";
import { StickyNote, Save, Trash2, X } from "lucide-react";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { useAuth } from "@/hooks/use-auth";
import { usePermissions } from "@/hooks/use-permissions";
import { RequirePermission } from "@/components/RequirePermission";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";

export const Route = createFileRoute("/_authenticated/housekeeping/board")({
  head: () => ({ meta: [{ title: "Room Status Board — HotelPilot" }] }),
  component: () => (<RequirePermission module="room_board"><BoardPage /></RequirePermission>),
});

interface RoomRow {
  id: string; room_number: string; floor: string | null;
  status: string; housekeeping_status: string;
  room_categories: { name: string } | null;
}

// Palette comes from the shared room-status module so this board always
// matches the dashboard grid and room detail page.
const COLOR = {
  vacant:      ROOM_STATUS_COLORS.vacant.bg,
  occupied:    ROOM_STATUS_COLORS.occupied.bg,
  dirty:       ROOM_STATUS_COLORS.dirty.bg,
  maintenance: ROOM_STATUS_COLORS.maintenance.bg,
  blocked:     ROOM_STATUS_COLORS.blocked.bg,
} as const;

type TileKind = "vacant" | "occupied" | "dirty" | "maintenance" | "blocked" | "occupied_dirty";

function tileKind(r: RoomRow): TileKind {
  const occ = r.status === "occupied";
  const dirty = r.housekeeping_status === "dirty";
  if (occ && dirty) return "occupied_dirty";
  if (occ) return "occupied";
  if (r.status === "blocked") return "blocked";
  if (r.status === "maintenance" || r.housekeeping_status === "out_of_order") return "maintenance";
  if (dirty) return "dirty";
  return "vacant";
}

function tileLabel(k: TileKind): string {
  switch (k) {
    case "occupied_dirty": return "Occupied · Dirty";
    case "occupied":     return "Occupied";
    case "vacant":       return "Vacant";
    case "dirty":        return "Dirty";
    case "maintenance":  return "Maintenance";
    case "blocked":      return "Event";
  }
}

function BoardPage() {
  const { currentId: propertyId } = useCurrentProperty();
  const { user } = useAuth();
  const { can } = usePermissions();
  const canEditNote = can("housekeeping", "edit");
  // Rooms come from the shared cache (see use-rooms.ts) — this board used to
  // issue its own identical query on every mount.
  const { rooms: sharedRooms, reload: reloadRooms } = useRooms(propertyId);
  const rooms = sharedRooms as unknown as RoomRow[];
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [filter, setFilter] = useState<"all" | HkStatus>("all");

  const loadNotes = useCallback(async () => {
    if (!propertyId) return;
    const { data: nts, error: __qp2 } = await supabase
      .from("housekeeping_room_notes" as never)
      .select("room_id,note")
      .eq("property_id", propertyId);
    if (__qp2) reportQueryError("room notes", __qp2);
    const map: Record<string, string> = {};
    for (const n of (nts ?? []) as any[]) map[n.room_id] = n.note ?? "";
    setNotes(map);
  }, [propertyId]);

  const load = useCallback(async () => {
    await Promise.all([reloadRooms(), loadNotes()]);
  }, [reloadRooms, loadNotes]);

  useEffect(() => { loadNotes(); }, [loadNotes]);

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
    if (error) { toastError(error); return; }
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
          room_id: roomId, room_number: prev.room_number,
          old_status: prev.housekeeping_status, new_status: hk,
        },
      });
    }
    load();
  }

  async function saveNote(roomId: string, text: string): Promise<boolean> {
    if (!propertyId) return false;
    const clean = text.trim();
    if (!clean) {
      const { error } = await supabase.from("housekeeping_room_notes" as never).delete().eq("room_id", roomId);
      if (error) { toastError(error); return false; }
      setNotes((m) => { const n = { ...m }; delete n[roomId]; return n; });
      toast.success("Note cleared");
      return true;
    }
    const { error } = await supabase.from("housekeeping_room_notes" as never).upsert({
      room_id: roomId, property_id: propertyId, note: clean,
      updated_by: user?.id ?? null, updated_at: new Date().toISOString(),
    } as any, { onConflict: "room_id" });
    if (error) { toastError(error); return false; }
    setNotes((m) => ({ ...m, [roomId]: clean }));
    toast.success("Note saved");
    return true;
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
            <div className="grid gap-2 grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 xl:grid-cols-7">
              {list.map((r) => (
                <RoomTile
                  key={r.id}
                  room={r}
                  note={notes[r.id] ?? ""}
                  canEditNote={canEditNote}
                  onSetHk={(s) => setHk(r.id, s)}
                  onSaveNote={(t) => saveNote(r.id, t)}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </AppShell>
  );
}

function RoomTile({
  room, note, canEditNote, onSetHk, onSaveNote,
}: {
  room: RoomRow;
  note: string;
  canEditNote: boolean;
  onSetHk: (s: HkStatus) => void;
  onSaveNote: (text: string) => Promise<boolean>;
}) {
  const kind = tileKind(room);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(note);
  const [pickerOpen, setPickerOpen] = useState(false);
  useEffect(() => { setDraft(note); }, [note]);

  const isSplit = kind === "occupied_dirty";
  const c = roomStatusColor(kind);
  const style: React.CSSProperties = isSplit
    ? { background: `linear-gradient(to bottom, ${COLOR.occupied} 0 25%, ${COLOR.dirty} 25% 100%)`, color: c.fg, borderColor: c.border }
    : { background: COLOR[kind as Exclude<TileKind, "occupied_dirty">], color: c.fg, borderColor: c.border };

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => { if (!editing) setPickerOpen(true); }}
      onKeyDown={(e) => { if (!editing && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); setPickerOpen(true); } }}
      className="rounded-md overflow-hidden shadow-sm border cursor-pointer focus:outline-none focus:ring-2 focus:ring-primary/40"
      style={style}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <div className="font-semibold text-base leading-tight drop-shadow-sm">{room.room_number}</div>
          </div>
        </div>
        <div className="text-[10px] font-medium mt-1 opacity-95">{tileLabel(kind)}</div>

        <div
          className="mt-2 pt-2 border-t border-current/25"
          onClick={(e) => e.stopPropagation()}
          onKeyDown={(e) => e.stopPropagation()}
        >
          {editing && canEditNote ? (
            <div className="space-y-1">
              <Textarea
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                placeholder="Add note…"
                rows={2}
                className="text-[11px] bg-white/95 text-slate-900 placeholder:text-slate-500 min-h-[44px] resize-none"
                autoFocus
              />
              <div className="flex gap-1">
                <Button
                  size="sm" variant="secondary" className="h-6 px-2 text-[10px] flex-1"
                  onClick={async () => { const ok = await onSaveNote(draft); if (ok) setEditing(false); }}
                >
                  <Save className="h-3 w-3 mr-1" />Save
                </Button>
                {note && (
                  <Button
                    size="sm" variant="destructive" className="h-6 px-2 text-[10px]"
                    onClick={async () => { const ok = await onSaveNote(""); if (ok) setEditing(false); }}
                    title="Clear note"
                  >
                    <Trash2 className="h-3 w-3" />
                  </Button>
                )}
                <Button
                  size="sm" variant="ghost"
                  className="h-6 px-2 text-[10px] hover:bg-current/10"
                  onClick={() => { setDraft(note); setEditing(false); }}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              disabled={!canEditNote}
              onClick={() => { if (canEditNote) setEditing(true); }}
              className={`w-full text-left text-[11px] leading-snug flex items-start gap-1 ${canEditNote ? "cursor-pointer hover:opacity-90" : "cursor-default"}`}
              title={canEditNote ? "Click to edit note" : note ? "Note (read-only)" : ""}
            >
              <StickyNote className="h-3 w-3 mt-0.5 flex-shrink-0 opacity-80" />
              <span className="opacity-95 whitespace-pre-wrap break-words">
                {note
                  ? note
                  : canEditNote
                    ? <span className="italic opacity-70">Add note…</span>
                    : <span className="italic opacity-60">No note</span>}
              </span>
            </button>
          )}
        </div>
      </div>
      <Dialog open={pickerOpen} onOpenChange={setPickerOpen}>
        <DialogContent className="sm:max-w-xs">
          <DialogHeader>
            <DialogTitle>Room {room.room_number} — Set status</DialogTitle>
          </DialogHeader>
          <div className="grid gap-2">
            {HK_STATUSES.map((s) => (
              <Button
                key={s}
                variant={room.housekeeping_status === s ? "default" : "outline"}
                className="justify-start capitalize"
                onClick={() => { onSetHk(s); setPickerOpen(false); }}
              >
                {s.replace("_", " ")}
              </Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
    </div>
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