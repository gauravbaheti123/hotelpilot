import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BedDouble, LogIn, LogOut, IndianRupee, Building2, Users, UtensilsCrossed, ChevronDown, ChevronRight, DoorOpen } from "lucide-react";
import { CheckoutDialog } from "@/components/CheckoutDialog";
import { RemindersBell, RemindersSection } from "@/components/Reminders";
import { ACTIVITY, logActivity, userDisplayName } from "@/lib/activityLog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  loadEventSummaries, checkInBlock, checkOutBlock,
  type EventBlockSummary, type EventBlockRecord,
} from "@/lib/eventRoomBlocks";
import { CalendarDays } from "lucide-react";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — HotelPilot" }] }),
  component: DashboardPage,
});

type Room = {
  id: string;
  room_number: string;
  status: "vacant" | "occupied" | "blocked" | "maintenance";
  housekeeping_status: "clean" | "dirty" | "inspected" | "out_of_order";
  category_id: string | null;
};

type RoomCategory = { id: string; name: string };

type StaffOpt = { id: string; name: string };
type TileKind = "vacant" | "occupied" | "dirty" | "maintenance";

type ScheduleRow = {
  id: string;
  booking_number: string;
  balance_amount: number;
  guest_name: string | null;
  room_numbers: string;
};

type PendingFood = {
  bookingId: string;
  amount: number;
  count: number;
  lastAt: string | null;
  items: string;
};

type PendingFoodRow = {
  roomId: string;
  roomNumber: string;
  bookingId: string;
  guestName: string | null;
  amount: number;
  items: string;
  lastAt: string | null;
};

type OccInfo = {
  bookingId: string;
  guestName: string | null;
  checkIn: string | null;
  checkOut: string | null;
  balance: number;
};

type RoomEventInfo = {
  blockId: string;
  bookingId: string;
  banquetBookingId: string;
  eventName: string;
  guestName: string | null;
  checkin: string;
  checkout: string;
  status: EventBlockRecord["status"];
  pending: number;
};

function todayISO() {
  const d = new Date();
  const tz = d.getTimezoneOffset() * 60000;
  return new Date(d.getTime() - tz).toISOString().slice(0, 10);
}

function DashboardPage() {
  const { user, roles } = useAuth();
  const isSuperadmin = roles.includes("superadmin");
  const { current, currentId } = useCurrentProperty();

  if (isSuperadmin && !currentId) {
    return <SuperadminDashboard email={user?.email ?? ""} />;
  }
  return (
    <OwnerDashboard
      propertyId={currentId}
      propertyName={current?.name ?? ""}
      propertyCity={current?.city ?? ""}
      email={user?.email ?? ""}
      userId={user?.id ?? ""}
      isSuperadmin={isSuperadmin}
    />
  );
}

function SuperadminDashboard({ email }: { email: string }) {
  const [counts, setCounts] = useState({ properties: 0, rooms: 0, staff: 0, revenue: 0 });
  useEffect(() => {
    (async () => {
      const today = todayISO();
      const [p, r, s, pay] = await Promise.all([
        supabase.from("properties").select("id", { count: "exact", head: true }),
        supabase.from("rooms").select("id", { count: "exact", head: true }),
        supabase.from("user_roles").select("user_id", { count: "exact", head: true }).neq("role", "superadmin"),
        supabase.from("payments").select("amount").gte("paid_at", `${today}T00:00:00`).lte("paid_at", `${today}T23:59:59`),
      ]);
      const revenue = (pay.data ?? []).reduce((a, x: any) => a + Number(x.amount || 0), 0);
      setCounts({ properties: p.count ?? 0, rooms: r.count ?? 0, staff: s.count ?? 0, revenue });
    })();
  }, []);
  const name = email ? email.split("@")[0] : "growth";
  return (
    <AppShell title="Dashboard">
      <div className="max-w-6xl space-y-6">
        <div>
          <h2 className="text-2xl font-semibold tracking-tight">Welcome, {name}</h2>
          <p className="text-sm text-muted-foreground">HotelPilot Super Admin</p>
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Total Properties" value={counts.properties} icon={Building2} />
          <Kpi label="Total Rooms" value={counts.rooms} icon={BedDouble} />
          <Kpi label="Total Staff" value={counts.staff} icon={Users} />
          <Kpi label="Today's Revenue" value={`₹${counts.revenue.toLocaleString("en-IN")}`} icon={IndianRupee} />
        </div>
      </div>
    </AppShell>
  );
}

function OwnerDashboard({
  propertyId,
  propertyName,
  propertyCity,
  email,
  userId,
  isSuperadmin,
}: {
  propertyId: string | null;
  propertyName: string;
  propertyCity: string;
  email: string;
  userId: string;
  isSuperadmin: boolean;
}) {
  const [name, setName] = useState<string>(email ? email.split("@")[0] : "");
  const [kpi, setKpi] = useState({ occupied: 0, arrivals: 0, departures: 0, revenue: 0 });
  const [rooms, setRooms] = useState<Room[]>([]);
  const [categories, setCategories] = useState<RoomCategory[]>([]);
  const [occupiedRoomIds, setOccupiedRoomIds] = useState<Set<string>>(new Set());
  const [bookingByRoom, setBookingByRoom] = useState<Map<string, string>>(new Map());
  const [arrivals, setArrivals] = useState<ScheduleRow[]>([]);
  const [departures, setDepartures] = useState<ScheduleRow[]>([]);
  const [staff, setStaff] = useState<StaffOpt[]>([]);
  const [modalRoom, setModalRoom] = useState<Room | null>(null);
  const [checkoutBookingId, setCheckoutBookingId] = useState<string | null>(null);
  const [pendingFoodByRoom, setPendingFoodByRoom] = useState<Map<string, PendingFood>>(new Map());
  const [pendingFoodRows, setPendingFoodRows] = useState<PendingFoodRow[]>([]);
  const [showPendingFood, setShowPendingFood] = useState(false);
  const [occInfoByRoom, setOccInfoByRoom] = useState<Map<string, OccInfo>>(new Map());
  const [events, setEvents] = useState<EventBlockSummary[]>([]);
  const [eventBlockByRoom, setEventBlockByRoom] = useState<Map<string, RoomEventInfo>>(new Map());
  const [bulkCheckinEvent, setBulkCheckinEvent] = useState<EventBlockSummary | null>(null);
  const [bulkCheckoutEvent, setBulkCheckoutEvent] = useState<EventBlockSummary | null>(null);
  const [singleAssignBlock, setSingleAssignBlock] = useState<EventBlockRecord | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!userId) return;
    supabase.from("profiles").select("name").eq("id", userId).maybeSingle()
      .then(({ data }) => { if (data?.name) setName(data.name); });
  }, [userId]);

  const reload = useCallback(async () => {
    if (!propertyId) return;
    const today = todayISO();
      const [occ, arr, dep, pay, rms, activeBR] = await Promise.all([
        supabase.from("bookings").select("id", { count: "exact", head: true })
          .eq("property_id", propertyId).eq("status", "checked_in"),
        supabase.from("bookings").select("id, booking_number, balance_amount, guest_id, guests:guest_id(name), booking_rooms(rooms(room_number))")
          .eq("property_id", propertyId).eq("status", "reserved").eq("check_in", today),
        supabase.from("bookings").select("id, booking_number, balance_amount, guest_id, guests:guest_id(name), booking_rooms(rooms(room_number))")
          .eq("property_id", propertyId).eq("status", "checked_in").eq("check_out", today),
        supabase.from("payments").select("amount").eq("property_id", propertyId)
          .gte("paid_at", `${today}T00:00:00`).lte("paid_at", `${today}T23:59:59`),
        supabase.from("rooms").select("id, room_number, status, housekeeping_status, category_id")
          .eq("property_id", propertyId).eq("is_active", true).order("room_number"),
        supabase.from("booking_rooms").select("room_id, booking_id, actual_check_out, bookings!inner(id, status, property_id, balance_amount, check_in, check_out, guests:guest_id(name))")
          .eq("property_id", propertyId).is("actual_check_out", null).eq("bookings.status", "checked_in"),
      ]);
      const revenue = (pay.data ?? []).reduce((a, x: any) => a + Number(x.amount || 0), 0);
      const occSet = new Set<string>(
        (activeBR.data ?? []).map((b: any) => b.room_id).filter(Boolean),
      );
      const bMap = new Map<string, string>();
      const oMap = new Map<string, OccInfo>();
      (activeBR.data ?? []).forEach((b: any) => {
        if (b.room_id && b.booking_id) bMap.set(b.room_id, b.booking_id);
        if (b.room_id && b.bookings) {
          oMap.set(b.room_id, {
            bookingId: b.booking_id,
            guestName: b.bookings.guests?.name ?? null,
            checkIn: b.bookings.check_in ?? null,
            checkOut: b.bookings.check_out ?? null,
            balance: Number(b.bookings.balance_amount || 0),
          });
        }
      });
      setOccupiedRoomIds(occSet);
      setBookingByRoom(bMap);
      setOccInfoByRoom(oMap);
      setKpi({
        occupied: occSet.size || (occ.count ?? 0),
        arrivals: arr.data?.length ?? 0,
        departures: dep.data?.length ?? 0,
        revenue,
      });
      const mapRow = (b: any): ScheduleRow => ({
        id: b.id,
        booking_number: b.booking_number,
        balance_amount: Number(b.balance_amount || 0),
        guest_name: b.guests?.name ?? null,
        room_numbers: (b.booking_rooms ?? []).map((br: any) => br.rooms?.room_number).filter(Boolean).join(", ") || "—",
      });
      setArrivals((arr.data ?? []).map(mapRow));
      setDepartures((dep.data ?? []).map(mapRow));
      setRooms((rms.data ?? []) as Room[]);

      // Pending food per room (open/printed/served, hotel copy only to avoid double-counting)
      const { data: kots } = await supabase
        .from("kot_orders")
        .select("id, booking_id, room_id, total_amount, created_at, status, kot_items(item_name, qty)")
        .eq("property_id", propertyId)
        .eq("kot_copy", "hotel_copy")
        .in("status", ["open", "printed", "served"]);
      const pfMap = new Map<string, PendingFood>();
      (kots ?? []).forEach((k: any) => {
        if (!k.room_id || !k.booking_id) return;
        const prev = pfMap.get(k.room_id) ?? { bookingId: k.booking_id, amount: 0, count: 0, lastAt: null, items: "" };
        const itemSummary = (k.kot_items ?? []).map((i: any) => `${i.item_name}×${i.qty}`).join(", ");
        prev.amount += Number(k.total_amount || 0);
        prev.count += 1;
        prev.lastAt = !prev.lastAt || k.created_at > prev.lastAt ? k.created_at : prev.lastAt;
        prev.items = prev.items ? `${prev.items}; ${itemSummary}` : itemSummary;
        prev.bookingId = k.booking_id;
        pfMap.set(k.room_id, prev);
      });
      setPendingFoodByRoom(pfMap);

      // Build per-row list for the collapsible section
      const guestByBooking = new Map<string, string | null>();
      (arr.data ?? []).concat(dep.data ?? []).forEach((b: any) => guestByBooking.set(b.id, b.guests?.name ?? null));
      const roomNumberById = new Map<string, string>((rms.data ?? []).map((r: any) => [r.id, r.room_number]));
      const missingBookingIds = Array.from(new Set(Array.from(pfMap.values()).map((v) => v.bookingId)))
        .filter((bid) => !guestByBooking.has(bid));
      if (missingBookingIds.length > 0) {
        const { data: gb } = await supabase
          .from("bookings")
          .select("id, guests:guest_id(name)")
          .in("id", missingBookingIds);
        (gb ?? []).forEach((b: any) => guestByBooking.set(b.id, b.guests?.name ?? null));
      }
      const rows: PendingFoodRow[] = [];
      pfMap.forEach((v, roomId) => {
        if (v.amount <= 0) return;
        rows.push({
          roomId,
          roomNumber: roomNumberById.get(roomId) ?? "—",
          bookingId: v.bookingId,
          guestName: guestByBooking.get(v.bookingId) ?? null,
          amount: v.amount,
          items: v.items,
          lastAt: v.lastAt,
        });
      });
      rows.sort((a, b) => a.roomNumber.localeCompare(b.roomNumber, undefined, { numeric: true }));
      setPendingFoodRows(rows);

      // Event room blocks
      try {
        const summaries = await loadEventSummaries(propertyId);
        setEvents(summaries);
        const map = new Map<string, RoomEventInfo>();
        summaries.forEach((ev) => ev.blocks.forEach((b) => {
          if (!b.room_id) return;
          map.set(b.room_id, {
            blockId: b.id,
            bookingId: b.booking_id ?? "",
            banquetBookingId: ev.banquet_booking_id,
            eventName: ev.event_name,
            guestName: b.guest_name,
            checkin: b.checkin_date,
            checkout: b.checkout_date,
            status: b.status,
            pending: 0,
          });
        }));
        setEventBlockByRoom(map);
      } catch (e) {
        console.warn("loadEventSummaries failed", e);
      }
  }, [propertyId]);

  useEffect(() => { reload(); }, [reload]);

  useEffect(() => {
    if (!propertyId) return;
    supabase.from("staff").select("id, name").eq("property_id", propertyId).eq("is_active", true).order("name")
      .then(({ data }) => setStaff((data ?? []) as StaffOpt[]));
    supabase.from("room_categories").select("id, name").eq("property_id", propertyId).order("name")
      .then(({ data }) => setCategories((data ?? []) as RoomCategory[]));
  }, [propertyId]);

  return (
    <AppShell title="Dashboard">
      <div className="w-full space-y-6 relative">
        <div className="absolute right-0 -top-10 z-10">
          <RemindersBell propertyId={propertyId} userId={userId} />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Occupied Rooms" value={kpi.occupied} icon={BedDouble} />
          <Kpi label="Available Rooms" value={Math.max(0, rooms.length - kpi.occupied)} icon={DoorOpen} />
          <Kpi label="Expected Arrivals" value={kpi.arrivals} icon={LogIn} />
          <Kpi label="Expected Departures" value={kpi.departures} icon={LogOut} />
        </div>

        {events.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <CalendarDays className="h-4 w-4" /> Events
              </CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {events.map((ev) => (
                <div key={ev.banquet_booking_id} className="border rounded-lg p-3 space-y-2"
                  style={{ borderLeft: "4px solid #7C3AED" }}>
                  <div>
                    <div className="font-semibold">{ev.event_name || "Unnamed Event"}</div>
                    <div className="text-xs text-muted-foreground">{ev.function_type} · {ev.event_date}</div>
                  </div>
                  <div className="text-xs">
                    {ev.blocked} blocked · {ev.checked_in} checked in · {ev.checked_out} checked out
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" disabled={ev.blocked === 0}
                      onClick={() => setBulkCheckinEvent(ev)}>Bulk Check-in</Button>
                    <Button size="sm" variant="outline" disabled={ev.checked_in === 0}
                      onClick={() => setBulkCheckoutEvent(ev)}>Bulk Checkout</Button>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Room Status</CardTitle></CardHeader>
          <CardContent>
            {rooms.length === 0 ? (
              <div className="text-sm text-muted-foreground">No rooms configured.</div>
            ) : (
              <RoomGroups
                rooms={rooms}
                categories={categories}
                occupiedRoomIds={occupiedRoomIds}
                pendingFoodByRoom={pendingFoodByRoom}
                occInfoByRoom={occInfoByRoom}
                eventBlockByRoom={eventBlockByRoom}
                onPick={(r) => setModalRoom(r)}
                onPickFood={(r) => {
                  const pf = pendingFoodByRoom.get(r.id);
                  if (pf?.bookingId) navigate({ to: "/front-desk/booking/$id", params: { id: pf.bookingId } });
                }}
                onCheckout={(bid) => setCheckoutBookingId(bid)}
                onAssignEvent={(blk) => setSingleAssignBlock(blk)}
                onEventCheckIn={async (blk) => {
                  if (!propertyId || !userId) return;
                  try {
                    await checkInBlock({ propertyId, block: blk, userId });
                    toast.success(`Room ${blk.room_number} checked in`);
                    reload();
                  } catch (e: any) { toast.error(e.message ?? "Failed"); }
                }}
              />
            )}
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <LegendDot style={{ backgroundColor: "#22c55e" }} label="Vacant" />
              <LegendDot style={{ backgroundColor: "#3b82f6" }} label="Occupied" />
              <LegendDot style={{ backgroundColor: "#f59e0b" }} label="Dirty" />
              <LegendDot style={{ backgroundColor: "#ef4444" }} label="Maintenance" />
              <LegendDot style={{ backgroundColor: "#7C3AED" }} label="Event Block" />
              <LegendDot style={{ backgroundColor: "#6b7280" }} label="Blocked" />
              <LegendDot style={{ backgroundColor: "#f59e0b" }} label="Pending food" />
            </div>
          </CardContent>
        </Card>

        <RemindersSection propertyId={propertyId} userId={userId} />

        <Card>
          <CardHeader className="pb-3">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left"
              onClick={() => setShowPendingFood((v) => !v)}
            >
              <CardTitle className="text-base flex items-center gap-2">
                {showPendingFood ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                Pending Food Orders
                <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-amber-500 text-white text-xs font-semibold">
                  {pendingFoodRows.length}
                </span>
              </CardTitle>
              {!showPendingFood && pendingFoodRows.length > 0 && (
                <span className="text-xs text-muted-foreground">
                  ₹{pendingFoodRows.reduce((a, r) => a + r.amount, 0).toLocaleString("en-IN")} unbilled
                </span>
              )}
            </button>
          </CardHeader>
          {showPendingFood && (
            <CardContent>
              {pendingFoodRows.length === 0 ? (
                <div className="text-sm text-muted-foreground">No pending food orders.</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-xs uppercase text-muted-foreground">
                        <th className="py-2 pr-3">Room</th>
                        <th className="py-2 pr-3">Guest</th>
                        <th className="py-2 pr-3">Items</th>
                        <th className="py-2 pr-3 text-right">Amount</th>
                        <th className="py-2 pr-3">Last order</th>
                        <th className="py-2 pr-3"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pendingFoodRows.map((r) => (
                        <tr key={r.roomId} className="border-t">
                          <td className="py-2 pr-3 font-semibold">{r.roomNumber}</td>
                          <td className="py-2 pr-3">{r.guestName ?? "—"}</td>
                          <td className="py-2 pr-3 max-w-[280px] truncate" title={r.items}>{r.items || "—"}</td>
                          <td className="py-2 pr-3 text-right font-medium">₹{r.amount.toLocaleString("en-IN")}</td>
                          <td className="py-2 pr-3 text-xs text-muted-foreground">
                            {r.lastAt ? new Date(r.lastAt).toLocaleString("en-IN", { dateStyle: "short", timeStyle: "short" }) : "—"}
                          </td>
                          <td className="py-2 pr-3 text-right">
                            <Button asChild size="sm" variant="outline">
                              <Link to="/front-desk/booking/$id" params={{ id: r.bookingId }}>Add to Bill</Link>
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          )}
        </Card>

        <div className="grid gap-4 lg:grid-cols-2">
          <ScheduleCard
            title="Today's Arrivals"
            rows={arrivals}
            actionLabel="Check-in"
            emptyText="No arrivals scheduled for today."
            showBalance={false}
          />
          <ScheduleCard
            title="Today's Departures"
            rows={departures}
            actionLabel="Checkout"
            emptyText="No departures scheduled for today."
            showBalance
          />
        </div>
      </div>
      <RoomStatusModal
        room={modalRoom}
        kind={modalRoom ? tileKind(modalRoom, occupiedRoomIds.has(modalRoom.id)) : null}
        bookingId={modalRoom ? bookingByRoom.get(modalRoom.id) ?? null : null}
        staff={staff}
        onClose={() => setModalRoom(null)}
        onChanged={async () => { await reload(); }}
        onOpenBooking={(bid) => { setModalRoom(null); navigate({ to: "/front-desk/booking/$id", params: { id: bid } }); }}
        onNewBooking={() => {
          const r = modalRoom;
          setModalRoom(null);
          navigate({
            to: "/front-desk/new",
            search: r ? { roomId: r.id, categoryId: r.category_id ?? undefined } : undefined,
          } as any);
        }}
        onCheckout={(bid: string) => { setModalRoom(null); setCheckoutBookingId(bid); }}
      />
      <CheckoutDialog
        bookingId={checkoutBookingId}
        open={!!checkoutBookingId}
        onOpenChange={(o: boolean) => { if (!o) setCheckoutBookingId(null); }}
        onDone={() => { setCheckoutBookingId(null); reload(); }}
      />
      <BulkCheckinDialog
        event={bulkCheckinEvent}
        propertyId={propertyId}
        userId={userId}
        onClose={() => setBulkCheckinEvent(null)}
        onDone={() => { setBulkCheckinEvent(null); reload(); }}
      />
      <BulkCheckoutDialog
        event={bulkCheckoutEvent}
        userId={userId}
        onClose={() => setBulkCheckoutEvent(null)}
        onDone={() => { setBulkCheckoutEvent(null); reload(); }}
      />
      <AssignGuestDialog
        block={singleAssignBlock}
        onClose={() => setSingleAssignBlock(null)}
        onDone={() => { setSingleAssignBlock(null); reload(); }}
      />
    </AppShell>
  );
}

function RoomGroups({
  rooms, categories, occupiedRoomIds, pendingFoodByRoom, occInfoByRoom, eventBlockByRoom,
  onPick, onPickFood, onCheckout, onAssignEvent, onEventCheckIn,
}: {
  rooms: Room[];
  categories: RoomCategory[];
  occupiedRoomIds: Set<string>;
  pendingFoodByRoom: Map<string, PendingFood>;
  occInfoByRoom: Map<string, OccInfo>;
  eventBlockByRoom: Map<string, RoomEventInfo>;
  onPick: (r: Room) => void;
  onPickFood: (r: Room) => void;
  onCheckout: (bookingId: string) => void;
  onAssignEvent: (blk: EventBlockRecord) => void;
  onEventCheckIn: (blk: EventBlockRecord) => void;
}) {
  const byCat = new Map<string, Room[]>();
  const uncategorised: Room[] = [];
  rooms.forEach((r) => {
    if (!r.category_id) { uncategorised.push(r); return; }
    const arr = byCat.get(r.category_id) ?? [];
    arr.push(r);
    byCat.set(r.category_id, arr);
  });
  const ordered = categories
    .map((c) => ({ name: c.name, rooms: byCat.get(c.id) ?? [] }))
    .filter((g) => g.rooms.length > 0);
  if (uncategorised.length > 0) ordered.push({ name: "Uncategorised", rooms: uncategorised });

  return (
    <div className="space-y-4">
      {ordered.map((g) => (
        <div key={g.name} className="space-y-2">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {g.name} <span className="text-muted-foreground/70 font-normal">· {g.rooms.length}</span>
          </div>
          <div className="grid gap-3 grid-cols-1 md:grid-cols-3 w-full">
            {g.rooms.map((r) => (
              <RoomCard
                key={r.id}
                room={r}
                category={g.name}
                isOccupied={occupiedRoomIds.has(r.id)}
                pendingFood={pendingFoodByRoom.get(r.id) ?? null}
                occ={occInfoByRoom.get(r.id) ?? null}
                eventInfo={eventBlockByRoom.get(r.id) ?? null}
                onPick={() => onPick(r)}
                onPickFood={() => onPickFood(r)}
                onCheckout={onCheckout}
                onAssignEvent={onAssignEvent}
                onEventCheckIn={onEventCheckIn}
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

const STATUS_META: Record<string, { label: string; bar: string; badgeBg: string; badgeText: string }> = {
  vacant:      { label: "Vacant",      bar: "#22c55e", badgeBg: "#dcfce7", badgeText: "#166534" },
  occupied:    { label: "Occupied",    bar: "#3b82f6", badgeBg: "#dbeafe", badgeText: "#1e40af" },
  dirty:       { label: "Dirty",       bar: "#f59e0b", badgeBg: "#fef3c7", badgeText: "#92400e" },
  maintenance: { label: "Maintenance", bar: "#ef4444", badgeBg: "#fee2e2", badgeText: "#991b1b" },
  blocked:     { label: "Blocked",     bar: "#6b7280", badgeBg: "#e5e7eb", badgeText: "#374151" },
};

function tileKindExt(r: Room, isOccupied: boolean): keyof typeof STATUS_META {
  if (isOccupied || r.status === "occupied") return "occupied";
  if (r.status === "blocked") return "blocked";
  if (r.status === "maintenance" || r.housekeeping_status === "out_of_order") return "maintenance";
  if (r.housekeeping_status === "dirty") return "dirty";
  return "vacant";
}

function fmtShort(dateStr: string | null) {
  if (!dateStr) return "—";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
}

function RoomCard({
  room, category, isOccupied, pendingFood, occ, eventInfo, onPick, onPickFood, onCheckout, onAssignEvent, onEventCheckIn,
}: {
  room: Room;
  category: string;
  isOccupied: boolean;
  pendingFood: PendingFood | null;
  occ: OccInfo | null;
  eventInfo: RoomEventInfo | null;
  onPick: () => void;
  onPickFood: () => void;
  onCheckout: (bid: string) => void;
  onAssignEvent: (blk: EventBlockRecord) => void;
  onEventCheckIn: (blk: EventBlockRecord) => void;
}) {
  const isEventBlock = !!eventInfo && eventInfo.status === "blocked";
  const isEventCheckedIn = !!eventInfo && eventInfo.status === "checked_in";
  const kind = tileKindExt(room, isOccupied);
  const meta = STATUS_META[kind];
  const hasFood = !!pendingFood && pendingFood.amount > 0;
  const baseBalance = occ?.balance ?? 0;
  const pending = baseBalance + (hasFood ? pendingFood!.amount : 0);

  if (isEventBlock || isEventCheckedIn) {
    return (
      <div
        role="button" tabIndex={0} onClick={onPick}
        onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPick(); }}
        className="relative rounded-lg border bg-card shadow-sm hover:shadow-md transition cursor-pointer overflow-hidden"
        style={{ borderLeft: "4px solid #7C3AED", minHeight: 120 }}
      >
        <div className="p-3 space-y-1">
          <div className="flex items-start justify-between gap-2">
            <div className="text-2xl font-bold leading-none">{room.room_number}</div>
            <span className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full text-white"
              style={{ backgroundColor: "#7C3AED" }}>
              {isEventCheckedIn ? "Event · In" : "Event Block"}
            </span>
          </div>
          <div className="text-xs text-muted-foreground">{category}</div>
          <div className="text-sm font-semibold truncate">{eventInfo!.eventName}</div>
          <div className={`text-xs truncate ${eventInfo!.guestName ? "" : "text-muted-foreground italic"}`}>
            {eventInfo!.guestName ?? "Guest Unassigned"}
          </div>
          <div className="text-xs text-muted-foreground">{fmtShort(eventInfo!.checkin)} → {fmtShort(eventInfo!.checkout)}</div>
          <div className="pt-1 flex flex-wrap gap-1">
            {isEventBlock && !eventInfo!.guestName && (
              <Button size="sm" variant="outline" className="h-7 text-xs"
                onClick={(e) => { e.stopPropagation(); onAssignEvent({
                  id: eventInfo!.blockId, banquet_booking_id: eventInfo!.banquetBookingId,
                  event_name: eventInfo!.eventName, room_id: room.id,
                  room_number: room.room_number, room_category: category,
                  guest_name: null, guest_mobile: null,
                  checkin_date: eventInfo!.checkin, checkout_date: eventInfo!.checkout,
                  special_rate: null, status: "blocked", booking_id: null,
                } as EventBlockRecord); }}>Assign Guest</Button>
            )}
            {isEventBlock && (
              <Button size="sm" className="h-7 text-xs"
                onClick={(e) => { e.stopPropagation(); onEventCheckIn({
                  id: eventInfo!.blockId, banquet_booking_id: eventInfo!.banquetBookingId,
                  event_name: eventInfo!.eventName, room_id: room.id,
                  room_number: room.room_number, room_category: category,
                  guest_name: eventInfo!.guestName, guest_mobile: null,
                  checkin_date: eventInfo!.checkin, checkout_date: eventInfo!.checkout,
                  special_rate: null, status: "blocked", booking_id: null,
                } as EventBlockRecord); }}>Check In</Button>
            )}
            {isEventCheckedIn && eventInfo!.bookingId && (
              <Button size="sm" className="h-7 text-xs"
                onClick={(e) => { e.stopPropagation(); onCheckout(eventInfo!.bookingId); }}>Checkout</Button>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPick(); }}
      className="relative rounded-lg border bg-card shadow-sm hover:shadow-md transition cursor-pointer overflow-hidden"
      style={{ borderLeft: `4px solid ${meta.bar}`, minHeight: 120 }}
    >
      <div className="p-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <div className="text-2xl font-bold leading-none">{room.room_number}</div>
            <div className="text-xs text-muted-foreground mt-1">{category}</div>
          </div>
          <span
            className="text-[10px] font-semibold uppercase tracking-wide px-2 py-0.5 rounded-full"
            style={{ backgroundColor: meta.badgeBg, color: meta.badgeText }}
          >
            {meta.label}
          </span>
        </div>

        {kind === "occupied" && occ && (
          <div className="mt-3 space-y-1">
            <div className="text-sm font-medium truncate">{occ.guestName ?? "Guest"}</div>
            <div className="text-xs text-muted-foreground">
              {fmtShort(occ.checkIn)} → {fmtShort(occ.checkOut)}
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-1">
              {pending > 0 && (
                <span className="text-xs font-semibold text-red-600">
                  ₹{pending.toLocaleString("en-IN")} pending
                </span>
              )}
              {hasFood && (
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); onPickFood(); }}
                  className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-amber-100 text-amber-800 hover:bg-amber-200"
                  title="View pending food orders"
                >
                  <UtensilsCrossed className="h-3 w-3" /> Food
                </button>
              )}
            </div>
            <div className="pt-2">
              <Button
                size="sm"
                className="h-7 text-xs"
                onClick={(e) => { e.stopPropagation(); onCheckout(occ.bookingId); }}
              >
                Checkout
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Kpi({ label, value, icon: Icon }: { label: string; value: number | string; icon: any }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </CardHeader>
      <CardContent><div className="text-2xl font-semibold">{value}</div></CardContent>
    </Card>
  );
}

function LegendDot({ className, style, label }: { className?: string; style?: React.CSSProperties; label: string }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${className ?? ""}`} style={style} />
      {label}
    </span>
  );
}

function tileKind(r: Room, isOccupied: boolean): TileKind {
  if (isOccupied || r.status === "occupied") return "occupied";
  if (r.status === "maintenance" || r.housekeeping_status === "out_of_order") return "maintenance";
  if (r.housekeeping_status === "dirty") return "dirty";
  return "vacant";
}

function roomTileStyle(r: Room, isOccupied: boolean): { bg: string; label: string } {
  switch (tileKind(r, isOccupied)) {
    case "occupied": return { bg: "bg-[#dc2626]", label: "Occupied" };
    case "maintenance": return { bg: "bg-[#6b7280]", label: "Maintenance" };
    case "dirty": return { bg: "bg-[#d97706]", label: "Dirty" };
    default: return { bg: "bg-[#16a34a]", label: "Vacant" };
  }
}

function RoomStatusModal({
  room, kind, bookingId, staff, onClose, onChanged, onOpenBooking, onNewBooking, onCheckout,
}: {
  room: Room | null;
  kind: TileKind | null;
  bookingId: string | null;
  staff: StaffOpt[];
  onClose: () => void;
  onChanged: () => Promise<void>;
  onOpenBooking: (bookingId: string) => void;
  onNewBooking: () => void;
  onCheckout: (bookingId: string) => void;
}) {
  const [staffId, setStaffId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => { setStaffId(""); setNotes(""); }, [room?.id]);

  if (!room || !kind) return null;

  const update = async (
    patch: Partial<Pick<Room, "status" | "housekeeping_status">>,
    log: null | { task_type: "cleaning" | "maintenance" },
    successLabel: string,
  ) => {
    setBusy(true);
    try {
      const { error } = await supabase.from("rooms").update(patch).eq("id", room.id);
      if (error) throw error;
      if (log) {
        const { data: rRow } = await supabase.from("rooms").select("property_id").eq("id", room.id).maybeSingle();
        const propertyId = (rRow as any)?.property_id;
        if (propertyId) {
          await supabase.from("housekeeping_tasks").insert({
            property_id: propertyId,
            room_id: room.id,
            task_type: log.task_type,
            status: "done",
            assigned_to: staffId || null,
            notes: notes || null,
            completed_at: new Date().toISOString(),
          } as any);
        }
      }
      toast.success(`Room ${room.room_number} ${successLabel}`);
      try {
        const { data: rRow } = await supabase.from("rooms").select("property_id").eq("id", room.id).maybeSingle();
        const propertyId = (rRow as any)?.property_id;
        if (propertyId) {
          const { data: { user } } = await supabase.auth.getUser();
          logActivity({
            property_id: propertyId,
            user_id: user?.id ?? "",
            user_name: userDisplayName(user as any),
            ...ACTIVITY.ROOM_STATUS_CHANGED,
            reference_id: room.id,
            reference_label: `Room ${room.room_number} → ${successLabel}`,
            details: { patch },
          });
        }
      } catch { /* ignore */ }
      await onChanged();
      onClose();
    } catch (e: any) {
      toast.error(e.message ?? "Failed to update room");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!room} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Room {room.room_number}</DialogTitle>
          <DialogDescription>
            Current: <span className="font-medium capitalize">{kind}</span>
          </DialogDescription>
        </DialogHeader>

        {kind === "vacant" && (
          <div className="grid gap-2">
            <Button variant="outline" disabled={busy}
              onClick={() => update({ housekeeping_status: "dirty" }, null, "marked as Dirty")}>
              Mark as Dirty
            </Button>
            <Button variant="outline" disabled={busy}
              onClick={() => update({ status: "maintenance" }, null, "marked as Maintenance")}>
              Mark as Maintenance
            </Button>
            <Button disabled={busy} onClick={onNewBooking}>New Booking</Button>
          </div>
        )}

        {kind === "occupied" && (
          <div className="grid gap-2">
            <p className="text-sm text-muted-foreground">Status change not allowed while occupied — check out guest first.</p>
            <Button disabled={!bookingId} onClick={() => bookingId && onCheckout(bookingId)}>Checkout</Button>
            <Button variant="outline" disabled={!bookingId} onClick={() => bookingId && onOpenBooking(bookingId)}>View Booking</Button>
            <Button variant="outline" disabled={!bookingId}
              onClick={() => bookingId && onOpenBooking(bookingId)}>Room Shift</Button>
          </div>
        )}

        {(kind === "dirty" || kind === "maintenance") && (
          <div className="grid gap-3">
            <div className="grid gap-1.5">
              <Label>{kind === "dirty" ? "Cleaned by" : "Maintenance resolved by"}</Label>
              <SearchableSelect
                value={staffId}
                onChange={setStaffId}
                placeholder="Select staff (optional)"
                searchPlaceholder="Search staff…"
                options={staff.map((s) => ({ value: s.id, label: s.name }))}
              />
            </div>
            <div className="grid gap-1.5">
              <Label>{kind === "dirty" ? "Cleaning notes" : "Resolution notes"}</Label>
              <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional" />
            </div>
            <div className="grid gap-2">
              <Button disabled={busy}
                onClick={() => update(
                  { status: "vacant", housekeeping_status: "clean" },
                  { task_type: kind === "dirty" ? "cleaning" : "maintenance" },
                  "marked as Vacant",
                )}>
                Mark as Clean (Vacant)
              </Button>
              {kind === "dirty" ? (
                <Button variant="outline" disabled={busy}
                  onClick={() => update({ status: "maintenance" }, null, "marked as Maintenance")}>
                  Mark as Maintenance
                </Button>
              ) : (
                <Button variant="outline" disabled={busy}
                  onClick={() => update({ status: "vacant", housekeeping_status: "dirty" }, null, "marked as Dirty")}>
                  Mark as Dirty
                </Button>
              )}
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ScheduleCard({
  title, rows, actionLabel, emptyText, showBalance,
}: {
  title: string;
  rows: ScheduleRow[];
  actionLabel: string;
  emptyText: string;
  showBalance: boolean;
}) {
  return (
    <Card>
      <CardHeader className="pb-3"><CardTitle className="text-base">{title}</CardTitle></CardHeader>
      <CardContent>
        {rows.length === 0 ? (
          <div className="text-sm text-muted-foreground">{emptyText}</div>
        ) : (
          <ul className="divide-y">
            {rows.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2 py-2.5">
                <div className="min-w-0">
                  <div className="text-sm font-medium truncate">{r.guest_name ?? "Guest"}</div>
                  <div className="text-xs text-muted-foreground">
                    Room {r.room_numbers} · {r.booking_number}
                    {showBalance && (
                      <> · Balance ₹{r.balance_amount.toLocaleString("en-IN")}</>
                    )}
                  </div>
                </div>
                <Button asChild size="sm" variant="outline">
                  <Link to="/front-desk/booking/$id" params={{ id: r.id }}>{actionLabel}</Link>
                </Button>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}