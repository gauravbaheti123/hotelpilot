import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { toast } from "sonner";
import { isValidStayRange } from "@/lib/front-desk";
import { BANQUET_STATUS_TONE, computeBanquetTotal, FUNCTION_TYPES } from "@/lib/banquet";
import { ArrowLeft, BedDouble, Trash2, CheckCircle2, Ban, Plus, FileText, Pencil, Save, LogIn, LogOut, UserPlus, Eye } from "lucide-react";
import { checkInBlock, checkOutBlock, bulkCheckInBlocks, dueForCheckIn, type EventBlockRecord } from "@/lib/eventRoomBlocks";
import { GuestSearchInput } from "@/components/GuestSearchInput";
import { sanitizeMobile } from "@/lib/mobile";

import { RequirePermission } from "@/components/RequirePermission";
import { useDiscountLimit } from "@/hooks/use-discount-limit";
import { canApplyDiscount, describeLimit } from "@/lib/discountLimit";
export const Route = createFileRoute("/_authenticated/banquet/event/$id")({
  head: () => ({ meta: [{ title: "Banquet Event — HotelPilot" }] }),
  component: () => (<RequirePermission module="banquet"><BanquetEventPage /></RequirePermission>),
});

interface Bq {
  id: string; property_id: string; banquet_number: string; function_type: string;
  event_name: string | null; event_date: string; event_end_date: string | null; start_time: string; end_time: string; pax: number;
  package_rate: number; hall_charge: number; fb_charge: number; extra_charge: number;
  extra_charge_description: string | null;
  discount_amount: number; total_amount: number; advance_amount: number; balance_amount: number;
  advance_payment_mode: string | null;
  status: string; notes: string | null;
  hall_id: string | null; halls: { id: string; name: string; capacity: number } | null;
  guests: { id: string; name: string; mobile: string | null; email: string | null } | null;
  guest_id: string | null;
}
interface Room { id: string; room_number: string; category_id: string | null; status: string }
interface Cat { id: string; name: string }
interface Hall { id: string; name: string; capacity: number }

function BanquetEventPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { user } = useAuth();
  const { limit: discountLimit } = useDiscountLimit();
  const [b, setB] = useState<Bq | null>(null);
  const [blocks, setBlocks] = useState<EventBlockRecord[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [halls, setHalls] = useState<Hall[]>([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [addRoomId, setAddRoomId] = useState("");
  const [addCatId, setAddCatId] = useState("");
  const [addRate, setAddRate] = useState("0");
  const [addCheckIn, setAddCheckIn] = useState("");
  const [addCheckOut, setAddCheckOut] = useState("");
  const [addGuestName, setAddGuestName] = useState("");
  const [addGuestMobile, setAddGuestMobile] = useState("");

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Host edit local state
  const [host, setHost] = useState({ name: "", mobile: "", email: "", function_type: "", notes: "" });
  const [savingHost, setSavingHost] = useState(false);

  // Event meta edit dialog
  const [metaOpen, setMetaOpen] = useState(false);
  const [meta, setMeta] = useState({ event_name: "", hall_id: "", event_date: "", event_end_date: "", start_time: "", end_time: "", pax: 0, function_type: "" });

  // Assign guest dialog
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignBlock, setAssignBlock] = useState<EventBlockRecord | null>(null);
  const [assignName, setAssignName] = useState("");
  const [assignMobile, setAssignMobile] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("banquet_bookings").select(`
      id,property_id,banquet_number,event_name,function_type,event_date,event_end_date,start_time,end_time,pax,
      package_rate,hall_charge,fb_charge,extra_charge,extra_charge_description,discount_amount,total_amount,
      advance_amount,balance_amount,advance_payment_mode,status,notes,hall_id,guest_id,
      halls(id,name,capacity),guests(id,name,mobile,email)
    `).eq("id", id).single();
    if (error) { toast.error(error.message); setLoading(false); return; }
    const bq = data as unknown as Bq;
    setB(bq);
    setHost({
      name: bq.guests?.name ?? "",
      mobile: bq.guests?.mobile ?? "",
      email: bq.guests?.email ?? "",
      function_type: bq.function_type ?? "",
      notes: bq.notes ?? "",
    });
    setMeta({
      event_name: bq.event_name ?? "",
      hall_id: bq.hall_id ?? "",
      event_date: bq.event_date,
      event_end_date: bq.event_end_date ?? bq.event_date,
      start_time: (bq.start_time ?? "").slice(0, 5),
      end_time: (bq.end_time ?? "").slice(0, 5),
      pax: bq.pax ?? 0,
      function_type: bq.function_type ?? "",
    });
    setAddCheckIn(bq.event_date);
    const nextDay = new Date(bq.event_date); nextDay.setDate(nextDay.getDate() + 1);
    setAddCheckOut(nextDay.toISOString().slice(0, 10));

    const [{ data: rs }, { data: cs }, { data: hs }] = await Promise.all([
      supabase.from("rooms").select("id,room_number,category_id,status")
        .eq("property_id", bq.property_id).order("room_number"),
      supabase.from("room_categories").select("id,name")
        .eq("property_id", bq.property_id).order("name"),
      supabase.from("halls").select("id,name,capacity")
        .eq("property_id", bq.property_id).eq("is_active", true).order("name"),
    ]);
    setRooms((rs ?? []) as Room[]);
    setCats((cs ?? []) as Cat[]);
    setHalls((hs ?? []) as Hall[]);
    const { data: erb } = await supabase.from("event_room_blocks")
      .select("*").eq("banquet_booking_id", id).order("room_number");
    setBlocks((erb ?? []) as unknown as EventBlockRecord[]);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function addRoomBlock() {
    if (!b) return;
    if (!addRoomId && !addCatId) return toast.error("Pick a room or category");
    if (!addCheckIn || !addCheckOut) return toast.error("Dates required");

    let roomRow: Room | undefined;
    if (addRoomId) {
      roomRow = rooms.find((r) => r.id === addRoomId);
    } else {
      // pick first vacant room in the chosen category
      roomRow = rooms.find((r) => r.category_id === addCatId && r.status === "vacant");
      if (!roomRow) return toast.error("No vacant room in that category");
    }
    const cat = cats.find((c) => c.id === (roomRow?.category_id ?? addCatId));
    const { error } = await supabase.from("event_room_blocks").insert({
      property_id: b.property_id,
      banquet_booking_id: b.id,
      event_name: b.event_name ?? b.banquet_number,
      room_id: roomRow!.id,
      room_number: roomRow!.room_number,
      room_category: cat?.name ?? null,
      guest_name: addGuestName.trim() || null,
      guest_mobile: addGuestMobile.trim() || null,
      checkin_date: addCheckIn,
      checkout_date: addCheckOut,
      special_rate: Number(addRate) || 0,
      status: "blocked",
    } as any);
    if (error) return toast.error(error.message);
    await supabase.from("rooms").update({ status: "blocked" } as any).eq("id", roomRow!.id);
    setAddOpen(false);
    setAddRoomId(""); setAddCatId(""); setAddRate("0");
    setAddGuestName(""); setAddGuestMobile("");
    toast.success("Room added to block");
    load();
  }

  async function removeBlock(block: EventBlockRecord) {
    if (block.status === "checked_in") return toast.error("Cannot remove a checked-in room");
    if (!confirm(`Remove room ${block.room_number} from this event?`)) return;
    await supabase.from("event_room_blocks").delete().eq("id", block.id);
    if (block.room_id) {
      await supabase.from("rooms").update({ status: "vacant" } as any).eq("id", block.room_id);
    }
    load();
  }

  async function saveBlockGuest(block: EventBlockRecord) {
    const { error } = await supabase.from("event_room_blocks").update({
      guest_name: block.guest_name?.trim() || null,
      guest_mobile: block.guest_mobile?.trim() || null,
    } as any).eq("id", block.id);
    if (error) return toast.error(error.message);
    toast.success("Guest info saved");
    load();
  }

  /** Patch a single block row locally (no reload — keeps inline editing smooth). */
  function patchBlockLocal(index: number, patch: Partial<EventBlockRecord>) {
    setBlocks((prev) => prev.map((x, idx) => (idx === index ? { ...x, ...patch } : x)));
  }

  /** Persist inline stay date/time edits for a row. */
  async function saveBlockStay(block: EventBlockRecord) {
    const ci = block.checkin_date;
    const co = block.checkout_date;
    const cit = (block.checkin_time ?? "12:00").slice(0, 5);
    const cot = (block.checkout_time ?? "11:00").slice(0, 5);
    if (!ci || !co) return toast.error("Check-in and check-out dates are required");
    if (!isValidStayRange(ci, co, cit, cot)) return toast.error("Check-out must be after check-in");
    const { error } = await supabase.from("event_room_blocks").update({
      checkin_date: ci, checkout_date: co, checkin_time: cit, checkout_time: cot,
    } as any).eq("id", block.id);
    if (error) return toast.error(error.message);
    toast.success(`Room ${block.room_number} stay updated`);
  }

  function openAssign(block: EventBlockRecord) {
    setAssignBlock(block);
    setAssignName(block.guest_name ?? "");
    setAssignMobile(block.guest_mobile ?? "");
    setAssignOpen(true);
  }

  async function saveAssign() {
    if (!assignBlock) return;
    if (!assignName.trim() || !assignMobile.trim()) return toast.error("Name and mobile required");
    const { error } = await supabase.from("event_room_blocks").update({
      guest_name: assignName.trim(),
      guest_mobile: assignMobile.trim(),
      status: "blocked",
    } as any).eq("id", assignBlock.id);
    if (error) return toast.error(error.message);
    setAssignOpen(false);
    toast.success("Guest assigned");
    load();
  }

  async function doCheckIn(block: EventBlockRecord) {
    if (!b) return;
    if (!user) return;
    if (!block.guest_name || !block.guest_mobile) {
      return toast.error("Assign guest name and mobile first");
    }
    if (!confirm(`Check in ${block.guest_name} to Room ${block.room_number}?`)) return;
    try {
      await checkInBlock({ propertyId: b.property_id, block, userId: user.id });
      toast.success(`Room ${block.room_number} checked in`);
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Check-in failed");
    }
  }

  async function doCheckOut(block: EventBlockRecord) {
    if (!user) return;
    if (!confirm(`Checkout room ${block.room_number}?`)) return;
    try {
      await checkOutBlock({ block, userId: user.id });
      toast.success("Checked out");
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Checkout failed");
    }
  }

  async function doBulkCheckIn() {
    if (!b || !user) return;
    const today = new Date().toISOString().slice(0, 10);
    const due = dueForCheckIn(blocks, today);
    if (due.length === 0) {
      return toast.error("No rooms due for check-in today (guest name + mobile required).");
    }
    if (!confirm(`Check in ${due.length} room(s) due today?`)) return;
    setBulkBusy(true);
    try {
      const res = await bulkCheckInBlocks({ propertyId: b.property_id, blocks: due, userId: user.id });
      if (res.done > 0) toast.success(`${res.done} room(s) checked in`);
      res.failed.forEach((f) => toast.error(`Room ${f.room ?? "?"}: ${f.message}`));
      load();
    } finally {
      setBulkBusy(false);
    }
  }

  async function setStatus(next: "confirmed" | "in_progress" | "completed") {
    if (!b) return;
    if (next === "completed") {
      const occ = blocks.filter((bl) => bl.status === "checked_in").length;
      if (occ > 0) {
        return toast.error(`${occ} room(s) still occupied. Checkout guests before completing event.`);
      }
    }
    await supabase.from("banquet_bookings").update({ status: next }).eq("id", b.id);
    toast.success(`Marked ${next.replace("_", " ")}`);
    load();
  }

  async function saveHost() {
    if (!b) return;
    if (!host.name.trim()) return toast.error("Name required");
    setSavingHost(true);
    try {
      let guestId = b.guest_id;
      if (guestId) {
        const { error } = await supabase.from("guests").update({
          name: host.name.trim(),
          mobile: host.mobile.trim() || null,
          email: host.email.trim() || null,
        } as any).eq("id", guestId);
        if (error) throw error;
      } else {
        const { data: g, error } = await supabase.from("guests").insert({
          property_id: b.property_id,
          name: host.name.trim(),
          mobile: host.mobile.trim() || null,
          email: host.email.trim() || null,
        } as any).select("id").single();
        if (error) throw error;
        guestId = (g as any).id;
      }
      const { error: be } = await supabase.from("banquet_bookings").update({
        guest_id: guestId,
        function_type: host.function_type || b.function_type,
        notes: host.notes.trim() || null,
      }).eq("id", b.id);
      if (be) throw be;
      toast.success("Host details saved");
      load();
    } catch (e: any) {
      toast.error(e?.message ?? "Save failed");
    } finally {
      setSavingHost(false);
    }
  }

  async function saveMeta() {
    if (!b) return;
    if (!meta.event_date || !meta.start_time || !meta.end_time) return toast.error("Date and time required");
    const endDate = meta.event_end_date || meta.event_date;
    if (!isValidStayRange(meta.event_date, endDate, meta.start_time, meta.end_time))
      return toast.error("Check-out must be after check-in");
    const { error } = await supabase.from("banquet_bookings").update({
      event_name: meta.event_name.trim() || null,
      hall_id: meta.hall_id || null,
      event_date: meta.event_date,
      event_end_date: meta.event_end_date || meta.event_date,
      start_time: meta.start_time,
      end_time: meta.end_time,
      pax: Number(meta.pax) || 0,
      function_type: meta.function_type || b.function_type,
    } as any).eq("id", b.id);
    if (error) return toast.error(error.message);
    setMetaOpen(false);
    toast.success("Event updated");
    load();
  }

  async function cancel() {
    if (!b) return;
    if (!cancelReason.trim()) return toast.error("Reason required");
    await supabase.from("banquet_bookings").update({
      status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_reason: cancelReason,
    }).eq("id", b.id);
    setCancelOpen(false);
    toast.success("Event cancelled");
    load();
  }

  async function patchCharges(patch: Partial<Bq>) {
    if (!b) return;
    const merged = { ...b, ...patch } as Bq;
    // Enforce per-role discount limit on the discount field.
    if (Object.prototype.hasOwnProperty.call(patch, "discount_amount")) {
      const sub =
        Number(merged.package_rate) * Number(merged.pax) +
        Number(merged.hall_charge) + Number(merged.fb_charge) + Number(merged.extra_charge);
      const disc = Number(merged.discount_amount) || 0;
      if (disc > 0 && sub > 0) {
        const chk = canApplyDiscount(discountLimit, { discountRupees: disc, base: sub });
        if (!chk.allowed) {
          toast.error(chk.reason ?? describeLimit(discountLimit));
          setB({ ...b });
          return;
        }
      }
    }
    const total = computeBanquetTotal({
      package_rate: merged.package_rate, pax: merged.pax,
      hall_charge: merged.hall_charge, fb_charge: merged.fb_charge,
      extra_charge: merged.extra_charge, discount_amount: merged.discount_amount,
    });
    const balance = Math.max(0, total - Number(merged.advance_amount));
    const dbPatch: any = { ...patch, total_amount: total, balance_amount: balance };
    delete dbPatch.guests;
    delete dbPatch.halls;
    await supabase.from("banquet_bookings").update(dbPatch).eq("id", b.id);
    setB({ ...merged, total_amount: total, balance_amount: balance });
  }

  if (loading) return <AppShell title="Banquet"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!b) return <AppShell title="Banquet"><p className="text-sm text-muted-foreground">Not found.</p></AppShell>;

  const editable = b.status === "reserved" || b.status === "confirmed" || b.status === "in_progress";

  return (
    <AppShell title={`Banquet ${b.banquet_number}`}>
      <div className="max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.history.back()}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          <Badge variant="outline" className={BANQUET_STATUS_TONE[b.status]}>{b.status.toUpperCase()}</Badge>
          <div className="text-sm text-muted-foreground">
            {b.event_name ? <span className="font-medium text-foreground mr-1">{b.event_name} ·</span> : null}
            {b.halls?.name ?? "—"} · {b.event_date} {b.start_time?.slice(0,5)} → {b.event_end_date && b.event_end_date !== b.event_date ? `${b.event_end_date} ` : ""}{b.end_time?.slice(0,5)} · {b.pax} pax
          </div>
          {editable && (
            <Button size="sm" variant="ghost" onClick={() => setMetaOpen(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Event Details
            </Button>
          )}
          <div className="flex-1" />
          <Button
            size="sm"
            variant="outline"
            onClick={() => router.navigate({ to: "/banquet/bill/$id", params: { id: b.id } })}
          >
            <FileText className="h-4 w-4 mr-1" /> View / Print Event Bill
          </Button>
          {b.status !== "cancelled" && b.status !== "completed" && (
            <div className="flex gap-2">
              {b.status === "reserved" && <Button size="sm" onClick={() => setStatus("confirmed")}>Confirm</Button>}
              {b.status === "confirmed" && <Button size="sm" onClick={() => setStatus("in_progress")}>Start Event</Button>}
              {b.status === "in_progress" && <Button size="sm" onClick={() => setStatus("completed")}><CheckCircle2 className="h-4 w-4 mr-1" /> Complete Event</Button>}
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}><Ban className="h-4 w-4 mr-1" /> Cancel</Button>
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Host</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-1.5"><Label className="text-xs">Name *</Label>
                  <Input value={host.name} disabled={!editable} onChange={(e) => setHost({ ...host, name: e.target.value })} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Mobile</Label>
                  <Input type="tel" maxLength={15} value={host.mobile} disabled={!editable} onChange={(e) => setHost({ ...host, mobile: e.target.value.replace(/[^\d+\-\s]/g, "") })} /></div>
                <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Email</Label>
                  <Input type="email" value={host.email} disabled={!editable} onChange={(e) => setHost({ ...host, email: e.target.value })} /></div>
                <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Function</Label>
                  <Select value={host.function_type} onValueChange={(v) => setHost({ ...host, function_type: v })} disabled={!editable}>
                    <SelectTrigger><SelectValue placeholder="Select function" /></SelectTrigger>
                    <SelectContent>
                      {FUNCTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Notes</Label>
                  <Textarea rows={2} value={host.notes} disabled={!editable} onChange={(e) => setHost({ ...host, notes: e.target.value })} /></div>
              </div>
              {editable && (
                <div className="pt-1">
                  <Button size="sm" onClick={saveHost} disabled={savingHost}><Save className="h-3.5 w-3.5 mr-1" /> Save Host Details</Button>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Charges</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2">
              <NumField label="Package / pax" value={b.package_rate} onSave={(v) => patchCharges({ package_rate: v })} disabled={!editable} />
              <NumField label="Pax" value={b.pax} onSave={(v) => patchCharges({ pax: v })} disabled={!editable} />
              <NumField label="Hall" value={b.hall_charge} onSave={(v) => patchCharges({ hall_charge: v })} disabled={!editable} />
              <NumField label="F&B" value={b.fb_charge} onSave={(v) => patchCharges({ fb_charge: v })} disabled={!editable} />
              <NumField label="Extra" value={b.extra_charge} onSave={(v) => patchCharges({ extra_charge: v })} disabled={!editable} />
              <div className="space-y-1.5">
                <Label className="text-xs">Extra description</Label>
                <Input value={b.extra_charge_description ?? ""} disabled={!editable}
                  onChange={(e) => setB({ ...b, extra_charge_description: e.target.value })}
                  onBlur={(e) => patchCharges({ extra_charge_description: e.target.value || null } as any)} />
              </div>
              <NumField label="Discount" value={b.discount_amount} onSave={(v) => patchCharges({ discount_amount: v })} disabled={!editable} />
              <NumField label="Advance" value={b.advance_amount} onSave={(v) => patchCharges({ advance_amount: v })} disabled={!editable} />
              <div className="space-y-1.5">
                <Label className="text-xs">Advance mode</Label>
                <Select value={b.advance_payment_mode ?? ""} disabled={!editable}
                  onValueChange={(v) => patchCharges({ advance_payment_mode: v } as any)}>
                  <SelectTrigger><SelectValue placeholder="Mode" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="upi">UPI</SelectItem>
                    <SelectItem value="bank">Bank Transfer</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5 sm:col-span-2 border-t pt-2 text-sm">
                <Row k="Total" v={`₹${Number(b.total_amount).toLocaleString("en-IN")}`} bold />
                <Row k="Balance" v={`₹${Number(b.balance_amount).toLocaleString("en-IN")}`} bold highlight={Number(b.balance_amount) > 0} />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><BedDouble className="h-4 w-4" /> Rooms · Assign Guest</CardTitle>
            <div className="flex gap-2">
              {editable && blocks.some((bk) => bk.status === "blocked") && (
                <Button size="sm" variant="outline" onClick={doBulkCheckIn} disabled={bulkBusy}>
                  <LogIn className="h-4 w-4 mr-1" /> {bulkBusy ? "Checking in…" : "Bulk Check-In"}
                </Button>
              )}
              {blocks.some((bk) => bk.status === "checked_out") && (
                <Button size="sm" variant="outline" onClick={() => router.navigate({ to: "/banquet/master-bill/$id", params: { id: b.id } })}>
                  <FileText className="h-4 w-4 mr-1" /> Master Bill
                </Button>
              )}
              {editable && <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> Assign Guest / Block Room</Button>}
            </div>
          </CardHeader>
          <CardContent>
            {blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rooms linked to this event.</p>
            ) : (
              <div className="space-y-2">
                <div className="grid grid-cols-[70px_100px_minmax(230px,1.2fr)_1fr_130px_110px_220px] gap-2 text-xs uppercase text-muted-foreground border-b pb-1">
                  <div>Room</div><div>Category</div><div>Stay (date · time)</div><div>Guest name</div><div>Mobile</div><div>Status</div><div>Actions</div>
                </div>
                {blocks.map((blk, i) => {
                  const isBlocked = blk.status === "blocked";
                  const hasGuest = !!(blk.guest_name && blk.guest_mobile);
                  return (
                  <div key={blk.id} className="grid grid-cols-[70px_100px_minmax(230px,1.2fr)_1fr_130px_110px_220px] gap-2 items-center text-sm">
                    <div className="font-semibold">{blk.room_number}</div>
                    <div className="text-xs text-muted-foreground">{blk.room_category ?? "—"}</div>
                    <div className="space-y-1">
                      <div className="flex items-center gap-1">
                        <span className="w-6 shrink-0 text-[10px] uppercase text-muted-foreground">In</span>
                        <Input type="date" className="h-8 w-[130px] px-1 text-xs" disabled={!isBlocked}
                          value={blk.checkin_date ?? ""}
                          onChange={(e) => patchBlockLocal(i, { checkin_date: e.target.value })}
                          onBlur={() => isBlocked && saveBlockStay(blocks[i])} />
                        <Input type="time" className="h-8 w-[92px] px-1 text-xs" disabled={!isBlocked}
                          value={(blk.checkin_time ?? "12:00").slice(0, 5)}
                          onChange={(e) => patchBlockLocal(i, { checkin_time: e.target.value })}
                          onBlur={() => isBlocked && saveBlockStay(blocks[i])} />
                      </div>
                      <div className="flex items-center gap-1">
                        <span className="w-6 shrink-0 text-[10px] uppercase text-muted-foreground">Out</span>
                        <Input type="date" className="h-8 w-[130px] px-1 text-xs" disabled={!isBlocked}
                          min={blk.checkin_date ?? undefined}
                          value={blk.checkout_date ?? ""}
                          onChange={(e) => patchBlockLocal(i, { checkout_date: e.target.value })}
                          onBlur={() => isBlocked && saveBlockStay(blocks[i])} />
                        <Input type="time" className="h-8 w-[92px] px-1 text-xs" disabled={!isBlocked}
                          value={(blk.checkout_time ?? "11:00").slice(0, 5)}
                          onChange={(e) => patchBlockLocal(i, { checkout_time: e.target.value })}
                          onBlur={() => isBlocked && saveBlockStay(blocks[i])} />
                      </div>
                    </div>
                    <GuestSearchInput
                      propertyId={b.property_id}
                      value={blk.guest_name ?? ""}
                      mobile={blk.guest_mobile ?? ""}
                      disabled={!isBlocked}
                      placeholder="Unassigned"
                      className="h-8 text-xs"
                      onChange={(name) => patchBlockLocal(i, { guest_name: name })}
                      onSelect={(g) => {
                        const next = { ...blocks[i], guest_name: g.name, guest_mobile: g.mobile ?? blocks[i].guest_mobile };
                        patchBlockLocal(i, { guest_name: next.guest_name, guest_mobile: next.guest_mobile });
                        saveBlockGuest(next);
                      }}
                      onCommit={() => isBlocked && saveBlockGuest(blocks[i])}
                    />
                    <Input value={blk.guest_mobile ?? ""} disabled={!isBlocked}
                      className="h-8 text-xs" inputMode="numeric" maxLength={10} placeholder="10-digit"
                      onChange={(e) => patchBlockLocal(i, { guest_mobile: sanitizeMobile(e.target.value) })}
                      onBlur={() => isBlocked && saveBlockGuest(blocks[i])} />
                    <Badge variant="outline" className={
                      blk.status === "checked_in" ? "bg-blue-100 text-blue-800" :
                      blk.status === "checked_out" ? "bg-emerald-100 text-emerald-800" :
                      blk.status === "cancelled" ? "bg-rose-100 text-rose-800" :
                      "bg-purple-100 text-purple-800"
                    }>{
                      blk.status === "blocked"
                        ? (blk.guest_name ? "assigned" : "unassigned")
                        : blk.status.replace("_", " ")
                    }</Badge>
                    <div className="flex flex-wrap gap-1">
                      {isBlocked && !hasGuest && (
                        <Button size="sm" variant="outline" onClick={() => openAssign(blk)}><UserPlus className="h-3.5 w-3.5 mr-1" />Assign</Button>
                      )}
                      {isBlocked && hasGuest && (
                        <Button size="sm" onClick={() => doCheckIn(blk)}><LogIn className="h-3.5 w-3.5 mr-1" />Check In</Button>
                      )}
                      {blk.status === "checked_in" && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => blk.booking_id && router.navigate({ to: "/front-desk/booking/$id", params: { id: blk.booking_id } })}>
                            <Eye className="h-3.5 w-3.5 mr-1" />Booking
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => doCheckOut(blk)}><LogOut className="h-3.5 w-3.5 mr-1" />Checkout</Button>
                        </>
                      )}
                      {blk.status === "checked_out" && blk.booking_id && (
                        <Button size="sm" variant="outline" onClick={() => router.navigate({ to: "/billing/folio/$bookingId", params: { bookingId: blk.booking_id! } })}>
                          <FileText className="h-3.5 w-3.5 mr-1" />Bill
                        </Button>
                      )}
                      {isBlocked && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeBlock(blk)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Assign guest / block room</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Specific room (optional)</Label>
                <Select value={addRoomId} onValueChange={(v) => { setAddRoomId(v); setAddCatId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Pick room" /></SelectTrigger>
                  <SelectContent>
                    {rooms.map((r) => <SelectItem key={r.id} value={r.id}>{r.room_number}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">…or category (auto-pick first vacant)</Label>
                <Select value={addCatId} onValueChange={(v) => { setAddCatId(v); setAddRoomId(""); }}>
                  <SelectTrigger><SelectValue placeholder="Pick category" /></SelectTrigger>
                  <SelectContent>
                    {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label className="text-xs">Check-in</Label><Input type="date" value={addCheckIn} onChange={(e) => setAddCheckIn(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Check-out</Label><Input type="date" value={addCheckOut} onChange={(e) => setAddCheckOut(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Rate / night</Label><Input type="number" value={addRate} onChange={(e) => setAddRate(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Guest name (optional)</Label><Input value={addGuestName} onChange={(e) => setAddGuestName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Guest mobile (optional)</Label><Input value={addGuestMobile} onChange={(e) => setAddGuestMobile(e.target.value)} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={addRoomBlock}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={metaOpen} onOpenChange={setMetaOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit event details</DialogTitle></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Event name</Label>
                <Input value={meta.event_name} onChange={(e) => setMeta({ ...meta, event_name: e.target.value })} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Hall</Label>
                <Select value={meta.hall_id} onValueChange={(v) => setMeta({ ...meta, hall_id: v })}>
                  <SelectTrigger><SelectValue placeholder="Pick hall" /></SelectTrigger>
                  <SelectContent>
                    {halls.map((h) => <SelectItem key={h.id} value={h.id}>{h.name} ({h.capacity} pax)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label className="text-xs">Check-in date</Label>
                <Input type="date" value={meta.event_date} onChange={(e) => {
                  const v = e.target.value;
                  setMeta((m) => ({ ...m, event_date: v, event_end_date: !m.event_end_date || m.event_end_date < v ? v : m.event_end_date }));
                }} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Check-out date</Label>
                <Input type="date" min={meta.event_date} value={meta.event_end_date} onChange={(e) => setMeta({ ...meta, event_end_date: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Pax</Label>
                <Input type="number" value={meta.pax} onChange={(e) => setMeta({ ...meta, pax: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Check-in time</Label>
                <Input type="time" value={meta.start_time} onChange={(e) => setMeta({ ...meta, start_time: e.target.value })} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Check-out time</Label>
                <Input type="time" value={meta.end_time} onChange={(e) => setMeta({ ...meta, end_time: e.target.value })} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Function type</Label>
                <Select value={meta.function_type} onValueChange={(v) => setMeta({ ...meta, function_type: v })}>
                  <SelectTrigger><SelectValue placeholder="Function" /></SelectTrigger>
                  <SelectContent>
                    {FUNCTION_TYPES.map((t) => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setMetaOpen(false)}>Cancel</Button>
              <Button onClick={saveMeta}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={assignOpen} onOpenChange={setAssignOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Assign guest to room {assignBlock?.room_number}</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5"><Label className="text-xs">Guest name *</Label>
                <Input value={assignName} onChange={(e) => setAssignName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Mobile *</Label>
                <Input type="tel" value={assignMobile} onChange={(e) => setAssignMobile(e.target.value.replace(/[^\d+\-\s]/g, ""))} /></div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAssignOpen(false)}>Cancel</Button>
              <Button onClick={saveAssign}>Save</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={cancelOpen} onOpenChange={setCancelOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Cancel event</DialogTitle></DialogHeader>
            <div className="space-y-1.5"><Label className="text-xs">Reason</Label>
              <Textarea rows={3} value={cancelReason} onChange={(e) => setCancelReason(e.target.value)} /></div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setCancelOpen(false)}>Keep</Button>
              <Button variant="destructive" onClick={cancel}>Cancel event</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </div>
    </AppShell>
  );
}

function Row({ k, v, bold, highlight }: { k: string; v: React.ReactNode; bold?: boolean; highlight?: boolean }) {
  return (
    <div className={`flex justify-between ${bold ? "font-semibold" : ""} ${highlight ? "text-amber-700" : ""}`}>
      <span className={bold ? "" : "text-muted-foreground"}>{k}</span><span>{v}</span>
    </div>
  );
}

function NumField({ label, value, onSave, disabled }: { label: string; value: number; onSave: (v: number) => void; disabled?: boolean }) {
  const [v, setV] = useState(String(value ?? 0));
  useEffect(() => { setV(String(value ?? 0)); }, [value]);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      <Input type="number" value={v} disabled={disabled}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { const n = Number(v) || 0; if (n !== Number(value)) onSave(n); }} />
    </div>
  );
}