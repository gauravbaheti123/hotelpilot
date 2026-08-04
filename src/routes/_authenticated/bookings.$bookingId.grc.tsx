import { createFileRoute, useParams, useRouter } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/BackButton";
import { Input } from "@/components/ui/input";
import { CityInput, StateSelect, NationInput } from "@/components/AddressFields";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { RequirePermission } from "@/components/RequirePermission";
import { toast } from "sonner";
import { Printer, Save, ArrowLeft } from "lucide-react";
import { resolveLogoUrl } from "@/lib/invoiceTemplates";

function fmtDateTime(value: string | null | undefined, fallbackTime?: string | null): string {
  if (!value) return "—";
  const isTs = value.includes("T") || value.length > 10;
  const t = (fallbackTime && fallbackTime.length >= 5) ? fallbackTime.slice(0, 5) : "12:00";
  const d = isTs ? new Date(value) : new Date(`${value}T${t}:00`);
  if (isNaN(d.getTime())) return String(value);
  const date = d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
  const time = d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${date}, ${time}`;
}

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
  city: string;
  state: string;
  country: string;
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
  designation: "", address: "", city: "", state: "", country: "India", company: "",
  arrival_from: "", preceding_to: "",
  mode_of_payment: "", purpose_of_visit: "",
  billing_instruction: "", discount_note: "", duty_manager_name: "",
};

function GrcPage() {
  const { bookingId } = useParams({ from: "/_authenticated/bookings/$bookingId/grc" });
  const router = useRouter();
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [booking, setBooking] = useState<any>(null);
  const [property, setProperty] = useState<any>(null);
  const [grc, setGrc] = useState<GrcState>(empty);
  const [staffOptions, setStaffOptions] = useState<string[]>([]);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const { data: b, error } = await supabase
        .from("bookings")
        .select(`id, booking_number, property_id, guest_id, check_in, check_out, adults, children, source, total_amount, advance_amount,
                 guests(name, mobile, email, address, city, state, country, pincode, company, id_proof_type, id_proof_number, gender, dob, nationality, gst_number),
                 booking_rooms(rate, meal_plan, actual_check_in, actual_check_out, rooms!booking_rooms_room_id_fkey(room_number), room_categories(name))`)
        .eq("id", bookingId)
        .maybeSingle();
      if (error || !b) { toast.error(error?.message ?? "Booking not found"); setLoading(false); return; }
      setBooking(b);

      const { data: p } = await supabase
        .from("properties")
        .select("id, name, legal_entity_name, address_line1, address_line2, city, state, pin_code, phone, email, gstin, short_code, logo_url, grc_terms, default_checkin_time, default_checkout_time")
        .eq("id", b.property_id).maybeSingle();
      setProperty(p);
      if (p?.logo_url) {
        const resolved = await resolveLogoUrl(p.logo_url);
        if (resolved) setProperty((cur: any) => cur ? { ...cur, logo_url: resolved } : cur);
      }

      const { data: g } = await supabase
        .from("grc_records")
        .select("*").eq("booking_id", bookingId).maybeSingle();
      // Duty Manager defaults to the logged-in user; a saved value always wins.
      let signedInName = "";
      const uid = (await supabase.auth.getSession()).data.session?.user?.id ?? null;
      if (uid) {
        const { data: prof } = await supabase
          .from("profiles").select("name,email").eq("id", uid).maybeSingle();
        signedInName = (prof?.name || prof?.email || "").trim();
      }
      // Duty Manager options come from the property's staff list.
      const { data: staffRows } = await supabase.rpc("list_property_staff", {
        _property_id: b.property_id,
      });
      const names = ((staffRows ?? []) as Array<{ display_name: string | null; email: string | null }>)
        .map((r) => (r.display_name || r.email || "").trim())
        .filter(Boolean);
      const saved = (g?.duty_manager_name ?? "").trim();
      if (saved && !names.includes(saved)) names.unshift(saved);
      if (signedInName && !names.includes(signedInName)) names.unshift(signedInName);
      setStaffOptions(Array.from(new Set(names)));
      if (g) {
        setGrc({
          id: g.id, grc_number: g.grc_number,
          designation: g.designation ?? "",
          address: g.address ?? (b.guests as any)?.address ?? "",
          city: (g as any).city ?? (b.guests as any)?.city ?? "",
          state: (g as any).state ?? (b.guests as any)?.state ?? "",
          country: (g as any).country ?? (b.guests as any)?.country ?? "India",
          company: g.company ?? (b.guests as any)?.company ?? "",
          arrival_from: g.arrival_from ?? "",
          preceding_to: g.preceding_to ?? "",
          mode_of_payment: g.mode_of_payment ?? "",
          purpose_of_visit: g.purpose_of_visit ?? "",
          billing_instruction: g.billing_instruction ?? "",
          discount_note: g.discount_note ?? "",
          duty_manager_name: g.duty_manager_name || signedInName,
        });
      } else {
        setGrc((s) => ({
          ...s,
          address: (b.guests as any)?.address ?? "",
          city: (b.guests as any)?.city ?? "",
          state: (b.guests as any)?.state ?? "",
          country: (b.guests as any)?.country ?? "India",
          company: (b.guests as any)?.company ?? "",
          duty_manager_name: s.duty_manager_name || signedInName,
        }));
      }
      setLoading(false);
    })();
  }, [bookingId, user?.id]);

  async function save(): Promise<string | null> {
    if (!booking) return null;
    setSaving(true);
    const payload = {
      property_id: booking.property_id,
      booking_id: booking.id,
      designation: grc.designation || null,
      address: grc.address || null,
      city: grc.city || null,
      state: grc.state || null,
      country: grc.country || "India",
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
    // Keep the guest master in sync — guest-billed invoices resolve
    // IGST vs CGST+SGST from guests.state (Phase 57).
    const gid = (booking as any)?.guest_id ?? null;
    if (gid && (grc.city || grc.state)) {
      await supabase.from("guests").update({
        city: grc.city || null,
        state: grc.state || null,
        country: grc.country || "India",
        address: grc.address || null,
      }).eq("id", gid);
    }
    toast.success("GRC saved");
    setSaving(false);
    return number ?? null;
  }

  async function printGrc() {
    // Auto-save first if the GRC hasn't been persisted yet — Print should
    // never depend on external printer/QZ status, only on having data ready.
    if (!grc.id) {
      const num = await save();
      if (!num) return;
    }
    // Hidden-iframe print pattern (same approach used by Invoice/KOT flows).
    // Called synchronously from the button click so the browser keeps the
    // user-gesture context and never silently blocks the print dialog.
    const source = document.getElementById("grc-print-area");
    if (!source) { window.print(); return; }
    const html = source.outerHTML;
    // Inline the parent document's stylesheets so Tailwind utility classes
    // (flex, p-6, h-24 w-24, grid, border-*, etc.) actually resolve inside the
    // iframe. Without this, the raw HTML renders unstyled — the logo balloons
    // to its natural size and content overflows across multiple pages.
    const parentStyles = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'))
      .map((n) => n.outerHTML)
      .join("\n");
    const printCss = `
      @page { size: A4 portrait; margin: 12mm; }
      html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; color: #000 !important; font-family: Arial, sans-serif; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .grc-print {
        width: 100% !important; max-width: none !important;
        margin: 0 !important; padding: 6mm !important;
        border: 2px solid #000 !important;
        box-sizing: border-box !important;
        display: block !important;
        font-size: 11pt; line-height: 1.45;
        color: #000 !important;
      }
      .grc-print img { max-width: 22mm !important; max-height: 22mm !important; width: auto !important; height: auto !important; object-fit: contain; }
      .grc-print .grc-title { font-size: 13pt; }
      .grc-print .grc-section-label { font-size: 10pt; }
      .grc-print pre { font-size: 9.5pt; line-height: 1.35; margin: 4px 0 8px; }
      .grc-print .grc-signatures { padding-top: 10mm !important; }
      table { border-collapse: collapse; width: 100%; }
      td, th { vertical-align: top; }
      .no-print { display: none !important; }
    `;
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>GRC ${grc.grc_number ?? ""}</title>${parentStyles}<style>${printCss}</style></head><body>${html}</body></html>`;
    const iframe = document.createElement("iframe");
    iframe.setAttribute("aria-hidden", "true");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.style.opacity = "0";
    document.body.appendChild(iframe);
    let cleaned = false;
    const cleanup = () => {
      if (cleaned) return;
      cleaned = true;
      try { iframe.parentNode?.removeChild(iframe); } catch {}
    };
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) { cleanup(); return; }
      try { win.focus(); } catch {}
      try {
        win.addEventListener("afterprint", () => setTimeout(cleanup, 200));
      } catch {}
      // Give the browser a tick to lay out before invoking print.
      setTimeout(() => {
        try { win.print(); } catch { cleanup(); }
        // Fallback cleanup in case afterprint never fires.
        setTimeout(cleanup, 60_000);
      }, 50);
    };
    iframe.srcdoc = doc;
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
          @page { size: A4 portrait; margin: 15mm; }
          html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; height: auto !important; overflow: visible !important; }
          body * { visibility: hidden !important; }
          .grc-print, .grc-print * { visibility: visible !important; }
          .grc-print {
            position: absolute !important;
            left: 0; top: 0;
            width: 100% !important;
            max-width: none !important;
            min-height: 267mm !important;
            margin: 0 !important;
            padding: 6mm !important;
            border: 2px solid #000 !important;
            box-shadow: none !important;
            overflow: visible !important;
            page-break-inside: avoid;
            display: flex !important;
            flex-direction: column !important;
            font-size: 12.5pt !important;
            line-height: 1.55 !important;
          }
          .grc-print .grc-signatures { margin-top: auto !important; padding-top: 18mm !important; }
          .grc-print h1, .grc-print h2, .grc-print .grc-title { font-size: 16pt !important; }
          .grc-print .grc-section-label { font-size: 11pt !important; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="max-w-4xl mx-auto space-y-4">
        <div className="flex flex-wrap items-center gap-2 no-print">
          <BackButton fallbackTo="/front-desk/bookings" />
          <div className="flex-1" />
          <Button variant="outline" onClick={save} disabled={saving}>
            <Save className="h-4 w-4 mr-1" /> {saving ? "Saving…" : "Save"}
          </Button>
          <Button onClick={printGrc} disabled={saving}>
            <Printer className="h-4 w-4 mr-1" /> Print GRC
          </Button>
        </div>

        {/* Editable office fields */}
        <Card className="no-print">
          <CardContent className="pt-4 grid gap-3 md:grid-cols-2">
            <Field label="Company / Organisation" value={grc.company} onChange={(v) => setGrc({ ...grc, company: v })} />
            <Field label="Purpose of Visit" value={grc.purpose_of_visit} onChange={(v) => setGrc({ ...grc, purpose_of_visit: v })} />
            <Field label="Billing Instruction" value={grc.billing_instruction} onChange={(v) => setGrc({ ...grc, billing_instruction: v })} />
            <Field label="Discount / Concession" value={grc.discount_note} onChange={(v) => setGrc({ ...grc, discount_note: v })} />
            <div>
              <Label className="text-xs">Duty Manager</Label>
              <Select
                value={grc.duty_manager_name || undefined}
                onValueChange={(v) => setGrc({ ...grc, duty_manager_name: v })}
              >
                <SelectTrigger><SelectValue placeholder="Select duty manager" /></SelectTrigger>
                <SelectContent>
                  {staffOptions.map((n) => (
                    <SelectItem key={n} value={n}>{n}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="md:col-span-2">
              <Label className="text-xs">Address (as declared on GRC)</Label>
              <Textarea rows={2} value={grc.address} onChange={(e) => setGrc({ ...grc, address: e.target.value })} />
            </div>
            <div>
              <Label className="text-xs">City</Label>
              <CityInput value={grc.city} onChange={(v) => setGrc({ ...grc, city: v })} />
            </div>
            <div>
              <Label className="text-xs">State / UT</Label>
              <StateSelect value={grc.state} onChange={(v) => setGrc({ ...grc, state: v })} />
            </div>
            <div>
              <Label className="text-xs">Nation</Label>
              <NationInput value={grc.country} onChange={(v) => setGrc({ ...grc, country: v })} />
            </div>
          </CardContent>
        </Card>

        {/* Print layout */}
        <div id="grc-print-area" className="grc-print bg-white text-black border-2 border-black p-6 text-[13px] leading-relaxed">
          <div className="flex items-start gap-4 border-b-2 border-black pb-3 mb-4">
            {property?.logo_url && (
              <img src={property.logo_url} alt="" className="h-24 w-24 object-contain" />
            )}
            <div className="flex-1 text-center">
              <div className="text-xl font-bold uppercase">{property?.name || property?.legal_entity_name || "—"}</div>
              {propAddress && <div className="text-[12px] mt-1">{propAddress}</div>}
              {(property?.phone || property?.email) && (
                <div className="text-[12px] mt-1">
                  {property?.phone && <>Ph: {property.phone}</>}
                  {property?.phone && property?.email && <> · </>}
                  {property?.email && <>Email: {property.email}</>}
                </div>
              )}
              {property?.gstin && <div className="text-[12px] mt-1">GSTIN: {property.gstin}</div>}
              <div className="grc-title mt-2 font-bold uppercase text-base border-y-2 border-black py-1">
                Guest Registration Card
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-4">
            <PrintRow k="GRC No." v={grc.grc_number ?? "— (save to generate)"} />
            <PrintRow k="Booking No." v={booking.booking_number} />
            <PrintRow k="Room No." v={room0.rooms?.room_number ?? "—"} />
            <PrintRow k="Room Type" v={room0.room_categories?.name ?? "—"} />
            <PrintRow k="Check-in" v={fmtDateTime((booking.booking_rooms?.[0] as any)?.actual_check_in ?? booking.check_in, property?.default_checkin_time)} />
            <PrintRow k="Check-out" v={fmtDateTime((booking.booking_rooms?.[0] as any)?.actual_check_out ?? booking.check_out, property?.default_checkout_time)} />
            <PrintRow k="Adults / Children" v={`${booking.adults} / ${booking.children ?? 0}`} />
            <PrintRow k="Meal Plan" v={room0.meal_plan ?? "—"} />
            <PrintRow k="Tariff/Night" v={`₹${Number(room0.rate ?? 0).toLocaleString("en-IN")}`} />
            <PrintRow k="Advance" v={`₹${Number(booking.advance_amount ?? 0).toLocaleString("en-IN")}`} />
          </div>

          <div className="grc-section-label border-t border-black pt-2 mt-2 mb-3 font-semibold text-[12px] uppercase tracking-wide">Guest Details</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-2 mb-4">
            <PrintRow k="Name" v={guest.name ?? "—"} />
            <PrintRow k="Mobile" v={guest.mobile ?? "—"} />
            <PrintRow k="Email" v={guest.email ?? "—"} />
            <PrintRow k="Gender / DOB" v={`${guest.gender ?? "—"}${guest.dob ? " · " + guest.dob : ""}`} />
            <PrintRow k="Nationality" v={guest.nationality ?? "—"} />
            <PrintRow k="ID Proof" v={guest.id_proof_type ? `${guest.id_proof_type} · ${guest.id_proof_number ?? ""}` : "—"} />
            <PrintRow k="GSTIN" v={guest.gst_number ?? "—"} />
            <PrintRow k="Company" v={grc.company || guest.company || "—"} />
            <PrintRow k="Purpose of Visit" v={grc.purpose_of_visit || "—"} />
            <PrintRow k="Billing Instruction" v={grc.billing_instruction || "—"} />
            <PrintRow k="Discount / Concession" v={grc.discount_note || "—"} />
          </div>
          <div className="mb-4">
            <div className="text-[12px]"><span className="font-semibold">Address:</span> {[grc.address, grc.city, grc.state, grc.country].filter(Boolean).join(", ") || "—"}</div>
          </div>

          <div className="grc-section-label border-t border-black pt-2 mt-2 mb-2 font-semibold text-[12px] uppercase tracking-wide">Terms &amp; Conditions</div>
          <pre className="whitespace-pre-wrap font-sans text-[11px] leading-relaxed mb-6">{terms}</pre>

          <div className="grc-signatures grid grid-cols-3 gap-6 pt-10 text-[12px]">
            <div className="border-t border-black pt-2 text-center">Guest Signature</div>
            <div className="border-t border-black pt-2 text-center">
              Duty Manager{grc.duty_manager_name ? ` — ${grc.duty_manager_name}` : ""}
            </div>
            <div className="border-t border-black pt-2 text-center">Date &amp; Time</div>
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