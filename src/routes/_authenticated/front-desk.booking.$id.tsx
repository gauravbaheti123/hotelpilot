import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { FolioOpenButton } from "@/components/FolioOpenButton";
import { BackButton } from "@/components/BackButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SearchableSelect, type SearchableOption } from "@/components/ui/searchable-select";
import { supabase } from "@/integrations/supabase/client";
import { ACTIVITY, logActivity, userDisplayName } from "@/lib/activityLog";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { toastWithUndo } from "@/lib/undoToast";
import {
  BOOKING_STATUS_LABEL,
  BOOKING_STATUS_TONE,
  nightsBetween,
  isValidStayRange,
} from "@/lib/front-desk";
import { fireTrigger } from "@/lib/whatsapp";
import { verifyManagerPassword } from "@/lib/manager-verify";
import { shiftRoomOp, modifyDatesOp } from "@/lib/roomOps";
import { fetchTariffPlans, pickTariffPlan, type TariffPlan } from "@/lib/tariff";
import { CheckoutDialog } from "@/components/CheckoutDialog";
import { RequirePermission } from "@/components/RequirePermission";
import { AssignRoomDialog } from "@/components/AssignRoomDialog";
import { BookingEditWizard } from "@/components/booking-wizard/BookingEditWizard";
import {
  LogIn,
  LogOut,
  MoreHorizontal,
  ArrowLeftRight,
  CalendarClock,
  Ban,
  Receipt,
  ShieldAlert,
  Check,
  BedDouble,
  FileText,
  Pencil,
  AlertTriangle,
} from "lucide-react";
import { istToday } from "@/lib/date";
import { reportQueryError } from "@/lib/queryError";
import { toastError } from "@/lib/errorMessage";

export const Route = createFileRoute("/_authenticated/front-desk/booking/$id")({
  head: () => ({ meta: [{ title: "Booking — HotelPilot" }] }),
  component: () => (<RequirePermission module="bookings"><BookingDetailPage /></RequirePermission>),
});

interface Guest { id: string; name: string; mobile: string | null; email: string | null; address: string | null; id_proof_type: string | null; id_proof_number: string | null; }

/** Shift wizard: 1 = why (mode), 2 = target room, 3 = tariff, 4 = food, 5 = confirm. */
type ShiftStep = 1 | 2 | 3 | 4 | 5;
const SHIFT_LAST_STEP: ShiftStep = 5;
interface Room {
  id: string;
  room_number: string;
  category_id: string | null;
  status: string;
  room_categories?: { name: string } | null;
}
interface BookingRoomRow {
  id: string;
  room_id: string | null;
  category_id: string | null;
  status?: string | null;
  rate: number;
  meal_plan: string;
  adults: number;
  children: number;
  check_in: string;
  check_out: string;
  actual_check_in: string | null;
  actual_check_out: string | null;
  rooms: { room_number: string } | null;
  room_categories: { name: string } | null;
}
interface BookingDetail {
  id: string;
  booking_number: string;
  status: string;
  source: string | null;
  check_in: string;
  check_out: string;
  adults: number;
  children: number;
  total_amount: number;
  advance_amount: number;
  balance_amount: number;
  notes: string | null;
  custom_remark: string | null;
  checked_in_at: string | null;
  checked_out_at: string | null;
  property_id: string;
  guests: Guest | null;
  booking_rooms: BookingRoomRow[];
}

interface ShiftRow {
  id: string;
  shifted_at: string;
  reason: string | null;
  old_rate: number | null;
  new_rate: number | null;
  shifted_by: string | null;
  from_room: { room_number: string } | null;
  to_room: { room_number: string } | null;
  shifted_by_name?: string | null;
}
interface KotSummaryRow {
  id: string;
  kot_number: string;
  status: string;
  created_at: string;
  total_amount: number;
  sub_total: number;
  kot_items: { item_name: string; qty: number; amount: number }[];
}
interface AdditionalGuestRow {
  id: string;
  is_primary: boolean;
  age: number | null;
  relation_to_primary: string | null;
  guests: { name: string; id_proof_type: string | null; id_proof_number: string | null; nationality: string | null } | null;
}

function BookingDetailPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { user, roles } = useAuth();
  const canAct = roles.some((r) =>
    ["superadmin", "owner", "manager", "receptionist"].includes(r),
  );
  const [b, setB] = useState<BookingDetail | null>(null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [tariffPlans, setTariffPlans] = useState<TariffPlan[]>([]);
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [kots, setKots] = useState<KotSummaryRow[]>([]);
  const [extraGuests, setExtraGuests] = useState<AdditionalGuestRow[]>([]);
  const [loading, setLoading] = useState(true);

  // dialogs
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftBrId, setShiftBrId] = useState<string>("");
  const [shiftToRoom, setShiftToRoom] = useState<string>("");
  const [shiftReason, setShiftReason] = useState("");
  const [shiftStep, setShiftStep] = useState<ShiftStep>(1);
  const [shiftMode, setShiftMode] = useState<"same_day" | "mid_stay">("same_day");
  const [shiftEffDate, setShiftEffDate] = useState<string>("");
  const [tariffChoice, setTariffChoice] = useState<"keep" | "new_standard" | "custom">("keep");
  const [customRate, setCustomRate] = useState("");
  const [transferKots, setTransferKots] = useState(true);
  const [pendingKots, setPendingKots] = useState<{ id: string; kot_number: string; status: string; total_amount: number }[]>([]);
  const [pendingFoodBills, setPendingFoodBills] = useState<{ id: string; bill_number: string | null; total_amount: number }[]>([]);
  const [mgrEmail, setMgrEmail] = useState("");
  const [mgrPass, setMgrPass] = useState("");
  const [mgrBusy, setMgrBusy] = useState(false);
  const [mgrApproved, setMgrApproved] = useState(false);
  const [shiftBusy, setShiftBusy] = useState(false);

  const [dateOpen, setDateOpen] = useState(false);
  const [newCheckOut, setNewCheckOut] = useState("");
  const [checkoutOpen, setCheckoutOpen] = useState(false);

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [assignBrId, setAssignBrId] = useState<string | null>(null);
  // Phase 3 — one page, two modes. "overview" is the read-only summary,
  // "edit" swaps the summary (only) for the step wizard; the header action bar
  // stays visible and unchanged in both.
  const [mode, setMode] = useState<"overview" | "edit">("overview");

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("bookings")
      .select(`
        id,booking_number,status,source,check_in,check_out,adults,children,
        total_amount,advance_amount,balance_amount,notes,custom_remark,checked_in_at,checked_out_at,property_id,
        guests(id,name,mobile,email,address,id_proof_type,id_proof_number),
        booking_rooms!booking_rooms_booking_id_fkey(id,room_id,category_id,status,rate,meal_plan,adults,children,check_in,check_out,actual_check_in,actual_check_out,
          rooms!booking_rooms_room_id_fkey(room_number),
          room_categories(name))
      `)
      .eq("id", id)
      .single();
    if (error) { toastError(error); setLoading(false); return; }
    const detail = data as unknown as BookingDetail;
    // Room-shift history rows (status = 'shifted'/'cancelled') must never drive
    // the UI: every action below (Shift room, Modify dates, check-in stamping)
    // has to target the CURRENTLY LIVE assignment, otherwise a second shift
    // re-targets a stale row and leaves the real room occupied + billed.
    const allBookingRoomIds = (detail?.booking_rooms ?? []).map((br) => br.id);
    if (detail) {
      detail.booking_rooms = (detail.booking_rooms ?? []).filter(
        (br) => (br.status ?? "active") !== "shifted" && (br.status ?? "active") !== "cancelled",
      );
    }
    setB(detail);
    if (detail) {
      setNewCheckOut(detail.check_out);
      const [{ data: rs, error: __qp1 }, { data: sh, error: __qp2 }, { data: kt, error: __qp3 }, { data: bg, error: __qp4 }] = await Promise.all([
        supabase
        .from("rooms")
        .select("id,room_number,category_id,status,room_categories(name)")
        .eq("property_id", detail.property_id)
        .order("room_number"),
        supabase
          .from("room_shifts")
          .select("id, shifted_at, reason, old_rate, new_rate, shifted_by, from_room:from_room_id(room_number), to_room:to_room_id(room_number)")
          .in("booking_room_id", allBookingRoomIds)
          .order("shifted_at", { ascending: false }),
        supabase
          .from("kot_orders")
          .select("id, kot_number, status, created_at, total_amount, sub_total, kot_items(item_name, qty, amount)")
          .eq("booking_id", detail.id)
          .neq("kot_copy", "restaurant_copy")
          .order("created_at", { ascending: false }),
        supabase
          .from("booking_guests")
          .select("id, is_primary, age, relation_to_primary, guests:guest_id(name, id_proof_type, id_proof_number, nationality)")
          .eq("booking_id", detail.id)
          .order("is_primary", { ascending: false }),
      ]);
      if (__qp1) reportQueryError("booking rooms", __qp1);
      if (__qp2) reportQueryError("room shifts", __qp2);
      if (__qp3) reportQueryError("KOT orders", __qp3);
      if (__qp4) reportQueryError("booking guests", __qp4);
      setRooms((rs ?? []) as Room[]);
      // Phase 27b — tariff plans drive every rate decision in the shift flow.
      setTariffPlans(await fetchTariffPlans(detail.property_id).catch(() => []));
      const shiftRows = (sh ?? []) as unknown as ShiftRow[];
      // Resolve shifted_by user names from profiles (no FK on shifted_by so we look up manually)
      const userIds = Array.from(new Set(shiftRows.map((s) => s.shifted_by).filter(Boolean) as string[]));
      if (userIds.length > 0) {
        const { data: profs, error: __qe1 } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", userIds);
        if (__qe1) reportQueryError("profiles", __qe1);
        const nameById = new Map<string, string | null>((profs ?? []).map((p: any) => [p.id, p.name]));
        shiftRows.forEach((s) => { s.shifted_by_name = s.shifted_by ? (nameById.get(s.shifted_by) ?? null) : null; });
      }
      setShifts(shiftRows);
      setKots((kt ?? []) as unknown as KotSummaryRow[]);
      setExtraGuests((bg ?? []) as unknown as AdditionalGuestRow[]);
    }
    setLoading(false);
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, [id]);

  async function checkIn() {
    if (!b) return;
    // Block check-in until every booking_room has a specific room assigned.
    const missing = b.booking_rooms.find((br) => !br.room_id);
    if (missing) {
      toast.error("Assign a room to this reservation before checking in");
      setAssignBrId(missing.id);
      return;
    }
    const now = new Date().toISOString();
    const { error } = await supabase.from("bookings").update({
      status: "checked_in" as any,
      checked_in_at: now,
      checked_in_by: user?.id ?? null,
    }).eq("id", b.id);
    if (error) return toastError(error);
    // mark each room occupied & stamp actual_check_in
    for (const br of b.booking_rooms) {
      if (br.room_id) {
        await supabase.from("rooms").update({ status: "occupied" as any }).eq("id", br.room_id);
      }
      await supabase.from("booking_rooms").update({ actual_check_in: now }).eq("id", br.id);
    }
    toast.success("Checked in");
    logActivity({
      property_id: b.property_id,
      user_id: user?.id ?? "",
      user_name: userDisplayName(user as any),
      ...ACTIVITY.CHECKIN,
      reference_id: b.id,
      reference_label: `${b.booking_number} — ${b.guests?.name ?? ""}`,
    });
    fireTrigger("checkin_welcome", {
      property_id: b.property_id,
      booking_id: b.id,
      guest_id: b.guests?.id ?? null,
      phone: b.guests?.mobile ?? null,
    });
    load();
  }

  // Lightweight checkOut() removed: all checkouts MUST flow through
  // <CheckoutDialog/>, which reads live folio balance (not the stale
  // bookings.balance_amount) and enforces the pending-KOT lock.

  function openShift(brId: string) {
    setShiftBrId(brId);
    setShiftToRoom("");
    setShiftReason("");
    setShiftStep(1);
    setShiftMode("same_day");
    setShiftEffDate(istToday());
    setTariffChoice("keep");
    setCustomRate("");
    setTransferKots(true);
    setPendingKots([]);
    setPendingFoodBills([]);
    setMgrEmail(""); setMgrPass(""); setMgrApproved(false);
    setShiftOpen(true);
  }

  /** Pending food can live in TWO places: un-billed KOTs, and an already-rolled-up
   *  OPEN food segment bill (segment_bills). Checking only KOTs made the wizard
   *  claim "no pending food orders" for bookings that clearly had an open bill. */
  async function loadPendingKotsFor(brId: string) {
    if (!b) return;
    const br = b.booking_rooms.find((x) => x.id === brId);
    if (!br) { setPendingKots([]); setPendingFoodBills([]); return; }
    const [{ data: kotRows, error: __qe2 }, { data: billRows, error: __qe3 }] = await Promise.all([
      supabase
        .from("kot_orders")
        .select("id,kot_number,status,total_amount")
        .eq("booking_id", b.id)
        .in("status", ["open", "printed", "served"]),
      supabase
        .from("segment_bills")
        .select("id,bill_number,total_amount")
        .eq("booking_id", b.id)
        .eq("segment", "food")
        .eq("status", "open"),
    ]);
    if (__qe2) reportQueryError("kot orders", __qe2);
    if (__qe3) reportQueryError("food bills", __qe3);
    setPendingKots(((kotRows ?? []) as any));
    setPendingFoodBills(((billRows ?? []) as any));
  }

  async function verifyMgrForCustom() {
    if (!mgrEmail || !mgrPass) return toast.error("Manager email & password required");
    setMgrBusy(true);
    const res = await verifyManagerPassword(mgrEmail.trim(), mgrPass);
    setMgrBusy(false);
    if (!res.ok) return toast.error(res.reason ?? "Incorrect manager password");
    setMgrApproved(true);
    toast.success("Custom rate authorised");
  }

  /**
   * Phase 27b — the "standard rate" for a shift target comes from the target
   * category's tariff plan, resolved against this stay's own check-in date
   * (the guest is already in-house; the stay keeps its original pricing date).
   */
  function standardRateFor(br: BookingRoomRow, target: Room | undefined): number {
    const plan = pickTariffPlan(tariffPlans, {
      categoryId: target?.category_id ?? null,
      date: br.check_in ?? b?.check_in ?? istToday(),
    });
    return Number(plan?.rate ?? 0) || 0;
  }

  function resolveNewRate(br: BookingRoomRow, target: Room | undefined): number {
    if (tariffChoice === "custom") return Number(customRate) || Number(br.rate);
    if (tariffChoice === "new_standard") {
      const std = standardRateFor(br, target);
      return std > 0 ? std : Number(br.rate);
    }
    return Number(br.rate);
  }

  async function doShift() {
    if (!b || !shiftBrId || !shiftToRoom) return toast.error("Pick a target room");
    const br = b.booking_rooms.find((x) => x.id === shiftBrId);
    if (!br) return;
    if (!shiftReason.trim()) return toast.error("Reason is required");
    if (shiftMode === "mid_stay") {
      if (!shiftEffDate) return toast.error("Pick the date the guest moves");
      if (br.check_in && shiftEffDate <= br.check_in) return toast.error("Shift date must be after the current check-in date");
      if (br.check_out && shiftEffDate >= br.check_out) return toast.error("Shift date must be before the check-out date");
    }
    if (tariffChoice === "custom" && !mgrApproved) return toast.error("Manager authorisation required for custom rate");
    const target = rooms.find((r) => r.id === shiftToRoom);
    const newRate = resolveNewRate(br, target);
    const fromRoomId = br.room_id;
    setShiftBusy(true);

    // Atomic shift + folio recompute + KOT transfer — see src/lib/roomOps.ts.
    let moved = { movedKots: 0, toRoomNumber: null as string | null };
    try {
      moved = await shiftRoomOp({
        bookingId: b.id,
        propertyId: b.property_id,
        bookingRoomId: br.id,
        fromRoomId,
        toRoomId: shiftToRoom,
        newRate,
        tariffChoice,
        reason: shiftReason,
        actorId: user?.id ?? null,
        transferKots,
        mode: shiftMode,
        effectiveDate: shiftMode === "mid_stay" ? shiftEffDate : null,
      });
    } catch (e) { setShiftBusy(false); return toastError(e); }
    if (moved.movedKots > 0) {
      toast.success(`Kitchen alert: ${moved.movedKots} order${moved.movedKots > 1 ? "s" : ""} moved to Room ${moved.toRoomNumber ?? ""}`);
    }

    // WhatsApp notify guest
    try {
      if (b.guests?.mobile) {
        const fromName = b.booking_rooms.find((x) => x.id === br.id)?.rooms?.room_number ?? "";
        const toName = target?.room_number ?? "";
        fireTrigger("room_shift" as any, {
          property_id: b.property_id,
          booking_id: b.id,
          guest_id: b.guests?.id ?? null,
          phone: b.guests.mobile,
          extra: { from_room: fromName, to_room: toName, new_rate: newRate },
        } as any);
      }
    } catch { /* ignore */ }

    setShiftBusy(false);
    toast.success("Room shifted");
    setShiftOpen(false);
    load();
  }

  async function modifyDate() {
    if (!b) return;
    if (!isValidStayRange(b.check_in, newCheckOut)) return toast.error("Check-out must be after check-in");
    const oldCheckOut = b.check_out;
    try {
      await modifyDatesOp({
        bookingId: b.id,
        checkIn: b.check_in,
        newCheckOut,
        advanceAmount: b.advance_amount,
        rooms: b.booking_rooms.map((r) => ({ id: r.id, rate: Number(r.rate) })),
      });
    } catch (e) { return toastError(e); }
    logActivity({
      property_id: b.property_id,
      user_id: user?.id ?? "",
      user_name: userDisplayName(user as never),
      action_type: "BOOKING_DATE_EXTENDED",
      module: "Front Desk",
      reference_id: b.id,
      reference_label: b.booking_number,
      details: {
        booking_id: b.id,
        old_checkout_date: oldCheckOut,
        new_checkout_date: newCheckOut,
      },
    });
    toast.success("Dates updated");
    setDateOpen(false);
    load();
  }

  async function cancelBooking() {
    if (!b) return;
    const bookingId = b.id;
    const priorStatus = b.status;
    // Snapshot room assignments so an Undo can restore what the
    // cancel trigger closed out.
    const { data: priorRooms, error: __qe12 } = await supabase
      .from("booking_rooms")
      .select("id,status,end_date")
      .eq("booking_id", bookingId);
    if (__qe12) reportQueryError("booking rooms", __qe12);
    const { error } = await supabase.from("bookings").update({
      status: "cancelled" as any,
      cancelled_at: new Date().toISOString(),
      cancelled_reason: cancelReason || null,
    }).eq("id", bookingId);
    if (error) return toastError(error);
    setCancelOpen(false);
    toastWithUndo(
      "Booking cancelled",
      async () => {
        const { error: undoErr } = await supabase.from("bookings").update({
          status: (priorStatus === "cancelled" ? "reserved" : priorStatus) as any,
          cancelled_at: null,
          cancelled_reason: null,
        }).eq("id", bookingId);
        if (undoErr) throw undoErr;
        for (const r of (priorRooms ?? []) as Array<{ id: string; status: string | null; end_date: string | null }>) {
          await supabase.from("booking_rooms")
            .update({ status: r.status, end_date: r.end_date } as any)
            .eq("id", r.id);
        }
        load();
      },
      { undoneMessage: "Booking restored" },
    );
    load();
  }

  if (loading) return <AppShell title="Booking"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!b) return <AppShell title="Booking"><p className="text-sm text-muted-foreground">Not found.</p></AppShell>;

  const nights = nightsBetween(b.check_in, b.check_out);
  const canCheckIn = b.status === "reserved";
  const canCheckOut = b.status === "checked_in";
  const canShift = b.status === "reserved" || b.status === "checked_in";
  const canCancel = b.status === "reserved";

  return (
    <AppShell title={`Booking ${b.booking_number}`}>
      <div className="max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <BackButton fallbackTo="/front-desk/bookings" />
          <Badge variant="outline" className={BOOKING_STATUS_TONE[b.status]}>
            {BOOKING_STATUS_LABEL[b.status] ?? b.status}
          </Badge>
          <div className="text-sm text-muted-foreground">
            {b.check_in} → {b.check_out} · {nights} night{nights > 1 ? "s" : ""}
          </div>
          <div className="flex-1" />
          {canAct && (
            <>
            {/* Desktop: full action row. */}
            <div className="hidden md:flex flex-wrap gap-2">
              <FolioOpenButton bookingId={b.id} variant="outline">
                <Receipt className="h-4 w-4 mr-1" /> Folio
              </FolioOpenButton>
              <Link to="/bookings/$bookingId/grc" params={{ bookingId: b.id }}>
                <Button variant="outline"><FileText className="h-4 w-4 mr-1" /> Print GRC</Button>
              </Link>
              {(b.status === "reserved" || b.status === "checked_in") && (
                <Button
                  variant={mode === "edit" ? "secondary" : "outline"}
                  onClick={() => setMode((m) => (m === "edit" ? "overview" : "edit"))}
                >
                  <Pencil className="h-4 w-4 mr-1" />
                  {mode === "edit" ? "Back to overview" : "Edit details"}
                </Button>
              )}
              {canCheckIn && <Button onClick={checkIn}><LogIn className="h-4 w-4 mr-1" /> Check-in</Button>}
              {canCheckOut && <Button onClick={() => setCheckoutOpen(true)}><LogOut className="h-4 w-4 mr-1" /> Check-out</Button>}
              {canShift && b.booking_rooms[0] && (
                <Button variant="outline" onClick={() => openShift(b.booking_rooms[0].id)}>
                  <ArrowLeftRight className="h-4 w-4 mr-1" /> Shift room
                </Button>
              )}
              {canCheckOut && (
                <Button variant="outline" onClick={() => setDateOpen(true)}>
                  <CalendarClock className="h-4 w-4 mr-1" /> Modify dates
                </Button>
              )}
              {canCancel && (
                <Button variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}>
                  <Ban className="h-4 w-4 mr-1" /> Cancel
                </Button>
              )}
            </div>

            {/* Mobile: primary action + Folio inline, everything else under "More". */}
            <div className="flex md:hidden w-full items-center gap-2">
              {canCheckIn && (
                <Button className="flex-1" onClick={checkIn}>
                  <LogIn className="h-4 w-4 mr-1" /> Check-in
                </Button>
              )}
              {canCheckOut && (
                <Button className="flex-1" onClick={() => setCheckoutOpen(true)}>
                  <LogOut className="h-4 w-4 mr-1" /> Check-out
                </Button>
              )}
              <FolioOpenButton bookingId={b.id} variant="outline" className="flex-1">
                <Receipt className="h-4 w-4 mr-1" /> Folio
              </FolioOpenButton>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="icon" className="h-10 w-10 shrink-0" aria-label="More actions">
                    <MoreHorizontal className="h-5 w-5" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem asChild>
                    <Link to="/bookings/$bookingId/grc" params={{ bookingId: b.id }}>
                      <FileText className="h-4 w-4 mr-2" /> Print GRC
                    </Link>
                  </DropdownMenuItem>
                  {(b.status === "reserved" || b.status === "checked_in") && (
                    <DropdownMenuItem onClick={() => setMode((m) => (m === "edit" ? "overview" : "edit"))}>
                      <Pencil className="h-4 w-4 mr-2" />
                      {mode === "edit" ? "Back to overview" : "Edit details"}
                    </DropdownMenuItem>
                  )}
                  {canShift && b.booking_rooms[0] && (
                    <DropdownMenuItem onClick={() => openShift(b.booking_rooms[0].id)}>
                      <ArrowLeftRight className="h-4 w-4 mr-2" /> Shift room
                    </DropdownMenuItem>
                  )}
                  {canCheckOut && (
                    <DropdownMenuItem onClick={() => setDateOpen(true)}>
                      <CalendarClock className="h-4 w-4 mr-2" /> Modify dates
                    </DropdownMenuItem>
                  )}
                  {canCancel && (
                    <DropdownMenuItem className="text-destructive" onClick={() => setCancelOpen(true)}>
                      <Ban className="h-4 w-4 mr-2" /> Cancel booking
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            </>
          )}
        </div>

        {mode === "edit" ? (
          <BookingEditWizard
            bookingId={b.id}
            onSaved={() => { setMode("overview"); load(); }}
            onCancel={() => setMode("overview")}
          />
        ) : (
        <>
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Guest</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row k="Name" v={b.guests?.name ?? "—"} />
              <Row k="Mobile" v={b.guests?.mobile ?? "—"} />
              <Row k="Email" v={b.guests?.email ?? "—"} />
              <Row k="ID" v={b.guests?.id_proof_type ? `${b.guests.id_proof_type} · ${b.guests.id_proof_number ?? ""}` : "—"} />
              <Row k="Address" v={b.guests?.address ?? "—"} />
              <Row k="Pax" v={`${b.adults} adult${b.adults > 1 ? "s" : ""}${b.children > 0 ? `, ${b.children} child` : ""}`} />
              <Row k="Source" v={b.source ?? "—"} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Charges</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <Row k="Room total" v={`₹${Number(b.total_amount).toLocaleString("en-IN")}`} />
              <Row k="Advance" v={`₹${Number(b.advance_amount).toLocaleString("en-IN")}`} />
              <Row k="Balance" v={`₹${Number(b.balance_amount).toLocaleString("en-IN")}`}
                   highlight={b.balance_amount > 0} />
              {b.notes && (
                <div className="pt-2 border-t">
                  <div className="text-xs text-muted-foreground mb-1">Notes</div>
                  <div>{b.notes}</div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <CustomRemarkCard
          bookingId={b.id}
          initial={b.custom_remark ?? ""}
          onSaved={(v: string) => { b.custom_remark = v || null; }}
        />

        <Card>
          <CardHeader><CardTitle className="text-base">Room(s)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {b.booking_rooms.map((br) => (
                <div key={br.id} className="flex flex-wrap items-center justify-between gap-2 rounded border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">
                      {br.room_id ? (
                        <>Room {br.rooms?.room_number ?? "—"} · {br.room_categories?.name ?? "—"}</>
                      ) : (
                        <>
                          <Badge variant="outline" className="mr-2 border-amber-400 text-amber-700 text-[10px]">
                            To be assigned
                          </Badge>
                          {br.room_categories?.name ?? "—"}
                        </>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {br.check_in} → {br.check_out} · {br.meal_plan} · ₹{br.rate}/night ·
                      {" "}{br.adults}A {br.children > 0 ? `${br.children}C` : ""}
                    </div>
                  </div>
                  {canAct && !br.room_id && (
                    <Button size="sm" onClick={() => setAssignBrId(br.id)}>
                      <BedDouble className="h-3.5 w-3.5 mr-1" /> Assign Room
                    </Button>
                  )}
                  {canAct && canShift && br.room_id && (
                    <Button size="sm" variant="ghost" onClick={() => openShift(br.id)}>
                      <ArrowLeftRight className="h-3.5 w-3.5 mr-1" /> Shift
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* ADDITIONAL GUESTS (Issue #6) */}
        {extraGuests.length > 0 && (
          <Card>
            <CardHeader><CardTitle className="text-base">All guests ({extraGuests.length})</CardTitle></CardHeader>
            <CardContent>
              <div className="text-sm divide-y">
                {extraGuests.map((g) => (
                  <div key={g.id} className="flex flex-wrap items-center gap-3 py-2">
                    <Badge variant={g.is_primary ? "default" : "outline"} className="text-[10px]">
                      {g.is_primary ? "Primary" : (g.relation_to_primary ?? "Guest")}
                    </Badge>
                    <div className="font-medium">{g.guests?.name ?? "—"}</div>
                    {g.age != null && <div className="text-xs text-muted-foreground">{g.age} yrs</div>}
                    {g.guests?.nationality && g.guests.nationality !== "Indian" && (
                      <Badge variant="outline" className="text-[10px] border-amber-400 text-amber-700">Foreign</Badge>
                    )}
                    <div className="ml-auto text-xs text-muted-foreground">
                      {g.guests?.id_proof_type
                        ? `${g.guests.id_proof_type.toUpperCase()} · ${g.guests.id_proof_number ?? "—"}`
                        : "No ID on file"}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* ROOM SHIFT HISTORY (Issue #3a) */}
        <Card>
          <CardHeader><CardTitle className="text-base">Room shift history</CardTitle></CardHeader>
          <CardContent>
            {shifts.length === 0 ? (
              <p className="text-sm text-muted-foreground">No room changes.</p>
            ) : (
              <div className="space-y-3">
                {shifts.map((s) => (
                  <div key={s.id} className="rounded border p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      <span>Room {s.from_room?.room_number ?? "—"}</span>
                      <ArrowLeftRight className="h-3.5 w-3.5 text-muted-foreground" />
                      <span>Room {s.to_room?.room_number ?? "—"}</span>
                      {s.old_rate != null && s.new_rate != null && Number(s.old_rate) !== Number(s.new_rate) && (
                        <Badge variant="outline" className="text-[10px]">
                          ₹{Number(s.old_rate)} → ₹{Number(s.new_rate)}
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground mt-1">
                      {new Date(s.shifted_at).toLocaleString()} · by {s.shifted_by_name ?? "staff"}
                    </div>
                    {s.reason && <div className="text-xs mt-1"><span className="text-muted-foreground">Reason:</span> {s.reason}</div>}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* FOOD BILL SUMMARY (Issue #3b) */}
        <Card>
          <CardHeader><CardTitle className="text-base">Food bill summary</CardTitle></CardHeader>
          <CardContent>
            {kots.length === 0 ? (
              <p className="text-sm text-muted-foreground">No food orders for this booking.</p>
            ) : (
              (() => {
                const total = kots.reduce((s, k) => s + Number(k.total_amount || 0), 0);
                const settled = kots.filter((k) => k.status === "billed").reduce((s, k) => s + Number(k.total_amount || 0), 0);
                const pending = total - settled;
                return (
                  <div className="space-y-3 text-sm">
                    <div className="space-y-2">
                      {kots.map((k) => (
                        <div key={k.id} className="rounded border p-2">
                          <div className="flex flex-wrap items-center justify-between gap-2 font-medium">
                            <span>
                              {k.kot_number}
                              <Badge variant="outline" className="ml-2 text-[10px] uppercase">{k.status}</Badge>
                            </span>
                            <span>₹{Number(k.total_amount).toLocaleString("en-IN")}</span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5">
                            {new Date(k.created_at).toLocaleString()}
                          </div>
                          <div className="text-xs text-muted-foreground mt-1">
                            {(k.kot_items ?? []).map((i) => `${i.qty}× ${i.item_name}`).join(", ") || "—"}
                          </div>
                        </div>
                      ))}
                    </div>
                    <div className="border-t pt-2 grid grid-cols-2 gap-2 sm:grid-cols-3">
                      <SummaryStat label="Total food" value={`₹${total.toLocaleString("en-IN")}`} />
                      <SummaryStat label="Settled" value={`₹${settled.toLocaleString("en-IN")}`} />
                      <SummaryStat label="Pending" value={`₹${pending.toLocaleString("en-IN")}`} highlight={pending > 0} />
                    </div>
                  </div>
                );
              })()
            )}
          </CardContent>
        </Card>
        </>
        )}

        {/* SHIFT DIALOG */}
        <Dialog open={shiftOpen} onOpenChange={setShiftOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Shift room — Step {shiftStep} of {SHIFT_LAST_STEP}</DialogTitle>
            </DialogHeader>
            {(() => {
              const br = b.booking_rooms.find((x) => x.id === shiftBrId);
              const target = rooms.find((r) => r.id === shiftToRoom);
              const fromRate = Number(br?.rate ?? 0);
              const newStdRate = br ? standardRateFor(br, target) : 0;
              const newRate = br ? resolveNewRate(br, target) : 0;
              return (
                <div className="space-y-4">
                  {/* Step 1: why is the guest moving? */}
                  {shiftStep === 1 && (
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-muted-foreground">Type of shift</div>
                      <TariffOption
                        active={shiftMode === "same_day"} onClick={() => setShiftMode("same_day")}
                        title="Same-day correction"
                        line1="Wrong room was assigned — no new charge"
                        line2="The existing room charge continues; only the room (and rate, if you change it) is corrected." />
                      <TariffOption
                        active={shiftMode === "mid_stay"} onClick={() => setShiftMode("mid_stay")}
                        title="Mid-stay shift"
                        line1="Guest actually moves during the stay"
                        line2="Nights already stayed remain billed on the old room; a new charge line starts for the new room." />
                      {shiftMode === "mid_stay" && (
                        <div className="space-y-1.5">
                          <Label className="text-xs">Moving from date *</Label>
                          <Input type="date" className="h-9 w-48" value={shiftEffDate}
                            min={br?.check_in ?? undefined}
                            max={br?.check_out ?? undefined}
                            onChange={(e) => setShiftEffDate(e.target.value)} />
                          <div className="text-xs text-muted-foreground">
                            Stay: {br?.check_in ?? "—"} → {br?.check_out ?? "—"}
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Step 2: pick new room */}
                  {shiftStep === 2 && (
                    <div className="space-y-3">
                      <div className="space-y-1.5">
                        <Label className="text-xs">Move to vacant room *</Label>
                        <SearchableSelect
                          value={shiftToRoom}
                          onChange={setShiftToRoom}
                          placeholder="Pick a room"
                          searchPlaceholder="Search by room number or category…"
                          options={rooms
                            .filter((r) => r.status === "vacant" && !b.booking_rooms.some((bx) => bx.room_id === r.id))
                            .map((r) => ({
                              value: r.id,
                              label: `Room ${r.room_number}`,
                              hint: r.room_categories?.name ?? undefined,
                              keywords: r.room_categories?.name ?? "",
                            })) as SearchableOption[]}
                        />
                      </div>
                      <div className="text-xs text-muted-foreground">
                        Current: Room {br?.rooms?.room_number ?? "—"} ({br?.room_categories?.name ?? "—"}) @ ₹{fromRate}/night
                      </div>
                    </div>
                  )}

                  {/* Step 3: tariff decision */}
                  {shiftStep === 3 && br && target && (
                    <div className="space-y-3">
                      <div className="text-xs font-medium text-muted-foreground">Tariff for new room</div>
                      <TariffOption
                        active={tariffChoice === "keep"} onClick={() => setTariffChoice("keep")}
                        title="Keep existing rate"
                        line1={`₹${fromRate}/night`}
                        line2="Guest continues paying the original rate" />
                      <TariffOption
                        active={tariffChoice === "new_standard"} onClick={() => setTariffChoice("new_standard")}
                        title="Apply new room's standard rate"
                        line1={newStdRate > 0 ? `₹${newStdRate}/night` : "No active tariff plan for this category"}
                        line2={`Based on ${target.room_categories?.name ?? "new"} category tariff`}
                        disabled={newStdRate <= 0} />
                      <div
                        className={`rounded-md border p-3 cursor-pointer ${tariffChoice === "custom" ? "border-primary bg-primary/5" : "hover:bg-muted/40"}`}
                        onClick={() => setTariffChoice("custom")}>
                        <div className="flex items-center gap-2 font-medium text-sm">
                          <span className={`h-3 w-3 rounded-full border ${tariffChoice === "custom" ? "bg-primary border-primary" : "border-muted-foreground"}`} />
                          Custom rate
                          {mgrApproved && tariffChoice === "custom" && (
                            <Badge variant="outline" className="ml-2 text-[10px] border-emerald-400 text-emerald-700">
                              <Check className="h-3 w-3 mr-0.5" /> Authorised
                            </Badge>
                          )}
                        </div>
                        {tariffChoice === "custom" && (
                          <div className="mt-2 space-y-2">
                            <div className="flex items-center gap-2">
                              <span className="text-xs text-muted-foreground">₹</span>
                              <Input type="number" value={customRate}
                                onChange={(e) => setCustomRate(e.target.value)}
                                placeholder="0" className="h-8 w-32" />
                              <span className="text-xs text-muted-foreground">/night</span>
                            </div>
                            {!mgrApproved && (
                              <div className="rounded border border-amber-300 bg-amber-50 p-2 space-y-2">
                                <div className="flex items-center gap-1 text-xs text-amber-800">
                                  <ShieldAlert className="h-3.5 w-3.5" /> Manager authorisation required
                                </div>
                                <Input type="email" placeholder="Manager email" value={mgrEmail}
                                  onChange={(e) => setMgrEmail(e.target.value)} className="h-8" />
                                <Input type="password" placeholder="Manager password" value={mgrPass}
                                  onChange={(e) => setMgrPass(e.target.value)} className="h-8" />
                                <Button size="sm" onClick={verifyMgrForCustom} disabled={mgrBusy}>
                                  {mgrBusy ? "Verifying…" : "Authorise custom rate"}
                                </Button>
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Step 4: food orders transfer */}
                  {shiftStep === 4 && (
                    <div className="space-y-3">
                      {pendingKots.length === 0 && pendingFoodBills.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No pending food orders.</p>
                      ) : (
                        <>
                          {pendingKots.length > 0 && (
                          <div className="flex items-center gap-2">
                            <input id="ktr" type="checkbox" checked={transferKots}
                              onChange={(e) => setTransferKots(e.target.checked)} />
                            <Label htmlFor="ktr" className="text-sm">
                              Transfer {pendingKots.length} pending order(s) to new room
                            </Label>
                          </div>
                          )}
                          <div className="space-y-1 text-sm">
                            {pendingKots.map((k) => (
                              <div key={k.id} className="flex justify-between border-b last:border-0 pb-1">
                                <span>{k.kot_number} <span className="uppercase text-xs text-muted-foreground ml-1">({k.status})</span></span>
                                <span>₹{Number(k.total_amount || 0).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                          {pendingFoodBills.length > 0 && (
                            <div className="space-y-1 text-sm">
                              <div className="text-xs font-medium text-muted-foreground">
                                Open food bill(s) — always moved with the guest
                              </div>
                              {pendingFoodBills.map((fb) => (
                                <div key={fb.id} className="flex justify-between border-b last:border-0 pb-1">
                                  <span>{fb.bill_number ?? "Food bill"}</span>
                                  <span>₹{Number(fb.total_amount || 0).toFixed(2)}</span>
                                </div>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  )}

                  {/* Step 5: confirm */}
                  {shiftStep === 5 && br && target && (
                    <div className="space-y-3 text-sm">
                      <div className="rounded-md border p-3 bg-muted/30 space-y-1">
                        <div><span className="text-muted-foreground">Type:</span>{" "}
                          {shiftMode === "same_day"
                            ? "Same-day correction (no extra room charge)"
                            : `Mid-stay shift from ${shiftEffDate}`}
                        </div>
                        <div><span className="text-muted-foreground">From:</span> Room {br.rooms?.room_number} ({br.room_categories?.name}) @ ₹{fromRate}/night</div>
                        <div><span className="text-muted-foreground">To:</span> Room {target.room_number} ({target.room_categories?.name ?? "—"}) @ ₹{newRate}/night
                          {tariffChoice === "custom" && <Badge variant="outline" className="ml-2 text-[10px] border-amber-400 text-amber-700">Custom</Badge>}
                          {tariffChoice === "keep" && <Badge variant="outline" className="ml-2 text-[10px]">Same rate</Badge>}
                          {tariffChoice === "new_standard" && <Badge variant="outline" className="ml-2 text-[10px]">New standard</Badge>}
                        </div>
                        <div><span className="text-muted-foreground">Pending orders transferred:</span> {transferKots ? pendingKots.length : 0}</div>
                        {pendingFoodBills.length > 0 && (
                          <div><span className="text-muted-foreground">Open food bills moved:</span> {pendingFoodBills.length}</div>
                        )}
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">Reason *</Label>
                        <Textarea rows={2} value={shiftReason}
                          onChange={(e) => setShiftReason(e.target.value)}
                          placeholder="e.g. Plumbing issue, guest upgrade request" />
                      </div>
                    </div>
                  )}
                </div>
              );
            })()}
            <DialogFooter className="flex justify-between gap-2">
              <Button variant="outline" onClick={() => setShiftOpen(false)} disabled={shiftBusy}>Cancel</Button>
              <div className="flex gap-2">
                {shiftStep > 1 && (
                  <Button variant="outline" onClick={() => setShiftStep((s: ShiftStep) => (s - 1) as ShiftStep)} disabled={shiftBusy}>Back</Button>
                )}
                {shiftStep < SHIFT_LAST_STEP && (
                  <Button
                    onClick={async () => {
                      if (shiftStep === 1 && shiftMode === "mid_stay") {
                        const cur = b.booking_rooms.find((x) => x.id === shiftBrId);
                        if (!shiftEffDate) return toast.error("Pick the date the guest moves");
                        if (cur?.check_in && shiftEffDate <= cur.check_in) return toast.error("Shift date must be after the check-in date");
                        if (cur?.check_out && shiftEffDate >= cur.check_out) return toast.error("Shift date must be before the check-out date");
                      }
                      if (shiftStep === 2 && !shiftToRoom) return toast.error("Pick a target room");
                      if (shiftStep === 3) {
                        if (tariffChoice === "custom" && (!customRate || Number(customRate) <= 0)) return toast.error("Enter a custom rate");
                        if (tariffChoice === "custom" && !mgrApproved) return toast.error("Manager must authorise the custom rate");
                      }
                      if (shiftStep === 3) await loadPendingKotsFor(shiftBrId);
                      setShiftStep((s: ShiftStep) => (s + 1) as ShiftStep);
                    }}
                  >Next</Button>
                )}
                {shiftStep === SHIFT_LAST_STEP && (
                  <Button onClick={doShift} disabled={shiftBusy || !shiftReason.trim()}>
                    {shiftBusy ? "Shifting…" : "Confirm Shift"}
                  </Button>
                )}
              </div>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* MODIFY DATE DIALOG */}
        <Dialog open={dateOpen} onOpenChange={setDateOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Modify check-out date</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="text-sm text-muted-foreground">
                Check-in: <span className="font-medium text-foreground">{b.check_in}</span>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">New check-out *</Label>
                <Input type="date" value={newCheckOut} onChange={(e) => setNewCheckOut(e.target.value)} />
              </div>
              <div className="text-xs text-muted-foreground">
                {nightsBetween(b.check_in, newCheckOut)} night(s) · room total recalculates at first room's rate.
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setDateOpen(false)}>Cancel</Button>
              <Button onClick={modifyDate}>Update</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        {/* CANCEL DIALOG */}
        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Cancel booking</DialogTitle></DialogHeader>
            <div className="space-y-1.5">
              <Label className="text-xs">Reason</Label>
              <Textarea rows={2} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} />
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep</Button>
              <Button variant="destructive" onClick={cancelBooking}>Cancel booking</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
      <CheckoutDialog
        bookingId={b.id}
        open={checkoutOpen}
        onOpenChange={setCheckoutOpen}
        onDone={() => load()}
      />
      {assignBrId && (() => {
        const br = b.booking_rooms.find((x) => x.id === assignBrId);
        if (!br) return null;
        return (
          <AssignRoomDialog
            open={!!assignBrId}
            onOpenChange={(o) => { if (!o) setAssignBrId(null); }}
            bookingRoomId={br.id}
            propertyId={b.property_id}
            bookingId={b.id}
            bookingNumber={b.booking_number}
            categoryId={br.category_id}
            categoryName={br.room_categories?.name ?? null}
            currentRate={Number(br.rate)}
            checkIn={br.check_in}
            checkOut={br.check_out}
            onDone={() => { setAssignBrId(null); load(); }}
          />
        );
      })()}
    </AppShell>
  );
}

function Row({ k, v, highlight }: { k: string; v: React.ReactNode; highlight?: boolean }) {
  return (
    <div className="flex gap-2">
      <div className="w-28 text-xs text-muted-foreground">{k}</div>
      <div className={`flex-1 ${highlight ? "font-semibold text-amber-700 dark:text-amber-300" : ""}`}>{v}</div>
    </div>
  );
}

function SummaryStat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="rounded border p-2">
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className={`text-sm font-semibold ${highlight ? "text-destructive" : ""}`}>{value}</div>
    </div>
  );
}

function TariffOption({
  active, onClick, title, line1, line2, disabled,
}: { active: boolean; onClick: () => void; title: string; line1: string; line2: string; disabled?: boolean }) {
  return (
    <div
      onClick={() => { if (!disabled) onClick(); }}
      className={`rounded-md border p-3 ${disabled ? "opacity-60 cursor-not-allowed" : "cursor-pointer"} ${
        active ? "border-primary bg-primary/5" : "hover:bg-muted/40"
      }`}
    >
      <div className="flex items-center gap-2 font-medium text-sm">
        <span className={`h-3 w-3 rounded-full border ${active ? "bg-primary border-primary" : "border-muted-foreground"}`} />
        {title}
      </div>
      <div className="text-sm mt-1">{line1}</div>
      <div className="text-xs text-muted-foreground">{line2}</div>
    </div>
  );
}

function CustomRemarkCard({
  bookingId,
  initial,
  onSaved,
}: {
  bookingId: string;
  initial: string;
  onSaved: (v: string) => void;
}) {
  const [value, setValue] = useState(initial);
  const [saving, setSaving] = useState(false);
  const dirty = value !== initial;

  async function save() {
    setSaving(true);
    const trimmed = value.trim();
    const { error } = await supabase
      .from("bookings")
      .update({ custom_remark: trimmed || null } as any)
      .eq("id", bookingId);
    setSaving(false);
    if (error) return toastError(error);
    onSaved(trimmed);
    toast.success("Custom remark saved");
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-amber-600" />
          Custom Remark
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Highlighted as a warning banner when Checkout is opened for this booking. Applies to this booking only.
        </p>
        <Textarea
          rows={2}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="e.g. ID proof pending, payment confirmation awaited, VIP — apply special rate"
        />
        <div className="flex justify-end">
          <Button size="sm" disabled={!dirty || saving} onClick={save}>
            {saving ? "Saving…" : "Save remark"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}