import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CityInput, StateSelect, NationInput } from "@/components/AddressFields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { ID_PROOF_TYPES } from "@/lib/guests";
import { isValidOrEmptyGSTIN, GSTIN_ERROR } from "@/lib/gstin";
import { isValidMobile, sanitizeMobile, MOBILE_ERROR } from "@/lib/mobile";
import { toast } from "sonner";
import { logActivity, userDisplayName } from "@/lib/activityLog";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/guests/new")({
  head: () => ({ meta: [{ title: "New Guest — HotelPilot" }] }),
  component: () => (<RequirePermission module="guest_crm"><NewGuestPage /></RequirePermission>),
});

function NewGuestPage() {
  const router = useRouter();
  const { currentId: propertyId } = useCurrentProperty();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [dob, setDob] = useState("");
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [address, setAddress] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [nation, setNation] = useState("India");
  const [company, setCompany] = useState("");
  const [gstNumber, setGstNumber] = useState("");
  const [guestType, setGuestType] = useState<"regular" | "corporate">("regular");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  if (!propertyId) return <AppShell title="New Guest"><EmptyPropertyState /></AppShell>;

  async function save() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!isValidMobile(mobile)) { toast.error(MOBILE_ERROR); return; }
    if (!isValidOrEmptyGSTIN(gstNumber)) { toast.error(GSTIN_ERROR); return; }
    setBusy(true);
    const tags = guestType === "regular" ? [] : [guestType];
    const { data, error } = await supabase.from("guests").insert({
      property_id: propertyId!,
      name: name.trim(),
      mobile: mobile.trim(),
      email: email.trim() || null,
      dob: dob || null,
      id_proof_type: idType || null,
      id_proof_number: idNumber.trim() || null,
      address: address.trim() || null,
      city: city.trim() || null,
      state: state.trim() || null,
      country: nation.trim() || "India",
      company: company.trim() || null,
      gst_number: gstNumber.trim().toUpperCase() || null,
      notes: notes.trim() || null,
      tags,
    }).select("id").single();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    const { data: u } = await supabase.auth.getUser();
    logActivity({
      property_id: propertyId!,
      user_id: u.user?.id ?? "",
      user_name: userDisplayName(u.user as never),
      action_type: "GUEST_CREATED",
      module: "Guests",
      reference_id: data!.id,
      reference_label: name.trim(),
      details: { guest_id: data!.id, guest_name: name.trim() },
    });
    toast.success("Guest created");
    router.navigate({ to: "/guests/$id", params: { id: data!.id } });
  }

  return (
    <AppShell title="New Guest">
      <Card className="max-w-2xl">
        <CardHeader><CardTitle className="text-base">Guest details</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Full name *"><Input value={name} onChange={(e) => setName(e.target.value)} maxLength={120} /></Field>
            <Field label="Mobile *">
              <Input
                value={mobile}
                onChange={(e) => setMobile(sanitizeMobile(e.target.value))}
                inputMode="numeric"
                pattern="\d{10}"
                maxLength={10}
                placeholder="10-digit mobile"
                className={mobile && !isValidMobile(mobile) ? "border-red-500 focus-visible:ring-red-500" : ""}
              />
              {mobile && !isValidMobile(mobile) && (
                <p className="mt-1 text-[11px] text-red-600">{MOBILE_ERROR}</p>
              )}
            </Field>
            <Field label="Date of Birth (optional)"><Input type="date" value={dob} onChange={(e) => setDob(e.target.value)} /></Field>
            <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} /></Field>
            <Field label="Guest type">
              <Select value={guestType} onValueChange={(v) => setGuestType(v as typeof guestType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular">Regular</SelectItem>
                  <SelectItem value="corporate">Corporate</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="ID proof type">
              <Select value={idType} onValueChange={setIdType}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {ID_PROOF_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="ID proof number"><Input value={idNumber} onChange={(e) => setIdNumber(e.target.value)} maxLength={40} /></Field>
            <div className="md:col-span-2">
              <Field label="Company Name">
                <Input value={company} onChange={(e) => setCompany(e.target.value)} maxLength={200} placeholder="e.g. Growth Story Pvt Ltd" />
                <p className="mt-1 text-[11px] text-muted-foreground">Optional — useful for corporate / business travelers</p>
              </Field>
            </div>
            <div className="md:col-span-2">
              <Field label="GST Number">
                <Input
                  value={gstNumber}
                  onChange={(e) => setGstNumber(e.target.value.toUpperCase())}
                  maxLength={15}
                  placeholder="e.g. 27AASFB5351R1ZM"
                  className={gstNumber && !isValidOrEmptyGSTIN(gstNumber) ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {gstNumber && !isValidOrEmptyGSTIN(gstNumber) && (
                  <p className="mt-1 text-[11px] text-red-600">{GSTIN_ERROR}</p>
                )}
              </Field>
            </div>
            <div className="md:col-span-2"><Field label="Address Line"><Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} placeholder="Street / building / area" /></Field></div>
            <Field label="City"><CityInput value={city} onChange={setCity} /></Field>
            <Field label="State">
              <StateSelect value={state} onChange={setState} />
              <p className="mt-1 text-[11px] text-muted-foreground">Decides CGST+SGST vs IGST on invoices.</p>
            </Field>
            <Field label="Nation"><NationInput value={nation} onChange={setNation} /></Field>
            <div className="md:col-span-2"><Field label="Notes"><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={1000} /></Field></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.history.back()}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Create guest"}</Button>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="mb-1 block text-xs">{label}</Label>{children}</div>;
}