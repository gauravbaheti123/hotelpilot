import { createFileRoute, useRouter, useSearch } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentProperty } from "@/hooks/use-property";
import { useAuth } from "@/hooks/use-auth";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { toast } from "sonner";
import {
  CHANNELS, renderTemplate, whatsappLink, mailtoLink, smsLink, type MergeContext,
} from "@/lib/comms";
import { ExternalLink, Send, Save } from "lucide-react";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/comms/new")({
  validateSearch: (s: Record<string, unknown>) => ({
    booking_id: typeof s.booking_id === "string" ? s.booking_id : undefined,
    guest_id: typeof s.guest_id === "string" ? s.guest_id : undefined,
  }),
  head: () => ({ meta: [{ title: "New Message — HotelPilot" }] }),
  component: () => (<RequirePermission module="communications"><NewCommPage /></RequirePermission>),
});

interface Tpl { id: string; name: string; channel: string; subject: string | null; body: string }
interface Booking {
  id: string;
  booking_number: string;
  check_in: string;
  check_out: string;
  balance_amount: number;
  guests: { id: string; name: string; mobile: string | null; email: string | null } | null;
  booking_rooms: { rooms: { room_number: string } | null }[];
}
interface Guest { id: string; name: string; mobile: string | null; email: string | null }

function NewCommPage() {
  const router = useRouter();
  const search = useSearch({ from: "/_authenticated/comms/new" });
  const { current } = useCurrentProperty();
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Tpl[]>([]);
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [guests, setGuests] = useState<Guest[]>([]);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({
    template_id: "",
    booking_id: search.booking_id ?? "",
    guest_id: search.guest_id ?? "",
    channel: "whatsapp",
    direction: "outbound",
    recipient: "",
    recipient_name: "",
    subject: "",
    body: "",
    notes: "",
  });

  useEffect(() => {
    if (!current) return;
    Promise.all([
      supabase.from("message_templates").select("id,name,channel,subject,body").eq("property_id", current.id).eq("is_active", true).order("name"),
      supabase.from("bookings").select("id,booking_number,check_in,check_out,balance_amount,guests(id,name,mobile,email),booking_rooms(rooms!booking_rooms_room_id_fkey(room_number))").eq("property_id", current.id).in("status", ["reserved", "checked_in", "checked_out"]).order("check_in", { ascending: false }).limit(80),
      supabase.from("guests").select("id,name,mobile,email").eq("property_id", current.id).order("name").limit(200),
    ]).then(async ([t, b, g]) => {
      setTemplates((t.data ?? []) as Tpl[]);
      // Banquet event-block bookings drop out of the picker after 48h.
      const scope = await fetchBanquetScope(current.id);
      setBookings(((b.data ?? []) as any[]).filter(
        (bk) => !isBanquetRecord(scope, { booking_id: bk.id }),
      ) as unknown as Booking[]);
      setGuests((g.data ?? []) as Guest[]);
    });
  }, [current?.id]);

  const booking = bookings.find((b) => b.id === form.booking_id);
  const guest = booking?.guests ?? guests.find((g) => g.id === form.guest_id) ?? null;

  function ctx(): MergeContext {
    return {
      guest_name: guest?.name ?? null,
      booking_number: booking?.booking_number ?? null,
      check_in: booking?.check_in ?? null,
      check_out: booking?.check_out ?? null,
      room_number: booking?.booking_rooms?.map((r) => r.rooms?.room_number).filter(Boolean).join(", ") || null,
      property_name: current?.name ?? null,
      balance: booking?.balance_amount ?? null,
    };
  }

  // Auto-fill recipient when booking/guest changes
  useEffect(() => {
    if (!guest) return;
    const rec = form.channel === "email" ? guest.email ?? "" : guest.mobile ?? "";
    setForm((f) => ({ ...f, recipient: rec, recipient_name: guest.name }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [guest?.id, form.channel]);

  function applyTemplate(id: string) {
    const t = templates.find((x) => x.id === id);
    if (!t) { setForm((f) => ({ ...f, template_id: "" })); return; }
    setForm((f) => ({
      ...f,
      template_id: id,
      channel: t.channel,
      subject: t.subject ?? f.subject,
      body: renderTemplate(t.body, ctx()),
    }));
  }

  async function save(status: "draft" | "sent") {
    if (!current) return;
    if (!form.recipient.trim()) { toast.error("Recipient required"); return; }
    if (!form.body.trim()) { toast.error("Message body required"); return; }
    setBusy(true);
    const payload = {
      property_id: current.id,
      booking_id: form.booking_id || null,
      guest_id: guest?.id ?? null,
      template_id: form.template_id || null,
      channel: form.channel,
      direction: form.direction,
      recipient: form.recipient.trim(),
      recipient_name: form.recipient_name.trim() || null,
      subject: form.subject.trim() || null,
      body: form.body,
      status,
      sent_at: status === "sent" ? new Date().toISOString() : null,
      notes: form.notes.trim() || null,
      created_by: user?.id ?? null,
    };
    const { error } = await supabase.from("communications").insert(payload);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(status === "sent" ? "Logged as sent" : "Saved as draft");
    router.navigate({ to: "/comms" });
  }

  function openExternal() {
    if (form.channel === "whatsapp") window.open(whatsappLink(form.recipient, form.body), "_blank");
    else if (form.channel === "email") window.location.href = mailtoLink(form.recipient, form.subject, form.body);
    else if (form.channel === "sms") window.location.href = smsLink(form.recipient, form.body);
    else if (form.channel === "call") window.location.href = `tel:${form.recipient.replace(/\s/g, "")}`;
    else return;
  }

  if (!current) return <AppShell title="New Message"><EmptyPropertyState /></AppShell>;

  return (
    <AppShell title="New Message">
      <div className="max-w-4xl">
        <Card>
          <CardHeader><CardTitle>Compose &amp; log message</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Booking (optional)</Label>
                <Select value={form.booking_id} onValueChange={(v) => setForm((f) => ({ ...f, booking_id: v, guest_id: "" }))}>
                  <SelectTrigger><SelectValue placeholder="No booking" /></SelectTrigger>
                  <SelectContent>
                    {bookings.map((b) => (
                      <SelectItem key={b.id} value={b.id}>
                        {b.booking_number} — {b.guests?.name ?? "Guest"}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Or guest from CRM</Label>
                <Select value={form.guest_id} onValueChange={(v) => setForm((f) => ({ ...f, guest_id: v, booking_id: "" }))} disabled={!!form.booking_id}>
                  <SelectTrigger><SelectValue placeholder="Pick a guest" /></SelectTrigger>
                  <SelectContent>
                    {guests.map((g) => (
                      <SelectItem key={g.id} value={g.id}>{g.name} {g.mobile ? `— ${g.mobile}` : ""}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Channel</Label>
                <Select value={form.channel} onValueChange={(v) => setForm((f) => ({ ...f, channel: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {CHANNELS.map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Direction</Label>
                <Select value={form.direction} onValueChange={(v) => setForm((f) => ({ ...f, direction: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="outbound">Outbound</SelectItem>
                    <SelectItem value="inbound">Inbound</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Recipient {form.channel === "email" ? "email" : "phone"}</Label>
                <Input value={form.recipient} onChange={(e) => setForm((f) => ({ ...f, recipient: e.target.value }))} />
              </div>
              <div className="space-y-2">
                <Label>Recipient name</Label>
                <Input value={form.recipient_name} onChange={(e) => setForm((f) => ({ ...f, recipient_name: e.target.value }))} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Template</Label>
              <Select value={form.template_id} onValueChange={applyTemplate}>
                <SelectTrigger><SelectValue placeholder="Start from template (optional)" /></SelectTrigger>
                <SelectContent>
                  {templates.filter((t) => !form.channel || t.channel === form.channel).map((t) => (
                    <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.channel === "email" && (
              <div className="space-y-2">
                <Label>Subject</Label>
                <Input value={form.subject} onChange={(e) => setForm((f) => ({ ...f, subject: e.target.value }))} />
              </div>
            )}

            <div className="space-y-2">
              <Label>Message body</Label>
              <Textarea rows={8} value={form.body} onChange={(e) => setForm((f) => ({ ...f, body: e.target.value }))} placeholder="Type message…" />
              {form.template_id && (
                <p className="text-xs text-muted-foreground">
                  Variables auto-filled from the selected booking/guest.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label>Internal notes</Label>
              <Textarea rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>

            <div className="flex flex-wrap gap-2 pt-2 border-t">
              <Button onClick={() => save("sent")} disabled={busy}>
                <Save className="h-4 w-4 mr-1" /> Log as sent
              </Button>
              <Button variant="outline" onClick={() => save("draft")} disabled={busy}>
                Save as draft
              </Button>
              {(form.channel === "whatsapp" || form.channel === "email" || form.channel === "sms" || form.channel === "call") && form.recipient && (
                <Button variant="secondary" onClick={openExternal}>
                  <ExternalLink className="h-4 w-4 mr-1" />
                  Open in {form.channel === "whatsapp" ? "WhatsApp" : form.channel === "email" ? "Mail app" : form.channel === "sms" ? "SMS app" : "Phone"}
                </Button>
              )}
              <Button variant="ghost" className="ml-auto" onClick={() => router.navigate({ to: "/comms" })}>Cancel</Button>
            </div>
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}