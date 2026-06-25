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
import { BANQUET_STATUS_TONE, computeBanquetTotal } from "@/lib/banquet";
import { ArrowLeft, BedDouble, Trash2, CheckCircle2, Ban, Plus } from "lucide-react";
import type { EventBlockRecord } from "@/lib/eventRoomBlocks";

export const Route = createFileRoute("/_authenticated/banquet/event/$id")({
  head: () => ({ meta: [{ title: "Banquet Event — HotelPilot" }] }),
  component: BanquetEventPage,
});

interface Bq {
  id: string; property_id: string; banquet_number: string; function_type: string;
  event_date: string; start_time: string; end_time: string; pax: number;
  package_rate: number; hall_charge: number; fb_charge: number; extra_charge: number;
  discount_amount: number; total_amount: number; advance_amount: number; balance_amount: number;
  status: string; notes: string | null;
  halls: { id: string; name: string; capacity: number } | null;
  guests: { id: string; name: string; mobile: string | null; email: string | null } | null;
}
interface Bulk {
  id: string; room_id: string | null; category_id: string | null;
  rate: number; nights: number; check_in: string; check_out: string;
  rooms: { room_number: string } | null;
  room_categories: { name: string } | null;
}
interface Room { id: string; room_number: string; category_id: string | null; status: string }
interface Cat { id: string; name: string }

function BanquetEventPage() {
  const { id } = Route.useParams();
  const router = useRouter();
  const { user } = useAuth();
  const [b, setB] = useState<Bq | null>(null);
  const [bulk, setBulk] = useState<Bulk[]>([]);
  const [blocks, setBlocks] = useState<EventBlockRecord[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [loading, setLoading] = useState(true);

  const [addOpen, setAddOpen] = useState(false);
  const [addRoomId, setAddRoomId] = useState("");
  const [addCatId, setAddCatId] = useState("");
  const [addRate, setAddRate] = useState("0");
  const [addNights, setAddNights] = useState("1");
  const [addCheckIn, setAddCheckIn] = useState("");
  const [addCheckOut, setAddCheckOut] = useState("");

  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelReason, setCancelReason] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.from("banquet_bookings").select(`
      id,property_id,banquet_number,function_type,event_date,start_time,end_time,pax,
      package_rate,hall_charge,fb_charge,extra_charge,discount_amount,total_amount,
      advance_amount,balance_amount,status,notes,
      halls(id,name,capacity),guests(id,name,mobile,email)
    `).eq("id", id).single();
    if (error) { toast.error(error.message); setLoading(false); return; }
    const bq = data as unknown as Bq;
    setB(bq);
    setAddCheckIn(bq.event_date);
    const nextDay = new Date(bq.event_date); nextDay.setDate(nextDay.getDate() + 1);
    setAddCheckOut(nextDay.toISOString().slice(0, 10));

    const [{ data: br }, { data: rs }, { data: cs }] = await Promise.all([
      supabase.from("banquet_bulk_rooms")
        .select("id,room_id,category_id,rate,nights,check_in,check_out,rooms(room_number),room_categories(name)")
        .eq("banquet_id", id),
      supabase.from("rooms").select("id,room_number,category_id,status")
        .eq("property_id", bq.property_id).order("room_number"),
      supabase.from("room_categories").select("id,name")
        .eq("property_id", bq.property_id).order("name"),
    ]);
    setBulk(((br ?? []) as unknown) as Bulk[]);
    setRooms((rs ?? []) as Room[]);
    setCats((cs ?? []) as Cat[]);
    const { data: erb } = await supabase.from("event_room_blocks")
      .select("*").eq("banquet_booking_id", id).order("room_number");
    setBlocks((erb ?? []) as unknown as EventBlockRecord[]);
    setLoading(false);
  }, [id]);

  useEffect(() => { load(); }, [load]);

  async function addBulkRoom() {
    if (!b) return;
    if (!addRoomId && !addCatId) return toast.error("Pick a room or category");
    if (!addCheckIn || !addCheckOut) return toast.error("Dates required");
    const { error } = await supabase.from("banquet_bulk_rooms").insert({
      banquet_id: b.id,
      room_id: addRoomId || null,
      category_id: addCatId || null,
      rate: Number(addRate) || 0,
      nights: Number(addNights) || 1,
      check_in: addCheckIn,
      check_out: addCheckOut,
    } as any);
    if (error) return toast.error(error.message);
    setAddOpen(false);
    setAddRoomId(""); setAddCatId(""); setAddRate("0"); setAddNights("1");
    toast.success("Room added to block");
    load();
  }

  async function removeBulk(rowId: string) {
    if (!confirm("Remove this room from block?")) return;
    await supabase.from("banquet_bulk_rooms").delete().eq("id", rowId);
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

  async function setStatus(next: "confirmed" | "completed") {
    if (!b) return;
    await supabase.from("banquet_bookings").update({ status: next }).eq("id", b.id);
    toast.success(`Marked ${next}`);
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

  if (loading) return <AppShell title="Banquet"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!b) return <AppShell title="Banquet"><p className="text-sm text-muted-foreground">Not found.</p></AppShell>;

  const editable = b.status === "reserved" || b.status === "confirmed";

  return (
    <AppShell title={`Banquet ${b.banquet_number}`}>
      <div className="max-w-6xl space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <Button variant="outline" size="sm" onClick={() => router.history.back()}><ArrowLeft className="h-4 w-4 mr-1" /> Back</Button>
          <Badge variant="outline" className={BANQUET_STATUS_TONE[b.status]}>{b.status.toUpperCase()}</Badge>
          <div className="text-sm text-muted-foreground">
            {b.halls?.name ?? "—"} · {b.event_date} · {b.start_time?.slice(0,5)}–{b.end_time?.slice(0,5)} · {b.pax} pax
          </div>
          <div className="flex-1" />
          {editable && (
            <div className="flex gap-2">
              {b.status === "reserved" && <Button size="sm" onClick={() => setStatus("confirmed")}>Confirm</Button>}
              {b.status === "confirmed" && <Button size="sm" onClick={() => setStatus("completed")}><CheckCircle2 className="h-4 w-4 mr-1" /> Mark completed</Button>}
              <Button size="sm" variant="outline" className="text-destructive" onClick={() => setCancelOpen(true)}><Ban className="h-4 w-4 mr-1" /> Cancel</Button>
            </div>
          )}
        </div>

        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="text-base">Host</CardTitle></CardHeader>
            <CardContent className="space-y-1 text-sm">
              <Row k="Name" v={b.guests?.name ?? "—"} />
              <Row k="Mobile" v={b.guests?.mobile ?? "—"} />
              <Row k="Email" v={b.guests?.email ?? "—"} />
              <Row k="Function" v={b.function_type} />
              {b.notes && <div className="pt-2 border-t"><div className="text-xs text-muted-foreground">Notes</div>{b.notes}</div>}
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
            <CardTitle className="text-base flex items-center gap-2"><BedDouble className="h-4 w-4" /> Bulk room block</CardTitle>
            {editable && <Button size="sm" onClick={() => setAddOpen(true)}><Plus className="h-4 w-4 mr-1" /> Add room</Button>}
          </CardHeader>
          <CardContent>
            {bulk.length === 0 ? (
              <p className="text-sm text-muted-foreground">No rooms blocked.</p>
            ) : (
              <div className="divide-y text-sm">
                {bulk.map((br) => (
                  <div key={br.id} className="py-2 flex items-center gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium">
                        {br.rooms?.room_number ? `Room ${br.rooms.room_number}` : br.room_categories?.name ?? "Category"}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {br.check_in} → {br.check_out} · {br.nights} night(s) · ₹{Number(br.rate).toLocaleString("en-IN")}/night
                      </div>
                    </div>
                    <div className="text-sm font-medium">
                      ₹{(Number(br.rate) * Number(br.nights)).toLocaleString("en-IN")}
                    </div>
                    {editable && (
                      <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive" onClick={() => removeBulk(br.id)}>
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {blocks.length > 0 && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <BedDouble className="h-4 w-4" /> Event Room Block · {b.banquet_number}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-[80px_1fr_1fr_1fr_120px_90px] gap-2 text-xs uppercase text-muted-foreground border-b pb-1">
                <div>Room</div><div>Stay</div><div>Guest name</div><div>Mobile</div><div>Status</div><div></div>
              </div>
              {blocks.map((blk, i) => (
                <div key={blk.id} className="grid grid-cols-[80px_1fr_1fr_1fr_120px_90px] gap-2 items-center text-sm">
                  <div>
                    <div className="font-semibold">{blk.room_number}</div>
                    <div className="text-xs text-muted-foreground">{blk.room_category}</div>
                  </div>
                  <div className="text-xs text-muted-foreground">{blk.checkin_date}<br/>→ {blk.checkout_date}</div>
                  <Input value={blk.guest_name ?? ""} disabled={blk.status !== "blocked"}
                    placeholder="Unassigned"
                    onChange={(e) => setBlocks((prev) => prev.map((x, idx) => idx === i ? { ...x, guest_name: e.target.value } : x))} />
                  <Input value={blk.guest_mobile ?? ""} disabled={blk.status !== "blocked"}
                    onChange={(e) => setBlocks((prev) => prev.map((x, idx) => idx === i ? { ...x, guest_mobile: e.target.value } : x))} />
                  <Badge variant="outline" className={
                    blk.status === "checked_in" ? "bg-blue-100 text-blue-800" :
                    blk.status === "checked_out" ? "bg-emerald-100 text-emerald-800" :
                    "bg-purple-100 text-purple-800"
                  }>{blk.status.replace("_", " ")}</Badge>
                  <Button size="sm" variant="outline" disabled={blk.status !== "blocked"}
                    onClick={() => saveBlockGuest(blk)}>Save</Button>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        <Dialog open={addOpen} onOpenChange={setAddOpen}>
          <DialogContent>
            <DialogHeader><DialogTitle>Add room to block</DialogTitle></DialogHeader>
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
                <Label className="text-xs">…or category (count seats by type)</Label>
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
                <div className="space-y-1.5"><Label className="text-xs">Nights</Label><Input type="number" value={addNights} onChange={(e) => setAddNights(e.target.value)} /></div>
                <div className="space-y-1.5"><Label className="text-xs">Rate / night</Label><Input type="number" value={addRate} onChange={(e) => setAddRate(e.target.value)} /></div>
              </div>
            </div>
            <DialogFooter>
              <Button variant="outline" onClick={() => setAddOpen(false)}>Cancel</Button>
              <Button onClick={addBulkRoom}>Add</Button>
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

// Suppress unused import warning
void useAuth;

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