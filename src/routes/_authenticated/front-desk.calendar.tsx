import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { addDaysIso, todayIso, BOOKING_STATUS_TONE } from "@/lib/front-desk";
import { ChevronLeft, ChevronRight } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/front-desk/calendar")({
  head: () => ({ meta: [{ title: "Reservation Calendar — HotelPilot" }] }),
  component: () => (<RequirePermission module="calendar"><CalendarPage /></RequirePermission>),
});

interface RoomRow {
  id: string;
  room_number: string;
  room_categories: { name: string } | null;
}

interface BRRow {
  id: string;
  booking_id: string;
  room_id: string | null;
  check_in: string;
  check_out: string;
  bookings: {
    booking_number: string;
    status: string;
    guests: { name: string } | null;
  } | null;
}

interface EventBlockRow {
  id: string;
  banquet_booking_id: string;
  event_name: string;
  room_id: string | null;
  checkin_date: string;
  checkout_date: string;
  status: "blocked" | "checked_in" | "checked_out" | "cancelled";
  guest_name: string | null;
}

const DAYS = 14;

function fmtDay(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}
function dayOfWeek(iso: string) {
  return new Date(iso).toLocaleDateString("en-IN", { weekday: "short" });
}

function CalendarPage() {
  const { current, loading: propLoading } = useCurrentProperty();
  const [start, setStart] = useState<string>(todayIso());
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [brs, setBrs] = useState<BRRow[]>([]);
  const [events, setEvents] = useState<EventBlockRow[]>([]);
  const [loading, setLoading] = useState(true);

  const days = useMemo(
    () => Array.from({ length: DAYS }, (_, i) => addDaysIso(start, i)),
    [start],
  );
  const rangeEnd = useMemo(() => addDaysIso(start, DAYS), [start]);

  async function load() {
    if (!current) return;
    setLoading(true);
    const [roomsRes, brRes, evRes] = await Promise.all([
      supabase
        .from("rooms")
        .select("id,room_number,room_categories(name)")
        .eq("property_id", current.id)
        .order("room_number"),
      supabase
        .from("booking_rooms")
        .select("id,booking_id,room_id,check_in,check_out,bookings!inner(booking_number,status,property_id,guests(name))")
        .eq("bookings.property_id", current.id)
        .lt("check_in", rangeEnd)
        .gt("check_out", start),
      supabase
        .from("event_room_blocks")
        .select("id,banquet_booking_id,event_booking_id,event_name,room_id,checkin_date,checkout_date,status,guest_name")
        .eq("property_id", current.id)
        .in("status", ["blocked", "checked_in"])
        .lt("checkin_date", rangeEnd)
        .gt("checkout_date", start),
    ]);
    if (roomsRes.error) toast.error(roomsRes.error.message);
    if (brRes.error) toast.error(brRes.error.message);
    if (evRes.error) toast.error(evRes.error.message);
    setRooms((roomsRes.data ?? []) as unknown as RoomRow[]);
    setBrs((brRes.data ?? []) as unknown as BRRow[]);
    setEvents((evRes.data ?? []) as unknown as EventBlockRow[]);
    setLoading(false);
  }

  useEffect(() => {
    if (current) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current?.id, start]);

  if (propLoading)
    return <AppShell title="Reservation Calendar"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="Reservation Calendar"><EmptyPropertyState /></AppShell>;

  const today = todayIso();

  // Index bookings by room_id for fast lookup
  const byRoom = new Map<string, BRRow[]>();
  for (const br of brs) {
    if (!br.room_id) continue;
    const list = byRoom.get(br.room_id) ?? [];
    list.push(br);
    byRoom.set(br.room_id, list);
  }
  const eventsByRoom = new Map<string, EventBlockRow[]>();
  for (const ev of events) {
    if (!ev.room_id) continue;
    const list = eventsByRoom.get(ev.room_id) ?? [];
    list.push(ev);
    eventsByRoom.set(ev.room_id, list);
  }

  return (
    <AppShell title="Reservation Calendar">
      <div className="space-y-4">
        <Card>
          <CardContent className="pt-6 flex flex-wrap items-center gap-2">
            <Button size="sm" variant="outline" onClick={() => setStart(addDaysIso(start, -7))}>
              <ChevronLeft className="h-4 w-4" /> Prev week
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStart(todayIso())}>
              Today
            </Button>
            <Button size="sm" variant="outline" onClick={() => setStart(addDaysIso(start, 7))}>
              Next week <ChevronRight className="h-4 w-4" />
            </Button>
            <div className="text-sm text-muted-foreground ml-2">
              {fmtDay(start)} — {fmtDay(addDaysIso(start, DAYS - 1))}
            </div>
            <div className="ml-auto flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-emerald-500/60" /> Checked In</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-blue-500/60" /> Reserved</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-slate-400/60" /> Checked Out</span>
              <span className="flex items-center gap-1"><span className="inline-block h-3 w-3 rounded bg-purple-500/60" /> Event</span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="pt-6 overflow-x-auto">
            {loading ? (
              <p className="text-sm text-muted-foreground">Loading…</p>
            ) : rooms.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rooms configured.</p>
            ) : (
              <div className="inline-block min-w-full">
                {/* Header row */}
                <div
                  className="grid border-b sticky top-0 bg-background"
                  style={{ gridTemplateColumns: `160px repeat(${DAYS}, minmax(64px, 1fr))` }}
                >
                  <div className="p-2 text-xs font-medium text-muted-foreground">Room</div>
                  {days.map((d) => (
                    <div
                      key={d}
                      className={`p-2 text-center text-xs border-l ${d === today ? "bg-primary/10 font-semibold" : ""}`}
                    >
                      <div className="text-muted-foreground">{dayOfWeek(d)}</div>
                      <div>{fmtDay(d)}</div>
                    </div>
                  ))}
                </div>

                {rooms.map((room) => {
                  const list = byRoom.get(room.id) ?? [];
                  const eventList = eventsByRoom.get(room.id) ?? [];
                  return (
                    <div
                      key={room.id}
                      className="grid border-b hover:bg-muted/30"
                      style={{ gridTemplateColumns: `160px repeat(${DAYS}, minmax(64px, 1fr))` }}
                    >
                      <div className="p-2 text-sm">
                        <div className="font-medium">{room.room_number}</div>
                        <div className="text-[10px] text-muted-foreground">
                          {room.room_categories?.name ?? ""}
                        </div>
                      </div>
                      <div
                        className="relative col-span-full"
                        style={{ gridColumn: `2 / span ${DAYS}` }}
                      >
                        {/* day cell grid lines */}
                        <div
                          className="absolute inset-0 grid"
                          style={{ gridTemplateColumns: `repeat(${DAYS}, minmax(64px, 1fr))` }}
                        >
                          {days.map((d) => (
                            <div
                              key={d}
                              className={`border-l h-12 ${d === today ? "bg-primary/5" : ""}`}
                            />
                          ))}
                        </div>
                        {/* Bookings bars */}
                        <div className="relative h-12">
                          {list.map((br) => {
                            const ci = br.check_in;
                            const co = br.check_out;
                            const startIdx = Math.max(0, days.findIndex((d) => d >= ci));
                            const endIdx = (() => {
                              const i = days.findIndex((d) => d >= co);
                              return i === -1 ? DAYS : i;
                            })();
                            if (endIdx <= startIdx) return null;
                            const left = (startIdx / DAYS) * 100;
                            const width = ((endIdx - startIdx) / DAYS) * 100;
                            const status = br.bookings?.status ?? "reserved";
                            const tone = BOOKING_STATUS_TONE[status] ?? "bg-blue-500/30";
                            return (
                              <Link
                                key={br.id}
                                to="/front-desk/booking/$id"
                                params={{ id: br.booking_id }}
                                className={`absolute top-1 bottom-1 rounded px-2 text-[11px] font-medium truncate border ${tone} hover:opacity-80`}
                                style={{ left: `${left}%`, width: `calc(${width}% - 4px)` }}
                                title={`${br.bookings?.booking_number} · ${br.bookings?.guests?.name ?? ""}`}
                              >
                                {`${br.bookings?.guests?.name ?? br.bookings?.booking_number} · ${room.room_number}`}
                              </Link>
                            );
                          })}
                          {eventList.map((ev) => {
                            const startIdx = Math.max(0, days.findIndex((d) => d >= ev.checkin_date));
                            const endIdx = (() => {
                              const i = days.findIndex((d) => d >= ev.checkout_date);
                              return i === -1 ? DAYS : i;
                            })();
                            if (endIdx <= startIdx) return null;
                            const left = (startIdx / DAYS) * 100;
                            const width = ((endIdx - startIdx) / DAYS) * 100;
                            return (
                              <div
                                key={ev.id}
                                className="absolute bottom-0 h-3 rounded px-1 text-[10px] font-medium truncate border bg-purple-500/30 border-purple-500/60 text-purple-900"
                                style={{ left: `${left}%`, width: `calc(${width}% - 4px)` }}
                                title={`Event: ${ev.event_name}${ev.guest_name ? ` · ${ev.guest_name}` : ""}`}
                              >
                                {ev.event_name}
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}