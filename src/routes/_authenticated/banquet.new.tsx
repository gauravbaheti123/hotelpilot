import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { computeBanquetTotal, FUNCTION_TYPES } from "@/lib/banquet";
import { Plus, Trash2 } from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { RequirePermission } from "@/components/RequirePermission";
import { useDiscountLimit } from "@/hooks/use-discount-limit";
import { canApplyDiscount, describeLimit } from "@/lib/discountLimit";
import { isValidMobile, sanitizeMobile, MOBILE_ERROR } from "@/lib/mobile";
import { fetchTariffPlans, pickTariffPlan, type TariffPlan } from "@/lib/tariff";
import {
  commitRoomBlocks, nightsBetween,
  type AssignedBlock,
} from "@/lib/eventRoomBlocks";
import { isValidStayRange } from "@/lib/front-desk";
import { GuestSearchInput } from "@/components/GuestSearchInput";

export const Route = createFileRoute("/_authenticated/banquet/new")({
  head: () => ({ meta: [{ title: "New Banquet — HotelPilot" }] }),
  component: () => (<RequirePermission module="banquet"><NewBanquetPage /></RequirePermission>),
});

interface Hall { id: string; name: string; capacity: number }
interface Cat { id: string; name: string }
interface RoomOpt { id: string; room_number: string; category_id: string | null; status: string; category_name: string | null }
interface ExtraRow { point_name: string; amount: string }
interface BlockRow {
  room_id: string;
  guest_name: string;
  guest_mobile: string;
  checkin_date: string;
  checkin_time: string;
  checkout_date: string;
  checkout_time: string;
  special_rate: string;
}

function NewBanquetPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentId: propertyId } = useCurrentProperty();
  const [halls, setHalls] = useState<Hall[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [tariffPlans, setTariffPlans] = useState<TariffPlan[]>([]);
  const [allRooms, setAllRooms] = useState<RoomOpt[]>([]);
  const [saving, setSaving] = useState(false);
  const { limit: discountLimit } = useDiscountLimit();

  const today = new Date().toISOString().slice(0, 10);

  // guest
  const [guestName, setGuestName] = useState("");
  const [guestMobile, setGuestMobile] = useState("");
  const [guestEmail, setGuestEmail] = useState("");
  // Read-only reference to an existing guest, if one was explicitly picked.
  // Banquet never creates or edits `guests` rows from this form.
  const [linkedGuestId, setLinkedGuestId] = useState<string | null>(null);
  const [linkedGuestName, setLinkedGuestName] = useState<string | null>(null);

  // event
  const [hallId, setHallId] = useState("");
  const [functionType, setFunctionType] = useState("Wedding");
  const [eventDate, setEventDate] = useState(today);
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("23:00");
  // Phase 34.3 — events can run past midnight, so check-out has its own date.
  const [eventEndDate, setEventEndDate] = useState(today);
  const [pax, setPax] = useState("100");

  // charges
  const [eventPrice, setEventPrice] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [advance, setAdvance] = useState("0");
  const [notes, setNotes] = useState("");

  // Extras (repeatable named line items)
  const [extras, setExtras] = useState<ExtraRow[]>([]);

  // Rooms: two modes — single-assign or bulk-block
  const [roomMode, setRoomMode] = useState<"none" | "single" | "bulk">("none");
  const [eventName, setEventName] = useState("");
  // Single-room state
  const [singleRoomId, setSingleRoomId] = useState("");
  const [singleCheckIn, setSingleCheckIn] = useState(today);
  const [singleCheckOut, setSingleCheckOut] = useState(today);
  const [singleRate, setSingleRate] = useState("0");
  // Bulk state — one row per physical room
  const [blockRows, setBlockRows] = useState<BlockRow[]>([]);

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data } = await supabase.from("halls")
        .select("id,name,capacity")
        .eq("property_id", propertyId).eq("is_active", true).order("name");
      setHalls((data ?? []) as Hall[]);
      const { data: cs } = await supabase.from("room_categories")
        .select("id, name")
        .eq("property_id", propertyId).order("name");
      setCats((cs ?? []) as Cat[]);
      // Phase 27b — room pricing for banquet blocks comes from Tariff Plans.
      setTariffPlans(await fetchTariffPlans(propertyId).catch(() => []));
      const { data: rs } = await supabase.from("rooms")
        .select("id,room_number,category_id,status,room_categories(name)")
        .eq("property_id", propertyId).eq("is_active", true)
        .eq("status", "vacant").order("room_number");
      setAllRooms(((rs ?? []) as any[]).map((r) => ({
        id: r.id, room_number: r.room_number, category_id: r.category_id,
        status: r.status, category_name: r.room_categories?.name ?? null,
      })));
    })();
  }, [propertyId]);

  const extrasTotal = useMemo(
    () => extras.reduce((s, x) => s + (Number(x.amount) || 0), 0),
    [extras],
  );
  const total = useMemo(() => computeBanquetTotal({
    package_rate: 0, pax: Number(pax),
    hall_charge: Number(eventPrice), fb_charge: 0,
    extra_charge: extrasTotal, discount_amount: Number(discount),
  }), [eventPrice, extrasTotal, pax, discount]);

  function addExtra() { setExtras((p) => [...p, { point_name: "", amount: "" }]); }
  function updateExtra(i: number, patch: Partial<ExtraRow>) {
    setExtras((p) => p.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function removeExtra(i: number) { setExtras((p) => p.filter((_, idx) => idx !== i)); }

  /**
   * Phase 27b — single source of truth for room pricing: the tariff plan that
   * is valid for this category on the given stay date.
   */
  function stdRate(categoryId: string | null | undefined, date: string): number {
    return Number(pickTariffPlan(tariffPlans, { categoryId: categoryId ?? null, date })?.rate ?? 0) || 0;
  }

  const blockSummary = useMemo(() => {
    let totalRooms = 0;
    let revenue = 0;
    blockRows.forEach((r) => {
      if (!r.room_id) return;
      const room = allRooms.find((x) => x.id === r.room_id);
      const rate = Number(r.special_rate) || stdRate(room?.category_id, r.checkin_date || eventDate);
      const nights = r.checkin_date && r.checkout_date ? nightsBetween(r.checkin_date, r.checkout_date) : 1;
      totalRooms += 1;
      revenue += rate * nights;
    });
    const categories = new Set(
      blockRows
        .map((r) => allRooms.find((x) => x.id === r.room_id)?.category_id)
        .filter(Boolean),
    ).size;
    return { totalRooms, revenue, categories };
  }, [blockRows, allRooms, tariffPlans, eventDate]);

  const summaryRoomRevenue = useMemo(() => {
    if (roomMode === "bulk") return blockSummary.revenue;
    if (roomMode === "single" && singleRoomId && Number(singleRate) > 0) {
      const n = Math.max(1, nightsBetween(singleCheckIn, singleCheckOut));
      return Number(singleRate) * n;
    }
    return 0;
  }, [roomMode, blockSummary.revenue, singleRoomId, singleRate, singleCheckIn, singleCheckOut]);

  function addBlockRow() {
    const nextDay = new Date(eventDate);
    nextDay.setDate(nextDay.getDate() + 1);
    setBlockRows((prev) => [...prev, {
      room_id: "", guest_name: "", guest_mobile: "",
      checkin_date: eventDate, checkin_time: "12:00",
      checkout_date: nextDay.toISOString().slice(0, 10), checkout_time: "11:00",
      special_rate: "",
    }]);
  }
  function updateBlockRow(i: number, patch: Partial<BlockRow>) {
    setBlockRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function removeBlockRow(i: number) {
    setBlockRows((prev) => prev.filter((_, idx) => idx !== i));
  }

  /** Build event_room_blocks rows from the per-room bulk grid. */
  function buildBulkAssignments(): AssignedBlock[] {
    return blockRows
      .filter((row) => row.room_id)
      .map((row) => {
        const room = allRooms.find((x) => x.id === row.room_id)!;
        const rate = row.special_rate
          ? Number(row.special_rate)
          : stdRate(room.category_id, row.checkin_date || eventDate);
        return {
          room_id: room.id,
          room_number: room.room_number,
          room_category: room.category_name ?? "",
          category_id: room.category_id ?? "",
          checkin_date: row.checkin_date,
          checkout_date: row.checkout_date,
          checkin_time: row.checkin_time || "12:00",
          checkout_time: row.checkout_time || "11:00",
          special_rate: rate,
          guest_name: row.guest_name.trim(),
          guest_mobile: row.guest_mobile.trim(),
        } as AssignedBlock;
      });
  }

  async function save() {
    if (!propertyId) return;
    if (!guestName.trim()) return toast.error("Guest name required");
    if (!isValidMobile(guestMobile)) return toast.error(MOBILE_ERROR);
    if (!eventDate || !startTime || !eventEndDate || !endTime)
      return toast.error("Event check-in / check-out date & time required");
    if (!isValidStayRange(eventDate, eventEndDate, startTime, endTime))
      return toast.error("Event check-out must be after check-in");
    if ((roomMode === "single" || roomMode === "bulk") && !eventName.trim()) {
      return toast.error("Event name required when assigning rooms");
    }
    if (roomMode === "single" && !singleRoomId) return toast.error("Pick a room to assign");
    if (roomMode === "bulk") {
      if (blockRows.length === 0) return toast.error("Add at least one room row");
      for (const [i, row] of blockRows.entries()) {
        const label = `Row ${i + 1}`;
        if (!row.room_id) return toast.error(`${label}: pick a room`);
        if (!row.guest_name.trim()) return toast.error(`${label}: guest name required`);
        if (!isValidMobile(row.guest_mobile)) return toast.error(`${label}: ${MOBILE_ERROR.toLowerCase()}`);
        if (!row.checkin_date || !row.checkout_date) return toast.error(`${label}: check-in / check-out dates required`);
        if (!isValidStayRange(row.checkin_date, row.checkout_date, row.checkin_time || "12:00", row.checkout_time || "11:00"))
          return toast.error(`${label}: check-out must be after check-in`);
      }
      const dupe = blockRows.map((r) => r.room_id).find((id, i, arr) => arr.indexOf(id) !== i);
      if (dupe) return toast.error("Same room selected in more than one row");
    }
    // Enforce per-role discount limits on any overridden room rate (single + bulk).
    if (roomMode === "single" && singleRoomId) {
      const r = allRooms.find((x) => x.id === singleRoomId);
      const base = stdRate(r?.category_id, singleCheckIn || eventDate);
      const proposed = Number(singleRate) || 0;
      if (base > 0 && proposed > 0 && proposed < base) {
        const chk = canApplyDiscount(discountLimit, { discountRupees: base - proposed, base });
        if (!chk.allowed) return toast.error(chk.reason ?? describeLimit(discountLimit));
      }
    }
    if (roomMode === "bulk") {
      for (const row of blockRows) {
        if (!row.room_id || !row.special_rate) continue;
        const room = allRooms.find((x) => x.id === row.room_id);
        const base = stdRate(room?.category_id, row.checkin_date || eventDate);
        const proposed = Number(row.special_rate) || 0;
        if (base > 0 && proposed > 0 && proposed < base) {
          const chk = canApplyDiscount(discountLimit, { discountRupees: base - proposed, base });
          if (!chk.allowed) return toast.error(`Room ${room?.room_number ?? ""}: ${chk.reason ?? describeLimit(discountLimit)}`);
        }
      }
    }
    setSaving(true);
    try {
      const advanceAmt = Number(advance) || 0;

      // Build assignments depending on roomMode
      let finalAssignments: AssignedBlock[] = [];
      if (roomMode === "single" && singleRoomId) {
        const r = allRooms.find((x) => x.id === singleRoomId);
        if (!r) throw new Error("Selected room no longer available");
        finalAssignments = [{
          room_id: r.id, room_number: r.room_number,
          room_category: r.category_name ?? "",
          category_id: r.category_id ?? "",
          checkin_date: singleCheckIn,
          checkout_date: singleCheckOut,
          special_rate: Number(singleRate) || 0,
          guest_name: guestName.trim(),
          guest_mobile: guestMobile.trim(),
        }];
      } else if (roomMode === "bulk" && blockRows.length > 0) {
        finalAssignments = buildBulkAssignments();
      }

      const totalRoomCharges = finalAssignments.reduce((sum, a) => {
        const nights = nightsBetween(a.checkin_date, a.checkout_date);
        return sum + (Number(a.special_rate ?? 0) * nights);
      }, 0);
      const combinedTotal = total + totalRoomCharges;

      const { data: bq, error: be } = await supabase.from("banquet_bookings").insert({
        property_id: propertyId,
        hall_id: hallId || null,
        // Read-only link only when a guest was explicitly selected from search.
        guest_id: linkedGuestId,
        host_name: guestName.trim(),
        host_mobile: guestMobile.trim() || null,
        host_email: guestEmail.trim() || null,
        event_name: roomMode !== "none" ? eventName : null,
        function_type: functionType,
        event_date: eventDate,
        event_end_date: eventEndDate,
        start_time: startTime,
        end_time: endTime,
        pax: Number(pax) || 0,
        package_rate: 0,
        hall_charge: Number(eventPrice) || 0,
        fb_charge: 0,
        extra_charge: extrasTotal,
        discount_amount: Number(discount) || 0,
        total_amount: combinedTotal,
        advance_amount: advanceAmt,
        balance_amount: Math.max(0, combinedTotal - advanceAmt),
        total_room_charges: totalRoomCharges,
        notes: notes || null,
        status: "reserved",
        created_by: user?.id ?? null,
      } as any).select("id").single();
      if (be) throw be;

      // Persist extras
      const extraRows = extras
        .map((x, idx) => ({ point_name: x.point_name.trim(), amount: Number(x.amount) || 0, sort_order: idx }))
        .filter((x) => x.point_name && x.amount > 0);
      if (extraRows.length > 0) {
        const { error: exErr } = await supabase.from("banquet_extra_charges").insert(
          extraRows.map((x) => ({
            banquet_booking_id: bq!.id,
            property_id: propertyId,
            point_name: x.point_name,
            amount: x.amount,
            sort_order: x.sort_order,
            created_by: user?.id ?? null,
          })) as any,
        );
        if (exErr) throw exErr;
      }

      let roomsBlocked = 0;
      if (roomMode !== "none" && finalAssignments.length > 0) {
        roomsBlocked = await commitRoomBlocks({
          propertyId,
          banquetBookingId: bq!.id,
          eventName,
          rows: finalAssignments,
        });
      }

      // load number for message
      const { data: bnRow } = await supabase.from("banquet_bookings")
        .select("banquet_number").eq("id", bq!.id).maybeSingle();
      const bn = (bnRow as any)?.banquet_number ?? "";
      toast.success(roomsBlocked > 0
        ? `Event saved — ${bn} generated, ${roomsBlocked} rooms assigned to event`
        : `Event saved — ${bn} generated`);
      router.navigate({ to: "/banquet/event/$id", params: { id: bq!.id } });
    } catch (e: any) {
      toast.error(e.message ?? "Failed");
    } finally {
      setSaving(false);
    }
  }

  if (!propertyId) return <AppShell title="New Banquet"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="New Banquet Event">
      <div className="max-w-5xl grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle className="text-base">Guest / Host</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Field label="Name *">
                <GuestSearchInput
                  propertyId={propertyId}
                  value={guestName}
                  mobile={guestMobile}
                  allowCreate={false}
                  placeholder="Search existing or type new"
                  onChange={(v) => setGuestName(v)}
                  onSelect={(g) => {
                    setLinkedGuestId(g.id);
                    setLinkedGuestName(g.name);
                    setGuestName(g.name);
                    setGuestMobile(sanitizeMobile(g.mobile ?? ""));
                    setGuestEmail(g.email ?? "");
                  }}
                />
                {linkedGuestId ? (
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Linked to existing guest (reference only — their CRM record is never changed).
                    <button type="button" className="ml-1 underline" onClick={() => { setLinkedGuestId(null); setLinkedGuestName(null); }}>Unlink</button>
                  </p>
                ) : (
                  <p className="mt-1 text-[11px] text-muted-foreground">Manual entry is saved on this event only.</p>
                )}
              </Field>
              <Field label="Mobile *">
                <Input
                  value={guestMobile}
                  onChange={(e) => setGuestMobile(sanitizeMobile(e.target.value))}
                  inputMode="numeric"
                  pattern="\d{10}"
                  maxLength={10}
                  placeholder="10-digit mobile"
                  className={guestMobile && !isValidMobile(guestMobile) ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {guestMobile && !isValidMobile(guestMobile) && (
                  <p className="mt-1 text-[11px] text-red-600">{MOBILE_ERROR}</p>
                )}
              </Field>
              <Field label="Email"><Input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Event</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Field label="Hall (optional)">
                <Select value={hallId} onValueChange={setHallId}>
                  <SelectTrigger><SelectValue placeholder="Pick hall" /></SelectTrigger>
                  <SelectContent>
                    {halls.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">Add halls in Masters first.</div>}
                    {halls.map((h) => <SelectItem key={h.id} value={h.id}>{h.name} · cap {h.capacity}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="Function type">
                <Select value={functionType} onValueChange={setFunctionType}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{FUNCTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
              <Field label="Pax"><Input type="number" value={pax} onChange={(e) => setPax(e.target.value)} /></Field>
              <Field label="Check-in Date *">
                <Input
                  type="date"
                  value={eventDate}
                  onChange={(e) => {
                    const v = e.target.value;
                    setEventDate(v);
                    if (!eventEndDate || eventEndDate < v) setEventEndDate(v);
                  }}
                />
              </Field>
              <Field label="Check-in Time *"><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
              <Field label="Check-out Date *"><Input type="date" value={eventEndDate} min={eventDate} onChange={(e) => setEventEndDate(e.target.value)} /></Field>
              <Field label="Check-out Time *"><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Charges</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Field label="Event Price (₹) *"><Input type="number" value={eventPrice} onChange={(e) => setEventPrice(e.target.value)} /></Field>
              <Field label="Discount (₹)"><Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
              <Field label="Advance (₹)"><Input type="number" value={advance} onChange={(e) => setAdvance(e.target.value)} /></Field>
              <Field label="Notes" wide><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Extra Charges</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addExtra}>
                <Plus className="h-4 w-4 mr-1" /> Add Extra Charge
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              {extras.length === 0 && (
                <p className="text-xs text-muted-foreground">
                  Optional. Add named line items (e.g. "DJ Setup", "Extra Chairs", "Decoration") that appear on the event bill.
                </p>
              )}
              {extras.map((x, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1.5fr_140px_30px] items-end">
                  <Field label={i === 0 ? "Point name" : ""}>
                    <Input placeholder="e.g. DJ Setup" value={x.point_name}
                      onChange={(e) => updateExtra(i, { point_name: e.target.value })} />
                  </Field>
                  <Field label={i === 0 ? "Amount (₹)" : ""}>
                    <Input type="number" value={x.amount}
                      onChange={(e) => updateExtra(i, { amount: e.target.value })} />
                  </Field>
                  <Button type="button" variant="ghost" size="icon"
                    className="h-8 w-8 text-destructive" onClick={() => removeExtra(i)}>
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Rooms · Assign Guest</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              <Tabs value={roomMode} onValueChange={(v) => setRoomMode(v as any)}>
                <TabsList>
                  <TabsTrigger value="none">None</TabsTrigger>
                  <TabsTrigger value="single">Assign One Room</TabsTrigger>
                  <TabsTrigger value="bulk">Block Multiple Rooms</TabsTrigger>
                </TabsList>

                {roomMode !== "none" && (
                  <div className="pt-3">
                    <Field label="Event Name * (shown on dashboard cards)">
                      <Input placeholder="e.g. Sharma Wedding" value={eventName} onChange={(e) => setEventName(e.target.value)} />
                    </Field>
                  </div>
                )}

                <TabsContent value="single" className="space-y-3 pt-3">
                  <div className="grid gap-2 sm:grid-cols-4">
                    <Field label="Room *">
                      <Select value={singleRoomId} onValueChange={setSingleRoomId}>
                        <SelectTrigger><SelectValue placeholder="Pick vacant room" /></SelectTrigger>
                        <SelectContent>
                          {allRooms.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">No vacant rooms.</div>}
                          {allRooms.map((r) => (
                            <SelectItem key={r.id} value={r.id}>
                              {r.room_number} {r.category_name ? `· ${r.category_name}` : ""}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </Field>
                    <Field label="Check-in">
                      <Input type="date" value={singleCheckIn} onChange={(e) => setSingleCheckIn(e.target.value)} />
                    </Field>
                    <Field label="Check-out">
                      <Input type="date" value={singleCheckOut} onChange={(e) => setSingleCheckOut(e.target.value)} />
                    </Field>
                    <Field label="Rate / night (₹)">
                      <Input type="number" value={singleRate} onChange={(e) => setSingleRate(e.target.value)} />
                    </Field>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Assigns this single room to the event host guest (name/mobile above).
                  </p>
                </TabsContent>

                <TabsContent value="bulk" className="space-y-3 pt-3">
                  <div className="space-y-2">
                  {blockRows.map((r, i) => {
                    const room = allRooms.find((x) => x.id === r.room_id);
                    return (
                      <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1.2fr_1fr_1fr_1fr_120px_30px] items-end p-2 border rounded">
                        <Field label={i === 0 ? "Room *" : ""}>
                          <Select value={r.room_id} onValueChange={(v) => updateBlockRow(i, { room_id: v })}>
                            <SelectTrigger><SelectValue placeholder="Pick room" /></SelectTrigger>
                            <SelectContent>
                              {allRooms.length === 0 && <div className="px-2 py-1 text-xs text-muted-foreground">No vacant rooms.</div>}
                              {allRooms.map((x) => (
                                <SelectItem key={x.id} value={x.id}>
                                  {x.room_number}{x.category_name ? ` · ${x.category_name}` : ""}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label={i === 0 ? "Guest name *" : ""}>
                          <Input value={r.guest_name} onChange={(e) => updateBlockRow(i, { guest_name: e.target.value })} />
                        </Field>
                        <Field label={i === 0 ? "Mobile *" : ""}>
                          <Input
                            value={r.guest_mobile}
                            inputMode="numeric"
                            pattern="\d{10}"
                            maxLength={10}
                            placeholder="10-digit mobile"
                            onChange={(e) => updateBlockRow(i, { guest_mobile: sanitizeMobile(e.target.value) })}
                            className={r.guest_mobile && !isValidMobile(r.guest_mobile) ? "border-red-500 focus-visible:ring-red-500" : ""}
                          />
                        </Field>
                        <Field label={i === 0 ? "Check-in" : ""}>
                          <Input type="date" value={r.checkin_date} onChange={(e) => updateBlockRow(i, { checkin_date: e.target.value })} />
                          <Input type="time" className="mt-1" value={r.checkin_time} onChange={(e) => updateBlockRow(i, { checkin_time: e.target.value })} />
                        </Field>
                        <Field label={i === 0 ? "Check-out" : ""}>
                          <Input type="date" value={r.checkout_date} onChange={(e) => updateBlockRow(i, { checkout_date: e.target.value })} />
                          <Input type="time" className="mt-1" value={r.checkout_time} onChange={(e) => updateBlockRow(i, { checkout_time: e.target.value })} />
                        </Field>
                        <Field label={i === 0 ? `Rate (def ₹${stdRate(room?.category_id, r.checkin_date || eventDate)})` : ""}>
                          <Input type="number" placeholder="default" value={r.special_rate} onChange={(e) => updateBlockRow(i, { special_rate: e.target.value })} />
                        </Field>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeBlockRow(i)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                  <Button type="button" variant="outline" size="sm" onClick={addBlockRow}>
                    <Plus className="h-4 w-4 mr-1" /> Add Room
                  </Button>
                </div>

                {blockRows.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Rooms to block: <b>{blockSummary.totalRooms}</b> across <b>{blockSummary.categories}</b> categories ·
                    Estimated room revenue: <b>₹{blockSummary.revenue.toLocaleString("en-IN")}</b>
                  </div>
                )}
                </TabsContent>
              </Tabs>
            </CardContent>
          </Card>
        </div>

        <Card className="self-start sticky top-4">
          <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row k="Event Price" v={`₹${Number(eventPrice).toLocaleString("en-IN")}`} />
            {extrasTotal > 0 && <Row k="Extras" v={`₹${extrasTotal.toLocaleString("en-IN")}`} />}
            {Number(discount) > 0 && <Row k="Discount" v={`- ₹${Number(discount).toLocaleString("en-IN")}`} />}
            {roomMode === "bulk" && blockSummary.revenue > 0 && (
              <Row k={`Rooms (${blockSummary.totalRooms})`} v={`₹${blockSummary.revenue.toLocaleString("en-IN")}`} />
            )}
            {roomMode === "single" && singleRoomId && Number(singleRate) > 0 && (
              <Row k="Room (1)" v={`₹${(Number(singleRate) * Math.max(1, nightsBetween(singleCheckIn, singleCheckOut))).toLocaleString("en-IN")}`} />
            )}
            <div className="border-t pt-2">
              <Row k="Total" v={`₹${(total + summaryRoomRevenue).toLocaleString("en-IN")}`} bold />
              <Row k="Advance" v={`₹${Number(advance).toLocaleString("en-IN")}`} />
              <Row k="Balance" v={`₹${Math.max(0, total + summaryRoomRevenue - Number(advance)).toLocaleString("en-IN")}`} bold highlight />
            </div>
            <div className="pt-3 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => router.history.back()}>Cancel</Button>
              <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving…" : "Assign Guest / Save"}</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Field({ label, children, wide }: { label: string; children: React.ReactNode; wide?: boolean }) {
  return <div className={`space-y-1.5 ${wide ? "sm:col-span-3" : ""}`}><Label className="text-xs">{label}</Label>{children}</div>;
}
function Row({ k, v, bold, highlight }: { k: string; v: React.ReactNode; bold?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""} ${highlight ? "text-amber-700" : ""}`}>
      <span className={bold ? "" : "text-muted-foreground"}>{k}</span><span>{v}</span>
    </div>
  );
}