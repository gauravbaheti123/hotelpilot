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

export const Route = createFileRoute("/_authenticated/banquet/new")({
  head: () => ({ meta: [{ title: "New Banquet — HotelPilot" }] }),
  component: NewBanquetPage,
});

interface Hall { id: string; name: string; capacity: number; hourly_rate: number; day_rate: number }

function NewBanquetPage() {
  const router = useRouter();
  const { user } = useAuth();
  const { currentId: propertyId } = useCurrentProperty();
  const [halls, setHalls] = useState<Hall[]>([]);
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

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data } = await supabase.from("halls")
        .select("id,name,capacity,hourly_rate,day_rate")
        .eq("property_id", propertyId).eq("is_active", true).order("name");
      setHalls((data ?? []) as Hall[]);
    })();
  }, [propertyId]);

  const total = useMemo(() => computeBanquetTotal({
    package_rate: Number(packageRate), pax: Number(pax),
    hall_charge: Number(hallCharge), fb_charge: Number(fbCharge),
    extra_charge: Number(extraCharge), discount_amount: Number(discount),
  }), [packageRate, pax, hallCharge, fbCharge, extraCharge, discount]);

  async function save() {
    if (!propertyId) return;
    if (!guestName.trim() || !guestMobile.trim()) return toast.error("Guest name & mobile required");
    if (!hallId) return toast.error("Pick a hall");
    if (!eventDate || !startTime || !endTime) return toast.error("Event date/time required");
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
      const { data: bq, error: be } = await supabase.from("banquet_bookings").insert({
        property_id: propertyId,
        hall_id: hallId,
        guest_id: g!.id,
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
        total_amount: total,
        advance_amount: advanceAmt,
        balance_amount: Math.max(0, total - advanceAmt),
        notes: notes || null,
        status: "reserved",
        created_by: user?.id ?? null,
      } as any).select("id").single();
      if (be) throw be;

      toast.success("Banquet event created");
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
        </div>

        <Card className="self-start sticky top-4">
          <CardHeader><CardTitle className="text-base">Summary</CardTitle></CardHeader>
          <CardContent className="text-sm space-y-2">
            <Row k="Package" v={`₹${(Number(packageRate) * Number(pax)).toLocaleString("en-IN")}`} />
            <Row k="Hall" v={`₹${Number(hallCharge).toLocaleString("en-IN")}`} />
            <Row k="F&B" v={`₹${Number(fbCharge).toLocaleString("en-IN")}`} />
            <Row k="Extra" v={`₹${Number(extraCharge).toLocaleString("en-IN")}`} />
            {Number(discount) > 0 && <Row k="Discount" v={`- ₹${Number(discount).toLocaleString("en-IN")}`} />}
            <div className="border-t pt-2">
              <Row k="Total" v={`₹${total.toLocaleString("en-IN")}`} bold />
              <Row k="Advance" v={`₹${Number(advance).toLocaleString("en-IN")}`} />
              <Row k="Balance" v={`₹${Math.max(0, total - Number(advance)).toLocaleString("en-IN")}`} bold highlight />
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