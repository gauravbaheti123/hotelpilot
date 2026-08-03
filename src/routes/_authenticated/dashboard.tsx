import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, useCallback, useMemo, memo } from "react";
import { AppShell } from "@/components/AppShell";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { supabase } from "@/integrations/supabase/client";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { BedDouble, LogIn, LogOut, IndianRupee, Building2, Users, UtensilsCrossed, ChevronDown, ChevronRight, DoorOpen, Sparkles, Wrench, PartyPopper, CheckCircle2, Receipt } from "lucide-react";
import { CheckoutDialog } from "@/components/CheckoutDialog";
import { AddExtraBedDialog } from "@/components/AddExtraBedDialog";
import { PunchChargeDialog } from "@/components/PunchChargeDialog";
import { KotHistoryDialog } from "@/components/KotHistoryDialog";
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
// Bell moved to global header (AppShell). Reminders section removed here.
import { ACTIVITY, logActivity, userDisplayName } from "@/lib/activityLog";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  loadEventSummaries, checkInBlock, checkOutBlock,
  type EventBlockSummary, type EventBlockRecord,
} from "@/lib/eventRoomBlocks";
import { CalendarDays } from "lucide-react";
import { SuperadminDashboard as PlatformSuperadminDashboard } from "@/components/SuperadminDashboard";
import { useSuperadminView } from "@/lib/superadmin-view";
import { usePermissions } from "@/hooks/use-permissions";
import {
  AssignRoomDialog,
  loadUnassignedReservations,
  type UnassignedReservation,
} from "@/components/AssignRoomDialog";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — HotelPilot" }] }),
  component: () => (<RequirePermission module="dashboard"><DashboardRouter /></RequirePermission>),
});

function DashboardRouter() {
  const { user, roles, loading } = useAuth();
  const { isViewing } = useSuperadminView();
  if (loading) return null;
  const isSuper =
    roles.includes("superadmin") ||
    (user?.email ?? "").toLowerCase() === "growth@hotelpilot.in";
  if (isSuper && !isViewing) return <PlatformSuperadminDashboard />;
  return <DashboardPage />;
}

type Room = {
  id: string;
  room_number: string;
  status: "vacant" | "occupied" | "blocked" | "maintenance";
  housekeeping_status: "clean" | "dirty" | "inspected" | "out_of_order";
  category_id: string | null;
  floor: string | null;
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
  checkInTime: string | null;
  checkOutTime: string | null;
  balance: number;
};

type RoomEventInfo = {
  blockId: string;
  bookingId: string;
  banquetBookingId: string;
  eventName: string;
  guestName: string | null;
  guestMobile: string | null;
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
        supabase.from("payments").select("amount,booking_id,folio_id").gte("paid_at", `${today}T00:00:00`).lte("paid_at", `${today}T23:59:59`),
      ]);
      // Banquet event-block collections are excluded from operational revenue.
      const scope = await fetchBanquetScope(null);
      const revenue = ((pay.data ?? []) as any[])
        .filter((x) => !isBanquetRecord(scope, x))
        .reduce((a, x) => a + Number(x.amount || 0), 0);
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
  const [viewDate, setViewDate] = useState<string>(todayISO());
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
  const [extraBedBookingId, setExtraBedBookingId] = useState<string | null>(null);
  const [pendingFoodByRoom, setPendingFoodByRoom] = useState<Map<string, PendingFood>>(new Map());
  const [pendingFoodRows, setPendingFoodRows] = useState<PendingFoodRow[]>([]);
  const [showPendingFood, setShowPendingFood] = useState(false);
  const [occInfoByRoom, setOccInfoByRoom] = useState<Map<string, OccInfo>>(new Map());
  const [events, setEvents] = useState<EventBlockSummary[]>([]);
  const [eventBlockByRoom, setEventBlockByRoom] = useState<Map<string, RoomEventInfo>>(new Map());
  const [bulkCheckinEvent, setBulkCheckinEvent] = useState<EventBlockSummary | null>(null);
  const [bulkCheckoutEvent, setBulkCheckoutEvent] = useState<EventBlockSummary | null>(null);
  const [singleAssignBlock, setSingleAssignBlock] = useState<EventBlockRecord | null>(null);
  const [grouping, setGrouping] = useState<"category" | "floor">("category");
  const [unassigned, setUnassigned] = useState<UnassignedReservation[]>([]);
  const [assignTarget, setAssignTarget] = useState<UnassignedReservation | null>(null);
  const [segment, setSegment] = useState<"rooms" | "food" | "laundry">("rooms");
  const [segmentPendingByRoom, setSegmentPendingByRoom] = useState<
    Map<string, { amount: number; count: number; bills: Array<{ id: string; bill_number: string; amount: number }> }>
  >(new Map());
  const [segmentReloadTick, setSegmentReloadTick] = useState(0);
  const [punchTarget, setPunchTarget] = useState<{
    segment: "food" | "laundry";
    bookingId: string | null;
    roomId: string | null;
    roomNumber: string | null;
    guestName: string | null;
  } | null>(null);
  const [kotHistoryTarget, setKotHistoryTarget] = useState<{
    segment: "food" | "laundry";
    bookingId: string | null;
    roomId: string | null;
    roomNumber: string | null;
    guestName: string | null;
  } | null>(null);
  const navigate = useNavigate();

  useEffect(() => {
    if (!userId) return;
    supabase.from("profiles").select("name").eq("id", userId).maybeSingle()
      .then(({ data }) => { if (data?.name) setName(data.name); });
  }, [userId]);

  // Load persisted room grouping preference for this property
  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    supabase.from("property_settings").select("room_grouping").eq("property_id", propertyId).maybeSingle()
      .then(({ data }) => {
        if (cancelled) return;
        const g = (data as any)?.room_grouping;
        if (g === "floor" || g === "category") setGrouping(g);
      });
    return () => { cancelled = true; };
  }, [propertyId]);

  async function changeGrouping(next: "category" | "floor") {
    setGrouping(next);
    if (!propertyId) return;
    const { error } = await supabase.from("property_settings").upsert(
      { property_id: propertyId, room_grouping: next } as any,
      { onConflict: "property_id" },
    );
    if (error) toast.error("Couldn't save grouping preference");
  }

  const reload = useCallback(async () => {
    if (!propertyId) return;
    const date = viewDate;
    const isToday = date === todayISO();
    // Single consolidated RPC replaces the 6 sequential selects that used to
    // run here — 1 network round-trip and 1 SQL join plan instead of 6.
    const { data: gridData, error: gridErr } = await supabase.rpc(
      "dashboard_grid" as any,
      { _property_id: propertyId, _date: date, _include_kots: isToday },
    );
    if (gridErr) {
      console.warn("dashboard_grid rpc failed", gridErr);
      return;
    }
    const grid: any = gridData ?? {};
    const arrRows: any[] = grid.arrivals ?? [];
    const depRows: any[] = grid.departures ?? [];
    const rmsRows: any[] = grid.rooms ?? [];
    const activeBRRows: any[] = grid.active_booking_rooms ?? [];
    const kotRows: any[] = grid.kots ?? [];
    const revenue = Number(grid.payments_total ?? 0);

      const occSet = new Set<string>(
        activeBRRows.map((b: any) => b.room_id).filter(Boolean),
      );
      const bMap = new Map<string, string>();
      const oMap = new Map<string, OccInfo>();
      activeBRRows.forEach((b: any) => {
        if (b.room_id && b.booking_id) bMap.set(b.room_id, b.booking_id);
        if (b.room_id) {
          oMap.set(b.room_id, {
            bookingId: b.booking_id,
            guestName: b.guest_name ?? null,
            checkIn: b.check_in ?? null,
            checkOut: b.check_out ?? null,
            checkInTime: b.check_in_time ?? null,
            checkOutTime: b.check_out_time ?? null,
            balance: Number(b.balance_amount || 0),
          });
        }
      });
      setOccupiedRoomIds(occSet);
      setBookingByRoom(bMap);
      setOccInfoByRoom(oMap);

      // Self-heal: reset only TRUE orphans — rooms flagged occupied with no
      // active booking_rooms row referencing them at all.
      //
      // REGRESSION GUARD (audited: "phantom auto checkout" bug, Phase 16):
      // NEVER vacate a room because its scheduled check_out date/time has
      // passed. A guest is released only by the explicit Checkout flow. An
      // overdue stay keeps an OPEN folio with a pending balance; auto-vacating
      // it makes the front desk think the room is free and re-let it while the
      // previous bill is unsettled. Overdue stays are surfaced by the
      // display-only "Overdue / Checkout due" indicator instead.
      if (isToday) {
        const potentialGhosts = rmsRows
          .filter((r: any) => r.status === "occupied" && !occSet.has(r.id))
          .map((r: any) => r.id);
        if (potentialGhosts.length > 0) {
          // Re-check against ALL active bookings with NO date filter, so an
          // overdue checked-in booking still holds its room.
          const { data: stillActive } = await supabase
            .from("booking_rooms")
            .select("room_id, actual_check_out, bookings!inner(status,property_id)")
            .eq("bookings.property_id", propertyId)
            .in("bookings.status", ["reserved", "checked_in"])
            .in("room_id", potentialGhosts);
          const heldRoomIds = new Set(
            (stillActive ?? [])
              .filter((b: any) => !b.actual_check_out)
              .map((b: any) => b.room_id)
              .filter(Boolean),
          );
          const ghosts = potentialGhosts.filter((id: string) => !heldRoomIds.has(id));
          if (ghosts.length > 0) {
            supabase.from("rooms")
              .update({ status: "vacant" as any, housekeeping_status: "dirty" as any })
              .in("id", ghosts)
              .then(({ error }) => { if (error) console.warn("ghost cleanup failed", error); });
          }
        }
      }
      setKpi({
        occupied: occSet.size,
        arrivals: arrRows.length,
        departures: depRows.length,
        revenue,
      });
      const mapRow = (b: any): ScheduleRow => ({
        id: b.id,
        booking_number: b.booking_number,
        balance_amount: Number(b.balance_amount || 0),
        guest_name: b.guest_name ?? null,
        room_numbers: b.room_numbers ?? "—",
      });
      setArrivals(arrRows.map(mapRow));
      setDepartures(depRows.map(mapRow));
      setRooms(rmsRows as Room[]);

      // Pending food per room — SINGLE SOURCE OF TRUTH: open segment_bills (segment = 'food').
      // The legacy kot_orders flow was removed in Phase 17; never read it here again or the
      // Lodge room badge will drift from the Food segment tab / checkout block.
      const pfMap = new Map<string, PendingFood>();
      {
        const { data: fbills } = await supabase
          .from("segment_bills" as any)
          .select("id,room_id,booking_id,total_amount,created_at,segment_bill_items(description,qty)")
          .eq("property_id", propertyId)
          .eq("segment", "food")
          .eq("status", "open")
          .eq("is_walkin", false);
        (fbills ?? []).forEach((b: any) => {
          if (!b.room_id || !b.booking_id) return;
          const prev = pfMap.get(b.room_id) ?? { bookingId: b.booking_id, amount: 0, count: 0, lastAt: null, items: "" };
          const itemSummary = (b.segment_bill_items ?? []).map((i: any) => `${i.description}×${i.qty}`).join(", ");
          prev.amount += Number(b.total_amount || 0);
          prev.count += 1;
          prev.lastAt = !prev.lastAt || b.created_at > prev.lastAt ? b.created_at : prev.lastAt;
          prev.items = prev.items ? `${prev.items}; ${itemSummary}` : itemSummary;
          prev.bookingId = b.booking_id;
          pfMap.set(b.room_id, prev);
        });
      }
      setPendingFoodByRoom(pfMap);

      // Build per-row list for the collapsible section
      const guestByBooking = new Map<string, string | null>();
      arrRows.concat(depRows).forEach((b: any) => guestByBooking.set(b.id, b.guest_name ?? null));
      const roomNumberById = new Map<string, string>(rmsRows.map((r: any) => [r.id, r.room_number]));
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

      // Event room blocks for the selected date
      try {
        const summaries = await loadEventSummaries(propertyId);
        // Filter blocks to those covering the selected date
        const filtered = summaries
          .map((ev) => ({
            ...ev,
            blocks: ev.blocks.filter((b) => b.checkin_date <= date && b.checkout_date > date),
          }))
          .filter((ev) => ev.blocks.length > 0)
          .map((ev) => ({
            ...ev,
            blocked: ev.blocks.filter((b) => b.status === "blocked").length,
            checked_in: ev.blocks.filter((b) => b.status === "checked_in").length,
            checked_out: ev.blocks.filter((b) => b.status === "checked_out").length,
            total: ev.blocks.length,
          }));
        setEvents(filtered);
        const map = new Map<string, RoomEventInfo>();
        // Populate the per-room event map from ALL blocks (not just those
        // active on the selected date) so any room whose DB status is
        // "blocked" always surfaces its event name + guest name on the tile.
        summaries.forEach((ev) => ev.blocks.forEach((b) => {
          if (!b.room_id) return;
          if (b.status === "checked_out" || b.status === "cancelled") return;
          map.set(b.room_id, {
            blockId: b.id,
            bookingId: b.booking_id ?? "",
            banquetBookingId: ev.banquet_booking_id,
            eventName: ev.event_name,
            guestName: b.guest_name,
            guestMobile: b.guest_mobile,
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

      // Load reservations without an assigned room (future stays only). These
      // do NOT attach to any room tile — they surface in a separate panel.
      try {
        const unas = await loadUnassignedReservations(propertyId);
        setUnassigned(unas);
      } catch (e) {
        console.warn("loadUnassignedReservations failed", e);
      }
  }, [propertyId, viewDate]);

  useEffect(() => { reload(); }, [reload]);

  // Segment view: load per-room open Food/Laundry bill totals when the
  // Food or Laundry tab is active. Only room-linked (non-walkin) OPEN bills
  // are surfaced against room tiles.
  useEffect(() => {
    if (!propertyId) return;
    if (segment === "rooms") { setSegmentPendingByRoom(new Map()); return; }
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("segment_bills" as any)
        .select("id,bill_number,room_id,total_amount,paid_amount,segment,status,is_walkin")
        .eq("property_id", propertyId)
        .eq("segment", segment)
        .eq("status", "open")
        .eq("is_walkin", false);
      if (cancelled) return;
      if (error) { console.warn("segment bills load failed", error); return; }
      const m = new Map<string, { amount: number; count: number; bills: Array<{ id: string; bill_number: string; amount: number }> }>();
      (data ?? []).forEach((b: any) => {
        if (!b.room_id) return;
        const bal = Math.max(0, Number(b.total_amount || 0) - Number(b.paid_amount || 0));
        const prev = m.get(b.room_id) ?? { amount: 0, count: 0, bills: [] };
        prev.amount += bal;
        prev.count += 1;
        prev.bills.push({ id: b.id, bill_number: b.bill_number, amount: bal });
        m.set(b.room_id, prev);
      });
      setSegmentPendingByRoom(m);
    })();
    return () => { cancelled = true; };
  }, [propertyId, segment, viewDate, segmentReloadTick]);

  // Realtime: refresh the segment-pending map when segment_bills change.
  useEffect(() => {
    if (!propertyId || segment === "rooms") return;
    const ch = supabase
      .channel(`dashboard-segment-${propertyId}-${segment}`)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "segment_bills", filter: `property_id=eq.${propertyId}` },
        () => { setSegmentReloadTick((n) => n + 1); }
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [propertyId, segment]);

  async function addPendingFoodToBill(bookingId: string) {
    try {
      const { data: folioId, error: fErr } = await supabase.rpc("get_or_create_folio", { _booking_id: bookingId });
      if (fErr || !folioId) throw fErr ?? new Error("Folio not created");
      const { data: bills, error: kErr } = await supabase
        .from("segment_bills" as any)
        .select("id,bill_number")
        .eq("booking_id", bookingId)
        .eq("segment", "food")
        .eq("status", "open");
      if (kErr) throw kErr;
      if (!bills || bills.length === 0) { toast.info("No pending food bills"); return; }
      const { data: existingCharges } = await supabase
        .from("folio_charges")
        .select("source_id")
        .eq("folio_id", folioId as any)
        .eq("source_table", "segment_bills");
      const existing = new Set((existingCharges ?? []).map((c: any) => c.source_id));
      for (const b of bills as any[]) {
        if (!existing.has(b.id)) {
          const { data: items, error: iErrS } = await supabase
            .from("segment_bill_items" as any)
            .select("description,qty,rate,amount,gst_rate,gst_amount")
            .eq("segment_bill_id", b.id);
          if (iErrS) throw iErrS;
          const rows = (items ?? []).map((it: any) => ({
            folio_id: folioId,
            charge_type: "food",
            description: `${it.description} (${b.bill_number})`,
            qty: Number(it.qty),
            rate: Number(it.rate),
            amount: Number(it.amount),
            gst_rate: Number(it.gst_rate),
            gst_amount: Number(it.gst_amount),
            source_table: "segment_bills",
            source_id: b.id,
            segment_bill_ref: b.bill_number,
            created_by: userId || null,
          }));
          if (rows.length > 0) {
            const { error: iErr } = await supabase.from("folio_charges").insert(rows as any);
            if (iErr) throw iErr;
          }
        }
        const { error: uErr } = await supabase
          .from("segment_bills" as any)
          .update({ status: "settled", settled_at: new Date().toISOString(), folio_id: folioId } as any)
          .eq("id", b.id);
        if (uErr) throw uErr;
      }
      toast.success(`Added ${bills.length} food bill(s) to room bill`);
      reload();
    } catch (e: any) {
      toast.error(e?.message ?? "Failed to add to bill");
    }
  }

  useEffect(() => {
    if (!propertyId) return;
    supabase.from("staff").select("id, name").eq("property_id", propertyId).eq("is_active", true).order("name")
      .then(({ data }) => setStaff((data ?? []) as StaffOpt[]));
    supabase.from("room_categories").select("id, name").eq("property_id", propertyId).order("name")
      .then(({ data }) => setCategories((data ?? []) as RoomCategory[]));
  }, [propertyId]);

  // Live updates: Realtime subscription + 60s polling fallback
  const [liveStatus, setLiveStatus] = useState<"connecting" | "live" | "polling">("connecting");
  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    const filter = `property_id=eq.${propertyId}`;
    const debouncedReload = (() => {
      let t: ReturnType<typeof setTimeout> | null = null;
      return () => {
        if (cancelled) return;
        if (t) clearTimeout(t);
        t = setTimeout(() => { if (!cancelled) reload(); }, 400);
      };
    })();
    const channel = supabase
      .channel(`dashboard-live-${propertyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "rooms", filter }, debouncedReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "bookings", filter }, debouncedReload)
      // booking_rooms carries property_id — filter to this property so a
      // sibling tenant's booking activity doesn't fan out to every open
      // dashboard. Prior version subscribed unfiltered which caused
      // cross-tenant reload chatter.
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_rooms", filter }, debouncedReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "kot_orders", filter }, debouncedReload)
      .on("postgres_changes", { event: "*", schema: "public", table: "event_room_blocks", filter }, debouncedReload)
      .subscribe((status) => {
        if (cancelled) return;
        if (status === "SUBSCRIBED") setLiveStatus("live");
        else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") setLiveStatus("polling");
      });
    const interval = setInterval(() => { if (!cancelled) reload(); }, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [propertyId, reload]);

  return (
    <AppShell title="Dashboard">
      <div className="w-full space-y-6">
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-4 flex-wrap">
            <CardTitle className="text-base flex items-center gap-2">
              Room Status
              <span
                title={
                  liveStatus === "live" ? "Live — updates in real time"
                  : liveStatus === "polling" ? "Polling — refreshing every 60s"
                  : "Connecting…"
                }
                className="inline-flex items-center gap-1 text-[10px] font-medium uppercase tracking-wide text-muted-foreground"
              >
                <span
                  className={`inline-block h-2 w-2 rounded-full ${
                    liveStatus === "live" ? "bg-emerald-500 animate-pulse"
                    : liveStatus === "polling" ? "bg-slate-400"
                    : "bg-amber-400 animate-pulse"
                  }`}
                />
                {liveStatus === "live" ? "Live" : liveStatus === "polling" ? "Polling" : "…"}
              </span>
            </CardTitle>
            <div className="flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-md border overflow-hidden text-xs">
                {(["rooms", "food", "laundry"] as const).map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setSegment(s)}
                    className={`px-3 h-8 font-medium transition-colors ${
                      segment === s
                        ? "bg-primary text-primary-foreground"
                        : "bg-background hover:bg-muted"
                    }`}
                  >
                    {s === "rooms" ? "Lodge" : s === "food" ? "Food" : "Laundry"}
                  </button>
                ))}
              </div>
              {segment !== "rooms" && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  onClick={() => setPunchTarget({
                    segment: segment as "food" | "laundry",
                    bookingId: null,
                    roomId: null,
                    roomNumber: null,
                    guestName: null,
                  })}
                >
                  Walk-in Sale
                </Button>
              )}
              <Input
                type="date"
                value={viewDate}
                onChange={(e) => setViewDate(e.target.value || todayISO())}
                className="w-40 h-8 text-xs py-1 bg-background"
              />
              {viewDate !== todayISO() && (
                <Button size="sm" variant="outline" className="h-8 text-xs px-2 py-1" onClick={() => setViewDate(todayISO())}>
                  Today
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            {rooms.length === 0 ? (
              <div className="text-sm text-muted-foreground">No rooms configured.</div>
            ) : (
              <RoomGroups
                rooms={rooms}
                categories={categories}
                grouping={grouping}
                occupiedRoomIds={occupiedRoomIds}
                pendingFoodByRoom={pendingFoodByRoom}
                occInfoByRoom={occInfoByRoom}
                eventBlockByRoom={eventBlockByRoom}
                segmentMode={segment}
                segmentPendingByRoom={segmentPendingByRoom}
                onPick={(r) => {
                  if (segment !== "rooms") {
                    const bid = bookingByRoom.get(r.id) ?? null;
                    const occ = occInfoByRoom.get(r.id) ?? null;
                    setPunchTarget({
                      segment: segment as "food" | "laundry",
                      bookingId: bid,
                      roomId: r.id,
                      roomNumber: r.room_number,
                      guestName: occ?.guestName ?? null,
                    });
                    return;
                  }
                  setModalRoom(r);
                }}
                onSegmentAction={async (r, action) => {
                  if (segment === "rooms") return;
                  const seg = segment as "food" | "laundry";
                  const bid = bookingByRoom.get(r.id) ?? null;
                  const occ = occInfoByRoom.get(r.id) ?? null;
                  if (action === "view_kot") {
                    setKotHistoryTarget({
                      segment: seg,
                      bookingId: bid,
                      roomId: r.id,
                      roomNumber: r.room_number,
                      guestName: occ?.guestName ?? null,
                    });
                    return;
                  }
                  // View Invoice — jump to the Invoices screen, pre-filtered to
                  // this room's latest bill for the active segment.
                  const latest = segmentPendingByRoom.get(r.id)?.bills?.[0]?.bill_number ?? null;
                  navigate({ to: "/billing/invoices", search: { seg, bill: latest ?? undefined } });
                }}
                onPickFood={(r) => {
                  const pf = pendingFoodByRoom.get(r.id);
                  if (pf?.bookingId) navigate({ to: "/front-desk/booking/$id", params: { id: pf.bookingId } });
                }}
                onCheckout={(bid) => setCheckoutBookingId(bid)}
                onAssignEvent={(blk) => {
                  // Inline Name + Mobile capture — no full booking form
                  setSingleAssignBlock(blk);
                }}
                onEventCheckIn={async (blk) => {
                  if (!propertyId || !userId) return;
                  if (!blk.guest_name || !blk.guest_mobile) {
                    // Guest missing name/mobile — open inline capture dialog
                    setSingleAssignBlock(blk);
                    return;
                  }
                  if (!confirm(`Check in ${blk.guest_name} to Room ${blk.room_number}?`)) return;
                  try {
                    await checkInBlock({ propertyId, block: blk, userId });
                    toast.success(`Room ${blk.room_number} checked in`);
                    reload();
                  } catch (e: any) {
                    toast.error(e?.message ?? "Check-in failed");
                  }
                }}
              />
            )}
            <div className="mt-4 flex flex-wrap gap-3 text-xs text-muted-foreground">
              <LegendDot style={{ backgroundColor: "#16a34a" }} label="Vacant" />
              <LegendDot style={{ backgroundColor: "#dc2626" }} label="Occupied" />
              <LegendDot style={{ backgroundColor: "#b45309" }} label="Overdue" />
              <LegendDot style={{ backgroundColor: "#d97706" }} label="Dirty" />
              <LegendDot style={{ backgroundColor: "#6b7280" }} label="Maintenance" />
              <LegendDot style={{ backgroundColor: "#7c3aed" }} label="Event" />
              <LegendDot style={{ backgroundColor: "#6d28d9" }} label="Event·In" />
              <LegendDot style={{ backgroundColor: "#fbbf24" }} label="Pending food" />
            </div>
            <div className="mt-4 flex items-center gap-2 border-t pt-3">
              <Label className="text-xs text-muted-foreground">Group rooms by</Label>
              <Select value={grouping} onValueChange={(v) => changeGrouping(v as "category" | "floor")}>
                <SelectTrigger className="h-8 w-36 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="category">Category</SelectItem>
                  <SelectItem value="floor">Floor</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Kpi label="Occupied Rooms" value={kpi.occupied} icon={BedDouble} />
          <Kpi
            label="Available Rooms"
            value={rooms.filter((r) =>
              ["vacant", "dirty", "maintenance"].includes(r.status as string),
            ).length}
            icon={DoorOpen}
          />
          <Kpi label="Expected Arrivals" value={kpi.arrivals} icon={LogIn} />
          <Kpi label="Expected Departures" value={kpi.departures} icon={LogOut} />
          <Kpi
            label="Dirty Rooms"
            value={rooms.filter((r) => r.housekeeping_status === "dirty").length}
            icon={Sparkles}
            iconClassName="text-amber-600"
          />
          <Kpi
            label="Maintenance Rooms"
            value={rooms.filter((r) => r.status === "maintenance" || r.housekeeping_status === "out_of_order").length}
            icon={Wrench}
            iconClassName="text-red-600"
          />
          <Kpi
            label="Event / Wedding Rooms"
            value={Array.from(eventBlockByRoom.values()).filter((e) => e.status !== "checked_out").length}
            icon={PartyPopper}
            iconClassName="text-purple-600"
          />
          <Kpi
            label="Ready to Sell"
            value={rooms.filter((r) =>
              r.status === "vacant" && r.housekeeping_status === "clean",
            ).length}
            icon={CheckCircle2}
            iconClassName="text-emerald-600"
          />
        </div>

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
                            <Button size="sm" onClick={() => addPendingFoodToBill(r.bookingId)}>
                              Add to Bill
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
                    {ev.blocked} pending · {ev.checked_in} checked in · {ev.checked_out} checked out
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

        {unassigned.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BedDouble className="h-4 w-4" />
                Unassigned Reservations
                <span className="inline-flex items-center justify-center min-w-[1.5rem] h-5 px-1.5 rounded-full bg-blue-500 text-white text-xs font-semibold">
                  {unassigned.length}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs uppercase text-muted-foreground">
                      <th className="py-2 pr-3">Booking #</th>
                      <th className="py-2 pr-3">Guest</th>
                      <th className="py-2 pr-3">Category</th>
                      <th className="py-2 pr-3">Stay</th>
                      <th className="py-2 pr-3">Pax</th>
                      <th className="py-2 pr-3 text-right">Rate</th>
                      <th className="py-2 pr-3"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {unassigned.map((r) => (
                      <tr key={r.booking_room_id} className="border-t">
                        <td className="py-2 pr-3 font-medium">
                          <Link
                            to="/front-desk/booking/$id"
                            params={{ id: r.booking_id }}
                            className="text-primary hover:underline"
                          >
                            {r.booking_number}
                          </Link>
                        </td>
                        <td className="py-2 pr-3">{r.guest_name ?? "—"}</td>
                        <td className="py-2 pr-3">{r.category_name}</td>
                        <td className="py-2 pr-3 text-xs">
                          {r.check_in} → {r.check_out}
                        </td>
                        <td className="py-2 pr-3 text-xs">
                          {r.adults}A{r.children > 0 ? ` ${r.children}C` : ""}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          ₹{r.rate.toLocaleString("en-IN")}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          <Button size="sm" onClick={() => setAssignTarget(r)}>
                            Assign Room
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      <RoomStatusModal
        room={modalRoom}
        kind={
          modalRoom
            ? tileKind(
                modalRoom,
                occupiedRoomIds.has(modalRoom.id) ||
                  eventBlockByRoom.get(modalRoom.id)?.status === "checked_in",
              )
            : null
        }
        bookingId={
          modalRoom
            ? bookingByRoom.get(modalRoom.id) ??
              (eventBlockByRoom.get(modalRoom.id)?.status === "checked_in"
                ? eventBlockByRoom.get(modalRoom.id)?.bookingId || null
                : null)
            : null
        }
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
        onAddExtraBed={(bid: string) => { setModalRoom(null); setExtraBedBookingId(bid); }}
        onCollectAdvance={(bid: string) => {
          setModalRoom(null);
          navigate({ to: "/billing/folio/$bookingId", params: { bookingId: bid } });
        }}
      />
      <CheckoutDialog
        bookingId={checkoutBookingId}
        open={!!checkoutBookingId}
        onOpenChange={(o: boolean) => { if (!o) setCheckoutBookingId(null); }}
        onDone={() => { setCheckoutBookingId(null); reload(); }}
      />
      <AddExtraBedDialog
        bookingId={extraBedBookingId}
        open={!!extraBedBookingId}
        onOpenChange={(o: boolean) => { if (!o) setExtraBedBookingId(null); }}
        onDone={() => { setExtraBedBookingId(null); reload(); }}
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
        propertyId={propertyId}
        userId={userId}
        onClose={() => setSingleAssignBlock(null)}
        onDone={() => { setSingleAssignBlock(null); reload(); }}
      />
      {assignTarget && propertyId && (
        <AssignRoomDialog
          open={!!assignTarget}
          onOpenChange={(o) => { if (!o) setAssignTarget(null); }}
          bookingRoomId={assignTarget.booking_room_id}
          propertyId={propertyId}
          bookingId={assignTarget.booking_id}
          bookingNumber={assignTarget.booking_number}
          categoryId={assignTarget.category_id}
          categoryName={assignTarget.category_name}
          currentRate={assignTarget.rate}
          checkIn={assignTarget.check_in}
          checkOut={assignTarget.check_out}
          onDone={() => { setAssignTarget(null); reload(); }}
        />
      )}
      {punchTarget && propertyId && (
        <PunchChargeDialog
          open={!!punchTarget}
          onClose={() => setPunchTarget(null)}
          segment={punchTarget.segment}
          propertyId={propertyId}
          propertyName={propertyName}
          bookingId={punchTarget.bookingId}
          roomId={punchTarget.roomId}
          roomNumber={punchTarget.roomNumber}
          guestName={punchTarget.guestName}
          onSaved={() => { setPunchTarget(null); reload(); }}
        />
      )}
      {kotHistoryTarget && propertyId && (
        <KotHistoryDialog
          open={!!kotHistoryTarget}
          onClose={() => setKotHistoryTarget(null)}
          segment={kotHistoryTarget.segment}
          propertyId={propertyId}
          roomId={kotHistoryTarget.roomId}
          roomNumber={kotHistoryTarget.roomNumber}
          guestName={kotHistoryTarget.guestName}
          bookingId={kotHistoryTarget.bookingId}
          onChanged={() => { setSegmentReloadTick((t) => t + 1); reload(); }}
        />
      )}
    </AppShell>
  );
}

function RoomGroups({
  rooms, categories, grouping, occupiedRoomIds, pendingFoodByRoom, occInfoByRoom, eventBlockByRoom,
  segmentMode, segmentPendingByRoom,
  onPick, onPickFood, onCheckout, onAssignEvent, onEventCheckIn, onSegmentAction,
}: {
  rooms: Room[];
  categories: RoomCategory[];
  grouping: "category" | "floor";
  occupiedRoomIds: Set<string>;
  pendingFoodByRoom: Map<string, PendingFood>;
  occInfoByRoom: Map<string, OccInfo>;
  eventBlockByRoom: Map<string, RoomEventInfo>;
  segmentMode: "rooms" | "food" | "laundry";
  segmentPendingByRoom: Map<string, { amount: number; count: number; bills: Array<{ id: string; bill_number: string; amount: number }> }>;
  onPick: (r: Room) => void;
  onPickFood: (r: Room) => void;
  onCheckout: (bookingId: string) => void;
  onAssignEvent: (blk: EventBlockRecord) => void;
  onEventCheckIn: (blk: EventBlockRecord) => void;
  onSegmentAction: (r: Room, action: "view_kot" | "view_invoice") => void;
}) {
  // Memoize the group derivation so unrelated state changes on the dashboard
  // (modal toggles, form inputs, etc.) don't rebuild these arrays on every
  // render — the previous version ran the full group/sort every re-render.
  const ordered = useMemo(() => {
    let out: { name: string; rooms: Room[] }[] = [];
    if (grouping === "floor") {
      const byFloor = new Map<string, Room[]>();
      const unassigned: Room[] = [];
      rooms.forEach((r) => {
        const f = (r.floor ?? "").trim();
        if (!f) { unassigned.push(r); return; }
        const arr = byFloor.get(f) ?? [];
        arr.push(r);
        byFloor.set(f, arr);
      });
      out = Array.from(byFloor.keys())
        .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
        .map((f) => ({ name: `Floor ${f}`, rooms: byFloor.get(f) ?? [] }));
      if (unassigned.length > 0) out.push({ name: "No floor set", rooms: unassigned });
    } else {
      const byCat = new Map<string, Room[]>();
      const uncategorised: Room[] = [];
      rooms.forEach((r) => {
        if (!r.category_id) { uncategorised.push(r); return; }
        const arr = byCat.get(r.category_id) ?? [];
        arr.push(r);
        byCat.set(r.category_id, arr);
      });
      out = categories
        .map((c) => ({ name: c.name, rooms: byCat.get(c.id) ?? [] }))
        .filter((g) => g.rooms.length > 0);
      if (uncategorised.length > 0) out.push({ name: "Uncategorised", rooms: uncategorised });
    }
    return out;
  }, [rooms, categories, grouping]);

  // In segment mode, hide rooms that can't take a charge (vacant, dirty,
  // maintenance, blocked/event). Only in-house guests (occupied) qualify.
  const filteredGroups = useMemo(() => {
    if (segmentMode === "rooms") return ordered;
    return ordered
      .map((g) => ({
        name: g.name,
        rooms: g.rooms.filter((r) => occupiedRoomIds.has(r.id)),
      }))
      .filter((g) => g.rooms.length > 0);
  }, [ordered, segmentMode, occupiedRoomIds]);

  return (
    <div className="space-y-4">
      {segmentMode !== "rooms" && filteredGroups.length === 0 && (
        <div className="text-sm text-muted-foreground border rounded-md p-6 text-center">
          No occupied rooms — {segmentMode === "food" ? "food" : "laundry"} charges can only be punched against in-house guests.
          Use <span className="font-medium">Walk-in Sale</span> for counter sales.
        </div>
      )}
      {filteredGroups.map((g) => (
        <div key={g.name} className="space-y-2">
          <div className="pb-1.5 border-b border-border/60">
            <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
              {g.name} <span className="text-muted-foreground/60 font-normal">· {g.rooms.length}</span>
            </div>
          </div>
          <div className="grid gap-2 grid-cols-2 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 w-full">
            {g.rooms.map((r) => (
              segmentMode !== "rooms" ? (
                <SegmentRoomCard
                  key={r.id}
                  room={r}
                  category={g.name}
                  segment={segmentMode}
                  occ={occInfoByRoom.get(r.id) ?? null}
                  pending={segmentPendingByRoom.get(r.id) ?? null}
                  onPick={() => onPick(r)}
                  onViewKot={() => onSegmentAction(r, "view_kot")}
                  onViewInvoice={() => onSegmentAction(r, "view_invoice")}
                />
              ) : (
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
              )
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// Segment tile — used when Food/Laundry tab is active. Displays the guest
// name and this segment's pending bill amount (₹0 = clean). Tapping opens
// the Punch Food/Laundry Charge dialog via the parent's onPick.
function SegmentRoomCard({
  room, category, segment, occ, pending, onPick, onViewKot, onViewInvoice,
}: {
  room: Room;
  category: string;
  segment: "food" | "laundry";
  occ: OccInfo | null;
  pending: { amount: number; count: number; bills: Array<{ id: string; bill_number: string; amount: number }> } | null;
  onPick: () => void;
  onViewKot: () => void;
  onViewInvoice: () => void;
}) {
  const amount = pending?.amount ?? 0;
  const hasPending = amount > 0.01;
  const bg = hasPending ? "#f59e0b" : "#0ea5e9"; // amber = pending, sky = clean
  const label = segment === "food" ? "Food" : "Laundry";
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div
          role="button"
          tabIndex={0}
          className="relative transition cursor-pointer overflow-hidden flex flex-col text-left"
          style={{ backgroundColor: bg, color: "#ffffff", minHeight: 118, borderRadius: 10 }}
        >
      <div className="px-2 pt-1.5 pb-1 flex-1 min-h-0 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <span style={{ color: "#ffffff", fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{room.room_number}</span>
          <span
            className="font-semibold uppercase tracking-wide rounded-full"
            style={{ backgroundColor: "rgba(255,255,255,0.25)", color: "#ffffff", fontSize: 10, padding: "2px 7px" }}
          >
            {label}
          </span>
        </div>
        <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 11, marginTop: 1 }}>{category}</div>
        <div className="truncate" style={{ color: "#ffffff", fontSize: 13, fontWeight: 700, marginTop: 2 }}>
          {occ?.guestName ?? "Guest"}
        </div>
        <div className="mt-auto pt-1">
          {hasPending ? (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: "#ffffff" }}>
                ₹{amount.toLocaleString("en-IN")} pending
              </div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.85)" }}>
                {pending!.count} open bill{pending!.count > 1 ? "s" : ""} · tap to add more
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 12, fontWeight: 700, color: "rgba(255,255,255,0.95)" }}>No pending</div>
              <div style={{ fontSize: 10, color: "rgba(255,255,255,0.85)" }}>Tap for {label.toLowerCase()} actions</div>
            </>
          )}
        </div>
      </div>
        </div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">
        <DropdownMenuItem onSelect={() => onViewKot()}>
          View {segment === "food" ? "KOT" : "Tickets"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onPick()}>
          New {segment === "food" ? "KOT" : "Ticket"}
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onViewInvoice()}>
          View Invoice
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

// === Batch 2: solid-colour room tiles. Each kind paints its full background.
// Hex only — these values are read directly by inline style so we never depend
// on Tailwind color utilities (and we keep the same palette the user signed off).
const STATUS_META: Record<string, { label: string; bg: string }> = {
  vacant:      { label: "Vacant",      bg: "#16a34a" },
  occupied:    { label: "Occupied",    bg: "#dc2626" },
  dirty:       { label: "Dirty",       bg: "#d97706" },
  maintenance: { label: "Maintenance", bg: "#6b7280" },
  blocked:     { label: "Event",       bg: "#7c3aed" },
  overdue:     { label: "OVERDUE",     bg: "#b45309" },
};
const EVENT_BLOCK_BG = "#7c3aed";
const EVENT_IN_BG = "#6d28d9";
// Back-compat alias used elsewhere in this file.
const EVENT_BG = EVENT_BLOCK_BG;

function tileKindExt(r: Room, isOccupied: boolean): keyof typeof STATUS_META {
  // Only treat as occupied when an actual active booking covers this room
  // for the selected date. The rooms.status flag can go stale (ghost tiles),
  // so we deliberately ignore it here — the self-heal in reload() will fix
  // the underlying row.
  if (isOccupied) return "occupied";
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

// Phase 34.2 — compact "02 Aug, 8:00 PM" for room cards. Time is optional;
// falls back to the date alone when the stay has no stored time.
function fmtTime12(t: string | null | undefined) {
  if (!t) return "";
  const [hStr, mStr] = t.split(":");
  const h = Number(hStr);
  if (isNaN(h)) return "";
  const suffix = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${mStr ?? "00"} ${suffix}`;
}

function fmtShortDT(dateStr: string | null, time?: string | null) {
  const d = fmtShort(dateStr);
  const t = fmtTime12(time);
  return t ? `${d}, ${t}` : d;
}

// React.memo with a data-only comparator: skip re-render when only the
// callback references changed (they're recreated inline every parent render).
// This is the room-grid re-render fix from Phase 2 — an unrelated dashboard
// state tick no longer re-renders all N tiles.
const RoomCard = memo(function RoomCard({
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
  const baseKind = tileKindExt(room, isOccupied);
  const todayStr = todayISO();
  const isOverdue = baseKind === "occupied" && !!occ?.checkOut && occ.checkOut < todayStr;
  const kind = isOverdue ? "overdue" : baseKind;
  const meta = STATUS_META[kind];
  const hasFood = !!pendingFood && pendingFood.amount > 0;
  const baseBalance = occ?.balance ?? 0;
  const pending = baseBalance + (hasFood ? pendingFood!.amount : 0);

  if (isEventBlock || isEventCheckedIn) {
    const evBg = isEventCheckedIn ? EVENT_IN_BG : EVENT_BLOCK_BG;
    return (
      <div
        role={isEventCheckedIn ? "button" : undefined}
        tabIndex={isEventCheckedIn ? 0 : -1}
        onClick={isEventCheckedIn ? onPick : undefined}
        onKeyDown={isEventCheckedIn
          ? (e) => { if (e.key === "Enter" || e.key === " ") onPick(); }
          : undefined}
        className="relative transition cursor-pointer overflow-hidden flex flex-col"
        style={{ backgroundColor: evBg, color: "#ffffff", minHeight: 118, borderRadius: 10 }}
      >
        <div className="px-2 pt-1.5 pb-1 flex-1 min-h-0 flex flex-col">
          <div className="flex items-start justify-between gap-2">
            <span style={{ color: "#ffffff", fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{room.room_number}</span>
            <span className="font-semibold uppercase tracking-wide rounded-full"
              style={{ backgroundColor: "rgba(255,255,255,0.25)", color: "#ffffff", fontSize: 10, padding: "2px 7px" }}>
              {isEventCheckedIn ? "Event·In" : "Event"}
            </span>
          </div>
          <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 1 }}>{category}</div>
          <div className="truncate" style={{ color: "rgba(255,255,255,0.8)", fontSize: 13, fontStyle: "italic", fontWeight: 500, marginTop: 2 }}>
            — {eventInfo!.eventName} —
          </div>
          <div className="truncate" style={{ color: eventInfo!.guestName ? "#ffffff" : "rgba(255,255,255,0.75)", fontStyle: eventInfo!.guestName ? "normal" : "italic", fontSize: 14, fontWeight: eventInfo!.guestName ? 700 : 500 }}>
            {eventInfo!.guestName ?? "Guest Unassigned"}
          </div>
          <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 11 }}>{fmtShort(eventInfo!.checkin)} → {fmtShort(eventInfo!.checkout)}</div>
          <div className="mt-auto pt-1 flex flex-wrap gap-1">
            {isEventBlock && !eventInfo!.guestName && (
              <button type="button"
                style={{ backgroundColor: "transparent", color: "#ffffff", border: "1px solid #ffffff", borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600 }}
                onClick={(e) => { e.stopPropagation(); onAssignEvent({
                  id: eventInfo!.blockId, banquet_booking_id: eventInfo!.banquetBookingId,
                  event_name: eventInfo!.eventName, room_id: room.id,
                  room_number: room.room_number, room_category: category,
                  guest_name: null, guest_mobile: null,
                  checkin_date: eventInfo!.checkin, checkout_date: eventInfo!.checkout,
                  special_rate: null, status: "blocked", booking_id: null,
                } as EventBlockRecord); }}>Assign</button>
            )}
            {isEventBlock && (
              <button type="button"
                title={eventInfo!.guestName && eventInfo!.guestMobile ? "Check in this guest" : "Assign guest name & mobile"}
                style={{
                  backgroundColor: "#ffffff",
                  color: evBg,
                  cursor: "pointer",
                  borderRadius: 4, padding: "3px 8px", fontSize: 11, fontWeight: 600, border: "none",
                }}
                onClick={(e) => { e.stopPropagation(); onEventCheckIn({
                  id: eventInfo!.blockId, banquet_booking_id: eventInfo!.banquetBookingId,
                  event_name: eventInfo!.eventName, room_id: room.id,
                  room_number: room.room_number, room_category: category,
                  guest_name: eventInfo!.guestName, guest_mobile: eventInfo!.guestMobile,
                  checkin_date: eventInfo!.checkin, checkout_date: eventInfo!.checkout,
                  special_rate: null, status: "blocked", booking_id: null,
                } as EventBlockRecord); }}>Check In</button>
            )}
            {isEventCheckedIn && eventInfo!.bookingId && (
              <button type="button"
                style={{ backgroundColor: "#ffffff", color: evBg, borderRadius: 4, padding: "3px 10px", fontSize: 11, fontWeight: 600, border: "none" }}
                onClick={(e) => { e.stopPropagation(); onCheckout(eventInfo!.bookingId); }}>Checkout</button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const isCompact = kind !== "occupied";
  const cardHeight = 118;
  const hintText =
    kind === "dirty" ? "🧹 Needs cleaning"
    : kind === "maintenance" ? "🔧 Under repair"
    : kind === "blocked"
      ? `🎉 ${eventInfo?.eventName ?? "Event"} — ${eventInfo?.guestName ?? "Unassigned"}`
    : null;

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onPick}
      onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") onPick(); }}
      className="relative transition cursor-pointer overflow-hidden flex flex-col"
      style={{ backgroundColor: meta.bg, color: "#ffffff", minHeight: 118, borderRadius: 10 }}
    >
      <div className="px-2 pt-1.5 pb-1 flex-1 min-h-0 flex flex-col">
        <div className="flex items-start justify-between gap-2">
          <span style={{ color: "#ffffff", fontSize: 20, fontWeight: 700, lineHeight: 1 }}>{room.room_number}</span>
          <span
            className="font-semibold uppercase tracking-wide rounded-full"
            style={{
              backgroundColor: kind === "overdue" ? "#dc2626" : "rgba(255,255,255,0.25)",
              color: "#ffffff", fontSize: 10, padding: "2px 7px",
            }}
          >
            {meta.label}
          </span>
        </div>
        <div style={{ color: "rgba(255,255,255,0.8)", fontSize: 11, marginTop: 1 }}>{category}</div>

        {(kind === "occupied" || kind === "overdue") && occ && (
          <>
            <div className="truncate" style={{ color: "#ffffff", fontSize: 13, fontWeight: 700, marginTop: 2 }}>
              {occ.guestName ?? "Guest"}
            </div>
            {kind === "overdue" ? (
              <div style={{ color: "#fecaca", fontSize: 11, fontWeight: 600 }}>
                Due: {fmtShortDT(occ.checkOut, occ.checkOutTime)} ⚠️
              </div>
            ) : (
              <div style={{ color: "rgba(255,255,255,0.85)", fontSize: 11 }}>
                {fmtShortDT(occ.checkIn, occ.checkInTime)} → {fmtShortDT(occ.checkOut, occ.checkOutTime)}
              </div>
            )}
            <div style={{ fontSize: 12, fontWeight: 700, color: kind === "overdue" ? "#fecaca" : (pending > 0 ? "#fbbf24" : "rgba(255,255,255,0.9)") }}>
              {pending > 0 ? `₹${pending.toLocaleString("en-IN")} pending` : "Balance ₹0"}
            </div>
            <div className="mt-auto pt-1">
              <button
                type="button"
                style={{
                  backgroundColor: kind === "overdue" ? "#dc2626" : "#ffffff",
                  color: kind === "overdue" ? "#ffffff" : meta.bg,
                  borderRadius: 4, padding: "3px 10px", fontSize: 11, fontWeight: 700, border: "none",
                }}
                onClick={(e) => { e.stopPropagation(); onCheckout(occ.bookingId); }}
              >
                {kind === "overdue" ? "Checkout Now" : "Checkout"}
              </button>
            </div>
          </>
        )}

        {hintText && (
          <div className="mt-auto" style={{ color: "rgba(255,255,255,0.7)", fontSize: 11 }}>
            {hintText}
          </div>
        )}
      </div>

      {hasFood && (kind === "occupied" || kind === "overdue") && (
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPickFood(); }}
          className="absolute flex items-center gap-1 font-semibold"
          style={{
            right: 6, bottom: 6, backgroundColor: "#fbbf24", color: "#78350f",
            borderRadius: 999, padding: "2px 8px", fontSize: 10, border: "none",
          }}
          title={`${pendingFood!.count} pending KOT${pendingFood!.count === 1 ? "" : "s"}`}
        >
          <UtensilsCrossed className="h-3 w-3" />
          ₹{pendingFood!.amount.toLocaleString("en-IN")}
        </button>
      )}
    </div>
  );
});

function Kpi({ label, value, icon: Icon, iconClassName }: { label: string; value: number | string; icon: any; iconClassName?: string }) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <Icon className={`h-4 w-4 ${iconClassName ?? "text-muted-foreground"}`} />
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
  if (isOccupied) return "occupied";
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
  room, kind, bookingId, staff, onClose, onChanged, onOpenBooking, onNewBooking, onCheckout, onAddExtraBed, onCollectAdvance,
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
  onAddExtraBed: (bookingId: string) => void;
  onCollectAdvance: (bookingId: string) => void;
}) {
  const [staffId, setStaffId] = useState<string>("");
  const [notes, setNotes] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const { can } = usePermissions();
  const canEditBooking = can("bookings", "edit") || can("bookings", "create");
  const showExtraBed = !!bookingId && canEditBooking;

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
              onClick={() => update({ status: "vacant", housekeeping_status: "dirty" }, null, "marked as Dirty")}>
              Mark as Dirty
            </Button>
            <Button variant="outline" disabled={busy}
              onClick={() => update({ status: "maintenance", housekeeping_status: "dirty" }, null, "marked as Maintenance")}>
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
            <Button variant="outline" disabled={!bookingId}
              onClick={() => bookingId && onCollectAdvance(bookingId)}>
              <Receipt className="h-4 w-4 mr-2" /> Collect Advance Payment
            </Button>
            {showExtraBed && (
              <Button variant="outline" onClick={() => bookingId && onAddExtraBed(bookingId)}>
                <BedDouble className="h-4 w-4 mr-2" /> Add Extra Bed
              </Button>
            )}
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

function BulkCheckinDialog({
  event, propertyId, userId, onClose, onDone,
}: {
  event: EventBlockSummary | null;
  propertyId: string | null;
  userId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (event) setSelected(new Set(event.blocks.filter((b) => b.status === "blocked").map((b) => b.id)));
  }, [event]);
  if (!event) return null;
  const blocked = event.blocks.filter((b) => b.status === "blocked");
  const allSelected = blocked.every((b) => selected.has(b.id));
  const toggle = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const confirm = async () => {
    if (!propertyId) return;
    setBusy(true);
    try {
      let n = 0;
      for (const b of blocked) {
        if (!selected.has(b.id)) continue;
        await checkInBlock({ propertyId, block: b, userId });
        n++;
      }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        logActivity({
          property_id: propertyId, user_id: user?.id ?? "",
          user_name: userDisplayName(user as any),
          action_type: "BULK_CHECKIN", module: "Front Desk",
          reference_id: event.banquet_booking_id,
          reference_label: event.event_name,
          details: { event_name: event.event_name, rooms_count: n },
        });
      } catch { /* ignore */ }
      toast.success(`${n} rooms checked in for ${event.event_name}`);
      onDone();
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Bulk Check-in — {event.event_name}</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          <label className="flex items-center gap-2 text-sm font-medium">
            <Checkbox checked={allSelected}
              onCheckedChange={(c) => setSelected(c ? new Set(blocked.map((b) => b.id)) : new Set())} />
            Select All
          </label>
          {blocked.map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm border-t py-2">
              <Checkbox checked={selected.has(b.id)} onCheckedChange={() => toggle(b.id)} />
              <span className="flex-1">
                Room {b.room_number} · {b.guest_name ?? <span className="italic text-muted-foreground">Unassigned</span>}
              </span>
              <span className="text-xs text-muted-foreground">{b.checkin_date} → {b.checkout_date}</span>
            </label>
          ))}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || selected.size === 0} onClick={confirm}>
            {busy ? "Checking in…" : `Confirm Bulk Check-in (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function BulkCheckoutDialog({
  event, userId, onClose, onDone,
}: {
  event: EventBlockSummary | null;
  userId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (event) setSelected(new Set(event.blocks.filter((b) => b.status === "checked_in").map((b) => b.id)));
  }, [event]);
  if (!event) return null;
  const checked = event.blocks.filter((b) => b.status === "checked_in");
  const toggle = (id: string) => {
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  };
  const confirm = async () => {
    setBusy(true);
    try {
      let n = 0;
      for (const b of checked) {
        if (!selected.has(b.id)) continue;
        await checkOutBlock({ block: b, userId });
        n++;
      }
      try {
        const { data: { user } } = await supabase.auth.getUser();
        logActivity({
          property_id: event.blocks[0]?.banquet_booking_id ? "" : "",
          user_id: user?.id ?? "", user_name: userDisplayName(user as any),
          action_type: "BULK_CHECKOUT", module: "Front Desk",
          reference_id: event.banquet_booking_id, reference_label: event.event_name,
          details: { event_name: event.event_name, rooms_count: n },
        });
      } catch { /* ignore */ }
      toast.success(`${n} rooms checked out for ${event.event_name}`);
      onDone();
    } catch (e: any) { toast.error(e.message ?? "Failed"); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={!!event} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>Bulk Checkout — {event.event_name}</DialogTitle></DialogHeader>
        <div className="space-y-2 max-h-[50vh] overflow-y-auto">
          {checked.map((b) => (
            <label key={b.id} className="flex items-center gap-2 text-sm border-t py-2">
              <Checkbox checked={selected.has(b.id)} onCheckedChange={() => toggle(b.id)} />
              <span className="flex-1">
                Room {b.room_number} · {b.guest_name ?? <span className="italic text-muted-foreground">Unassigned</span>}
              </span>
            </label>
          ))}
        </div>
        <div className="text-xs text-muted-foreground border-t pt-2">
          Combined payment is collected per booking via the standard Checkout dialog. This action releases the rooms and marks them ready for housekeeping.
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button disabled={busy || selected.size === 0} onClick={confirm}>
            {busy ? "Checking out…" : `Confirm Bulk Checkout (${selected.size})`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssignGuestDialog({
  block, propertyId, userId, onClose, onDone,
}: {
  block: EventBlockRecord | null;
  propertyId: string | null;
  userId: string;
  onClose: () => void;
  onDone: () => void;
}) {
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setName(block?.guest_name ?? ""); setMobile(block?.guest_mobile ?? ""); }, [block?.id]);
  if (!block) return null;
  const saveOnly = async () => {
    setBusy(true);
    const { error } = await supabase.from("event_room_blocks").update({
      guest_name: name.trim() || null, guest_mobile: mobile.trim() || null,
    } as any).eq("id", block.id);
    setBusy(false);
    if (error) return toast.error(error.message);
    toast.success("Guest assigned");
    onDone();
  };
  const saveAndCheckIn = async () => {
    if (!propertyId || !userId) return toast.error("Missing property or user");
    if (!name.trim() || !mobile.trim()) return toast.error("Name and mobile required");
    setBusy(true);
    const { error: upErr } = await supabase.from("event_room_blocks").update({
      guest_name: name.trim(), guest_mobile: mobile.trim(),
    } as any).eq("id", block.id);
    if (upErr) { setBusy(false); return toast.error(upErr.message); }
    try {
      await checkInBlock({
        propertyId,
        block: { ...block, guest_name: name.trim(), guest_mobile: mobile.trim() },
        userId,
      });
      toast.success(`Room ${block.room_number} checked in`);
      onDone();
    } catch (e: any) {
      toast.error(e?.message ?? "Check-in failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={!!block} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader><DialogTitle>Assign guest — Room {block.room_number}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div><Label className="text-xs">Guest name</Label><Input value={name} onChange={(e) => setName(e.target.value)} /></div>
          <div><Label className="text-xs">Mobile</Label><Input value={mobile} onChange={(e) => setMobile(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button variant="secondary" disabled={busy} onClick={saveOnly}>{busy ? "Saving…" : "Save"}</Button>
          <Button disabled={busy} onClick={saveAndCheckIn}>{busy ? "Working…" : "Save & Check In"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}