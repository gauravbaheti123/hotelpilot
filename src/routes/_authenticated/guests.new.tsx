import { createFileRoute, useRouter } from "@tanstack/react-router";
import { useState } from "react";
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
import { useCurrentProperty } from "@/hooks/use-property";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import { ID_PROOF_TYPES, guestSchema, emptyToNull } from "@/lib/guests";

export const Route = createFileRoute("/_authenticated/guests/new")({
  head: () => ({ meta: [{ title: "New Guest — HotelPilot" }] }),
  component: NewGuestPage,
});

function NewGuestPage() {
  const router = useRouter();
  const { currentId: propertyId } = useCurrentProperty();
  const [form, setForm] = useState({
    name: "", mobile: "", email: "", gender: "", dob: "",
    nationality: "Indian", address: "", city: "", state: "", country: "India",
    pincode: "", company: "", gst_number: "", id_proof_type: "", id_proof_number: "", notes: "",
  });
  const [tagsInput, setTagsInput] = useState("");
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: string) { setForm((f) => ({ ...f, [k]: v })); }

  async function submit() {
    if (!propertyId) return;
    const parsed = guestSchema.safeParse(form);
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Invalid input");
      return;
    }
    setBusy(true);
    try {
      const { name, ...rest } = parsed.data;
      const payload = emptyToNull(rest);
      const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10);
      const { data, error } = await supabase.from("guests").insert({
        property_id: propertyId,
        name,
        ...payload,
        tags,
      }).select("id").single();
      if (error) throw error;
      toast.success("Guest created");
      router.navigate({ to: "/guests/$id", params: { id: data.id } });
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed");
    } finally { setBusy(false); }
  }

  if (!propertyId) return <AppShell title="New Guest"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="New Guest">
      <Card className="max-w-3xl">
        <CardHeader><CardTitle className="text-base">Guest profile</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name *"><Input value={form.name} onChange={(e) => set("name", e.target.value)} maxLength={120} /></Field>
            <Field label="Mobile"><Input value={form.mobile} onChange={(e) => set("mobile", e.target.value)} maxLength={20} /></Field>
            <Field label="Email"><Input type="email" value={form.email} onChange={(e) => set("email", e.target.value)} maxLength={255} /></Field>
            <Field label="Gender">
              <Select value={form.gender} onValueChange={(v) => set("gender", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="Date of birth"><Input type="date" value={form.dob} onChange={(e) => set("dob", e.target.value)} /></Field>
            <Field label="Nationality"><Input value={form.nationality} onChange={(e) => set("nationality", e.target.value)} /></Field>
            <Field label="ID type">
              <Select value={form.id_proof_type} onValueChange={(v) => set("id_proof_type", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {ID_PROOF_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="ID number"><Input value={form.id_proof_number} onChange={(e) => set("id_proof_number", e.target.value)} maxLength={40} /></Field>
            <Field label="Company"><Input value={form.company} onChange={(e) => set("company", e.target.value)} maxLength={200} /></Field>
            <Field label="GSTIN"><Input value={form.gst_number} onChange={(e) => set("gst_number", e.target.value.toUpperCase())} maxLength={15} /></Field>
            <Field label="City"><Input value={form.city} onChange={(e) => set("city", e.target.value)} /></Field>
            <Field label="State"><Input value={form.state} onChange={(e) => set("state", e.target.value)} /></Field>
            <Field label="Country"><Input value={form.country} onChange={(e) => set("country", e.target.value)} /></Field>
            <Field label="Pincode"><Input value={form.pincode} onChange={(e) => set("pincode", e.target.value)} maxLength={12} /></Field>
            <div className="md:col-span-2"><Field label="Address"><Textarea rows={2} value={form.address} onChange={(e) => set("address", e.target.value)} maxLength={500} /></Field></div>
            <div className="md:col-span-2"><Field label="Tags (comma separated, e.g. VIP, Repeat)"><Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} /></Field></div>
            <div className="md:col-span-2"><Field label="Notes"><Textarea rows={2} value={form.notes} onChange={(e) => set("notes", e.target.value)} maxLength={1000} /></Field></div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => router.history.back()}>Cancel</Button>
            <Button onClick={submit} disabled={busy}>{busy ? "Saving…" : "Save guest"}</Button>
          </div>
        </CardContent>
      </Card>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="mb-1 block text-xs">{label}</Label>{children}</div>;
}