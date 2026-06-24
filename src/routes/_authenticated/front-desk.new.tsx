import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { addDaysIso, nightsBetween, SOURCES, todayIso } from "@/lib/front-desk";

export const Route = createFileRoute("/_authenticated/front-desk/new")({
  head: () => ({ meta: [{ title: "New Booking — HotelPilot" }] }),
  component: NewBookingPage,
});

interface Category { id: string; name: string; base_rate: number; max_occupancy: number; }
interface RoomRow { id: string; room_number: string; category_id: string | null; status: string; }
interface Tariff { id: string; name: string; category_id: string | null; rate: number; meal_plan: string; }

function NewBookingPage() {
  const router = useRouter();
  const { user, roles } = useAuth();
  const canBook = roles.some((r) =>
    ["superadmin", "owner", "manager", "receptionist"].includes(r),
  );
  const { current, loading: propLoading } = useCurrentProperty();

  const [cats, setCats] = useState<Category[]>([]);
  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [tariffs, setTariffs] = useState<Tariff[]>([]);

  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [idType, setIdType] = useState("aadhaar");
  const [idNumber, setIdNumber] = useState("");
  const [address, setAddress] = useState("");

  const [checkIn, setCheckIn] = useState(todayIso());
  const [checkOut, setCheckOut] = useState(addDaysIso(todayIso(), 1));
  const [adults, setAdults] = useState(1);
  const [children, setChildren] = useState(0);
  const [categoryId, setCategoryId] = useState<string>("");
  const [roomId, setRoomId] = useState<string>("");
  const [tariffId, setTariffId] = useState<string>("");
  const [rate, setRate] = useState(0);
  const [mealPlan, setMealPlan] = useState("EP");
  const [source, setSource] = useState("walk_in");
  const [advance, setAdvance] = useState(0);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!current) return;
    (async () => {
      const [c, r, t] = await Promise.all([
        supabase.from("room_categories").select("id,name,base_rate,max_occupancy").eq("property_id", current.id).order("name"),
        supabase.from("rooms").select("id,room_number,category_id,status").eq("property_id", current.id).order("room_number"),
        supabase.from("tariff_plans").select("id,name,category_id,rate,meal_plan").eq("property_id", current.id).eq("is_active", true).order("name"),
      ]);
      setCats((c.data ?? []) as Category[]);
      setRooms((r.data ?? []) as RoomRow[]);
      setTariffs((t.data ?? []) as Tariff[]);
    })();
  }, [current?.id]);

  const nights = nightsBetween(checkIn, checkOut);
  const total = nights * rate;
  const balance = Math.max(0, total - advance);
  const availableRooms = rooms.filter(
    (r) => (!categoryId || r.category_id === categoryId) && r.status === "vacant",
  );
  const categoryTariffs = tariffs.filter((t) => !categoryId || t.category_id === categoryId);

  function pickCategory(id: string) {
    setCategoryId(id);
    setRoomId("");
    const cat = cats.find((c) => c.id === id);
    if (cat && rate === 0) setRate(cat.base_rate);
    const t = tariffs.find((t) => t.category_id === id);
    if (t) {
      setTariffId(t.id);
      setRate(t.rate);
      setMealPlan(t.meal_plan);
    } else {
      setTariffId("");
    }
  }

  function pickTariff(id: string) {
    setTariffId(id);
    const t = tariffs.find((t) => t.id === id);
    if (t) {
      setRate(t.rate);
      setMealPlan(t.meal_plan);
    }
  }

  async function save(checkInNow: boolean) {
    if (!current) return;
    if (!name.trim()) return toast.error("Guest name required");
    if (!categoryId) return toast.error("Pick a category");
    if (!roomId) return toast.error("Pick a room");
    if (nightsBetween(checkIn, checkOut) < 1) return toast.error("Check-out must be after check-in");

    setSaving(true);
    try {
      // 1) Guest
      const { data: guest, error: gErr } = await supabase
        .from("guests")
        .insert({
          property_id: current.id,
          name: name.trim(),
          mobile: mobile || null,
          email: email || null,
          id_proof_type: idType || null,
          id_proof_number: idNumber || null,
          address: address || null,
        })
        .select("id")
        .single();
      if (gErr) throw gErr;

      // 2) Booking
      const { data: booking, error: bErr } = await supabase
        .from("bookings")
        .insert({
          property_id: current.id,
          booking_number: "",
          guest_id: guest!.id,
          source,
          status: checkInNow ? "checked_in" : "reserved",
          check_in: checkIn,
          check_out: checkOut,
          adults,
          children,
          total_amount: total,
          advance_amount: advance,
          balance_amount: balance,
          notes: notes || null,
          created_by: user?.id ?? null,
          checked_in_at: checkInNow ? new Date().toISOString() : null,
          checked_in_by: checkInNow ? (user?.id ?? null) : null,
        } as any)
        .select("id, booking_number")
        .single();
      if (bErr) throw bErr;

      // 3) Booking room
      const { error: brErr } = await supabase.from("booking_rooms").insert({
        booking_id: booking!.id,
        property_id: current.id,
        room_id: roomId,
        category_id: categoryId,
        tariff_id: tariffId || null,
        meal_plan: mealPlan,
        rate,
        adults,
        children,
        check_in: checkIn,
        check_out: checkOut,
        actual_check_in: checkInNow ? new Date().toISOString() : null,
      } as any);
      if (brErr) throw brErr;

      // 4) If checked in, mark room occupied
      if (checkInNow) {
        await supabase.from("rooms").update({ status: "occupied" }).eq("id", roomId);
      }

      toast.success(`Booking ${booking!.booking_number} created`);
      router.navigate({ to: "/front-desk/booking/$id", params: { id: booking!.id } });
    } catch (e: any) {
      toast.error(e.message ?? "Failed to save");
    } finally {
      setSaving(false);
    }
  }

  if (propLoading) return <AppShell title="New Booking"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!current) return <AppShell title="New Booking"><EmptyPropertyState /></AppShell>;
  if (!canBook) return <AppShell title="New Booking"><p className="text-sm text-muted-foreground">You don't have permission to create bookings.</p></AppShell>;

  return (
    <AppShell title="New Booking">
      <div className="max-w-5xl space-y-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Guest details</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <F label="Full name *"><Input value={name} onChange={(e) => setName(e.target.value)} /></F>
            <F label="Mobile"><Input value={mobile} onChange={(e) => setMobile(e.target.value)} /></F>
            <F label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} /></F>
            <F label="ID type">
              <Select value={idType} onValueChange={setIdType}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="aadhaar">Aadhaar</SelectItem>
                  <SelectItem value="passport">Passport</SelectItem>
                  <SelectItem value="driving_license">Driving License</SelectItem>
                  <SelectItem value="voter_id">Voter ID</SelectItem>
                  <SelectItem value="pan">PAN</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="ID number"><Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} /></F>
            <div />
            <div className="col-span-2">
              <F label="Address"><Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></F>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Stay & room</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-3">
            <F label="Check-in *"><Input type="date" value={checkIn} onChange={(e) => setCheckIn(e.target.value)} /></F>
            <F label="Check-out *"><Input type="date" value={checkOut} onChange={(e) => setCheckOut(e.target.value)} /></F>
            <F label="Adults"><Input type="number" min={1} value={adults} onChange={(e) => setAdults(Number(e.target.value))} /></F>
            <F label="Children"><Input type="number" min={0} value={children} onChange={(e) => setChildren(Number(e.target.value))} /></F>
            <F label="Category *">
              <Select value={categoryId} onValueChange={pickCategory}>
                <SelectTrigger><SelectValue placeholder="Select category" /></SelectTrigger>
                <SelectContent>
                  {cats.map((c) => (<SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>))}
                </SelectContent>
              </Select>
            </F>
            <F label="Room *">
              <Select value={roomId} onValueChange={setRoomId} disabled={!categoryId}>
                <SelectTrigger>
                  <SelectValue placeholder={categoryId ? (availableRooms.length ? "Select vacant room" : "No vacant rooms") : "Pick category first"} />
                </SelectTrigger>
                <SelectContent>
                  {availableRooms.map((r) => (<SelectItem key={r.id} value={r.id}>{r.room_number}</SelectItem>))}
                </SelectContent>
              </Select>
            </F>
            <F label="Tariff plan">
              <Select value={tariffId} onValueChange={pickTariff} disabled={!categoryId}>
                <SelectTrigger><SelectValue placeholder="Custom / none" /></SelectTrigger>
                <SelectContent>
                  {categoryTariffs.map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name} ({t.meal_plan}) ₹{t.rate}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </F>
            <F label="Meal plan">
              <Select value={mealPlan} onValueChange={setMealPlan}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="EP">EP — Room only</SelectItem>
                  <SelectItem value="CP">CP — Breakfast</SelectItem>
                  <SelectItem value="MAP">MAP — Breakfast + 1 meal</SelectItem>
                  <SelectItem value="AP">AP — All meals</SelectItem>
                </SelectContent>
              </Select>
            </F>
            <F label="Rate / night (₹)"><Input type="number" value={rate} onChange={(e) => setRate(Number(e.target.value))} /></F>
            <F label="Source">
              <Select value={source} onValueChange={setSource}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SOURCES.map((s) => (<SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>))}
                </SelectContent>
              </Select>
            </F>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Payment & notes</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid grid-cols-4 gap-3 text-sm">
              <Stat label="Nights" value={String(nights)} />
              <Stat label="Room total" value={`₹${total.toLocaleString("en-IN")}`} />
              <F label="Advance (₹)"><Input type="number" value={advance} onChange={(e) => setAdvance(Number(e.target.value))} /></F>
              <Stat label="Balance" value={`₹${balance.toLocaleString("en-IN")}`} highlight />
            </div>
            <F label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></F>
          </CardContent>
        </Card>

        <div className="flex justify-end gap-2">
          <Button variant="outline" disabled={saving} onClick={() => save(false)}>Save as reservation</Button>
          <Button disabled={saving} onClick={() => save(true)}>Save & check-in now</Button>
        </div>
      </div>
    </AppShell>
  );
}

function F({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-1.5"><Label className="text-xs">{label}</Label>{children}</div>;
}
function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div className={`h-9 px-3 flex items-center rounded-md border ${highlight ? "font-semibold bg-primary/5" : "bg-muted/30"}`}>{value}</div>
    </div>
  );
}