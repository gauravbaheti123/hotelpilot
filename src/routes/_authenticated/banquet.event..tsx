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
import { BANQUET_STATUS_TONE, FUNCTION_TYPES, computeBanquetTotal } from "@/lib/banquet";
import { ArrowLeft, BedDouble, Trash2, CheckCircle2, Ban, Plus, FileText, Pencil } from "lucide-react";
import type { EventBlockRecord } from "@/lib/eventRoomBlocks";

export const Route = createFileRoute("/_authenticated/banquet/event/$id")({
  head: () => ({ meta: [{ title: "Banquet Event — HotelPilot" }] }),
  component: BanquetEventPage,
});

interface Bq {
  id: string; property_id: string; banquet_number: string; function_type: string;
  event_date: string; start_time: string; end_time: string; pax: number;
  event_name: string | null; hall_id: string | null;
  package_rate: number; hall_charge: number; fb_charge: number; extra_charge: number;
  discount_amount: number; total_amount: number; advance_amount: number; balance_amount: number;
  status: string; notes: string | null;
  halls: { id: string; name: string; capacity: number } | null;
  guests: { id: string; name: string; mobile: string | null; email: string | null } | null;
}
interface Room { id: string; room_number: string; category_id: string | null; status: string }
interface Cat { id: string; name: string }
interface Hall { id: string; name: string; capacity: number }

function BanquetEventPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  void useAuth;
  const [b, setB] = useState<Bq | null>(null);
  const [blocks, setBlocks] = useState<EventBlockRecord[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [halls, setHalls] = useState<Hall[]>([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [addRoomId, setAddRoomId] = useState("");
  const [addRate, setAddRate] = useState("0");
  const [addCheckIn, setAddCheckIn] = useState("");
  const [addCheckOut, setAddCheckOut] = useState("");
  const [addGuestName, setAddGuestName] = useState("");
  const [addGuestMobile, setAddGuestMobile] = useState("");

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  // Host edit
  const [hostName, setHostName] = useState("");
  const [hostMobile, setHostMobile] = useState("");
  const [hostEmail, setHostEmail] = useState("");
  const [notesDraft, setNotesDraft] = useState("");

  // Meta edit
  const [editMetaOpen, setEditMetaOpen] = useState(false);
  const [mEventName, setMEventName] = useState("");
  const [mEventDate, setMEventDate] = useState("");
  const [mStart, setMStart] = useState("");
  const [mEnd, setMEnd] = useState("");
  const [mHallId, setMHallId] = useState("");
  const [mPax, setMPax] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("banquet_bookings").select(`
      id,property_id,banquet_number,function_type,event_date,start_time,end_time,pax,event_name,hall_id,
      package_rate,hall_charge,fb_charge,extra_charge,discount_amount,total_amount,
      advance_amount,balance_amount,status,notes,
      halls(id,name,capacity),guests(id,name,mobile,email)
    `).eq("id", id).single();
    if (error) { toast.error(error.message); setLoading(false); return; }
    const bq = data as unknown as Bq;
    setB(bq);
    setHostName(bq.guests?.name ?? "");
    setHostMobile(bq.guests?.mobile ?? "");
    setHostEmail(bq.guests?.email ?? "");
    setNotesDraft(bq.notes ?? "");
    setMEventName(bq.event_name ?? "");
    setMEventDate(bq.event_date);
    setMStart(bq.start_time?.slice(0, 5) ?? "");
    setMEnd(bq.end_time?.slice(0, 5) ?? "");
    setMHallId(bq.hall_id ?? "");
    setMPax(bq.pax);
    setAddCheckIn(bq.event_date);
    const nextDay = new Date(bq.event_date); nextDay.setDate(nextDay.getDate() + 1);
    setAddCheckOut(nextDay.toISOString().slice(0, 10));

    const [{ data: rs }, { data: cs }, { data: hs }] = await Promise.all([
      supabase.from("rooms").select("id,room_number,category_id,status")
        .eq("property_id", bq.property_id).order("room_number"),
      supabase.from("room_categories").select("id,name")
        .eq("property_id", bq.property_id).order("name"),
      supabase.from("halls").select("id,name,capacity").eq("property_id", bq.property_id).order("name"),
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

  async function addBlockRoom() {
    if (!b) return;
    if (!addRoomId) return toast.error("Pick a room");
    if (!addCheckIn || !addCheckOut) return toast.error("Dates required");
    const r = rooms.find((x) => x.id === addRoomId);
    if (!r) return toast.error("Room not found");
    const cat = cats.find((c) => c.id === r.category_id);
    const { error } = await supabase.from("event_room_blocks").insert({
      property_id: b.property_id,
      banquet_booking_id: b.id,
      event_name: b.event_name ?? b.banquet_number,
      room_id: r.id,
      room_number: r.room_number,
      room_category: cat?.name ?? "",
      guest_name: addGuestName.trim() || null,
      guest_mobile: addGuestMobile.trim() || null,
      checkin_date: addCheckIn,
      checkout_date: addCheckOut,
      special_rate: Number(addRate) || null,
      status: "blocked",
    } as any);
    if (error) return toast.error(error.message);
    await supabase.from("rooms").update({ status: "blocked" } as any).eq("id", r.id);
    setAddOpen(false);
    setAddRoomId(""); setAddRate("0"); setAddGuestName(""); setAddGuestMobile("");
    toast.success("Room added to event");
    load();
  }

  async function removeBlock(blk: EventBlockRecord) {
    if (blk.status !== "blocked") return toast.error("Cannot remove a checked-in room");
    if (!confirm(`Remove Room ${blk.room_number} from this event?`)) return;
    await supabase.from("event_room_blocks").delete().eq("id", blk.id);
    if (blk.room_id) await supabase.from("rooms").update({ status: "vacant" } as any).eq("id", blk.room_id);
    load();
  }

  function goAssign(blk: EventBlockRecord) {
    router.navigate({
      to: "/front-desk/new",
      search: {
        roomId: blk.room_id ?? undefined,
        eventId: id,
        blockId: blk.id,
        eventName: blk.event_name,
        checkIn: blk.checkin_date,
        checkOut: blk.checkout_date,
      } as any,
    });
  }

  async function setStatus(next: "confirmed" | "in_progress" | "completed") {
    if (!b) return;
    if (next === "completed") {
      const stillOpen = blocks.filter((x) => x.status === "checked_in");
      if (stillOpen.length > 0) {
        return toast.error(`${stillOpen.length} room(s) still occupied. Checkout first.`);
      }
    }
    await supabase.from("banquet_bookings").update({ status: next }).eq("id", b.id);
    toast.success(`Marked ${next.replace("_", " ")}`);
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

  async function saveHost() {
    if (!b?.guests?.id) return toast.error("No host attached");
    const { error } = await supabase.from("guests").update({
      name: hostName.trim(), mobile: hostMobile.trim() || null, email: hostEmail.trim() || null,
    } as any).eq("id", b.guests.id);
    if (error) return toast.error(error.message);
    toast.success("Host updated");
    load();
  }

  async function saveNotes() {
    if (!b) return;
    if ((notesDraft || null) === (b.notes ?? null)) return;
    await supabase.from("banquet_bookings").update({ notes: notesDraft || null }).eq("id", b.id);
    toast.success("Notes saved");
    setB({ ...b, notes: notesDraft || null });
  }

  async function saveMeta() {
    if (!b) return;
    const { error } = await supabase.from("banquet_bookings").update({
      event_name: mEventName.trim() || null,
      event_date: mEventDate,
      start_time: mStart || null,
      end_time: mEnd || null,
      hall_id: mHallId || null,
      pax: Number(mPax) || 0,
    } as any).eq("id", b.id);
    if (error) return toast.error(error.message);
    setEditMetaOpen(false);
    toast.success("Event updated");
    load();
  }

  if (loading) return <AppShell title="Banquet"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!b) return <AppShell title="Banquet"><p className="text-sm text-muted-foreground">Not found.</p></AppShell>;

  const editable = b.status === "reserved" || b.status === "confirmed" || b.status === "in_progress";

  return (
    <AppShell title={`Banquet ${b.banquet_number}`}>
      <div className="max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.history.back()}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          <Badge variant="outline" className={BANQUET_STATUS_TONE[b.status]}>{b.status.toUpperCase().replace("_", " ")}</Badge>
          <div className="text-sm text-muted-foreground">
            {b.event_name ? `${b.event_name} · ` : ""}{b.halls?.name ?? "—"} · {b.event_date} · {b.start_time?.slice(0, 5)}–{b.end_time?.slice(0, 5)} · {b.pax} pax
          </div>
          {editable && (
            <Button size="sm" variant="outline" onClick={() => setEditMetaOpen(true)}>
              <Pencil className="h-3.5 w-3.5 mr-1" /> Edit Event
            </Button>
          )}
          <div className="flex-1" />
          <Button size="sm" variant="outline"
            onClick={() => router.navigate({ to: "/banquet/bill/$id", params: { id: b.id } })}>
            <FileText className="h-4 w-4 mr-1" /> View / Print Event Bill
          </Button>
          {editable && (
            <div className="flex gap-2">
              {b.status === "reserved" && <Button size="sm" onClick={() => setStatus("confirmed")}>Confirm</Button>}
              {b.status === "confirmed" && <Button size="sm" onClick={() => setStatus("in_progress")}>Start Event</Button>}
              {b.status === "in_progress" && <Button size="sm" onClick={() => setStatus("completed")}><CheckCircle2 className="h-4 w-4 mr-1" /> Complete</Button>}
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}><Ban className="h-4 w-4 mr-1" /> Cancel</Button>
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Host</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-2 text-sm">
              <div className="space-y-1.5"><Label className="text-xs">Name</Label><Input value={hostName} disabled={!editable || !b.guests?.id} onChange={(e) => setHostName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Mobile</Label><Input value={hostMobile} disabled={!editable || !b.guests?.id} maxLength={10} onChange={(e) => setHostMobile(e.target.value.replace(/\D/g, ""))} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Email</Label><Input type="email" value={hostEmail} disabled={!editable || !b.guests?.id} onChange={(e) => setHostEmail(e.target.value)} /></div>
              <div className="space-y-1.5">
                <Label className="text-xs">Function Type</Label>
                <Select value={b.function_type} disabled={!editable} onValueChange={(v) => patchCharges({ function_type: v } as any)}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {FUNCTION_TYPES.map((f) => <SelectItem key={f} value={f}>{f}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 flex justify-end">
                {editable && b.guests?.id && <Button size="sm" onClick={saveHost}>Save host</Button>}
              </div>
              <div className="sm:col-span-2 space-y-1.5">
                <Label className="text-xs">Notes</Label>
                <Textarea rows={2} value={notesDraft} disabled={!editable}
                  onChange={(e) => setNotesDraft(e.target.value)} onBlur={saveNotes} />
              </div>
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
              <NumField label="Discount" value={b.discount_amount} onSave={(v) => patchCharges({ discount_amount: v })} disabled={!editable} />
              <NumField label="Advance" value={b.advance_amount} onSave={(v) => patchCharges({ advance_amount: v })} disabled={!editable} />
              <div className="space-y-1.5 sm:col-span-2 border-t pt-2 text-sm">
                <Row k="Total" v={`₹${Number(b.total_amount).toLocaleString("en-IN")}`} bold />
                <Row k="Balance" v={`₹${Number(b.balance_amount).toLocaleString("en-IN")}`} bold highlight={Number(b.balance_amount) > 0} />
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle className="text-base flex items-center gap-2"><BedDouble className="h-4 w-4" /> Rooms ({blocks.length})</CardTitle>
            {editable && <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add room</Button>}
          </CardHeader>
          <CardContent>
            {blocks.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rooms linked to this event yet.</p>
            ) : (
              <div className="divide-y text-sm">
                <div className="grid grid-cols-[70px_1fr_1.2fr_1.2fr_110px_1.4fr] gap-2 text-xs uppercase text-muted-foreground pb-1">
                  <div>Room</div><div>Category</div><div>Stay</div><div>Guest</div><div>Status</div><div className="text-right">Actions</div>
                </div>
                {blocks.map((blk) => (
                  <div key={blk.id} className="grid grid-cols-[70px_1fr_1.2fr_1.2fr_110px_1.4fr] gap-2 items-center py-2">
                    <div className="font-semibold">{blk.room_number}</div>
                    <div className="text-xs text-muted-foreground">{blk.room_category}</div>
                    <div className="text-xs text-muted-foreground">{blk.checkin_date}<br />→ {blk.checkout_date}</div>
                    <div className="text-xs">
                      <div className="font-medium truncate">{blk.guest_name ?? <span className="italic text-muted-foreground">Unassigned</span>}</div>
                      <div className="text-muted-foreground">{blk.guest_mobile ?? ""}</div>
                    </div>
                    <Badge variant="outline" className={
                      blk.status === "checked_in" ? "bg-blue-100 text-blue-800" :
                        blk.status === "checked_out" ? "bg-emerald-100 text-emerald-800" :
                          "bg-purple-100 text-purple-800"
                    }>{blk.status.replace("_", " ")}</Badge>
                    <div className="flex flex-wrap justify-end gap-1">
                      {blk.status === "blocked" && !blk.guest_name && (
                        <Button size="sm" onClick={() => goAssign(blk)}>Assign Guest</Button>
                      )}
                      {blk.status === "blocked" && blk.guest_name && (
                        <Button size="sm" onClick={() => goAssign(blk)}>Check In</Button>
                      )}
                      {blk.status === "checked_in" && blk.booking_id && (
                        <>
                          <Button size="sm" variant="outline" onClick={() => router.navigate({ to: "/front-desk/booking/$id", params: { id: blk.booking_id! } })}>View</Button>
                          <Button size="sm" variant="outline" onClick={() => router.navigate({ to: "/front-desk/booking/$id", params: { id: blk.booking_id! } })}>Checkout</Button>
                        </>
                      )}
                      {blk.status === "checked_out" && blk.booking_id && (
                        <Button size="sm" variant="outline" onClick={() => router.navigate({ to: "/billing/folio/$bookingId", params: { bookingId: blk.booking_id! } })}>View Bill</Button>
                      )}
                      {blk.status === "blocked" && editable && (
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeBlock(blk)}>
                          <Trash2 className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add room to event</DialogTitle></DialogHeader>
            <div className="space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs">Room</Label>
                <Select value={addRoomId} onValueChange={setAddRoomId}>
                  <SelectTrigger><SelectValue placeholder="Pick a vacant room" /></SelectTrigger>
                  <SelectContent>
                    {rooms.filter((r) => r.status === "vacant").map((r) => (
                      <SelectItem key={r.id} value={r.id}>Room {r.room_number}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1.5"><Label className="text-xs">Check-in</Label><Input type="date" value={addCheckIn} onChange={(e) => setAddCheckIn(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Check-out</Label><Input type="date" value={addCheckOut} onChange={(e) => setAddCheckOut(e.target.value)} /></div>
                <div className="space-y-1.5 col-span-2"><Label className="text-xs">Rate / night</Label><Input type="number" value={addRate} onChange={(e) => setAddRate(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Guest name (optional)</Label><Input value={addGuestName} onChange={(e) => setAddGuestName(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Guest mobile (optional)</Label><Input value={addGuestMobile} maxLength={10} onChange={(e) => setAddGuestMobile(e.target.value.replace(/\D/g, ""))} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={addBlockRoom}>Add</Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>

        <Dialog open={editMetaOpen} onOpenChange={setEditMetaOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Edit event</DialogTitle></DialogHeader>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5 sm:col-span-2"><Label className="text-xs">Event name</Label><Input value={mEventName} onChange={(e) => setMEventName(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Event date</Label><Input type="date" value={mEventDate} onChange={(e) => setMEventDate(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Expected pax</Label><Input type="number" value={mPax} onChange={(e) => setMPax(Number(e.target.value) || 0)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">Start</Label><Input type="time" value={mStart} onChange={(e) => setMStart(e.target.value)} /></div>
              <div className="space-y-1.5"><Label className="text-xs">End</Label><Input type="time" value={mEnd} onChange={(e) => setMEnd(e.target.value)} /></div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label className="text-xs">Hall</Label>
                <Select value={mHallId} onValueChange={setMHallId}>
                  <SelectTrigger><SelectValue placeholder="Pick a hall" /></SelectTrigger>
                  <SelectContent>
                    {halls.map((h) => <SelectItem key={h.id} value={h.id}>{h.name} ({h.capacity} pax)</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setEditMetaOpen(false)}>Cancel</Button>
              <Button onClick={saveMeta}>Save</Button>
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
