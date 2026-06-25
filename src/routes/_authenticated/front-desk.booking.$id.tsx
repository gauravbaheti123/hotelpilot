import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import {
  BOOKING_STATUS_LABEL,
  BOOKING_STATUS_TONE,
  nightsBetween,
} from "@/lib/front-desk";
import { fireTrigger } from "@/lib/whatsapp";
import { verifyManagerPassword } from "@/lib/manager-verify";
import { recomputeFolio } from "@/lib/billing";
import { CheckoutDialog } from "@/components/CheckoutDialog";
import {
  LogIn,
  LogOut,
  ArrowLeftRight,
  CalendarClock,
  Ban,
  Receipt,
  ShieldAlert,
  Check,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/front-desk/booking/$id")({
  head: () => ({ meta: [{ title: "Booking — HotelPilot" }] }),
  component: BookingDetailPage,
});

interface Guest { id: string; name: string; mobile: string | null; email: string | null; address: string | null; id_proof_type: string | null; id_proof_number: string | null; }
interface Room {
  id: string;
  room_number: string;
  category_id: string | null;
  status: string;
  room_categories?: { name: string; base_rate: number } | null;
}
interface BookingRoomRow {
  id: string;
  room_id: string | null;
  category_id: string | null;
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
  const [shifts, setShifts] = useState<ShiftRow[]>([]);
  const [kots, setKots] = useState<KotSummaryRow[]>([]);
  const [extraGuests, setExtraGuests] = useState<AdditionalGuestRow[]>([]);
  const [loading, setLoading] = useState(true);

  // dialogs
  const [shiftOpen, setShiftOpen] = useState(false);
  const [shiftBrId, setShiftBrId] = useState<string>("");
  const [shiftToRoom, setShiftToRoom] = useState<string>("");
  const [shiftReason, setShiftReason] = useState("");
  const [shiftStep, setShiftStep] = useState<1 | 2 | 3 | 4>(1);
  const [tariffChoice, setTariffChoice] = useState<"keep" | "new_standard" | "custom">("keep");
  const [customRate, setCustomRate] = useState("");
  const [transferKots, setTransferKots] = useState(true);
  const [pendingKots, setPendingKots] = useState<{ id: string; kot_number: string; status: string; total_amount: number }[]>([]);
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

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from("bookings")
      .select(`
        id,booking_number,status,source,check_in,check_out,adults,children,
        total_amount,advance_amount,balance_amount,notes,checked_in_at,checked_out_at,property_id,
        guests(id,name,mobile,email,address,id_proof_type,id_proof_number),
        booking_rooms(id,room_id,category_id,rate,meal_plan,adults,children,check_in,check_out,actual_check_in,actual_check_out,
          rooms(room_number),
          room_categories(name))
      `)
      .eq("id", id)
      .single();
    if (error) { toast.error(error.message); setLoading(false); return; }
    const detail = data as unknown as BookingDetail;
    setB(detail);
    if (detail) {
      setNewCheckOut(detail.check_out);
      const [{ data: rs }, { data: sh }, { data: kt }, { data: bg }] = await Promise.all([
        supabase
        .from("rooms")
        .select("id,room_number,category_id,status,room_categories(name,base_rate)")
        .eq("property_id", detail.property_id)
        .order("room_number"),
        supabase
          .from("room_shifts")
          .select("id, shifted_at, reason, old_rate, new_rate, shifted_by, from_room:from_room_id(room_number), to_room:to_room_id(room_number)")
          .in("booking_room_id", detail.booking_rooms.map((br) => br.id))
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
      setRooms((rs ?? []) as Room[]);
      const shiftRows = (sh ?? []) as unknown as ShiftRow[];
      // Resolve shifted_by user names from profiles (no FK on shifted_by so we look up manually)
      const userIds = Array.from(new Set(shiftRows.map((s) => s.shifted_by).filter(Boolean) as string[]));
      if (userIds.length > 0) {
        const { data: profs } = await supabase
          .from("profiles")
          .select("id, name")
          .in("id", userIds);
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
    const now = new Date().toISOString();
    const { error } = await supabase.from("bookings").update({
      status: "checked_in" as any,
      checked_in_at: now,
      checked_in_by: user?.id ?? null,
    }).eq("id", b.id);
    if (error) return toast.error(error.message);
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

  async function checkOut() {
    if (!b) return;
    // Phase 4: checkout lock — block while any KOT is open/printed/served
    const { data: openKots, error: kErr } = await supabase
      .from("kot_orders")
      .select("id,kot_number,status")
      .eq("booking_id", b.id)
      .in("status", ["open", "printed", "served"]);
    if (kErr) return toast.error(kErr.message);
    if (openKots && openKots.length > 0) {
      toast.error(
        `Cannot check out — ${openKots.length} KOT pending (${openKots.map((k: any) => k.kot_number).join(", ")}). Mark them billed or void first.`,
      );
      return;
    }
    if (b.balance_amount > 0) {
      if (!confirm(`Balance of ₹${b.balance_amount} is pending. Check out anyway?`)) return;
    }
    const now = new Date().toISOString();
    const { error } = await supabase.from("bookings").update({
      status: "checked_out" as any,
      checked_out_at: now,
      checked_out_by: user?.id ?? null,
    }).eq("id", b.id);
    if (error) return toast.error(error.message);
    for (const br of b.booking_rooms) {
      if (br.room_id) {
        await supabase.from("rooms").update({
          status: "vacant" as any,
          housekeeping_status: "dirty" as any,
        }).eq("id", br.room_id);
      }
      await supabase.from("booking_rooms").update({ actual_check_out: now }).eq("id", br.id);
    }
    toast.success("Checked out");
    logActivity({
      property_id: b.property_id,
      user_id: user?.id ?? "",
      user_name: userDisplayName(user as any),
      ...ACTIVITY.CHECKOUT,
      reference_id: b.id,
      reference_label: `${b.booking_number} — ${b.guests?.name ?? ""}`,
    });
    fireTrigger("checkout_bill", {
      property_id: b.property_id,
      booking_id: b.id,
      guest_id: b.guests?.id ?? null,
      phone: b.guests?.mobile ?? null,
    });
    load();
  }

  function openShift(brId: string) {
    setShiftBrId(brId);
    setShiftToRoom("");
    setShiftReason("");
    setShiftStep(1);
    setTariffChoice("keep");
    setCustomRate("");
    setTransferKots(true);
    setPendingKots([]);
    setMgrEmail(""); setMgrPass(""); setMgrApproved(false);
    setShiftOpen(true);
  }

  async function loadPendingKotsFor(brId: string) {
    if (!b) return;
    const br = b.booking_rooms.find((x) => x.id === brId);
    if (!br) { setPendingKots([]); return; }
    const { data } = await supabase
      .from("kot_orders")
      .select("id,kot_number,status,total_amount")
      .eq("booking_id", b.id)
      .in("status", ["open", "printed", "served"]);
    setPendingKots(((data ?? []) as any));
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

  function resolveNewRate(br: BookingRoomRow, target: Room | undefined): number {
    if (tariffChoice === "custom") return Number(customRate) || Number(br.rate);
    if (tariffChoice === "new_standard") return Number(target?.room_categories?.base_rate ?? br.rate);
    return Number(br.rate);
  }

  async function doShift() {
    if (!b || !shiftBrId || !shiftToRoom) return toast.error("Pick a target room");
    const br = b.booking_rooms.find((x) => x.id === shiftBrId);
    if (!br) return;
    if (!shiftReason.trim()) return toast.error("Reason is required");
    if (tariffChoice === "custom" && !mgrApproved) return toast.error("Manager authorisation required for custom rate");
    const target = rooms.find((r) => r.id === shiftToRoom);
    const oldRate = Number(br.rate);
    const newRate = resolveNewRate(br, target);
    const fromRoomId = br.room_id;
    setShiftBusy(true);

    const { error: e1 } = await supabase.from("booking_rooms")
      .update({ room_id: shiftToRoom, rate: newRate, category_id: target?.category_id ?? br.category_id }).eq("id", br.id);
    if (e1) { setShiftBusy(false); return toast.error(e1.message); }

    // Update folio room charges (if any) for this booking_room to reflect new rate
    try {
      const { data: folioId } = await supabase.rpc("get_or_create_folio", { _booking_id: b.id });
      const fId = folioId as unknown as string;
      const { data: roomCharges } = await supabase.from("folio_charges").select("*")
        .eq("folio_id", fId).eq("source_table", "booking_rooms").eq("source_id", br.id);
      for (const rc of (roomCharges ?? []) as any[]) {
        const qty = Number(rc.qty) || 1;
        const amount = qty * newRate;
        const gstAmt = Math.round(amount * Number(rc.gst_rate || 0)) / 100;
        await supabase.from("folio_charges")
          .update({ rate: newRate, amount, gst_amount: gstAmt }).eq("id", rc.id);
      }
      const { data: allCharges } = await supabase.from("folio_charges").select("*").eq("folio_id", fId);
      const { data: folio } = await supabase.from("folios").select("gst_mode,paid_amount").eq("id", fId).single();
      const mode = ((folio as any)?.gst_mode ?? "cash") as "cash" | "gst";
      const t = recomputeFolio((allCharges ?? []) as any, mode);
      const paid = Number((folio as any)?.paid_amount ?? 0);
      await supabase.from("folios").update({
        ...t, balance_amount: Math.max(0, t.total_amount - paid),
      }).eq("id", fId);
    } catch (e) { console.warn("folio rate update failed", e); }

    await supabase.from("room_shifts").insert({
      property_id: b.property_id,
      booking_room_id: br.id,
      from_room_id: fromRoomId,
      to_room_id: shiftToRoom,
      reason: shiftReason,
      old_rate: oldRate,
      new_rate: newRate,
      tariff_choice: tariffChoice,
      shifted_by: user?.id ?? null,
    } as any);

    if (b.status === "checked_in") {
      if (fromRoomId) {
        await supabase.from("rooms").update({
          status: "vacant" as any,
          housekeeping_status: "dirty" as any,
        }).eq("id", fromRoomId);
      }
      await supabase.from("rooms").update({ status: "occupied" as any }).eq("id", shiftToRoom);
    }

    // === Transfer open/printed KOTs to new room and log ===
    if (transferKots) try {
      if (!fromRoomId) throw new Error("no from room");
      const fromId: string = fromRoomId;
      const { data: openKots } = await supabase
        .from("kot_orders")
        .select("id,kot_number")
        .eq("booking_id", b.id)
        .eq("room_id", fromId)
        .in("status", ["open", "printed", "served"]);
      const ids = (openKots ?? []).map((k: any) => k.id);
      if (ids.length > 0) {
        await supabase.from("kot_orders")
          .update({ room_id: shiftToRoom } as any)
          .in("id", ids);
        const { data: toRoom } = await supabase.from("rooms").select("room_number").eq("id", shiftToRoom).single();
        const { data: frRoom } = await supabase.from("rooms").select("room_number").eq("id", fromId).single();
        await (supabase as any).from("kot_audit_log").insert(ids.map((kid: string) => ({
          property_id: b.property_id,
          kot_order_id: kid,
          event_type: "room_shift",
          message: `Orders transferred from Room ${frRoom?.room_number ?? "?"} to Room ${toRoom?.room_number ?? "?"}`,
          meta: { from_room_id: fromId, to_room_id: shiftToRoom },
          actor: user?.id ?? null,
        })));
        toast.success(`Kitchen alert: ${ids.length} order${ids.length > 1 ? "s" : ""} moved to Room ${toRoom?.room_number ?? ""}`);
      }
    } catch (e) {
      console.warn("KOT transfer failed", e);
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
    const nights = nightsBetween(b.check_in, newCheckOut);
    if (nights < 1) return toast.error("Check-out must be after check-in");
    const br = b.booking_rooms[0];
    const newTotal = nights * (br?.rate ?? 0);
    const newBalance = Math.max(0, newTotal - b.advance_amount);

    const { error } = await supabase.from("bookings").update({
      check_out: newCheckOut,
      total_amount: newTotal,
      balance_amount: newBalance,
    }).eq("id", b.id);
    if (error) return toast.error(error.message);
    for (const r of b.booking_rooms) {
      await supabase.from("booking_rooms").update({ check_out: newCheckOut }).eq("id", r.id);
    }
    toast.success("Dates updated");
    setDateOpen(false);
    load();
  }

  async function cancelBooking() {
    if (!b) return;
    const { error } = await supabase.from("bookings").update({
      status: "cancelled" as any,
      cancelled_at: new Date().toISOString(),
      cancelled_reason: cancelReason || null,
    }).eq("id", b.id);
    if (error) return toast.error(error.message);
    toast.success("Booking cancelled");
    setCancelOpen(false);
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
          <Button variant="outline" size="sm" onClick={() => router.history.back()}>← Back</Button>
          <Badge variant="outline" className={BOOKING_STATUS_TONE[b.status]}>
            {BOOKING_STATUS_LABEL[b.status] ?? b.status}
          </Badge>
          <div className="text-sm text-muted-foreground">
            {b.check_in} → {b.check_out} · {nights} night{nights > 1 ? "s" : ""}
          </div>
          <div className="flex-1" />
          {canAct && (
            <div className="flex gap-2">
              <Link to="/billing/folio/$bookingId" params={{ bookingId: b.id }}>
                <Button variant="outline"><Receipt className="h-4 w-4 mr-1" /> Folio</Button>
              </Link>
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
          )}
        </div>

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

        <Card>
          <CardHeader><CardTitle className="text-base">Room(s)</CardTitle></CardHeader>
          <CardContent>
            <div className="space-y-2">
              {b.booking_rooms.map((br) => (
                <div key={br.id} className="flex items-center justify-between rounded border px-3 py-2 text-sm">
                  <div>
                    <div className="font-medium">
                      Room {br.rooms?.room_number ?? "—"} · {br.room_categories?.name ?? "—"}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {br.check_in} → {br.check_out} · {br.meal_plan} · ₹{br.rate}/night ·
                      {" "}{br.adults}A {br.children > 0 ? `${br.children}C` : ""}
                    </div>
                  </div>
                  {canAct && canShift && (
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
                          <div className="flex items-center justify-between font-medium">
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
                    <div className="border-t pt-2 grid grid-cols-3 gap-2">
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

        {/* SHIFT DIALOG */}
        <Dialog open={shiftOpen} onOpenChange={setShiftOpen}>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>Shift room — Step {shiftStep} of 4</DialogTitle>
            </DialogHeader>
            {(() => {
              const br = b.booking_rooms.find((x) => x.id === shiftBrId);
              const target = rooms.find((r) => r.id === shiftToRoom);
              const fromRate = Number(br?.rate ?? 0);
              const newStdRate = Number(target?.room_categories?.base_rate ?? 0);
              const newRate = br ? resolveNewRate(br, target) : 0;
              return (
                <div className="space-y-4">
                  {/* Step 1: pick new room */}
                  {shiftStep === 1 && (
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

                  {/* Step 2: tariff decision */}
                  {shiftStep === 2 && br && target && (
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
                        line1={newStdRate > 0 ? `₹${newStdRate}/night` : "No base rate set on category"}
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

                  {/* Step 3: food orders transfer */}
                  {shiftStep === 3 && (
                    <div className="space-y-3">
                      {pendingKots.length === 0 ? (
                        <p className="text-sm text-muted-foreground">No pending food orders.</p>
                      ) : (
                        <>
                          <div className="flex items-center gap-2">
                            <input id="ktr" type="checkbox" checked={transferKots}
                              onChange={(e) => setTransferKots(e.target.checked)} />
                            <Label htmlFor="ktr" className="text-sm">
                              Transfer {pendingKots.length} pending order(s) to new room
                            </Label>
                          </div>
                          <div className="space-y-1 text-sm">
                            {pendingKots.map((k) => (
                              <div key={k.id} className="flex justify-between border-b last:border-0 pb-1">
                                <span>{k.kot_number} <span className="uppercase text-xs text-muted-foreground ml-1">({k.status})</span></span>
                                <span>₹{Number(k.total_amount || 0).toFixed(2)}</span>
                              </div>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}

                  {/* Step 4: confirm */}
                  {shiftStep === 4 && br && target && (
                    <div className="space-y-3 text-sm">
                      <div className="rounded-md border p-3 bg-muted/30 space-y-1">
                        <div><span className="text-muted-foreground">From:</span> Room {br.rooms?.room_number} ({br.room_categories?.name}) @ ₹{fromRate}/night</div>
                        <div><span className="text-muted-foreground">To:</span> Room {target.room_number} ({target.room_categories?.name ?? "—"}) @ ₹{newRate}/night
                          {tariffChoice === "custom" && <Badge variant="outline" className="ml-2 text-[10px] border-amber-400 text-amber-700">Custom</Badge>}
                          {tariffChoice === "keep" && <Badge variant="outline" className="ml-2 text-[10px]">Same rate</Badge>}
                          {tariffChoice === "new_standard" && <Badge variant="outline" className="ml-2 text-[10px]">New standard</Badge>}
                        </div>
                        <div><span className="text-muted-foreground">Pending orders transferred:</span> {transferKots ? pendingKots.length : 0}</div>
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
                  <Button variant="outline" onClick={() => setShiftStep((s) => (s - 1) as 1 | 2 | 3 | 4)} disabled={shiftBusy}>Back</Button>
                )}
                {shiftStep < 4 && (
                  <Button
                    onClick={async () => {
                      if (shiftStep === 1 && !shiftToRoom) return toast.error("Pick a target room");
                      if (shiftStep === 2) {
                        if (tariffChoice === "custom" && (!customRate || Number(customRate) <= 0)) return toast.error("Enter a custom rate");
                        if (tariffChoice === "custom" && !mgrApproved) return toast.error("Manager must authorise the custom rate");
                      }
                      if (shiftStep === 2) await loadPendingKotsFor(shiftBrId);
                      setShiftStep((s) => (s + 1) as 1 | 2 | 3 | 4);
                    }}
                  >Next</Button>
                )}
                {shiftStep === 4 && (
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