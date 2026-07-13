import { createFileRoute, useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { RequirePermission } from "@/components/RequirePermission";
import { toast } from "sonner";
import { Printer, Save, ArrowLeft } from "lucide-react";

export const Route = createFileRoute("/_authenticated/bookings/$bookingId/grc")({
  head: () => ({ meta: [{ title: "Guest Registration Card — HotelPilot" }] }),
  component: () => (
    <RequirePermission module="grc">
      <GrcPage />
    </RequirePermission>
  ),
});

const DEFAULT_TERMS = `1. Check-out time is 12:00 noon. Retention charges apply for late check-out.
2. Guest is responsible for any damage/loss to hotel property caused during stay.
3. Payment must be settled at the time of check-out. Cheques not accepted.
4. Visitors are allowed only in the lobby. Extra pax charges apply for stay in room.
5. Hotel is not responsible for cash, jewellery or valuables left in the room.
6. Firearms, illegal substances, and hazardous materials are strictly prohibited.
7. The guest agrees to abide by the rules and regulations of the hotel.
8. Disputes, if any, are subject to local jurisdiction only.`;

interface GrcState {
  id: string | null;
  grc_number: string | null;
  designation: string;
  address: string;
  company: string;
  arrival_from: string;
  preceding_to: string;
  mode_of_payment: string;
  purpose_of_visit: string;
  billing_instruction: string;
  discount_note: string;
  duty_manager_name: string;
}

const empty: GrcState = {
  id: null, grc_number: null,
  designation: "", address: "", company: "",
  arrival_from: "", preceding_to: "",
  mode_of_payment: "", purpose_of_visit: "",
  billing_instruction: "", discount_note: "", duty_manager_name: "",
};

function GrcPage() {
  const { bookingId } = useParams({ from: "/_authenticated/bookings/$bookingId/grc" });
  const router = useRouter();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [booking, setBooking] = useState<any>(null);
  const [property, setProperty] = useState<any>(null);
  const [grc, setGrc] = useState<GrcState>(empty);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: b, error } = await supabase
        .from("bookings")
        .select(`id, booking_number, property_id, check_in, check_out, adults, children, source, total_amount, advance_amount,
                 guests(name, mobile, email, address, city, state, country, pincode, company, id_proof_type, id_proof_number, gender, dob, nationality, gst_number),
                 booking_rooms(rate, meal_plan, rooms(room_number), room_categories(name))`)
        .eq("id", bookingId)
        .maybeSingle();
      if (error || !b) { toast.error(error?.message ?? "Booking not found"); setLoading(false); return; }
      setBooking(b);

      const { data: p } = await supabase
        .from("properties")
        .select("id, name, legal_entity_name, address_line1, address_line2, city, state, pin_code, phone, email, gstin, short_code, logo_url, grc_terms")
        .eq("id", b.property_id).maybeSingle();
      setProperty(p);

      const { data: g } = await supabase
        .from("grc_records")
        .select("*").eq("booking_id", bookingId).maybeSingle();
      if (g) {
        setGrc({
          id: g.id, grc_number: g.grc_number,
          designation: g.designation ?? "",
          address: g.address ?? (b.guests as any)?.address ?? "",
          company: g.company ?? (b.guests as any)?.company ?? "",
          arrival_from: g.arrival_from ?? "",
          preceding_to: g.preceding_to ?? "",
          mode_of_payment: g.mode_of_payment ?? "",
          purpose_of_visit: g.purpose_of_visit ?? "",
          billing_instruction: g.billing_instruction ?? "",
          discount_note: g.discount_note ?? "",
          duty_manager_name: g.duty_manager_name ?? "",
        });
      } else {
        setGrc((s) => ({
          ...s,
          address: (b.guests as any)?.address ?? "",
          company: (b.guests as any)?.company ?? "",
        }));
      }
      setLoading(false);
    })();
  }, [bookingId]);

  async function save(): Promise<string | null> {
    if (!booking) return null;
    setSaving(true);
    const payload = {
      property_id: booking.property_id,
      booking_id: booking.id,
      designation: grc.designation || null,
      address: grc.address || null,
      company: grc.company || null,
      arrival_from: grc.arrival_from || null,
      preceding_to: grc.preceding_to || null,
      mode_of_payment: grc.mode_of_payment || null,
      purpose_of_visit: grc.purpose_of_visit || null,
      billing_instruction: grc.billing_instruction || null,
      discount_note: grc.discount_note || null,
      duty_manager_name: grc.duty_manager_name || null,
    };
    let number = grc.grc_number;
    if (grc.id) {
      const { error } = await supabase.from("grc_records").update(payload).eq("id", grc.id);
      if (error) { toast.error(error.message); setSaving(false); return null; }
    } else {
      const { data, error } = await supabase.from("grc_records").insert(payload).select("id, grc_number").single();
      if (error) { toast.error(error.message); setSaving(false); return null; }
      number = data.grc_number;
      setGrc((s) => ({ ...s, id: data.id, grc_number: data.grc_number }));
    }
    toast.success("GRC saved");
    setSaving(false);
    return number ?? null;
  }

  async function saveAndPrint() {
    const num = await save();
    if (num) setTimeout(() => window.print(), 100);
  }

  if (loading) return <AppShell title="Guest Registration Card"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;
  if (!booking) return <AppShell title="Guest Registration Card"><p className="text-sm text-muted-foreground">Not found.</p></AppShell>;

  const guest = booking.guests ?? {};
  const room0 = booking.booking_rooms?.[0] ?? {};
  const terms = property?.grc_terms || DEFAULT_TERMS;
  const propAddress = [property?.address_line1, property?.address_line2, property?.city, property?.state, property?.pin_code].filter(Boolean).join(", ");

  return (
    <AppShell title="Guest Registration Card">
      <style>{`
        @media print {
          @page { size: A4 portrait; margin: 10mm; }
          .no-print { display: none !important; }
          .grc-print { border: 2px solid #000 !important; }
          body { background: white !important; }
        }
      `}</style>

      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2 no-print">
          <Button variant="outline" size="sm" onClick={() => router.history.back()}>
            <ArrowLeft className="h-4 w-4 mr-1" /> Back
          </Button>
          <div className="flex-1" />
          <Button variant="outline" onClick={save} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> {saving ? "Saving…" : "Save"}
          </Button>
          <Button onClick={saveAndPrint} disabled={saving}>
            <Printer className="h-4 w-4 mr-1" /> Save & Print
          </Button>
        </div>

        {/* Editable office fields */}
        <Card className="no-print">
          <CardContent className="pt-4 grid gap-3 md:grid-cols-2">
            <Field label="Designation" value={grc.designation} onChange={(v) => setGrc({ ...grc, designation: v })} />
            <Field label="Company / Organisation" value={grc.company} onChange={(v) => setGrc({ ...grc, company: v })} />
            <Field label="Arriving From" value={grc.arrival_from} onChange={(v) => setGrc({ ...grc, arrival_from: v })} />
            <Field label="Proceeding To" value={grc.preceding_to} onChange={(v) => setGrc({ ...grc, preceding_to: v })} />
            <Field label="Mode of Payment" value={grc.mode_of_payment} onChange={(v) => setGrc({ ...grc, mode_of_payment: v })} />
            <Field label="Purpose of Visit" value={grc.purpose_of_visit} onChange={(v) => setGrc({ ...grc, purpose_of_visit: v })} />
            <Field label="Billing Instruction" value={grc.billing_instruction} onChange={(v) => setGrc({ ...grc, billing_instruction: v })} />
            <Field label="Discount / Concession" value={grc.discount_note} onChange={(v) => setGrc({ ...grc, discount_note: v })} />
            <Field label="Duty Manager" value={grc.duty_manager_name} onChange={(v) => setGrc({ ...grc, duty_manager_name: v })} />
            <div className="md:col-span-2">
              <Label className="text-xs">Address (as declared on GRC)</Label>
              <Textarea rows={2} value={grc.address} onChange={(e) => setGrc({ ...grc, address: e.target.value })} />
            </div>
          </CardContent>
        </Card>

        {/* Print layout */}
        <div className="grc-print bg-white text-black border-2 border-black p-4 text-[12px] leading-tight">
          <div className="flex items-start gap-3 border-b-2 border-black pb-2 mb-2">
            {property?.logo_url && (
              <img src={property.logo_url} alt="" className="h-14 w-14 object-contain" />
            )}
            <div className="flex-1 text-center">
              <div className="text-lg font-bold uppercase">{property?.legal_entity_name || property?.name}</div>
              <div className="text-[11px]">{propAddress}</div>
              <div className="text-[11px]">
                {property?.phone && <>Ph: {property.phone} </>}
                {property?.email && <>· Email: {property.email} </>}
                {property?.gstin && <>· GSTIN: {property.gstin}</>}
              </div>
              <div className="mt-1 font-bold uppercase text-sm border-y border-black py-0.5">
                Guest Registration Card
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
            <PrintRow k="GRC No." v={grc.grc_number ?? "— (save to generate)"} />
            <PrintRow k="Booking No." v={booking.booking_number} />
            <PrintRow k="Room No." v={room0.rooms?.room_number ?? "—"} />
            <PrintRow k="Room Type" v={room0.room_categories?.name ?? "—"} />
            <PrintRow k="Check-in" v={booking.check_in} />
            <PrintRow k="Check-out" v={booking.check_out} />
            <PrintRow k="Adults / Children" v={`${booking.adults} / ${booking.children ?? 0}`} />
            <PrintRow k="Meal Plan" v={room0.meal_plan ?? "—"} />
            <PrintRow k="Tariff/Night" v={`₹${Number(room0.rate ?? 0).toLocaleString("en-IN")}`} />
            <PrintRow k="Advance" v={`₹${Number(booking.advance_amount ?? 0).toLocaleString("en-IN")}`} />
          </div>

          <div className="border-t border-black pt-1 mt-1 mb-2 font-semibold text-[11px] uppercase">Guest Details</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1 mb-2">
            <PrintRow k="Name" v={guest.name ?? "—"} />
            <PrintRow k="Designation" v={grc.designation || "—"} />
            <PrintRow k="Mobile" v={guest.mobile ?? "—"} />
            <PrintRow k="Email" v={guest.email ?? "—"} />
            <PrintRow k="Gender / DOB" v={`${guest.gender ?? "—"}${guest.dob ? " · " + guest.dob : ""}`} />
            <PrintRow k="Nationality" v={guest.nationality ?? "—"} />
            <PrintRow k="ID Proof" v={guest.id_proof_type ? `${guest.id_proof_type} · ${guest.id_proof_number ?? ""}` : "—"} />
            <PrintRow k="GSTIN" v={guest.gst_number ?? "—"} />
            <PrintRow k="Company" v={grc.company || guest.company || "—"} />
            <PrintRow k="Arriving From" v={grc.arrival_from || "—"} />
            <PrintRow k="Proceeding To" v={grc.preceding_to || "—"} />
            <PrintRow k="Purpose of Visit" v={grc.purpose_of_visit || "—"} />
            <PrintRow k="Mode of Payment" v={grc.mode_of_payment || "—"} />
            <PrintRow k="Billing Instruction" v={grc.billing_instruction || "—"} />
            <PrintRow k="Discount / Concession" v={grc.discount_note || "—"} />
          </div>
          <div className="mb-2">
            <div className="text-[11px]"><span className="font-semibold">Address:</span> {grc.address || "—"}</div>
          </div>

          <div className="border-t border-black pt-1 mt-1 mb-1 font-semibold text-[11px] uppercase">Terms &amp; Conditions</div>
          <pre className="whitespace-pre-wrap font-sans text-[10px] leading-snug mb-3">{terms}</pre>

          <div className="grid grid-cols-3 gap-4 pt-6 text-[11px]">
            <div className="border-t border-black pt-1 text-center">Guest Signature</div>
            <div className="border-t border-black pt-1 text-center">
              Duty Manager{grc.duty_manager_name ? ` — ${grc.duty_manager_name}` : ""}
            </div>
            <div className="border-t border-black pt-1 text-center">Date &amp; Time</div>
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <Label className="text-xs">{label}</Label>
      <Input value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

function PrintRow({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex gap-2 border-b border-dotted border-black/40 pb-0.5">
      <div className="w-32 font-semibold text-[11px]">{k}:</div>
      <div className="flex-1 text-[11px]">{v}</div>
    </div>
  );
}