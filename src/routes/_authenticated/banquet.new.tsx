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
import { Switch } from "@/components/ui/switch";
import { Plus, Trash2 } from "lucide-react";
import {
  pickAvailableRooms, commitRoomBlocks, nightsBetween,
  type AssignedBlock,
} from "@/lib/eventRoomBlocks";

export const Route = createFileRoute("/_authenticated/banquet/new")({
  head: () => ({ meta: [{ title: "New Banquet — HotelPilot" }] }),
  component: NewBanquetPage,
});

interface Hall { id: string; name: string; capacity: number; hourly_rate: number; day_rate: number }
interface Cat { id: string; name: string; base_rate?: number }
interface BlockRow {
  category_id: string;
  quantity: string;
  checkin_date: string;
  checkout_date: string;
  special_rate: string;
}

function NewBanquetPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentId: propertyId } = useCurrentProperty();
  const [halls, setHalls] = useState<Hall[]>([]);
  const [cats, setCats] = useState<Cat[]>([]);
  const [saving, setSaving] = useState(false);

  const today = new Date().toISOString().slice(0, 10);

  // guest
  const [guestName, setGuestName] = useState("");
  const [guestMobile, setGuestMobile] = useState("");
  const [guestEmail, setGuestEmail] = useState("");

  // event
  const [hallId, setHallId] = useState("");
  const [functionType, setFunctionType] = useState("Wedding");
  const [eventDate, setEventDate] = useState(today);
  const [startTime, setStartTime] = useState("18:00");
  const [endTime, setEndTime] = useState("23:00");
  const [pax, setPax] = useState("100");

  // charges
  const [packageRate, setPackageRate] = useState("0");
  const [hallCharge, setHallCharge] = useState("0");
  const [fbCharge, setFbCharge] = useState("0");
  const [extraCharge, setExtraCharge] = useState("0");
  const [discount, setDiscount] = useState("0");
  const [advance, setAdvance] = useState("0");
  const [notes, setNotes] = useState("");

  // Room block
  const [blockOn, setBlockOn] = useState(false);
  const [eventName, setEventName] = useState("");
  const [blockRows, setBlockRows] = useState<BlockRow[]>([]);
  const [assignments, setAssignments] = useState<AssignedBlock[]>([]);
  const [showAssignments, setShowAssignments] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data } = await supabase.from("halls")
        .select("id,name,capacity,hourly_rate,day_rate")
        .eq("property_id", propertyId).eq("is_active", true).order("name");
      setHalls((data ?? []) as Hall[]);
      const { data: cs } = await supabase.from("room_categories")
        .select("id, name, base_rate")
        .eq("property_id", propertyId).order("name");
      setCats((cs ?? []) as Cat[]);
    })();
  }, [propertyId]);

  const total = useMemo(() => computeBanquetTotal({
    package_rate: Number(packageRate), pax: Number(pax),
    hall_charge: Number(hallCharge), fb_charge: Number(fbCharge),
    extra_charge: Number(extraCharge), discount_amount: Number(discount),
  }), [packageRate, pax, hallCharge, fbCharge, extraCharge, discount]);

  const blockSummary = useMemo(() => {
    let totalRooms = 0;
    let revenue = 0;
    blockRows.forEach((r) => {
      const q = Number(r.quantity) || 0;
      const cat = cats.find((c) => c.id === r.category_id);
      const rate = Number(r.special_rate) || Number(cat?.base_rate ?? 0);
      const nights = r.checkin_date && r.checkout_date ? nightsBetween(r.checkin_date, r.checkout_date) : 1;
      totalRooms += q;
      revenue += q * rate * nights;
    });
    const categories = new Set(blockRows.filter((r) => r.category_id).map((r) => r.category_id)).size;
    return { totalRooms, revenue, categories };
  }, [blockRows, cats]);

  function addBlockRow() {
    setBlockRows((prev) => [...prev, {
      category_id: "", quantity: "1",
      checkin_date: eventDate, checkout_date: eventDate,
      special_rate: "",
    }]);
  }
  function updateBlockRow(i: number, patch: Partial<BlockRow>) {
    setBlockRows((prev) => prev.map((r, idx) => idx === i ? { ...r, ...patch } : r));
  }
  function removeBlockRow(i: number) {
    setBlockRows((prev) => prev.filter((_, idx) => idx !== i));
    setAssignments([]); setShowAssignments(false);
  }

  async function prepareAssignments() {
    if (!propertyId) return;
    if (!eventName.trim()) return toast.error("Event name required");
    try {
      const out: AssignedBlock[] = [];
      for (const row of blockRows) {
        if (!row.category_id) continue;
        const q = Number(row.quantity) || 0;
        if (q <= 0) continue;
        const cat = cats.find((c) => c.id === row.category_id);
        const rooms = await pickAvailableRooms(propertyId, row.category_id, q);
        const rate = row.special_rate ? Number(row.special_rate) : Number(cat?.base_rate ?? 0);
        rooms.forEach((r) => out.push({
          room_id: r.id, room_number: r.room_number,
          room_category: r.category_name || cat?.name || "",
          category_id: row.category_id,
          checkin_date: row.checkin_date,
          checkout_date: row.checkout_date,
          special_rate: rate,
        }));
      }
      setAssignments(out);
      setShowAssignments(true);
    } catch (e: any) {
      toast.error(e.message ?? "Could not pick rooms");
    }
  }

  async function save() {
    if (!propertyId) return;
    if (!guestName.trim() || !guestMobile.trim()) return toast.error("Guest name & mobile required");
    if (!hallId) return toast.error("Pick a hall");
    if (!eventDate || !startTime || !endTime) return toast.error("Event date/time required");
    if (blockOn && blockRows.length > 0 && !eventName.trim()) return toast.error("Event name required for room block");
    setSaving(true);
    try {
      const { data: g, error: ge } = await supabase.from("guests").insert({
        property_id: propertyId,
        name: guestName,
        mobile: guestMobile,
        email: guestEmail || null,
        created_by: user?.id ?? null,
      } as any).select("id").single();
      if (ge) throw ge;

      const advanceAmt = Number(advance) || 0;

      // Prepare assignments if not already
      let finalAssignments = assignments;
      if (blockOn && blockRows.length > 0 && finalAssignments.length === 0) {
        const out: AssignedBlock[] = [];
        for (const row of blockRows) {
          if (!row.category_id) continue;
          const q = Number(row.quantity) || 0;
          if (q <= 0) continue;
          const cat = cats.find((c) => c.id === row.category_id);
          const rooms = await pickAvailableRooms(propertyId, row.category_id, q);
          const rate = row.special_rate ? Number(row.special_rate) : Number(cat?.base_rate ?? 0);
          rooms.forEach((r) => out.push({
            room_id: r.id, room_number: r.room_number,
            room_category: r.category_name || cat?.name || "",
            category_id: row.category_id,
            checkin_date: row.checkin_date,
            checkout_date: row.checkout_date,
            special_rate: rate,
          }));
        }
        finalAssignments = out;
      }

      const totalRoomCharges = finalAssignments.reduce((sum, a) => {
        const nights = nightsBetween(a.checkin_date, a.checkout_date);
        return sum + (Number(a.special_rate ?? 0) * nights);
      }, 0);
      const combinedTotal = total + totalRoomCharges;

      const { data: bq, error: be } = await supabase.from("banquet_bookings").insert({
        property_id: propertyId,
        hall_id: hallId,
        guest_id: g!.id,
        event_name: blockOn ? eventName : null,
        function_type: functionType,
        event_date: eventDate,
        start_time: startTime,
        end_time: endTime,
        pax: Number(pax) || 0,
        package_rate: Number(packageRate) || 0,
        hall_charge: Number(hallCharge) || 0,
        fb_charge: Number(fbCharge) || 0,
        extra_charge: Number(extraCharge) || 0,
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

      let roomsBlocked = 0;
      if (blockOn && finalAssignments.length > 0) {
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
        ? `Event saved — ${bn} generated, ${roomsBlocked} rooms blocked`
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
              <Field label="Name *"><Input value={guestName} onChange={(e) => setGuestName(e.target.value)} /></Field>
              <Field label="Mobile *"><Input value={guestMobile} onChange={(e) => setGuestMobile(e.target.value)} /></Field>
              <Field label="Email"><Input type="email" value={guestEmail} onChange={(e) => setGuestEmail(e.target.value)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Event</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Field label="Hall *">
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
              <Field label="Date *"><Input type="date" value={eventDate} onChange={(e) => setEventDate(e.target.value)} /></Field>
              <Field label="Start *"><Input type="time" value={startTime} onChange={(e) => setStartTime(e.target.value)} /></Field>
              <Field label="End *"><Input type="time" value={endTime} onChange={(e) => setEndTime(e.target.value)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle className="text-base">Charges</CardTitle></CardHeader>
            <CardContent className="grid gap-3 sm:grid-cols-3">
              <Field label="Package rate / pax (₹)"><Input type="number" value={packageRate} onChange={(e) => setPackageRate(e.target.value)} /></Field>
              <Field label="Hall charge (₹)"><Input type="number" value={hallCharge} onChange={(e) => setHallCharge(e.target.value)} /></Field>
              <Field label="F&B charge (₹)"><Input type="number" value={fbCharge} onChange={(e) => setFbCharge(e.target.value)} /></Field>
              <Field label="Extra (₹)"><Input type="number" value={extraCharge} onChange={(e) => setExtraCharge(e.target.value)} /></Field>
              <Field label="Discount (₹)"><Input type="number" value={discount} onChange={(e) => setDiscount(e.target.value)} /></Field>
              <Field label="Advance (₹)"><Input type="number" value={advance} onChange={(e) => setAdvance(e.target.value)} /></Field>
              <Field label="Notes" wide><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0">
              <CardTitle className="text-base">Room Block for Event</CardTitle>
              <div className="flex items-center gap-2">
                <Label className="text-xs">Add room block</Label>
                <Switch checked={blockOn} onCheckedChange={setBlockOn} />
              </div>
            </CardHeader>
            {blockOn && (
              <CardContent className="space-y-3">
                <Field label="Event Name * (shown on dashboard cards)">
                  <Input placeholder="e.g. Sharma Wedding" value={eventName} onChange={(e) => setEventName(e.target.value)} />
                </Field>

                <div className="space-y-2">
                  {blockRows.map((r, i) => {
                    const cat = cats.find((c) => c.id === r.category_id);
                    return (
                      <div key={i} className="grid gap-2 sm:grid-cols-[1.5fr_70px_1fr_1fr_120px_30px] items-end p-2 border rounded">
                        <Field label={i === 0 ? "Category" : ""}>
                          <Select value={r.category_id} onValueChange={(v) => updateBlockRow(i, { category_id: v })}>
                            <SelectTrigger><SelectValue placeholder="Pick category" /></SelectTrigger>
                            <SelectContent>
                              {cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
                            </SelectContent>
                          </Select>
                        </Field>
                        <Field label={i === 0 ? "Qty" : ""}>
                          <Input type="number" min={1} value={r.quantity} onChange={(e) => updateBlockRow(i, { quantity: e.target.value })} />
                        </Field>
                        <Field label={i === 0 ? "Check-in" : ""}>
                          <Input type="date" value={r.checkin_date} onChange={(e) => updateBlockRow(i, { checkin_date: e.target.value })} />
                        </Field>
                        <Field label={i === 0 ? "Check-out" : ""}>
                          <Input type="date" value={r.checkout_date} onChange={(e) => updateBlockRow(i, { checkout_date: e.target.value })} />
                        </Field>
                        <Field label={i === 0 ? `Rate (def ₹${cat?.base_rate ?? 0})` : ""}>
                          <Input type="number" placeholder="default" value={r.special_rate} onChange={(e) => updateBlockRow(i, { special_rate: e.target.value })} />
                        </Field>
                        <Button type="button" variant="ghost" size="icon" className="h-8 w-8 text-destructive" onClick={() => removeBlockRow(i)}>
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    );
                  })}
                  <Button type="button" variant="outline" size="sm" onClick={addBlockRow}>
                    <Plus className="h-4 w-4 mr-1" /> Add Another Room Category
                  </Button>
                </div>

                {blockRows.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    Rooms to block: <b>{blockSummary.totalRooms}</b> across <b>{blockSummary.categories}</b> categories ·
                    Estimated room revenue: <b>₹{blockSummary.revenue.toLocaleString("en-IN")}</b>
                  </div>
                )}

                {blockRows.length > 0 && !showAssignments && (
                  <Button type="button" variant="outline" size="sm" onClick={prepareAssignments}>
                    Assign Guests to Rooms (Optional)
                  </Button>
                )}

                {showAssignments && assignments.length > 0 && (
                  <div className="space-y-2 border-t pt-3">
                    <div className="text-xs font-medium uppercase text-muted-foreground">Assign Guests to Rooms</div>
                    {assignments.map((a, i) => (
                      <div key={i} className="grid gap-2 sm:grid-cols-[100px_1fr_1fr] items-center text-sm">
                        <div><b>Room {a.room_number}</b><div className="text-xs text-muted-foreground">{a.room_category}</div></div>
                        <Input placeholder="Guest name" value={a.guest_name ?? ""}
                          onChange={(e) => setAssignments((prev) => prev.map((x, idx) => idx === i ? { ...x, guest_name: e.target.value } : x))} />
                        <Input placeholder="Mobile" value={a.guest_mobile ?? ""}
                          onChange={(e) => setAssignments((prev) => prev.map((x, idx) => idx === i ? { ...x, guest_mobile: e.target.value } : x))} />
                      </div>
                    ))}
                    <p className="text-xs text-muted-foreground">Leave blank to mark as "Unassigned" — can be filled later from event page or dashboard.</p>
                  </div>
                )}
              </CardContent>
            )}
          </Card>
        </div>

        <Card className="self-start sticky top-4">
          <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row k="Package" v={`₹${(Number(packageRate) * Number(pax)).toLocaleString("en-IN")}`} />
            <Row k="Hall" v={`₹${Number(hallCharge).toLocaleString("en-IN")}`} />
            <Row k="F&B" v={`₹${Number(fbCharge).toLocaleString("en-IN")}`} />
            <Row k="Extra" v={`₹${Number(extraCharge).toLocaleString("en-IN")}`} />
            {Number(discount) > 0 && <Row k="Discount" v={`- ₹${Number(discount).toLocaleString("en-IN")}`} />}
            {blockOn && blockSummary.revenue > 0 && <Row k={`Rooms (${blockSummary.totalRooms})`} v={`₹${blockSummary.revenue.toLocaleString("en-IN")}`} />}
            <div className="border-t pt-2">
              <Row k="Total" v={`₹${(total + (blockOn ? blockSummary.revenue : 0)).toLocaleString("en-IN")}`} bold />
              <Row k="Advance" v={`₹${Number(advance).toLocaleString("en-IN")}`} />
              <Row k="Balance" v={`₹${Math.max(0, total + (blockOn ? blockSummary.revenue : 0) - Number(advance)).toLocaleString("en-IN")}`} bold highlight />
            </div>
            <div className="pt-3 flex gap-2">
              <Button variant="outline" className="flex-1" onClick={() => router.history.back()}>Cancel</Button>
              <Button className="flex-1" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save event"}</Button>
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