// Shared "Rooms · Assign Guest" block editor for banquet events.
// Rendered both inside the New Booking wizard (banquet path) and on the
// legacy /banquet/new form, so the three modes behave identically.
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { isValidMobile, sanitizeMobile } from "@/lib/mobile";
import { addDaysIso } from "@/lib/front-desk";
import type { TariffPlan } from "@/lib/tariff";
import {
  roomBlocksSummary, stdRateFor, type RoomOption,
} from "@/lib/eventRoomsForm";
import {
  emptyEventRoomRow, type RoomBlockMode, type WizardEventRoomRow,
} from "@/lib/bookingWizard";

interface Props {
  mode: RoomBlockMode;
  onModeChange: (mode: RoomBlockMode) => void;
  eventName: string;
  onEventNameChange: (v: string) => void;
  rows: WizardEventRoomRow[];
  onRowsChange: (rows: WizardEventRoomRow[]) => void;
  eventDate: string;
  rooms: RoomOption[];
  plans: TariffPlan[];
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
    </div>
  );
}

export function EventRoomBlocks({
  mode, onModeChange, eventName, onEventNameChange,
  rows, onRowsChange, eventDate, rooms, plans,
}: Props) {
  const single = rows[0] ?? emptyEventRoomRow({ checkIn: eventDate, checkOut: addDaysIso(eventDate, 1) });
  const summary = roomBlocksSummary({
    mode, rows, rooms, plans, eventDate, hostName: "", hostMobile: "",
  });

  function patchSingle(patch: Partial<WizardEventRoomRow>) {
    const next = { ...single, ...patch };
    onRowsChange([next, ...rows.slice(1)]);
  }
  function patchRow(i: number, patch: Partial<WizardEventRoomRow>) {
    onRowsChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function addRow() {
    onRowsChange([
      ...rows,
      emptyEventRoomRow({ checkIn: eventDate, checkOut: addDaysIso(eventDate, 1) }),
    ]);
  }
  function removeRow(i: number) {
    onRowsChange(rows.filter((_, idx) => idx !== i));
  }

  /** Picking a room in the bulk grid pre-fills the tariff-plan rate (still editable). */
  function selectBulkRoom(i: number, roomId: string) {
    const row = rows[i];
    const room = rooms.find((x) => x.id === roomId);
    const rate = stdRateFor(plans, room?.category_id, row?.checkIn || eventDate);
    patchRow(i, { roomId, ...(rate > 0 ? { specialRate: String(rate) } : {}) });
  }

  function switchMode(next: RoomBlockMode) {
    onModeChange(next);
    if (next === "none") return;
    if (rows.length === 0) {
      onRowsChange([emptyEventRoomRow({ checkIn: eventDate, checkOut: addDaysIso(eventDate, 1) })]);
    }
  }

  return (
    <div className="space-y-3">
      <Tabs value={mode} onValueChange={(v) => switchMode(v as RoomBlockMode)}>
        <TabsList>
          <TabsTrigger value="none">None</TabsTrigger>
          <TabsTrigger value="single">Assign One Room</TabsTrigger>
          <TabsTrigger value="bulk">Block Multiple Rooms</TabsTrigger>
        </TabsList>

        {mode !== "none" && (
          <div className="pt-3">
            <Field label="Event Name * (shown on dashboard cards)">
              <Input
                autoTitleCase
                placeholder="e.g. Sharma Wedding"
                value={eventName}
                onChange={(e) => onEventNameChange(e.target.value)}
              />
            </Field>
          </div>
        )}

        <TabsContent value="single" className="space-y-3 pt-3">
          <div className="grid gap-2 sm:grid-cols-4">
            <Field label="Room *">
              <Select value={single.roomId} onValueChange={(v) => patchSingle({ roomId: v })}>
                <SelectTrigger>
                  <SelectValue placeholder="Pick vacant room" />
                </SelectTrigger>
                <SelectContent>
                  {rooms.length === 0 && (
                    <div className="px-2 py-1 text-xs text-muted-foreground">No vacant rooms.</div>
                  )}
                  {rooms.map((r) => (
                    <SelectItem key={r.id} value={r.id}>
                      {r.room_number} {r.category_name ? `· ${r.category_name}` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Check-in">
              <Input
                type="date"
                value={single.checkIn}
                onChange={(e) => patchSingle({ checkIn: e.target.value })}
              />
            </Field>
            <Field label="Check-out">
              <Input
                type="date"
                value={single.checkOut}
                onChange={(e) => patchSingle({ checkOut: e.target.value })}
              />
            </Field>
            <Field label="Rate / night (₹)">
              <Input
                type="number"
                value={single.specialRate}
                onChange={(e) => patchSingle({ specialRate: e.target.value })}
              />
            </Field>
          </div>
          <p className="text-xs text-muted-foreground">
            Assigns this single room to the event host guest (name/mobile above).
          </p>
        </TabsContent>

        <TabsContent value="bulk" className="space-y-3 pt-3">
          <div className="space-y-2">
            {rows.map((r, i) => {
              const room = rooms.find((x) => x.id === r.roomId);
              return (
                <div
                  key={r.key}
                  className="grid gap-2 sm:grid-cols-[1fr_1.2fr_1fr_1fr_1fr_120px_30px] items-end p-2 border rounded"
                >
                  <Field label={i === 0 ? "Room *" : ""}>
                    <Select value={r.roomId} onValueChange={(v) => selectBulkRoom(i, v)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Pick room" />
                      </SelectTrigger>
                      <SelectContent>
                        {rooms.length === 0 && (
                          <div className="px-2 py-1 text-xs text-muted-foreground">No vacant rooms.</div>
                        )}
                        {rooms.map((x) => (
                          <SelectItem key={x.id} value={x.id}>
                            {x.room_number}
                            {x.category_name ? ` · ${x.category_name}` : ""}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </Field>
                  <Field label={i === 0 ? "Guest name *" : ""}>
                    <Input
                      value={r.guestName}
                      onChange={(e) => patchRow(i, { guestName: e.target.value })}
                    />
                  </Field>
                  <Field label={i === 0 ? "Mobile *" : ""}>
                    <Input
                      value={r.guestMobile}
                      inputMode="numeric"
                      pattern="\d{10}"
                      maxLength={10}
                      placeholder="10-digit mobile"
                      onChange={(e) => patchRow(i, { guestMobile: sanitizeMobile(e.target.value) })}
                      className={
                        r.guestMobile && !isValidMobile(r.guestMobile)
                          ? "border-red-500 focus-visible:ring-red-500"
                          : ""
                      }
                    />
                  </Field>
                  <Field label={i === 0 ? "Check-in" : ""}>
                    <Input
                      type="date"
                      value={r.checkIn}
                      onChange={(e) => patchRow(i, { checkIn: e.target.value })}
                    />
                    <Input
                      type="time"
                      className="mt-1"
                      value={r.checkInTime}
                      onChange={(e) => patchRow(i, { checkInTime: e.target.value })}
                    />
                  </Field>
                  <Field label={i === 0 ? "Check-out" : ""}>
                    <Input
                      type="date"
                      value={r.checkOut}
                      onChange={(e) => patchRow(i, { checkOut: e.target.value })}
                    />
                    <Input
                      type="time"
                      className="mt-1"
                      value={r.checkOutTime}
                      onChange={(e) => patchRow(i, { checkOutTime: e.target.value })}
                    />
                  </Field>
                  <Field
                    label={
                      i === 0
                        ? `Rate (def ₹${stdRateFor(plans, room?.category_id, r.checkIn || eventDate)})`
                        : ""
                    }
                  >
                    <Input
                      type="number"
                      value={r.specialRate}
                      onChange={(e) => patchRow(i, { specialRate: e.target.value })}
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-destructive"
                    onClick={() => removeRow(i)}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              );
            })}
            <Button type="button" variant="outline" size="sm" onClick={addRow}>
              <Plus className="h-4 w-4 mr-1" /> Add Room
            </Button>
          </div>

          {rows.length > 0 && (
            <div className="text-xs text-muted-foreground">
              Rooms to block: <b>{summary.totalRooms}</b> across <b>{summary.categories}</b>{" "}
              categories · Estimated room revenue:{" "}
              <b>₹{summary.revenue.toLocaleString("en-IN")}</b>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
