import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell } from "@/components/AppShell";
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
import { toast } from "sonner";

export const Route = createFileRoute("/_authenticated/guests/new")({
  head: () => ({ meta: [{ title: "New Guest — HotelPilot" }] }),
  component: NewGuestPage,
});

function NewGuestPage() {
  const router = useRouter();
  const { currentId: propertyId } = useCurrentProperty();
  const [name, setName] = useState("");
  const [mobile, setMobile] = useState("");
  const [email, setEmail] = useState("");
  const [idType, setIdType] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [address, setAddress] = useState("");
  const [guestType, setGuestType] = useState<"regular" | "corporate" | "vip">("regular");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);

  if (!propertyId) return <AppShell title="New Guest"><EmptyPropertyState /></AppShell>;

  async function save() {
    if (!name.trim()) { toast.error("Name is required"); return; }
    if (!mobile.trim()) { toast.error("Mobile is required"); return; }
    setBusy(true);
    const tags = guestType === "regular" ? [] : [guestType];
    const { data, error } = await supabase.from("guests").insert({
      property_id: propertyId,
      name: name.trim(),
      mobile: mobile.trim(),
      email: email.trim() || null,
      id_proof_type: idType || null,
      id_proof_number: idNumber.trim() || null,
      address: address.trim() || null,
      notes: notes.trim() || null,
      tags,
    }).select("id").single();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
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
            <Field label="Mobile *"><Input value={mobile} onChange={(e) => setMobile(e.target.value)} maxLength={20} /></Field>
            <Field label="Email"><Input value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} /></Field>
            <Field label="Guest type">
              <Select value={guestType} onValueChange={(v) => setGuestType(v as typeof guestType)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="regular">Regular</SelectItem>
                  <SelectItem value="corporate">Corporate</SelectItem>
                  <SelectItem value="vip">VIP</SelectItem>
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
            <div className="md:col-span-2"><Field label="Address"><Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} maxLength={500} /></Field></div>
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