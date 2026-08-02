import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { CityInput, StateSelect, NationInput } from "@/components/AddressFields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Ban, ShieldCheck } from "lucide-react";
import { ID_PROOF_TYPES, guestSchema, emptyToNull } from "@/lib/guests";
import { isValidOrEmptyGSTIN, GSTIN_ERROR } from "@/lib/gstin";
import { isValidMobile, sanitizeMobile, MOBILE_ERROR } from "@/lib/mobile";
import { inr } from "@/lib/billing";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { fetchGuestLedger, type GuestLedger } from "@/lib/guestLedger";

import { RequirePermission } from "@/components/RequirePermission";
export const Route = createFileRoute("/_authenticated/guests/$id")({
  head: () => ({ meta: [{ title: "Guest — HotelPilot" }] }),
  component: () => (<RequirePermission module="guest_crm"><GuestDetail /></RequirePermission>),
});

interface Guest {
  id: string; property_id: string;
  name: string; mobile: string | null; email: string | null;
  gender: string | null; dob: string | null; nationality: string | null;
  address: string | null; city: string | null; state: string | null;
  country: string | null; pincode: string | null;
  company: string | null; gst_number: string | null;
  id_proof_type: string | null; id_proof_number: string | null;
  notes: string | null; tags: string[] | null; is_blacklisted: boolean;
  id_document_url?: string | null;
  id_document_name?: string | null;
  id_document_uploaded_at?: string | null;
}

interface Stay {
  id: string; booking_number: string; status: string;
  check_in: string; check_out: string; total_amount: number;
}

interface Feedback {
  id: string; feedback_date: string; overall_rating: number;
  comments: string | null; source: string;
}

function GuestDetail() {
  const router = useRouter();
  const { id } = Route.useParams();
  const [g, setG] = useState<Guest | null>(null);
  const [stays, setStays] = useState<Stay[]>([]);
  const [feedback, setFeedback] = useState<Feedback[]>([]);
  const [ledger, setLedger] = useState<GuestLedger | null>(null);
  const [tagsInput, setTagsInput] = useState("");
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const { data } = await supabase.from("guests").select("*").eq("id", id).maybeSingle();
    setG((data as Guest | null) ?? null);
    setTagsInput((data?.tags ?? []).join(", "));
    const { data: b } = await supabase.from("bookings")
      .select("id,booking_number,status,check_in,check_out,total_amount")
      .eq("guest_id", id).order("check_in", { ascending: false }).limit(50);
    setStays((b ?? []) as Stay[]);
    const { data: f } = await supabase.from("guest_feedback")
      .select("id,feedback_date,overall_rating,comments,source")
      .eq("guest_id", id).order("feedback_date", { ascending: false }).limit(20);
    setFeedback((f ?? []) as Feedback[]);
    try { setLedger(await fetchGuestLedger(id)); } catch { setLedger(null); }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  if (!g) return <AppShell title="Guest"><p className="text-sm text-muted-foreground">Loading…</p></AppShell>;

  function patch<K extends keyof Guest>(k: K, v: Guest[K]) { setG((cur) => cur ? { ...cur, [k]: v } : cur); }

  async function save() {
    if (!g) return;
    const parsed = guestSchema.safeParse({
      name: g.name, mobile: g.mobile ?? "", email: g.email ?? "",
      gender: g.gender ?? "", dob: g.dob ?? "", nationality: g.nationality ?? "",
      address: g.address ?? "", city: g.city ?? "", state: g.state ?? "",
      country: g.country ?? "", pincode: g.pincode ?? "",
      company: g.company ?? "", gst_number: g.gst_number ?? "",
      id_proof_type: g.id_proof_type ?? "", id_proof_number: g.id_proof_number ?? "",
      notes: g.notes ?? "",
    });
    if (!parsed.success) { toast.error(parsed.error.issues[0]?.message ?? "Invalid"); return; }
    if (g.gst_number && !isValidOrEmptyGSTIN(g.gst_number)) { toast.error(GSTIN_ERROR); return; }
    if (!isValidMobile(g.mobile ?? "")) { toast.error(MOBILE_ERROR); return; }
    setBusy(true);
    try {
      const { name, ...rest } = parsed.data;
      const payload = emptyToNull(rest);
      const tags = tagsInput.split(",").map((t) => t.trim()).filter(Boolean).slice(0, 10);
      const beforeMap: Record<string, unknown> = {
        name: g.name, mobile: g.mobile, email: g.email, gender: g.gender, dob: g.dob,
        nationality: g.nationality, address: g.address, city: g.city, state: g.state,
        country: g.country, pincode: g.pincode, company: g.company, gst_number: g.gst_number,
        id_proof_type: g.id_proof_type, id_proof_number: g.id_proof_number, notes: g.notes,
        tags: (g.tags ?? []).join(","),
      };
      const newMap: Record<string, unknown> = { name, ...payload, tags: tags.join(",") };
      const changed = Object.keys(newMap).filter(
        (k) => (beforeMap[k] ?? null) !== (newMap[k] ?? null),
      );
      const { error } = await supabase.from("guests").update({ name, ...payload, tags }).eq("id", g.id);
      if (error) throw error;
      const { data: u } = await supabase.auth.getUser();
      logActivity({
        property_id: g.property_id,
        user_id: u.user?.id ?? "",
        user_name: userDisplayName(u.user as never),
        action_type: "GUEST_EDITED",
        module: "Guests",
        reference_id: g.id,
        reference_label: name,
        details: { guest_id: g.id, guest_name: name, changed_fields: changed },
      });
      toast.success("Saved");
      await load();
    } catch (e) { toast.error(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  }

  async function toggleBlacklist() {
    if (!g) return;
    const nextVal = !g.is_blacklisted;
    const { error } = await supabase.from("guests").update({ is_blacklisted: nextVal }).eq("id", g.id);
    if (error) toast.error(error.message);
    else {
      const { data: u } = await supabase.auth.getUser();
      logActivity({
        property_id: g.property_id,
        user_id: u.user?.id ?? "",
        user_name: userDisplayName(u.user as never),
        action_type: nextVal ? "GUEST_BLACKLISTED" : "GUEST_UNBLACKLISTED",
        module: "Guests",
        reference_id: g.id,
        reference_label: g.name,
        details: { guest_id: g.id, guest_name: g.name },
      });
      toast.success(g.is_blacklisted ? "Unblocked" : "Blacklisted");
      load();
    }
  }

  const totalSpend = stays.reduce((s, r) => s + Number(r.total_amount ?? 0), 0);
  const stayCount = stays.length;

  return (
    <AppShell title={g.name}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        {g.company && <span className="text-sm text-muted-foreground">{g.company}</span>}
        {g.is_blacklisted && <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-300"><Ban className="h-3 w-3 mr-1" />Blacklisted</Badge>}
        {(g.tags ?? []).map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={toggleBlacklist}>
            {g.is_blacklisted ? <><ShieldCheck className="h-4 w-4 mr-1" />Unblacklist</> : <><Ban className="h-4 w-4 mr-1" />Blacklist</>}
          </Button>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-4">
        <Stat label="Total stays" value={stayCount.toString()} />
        <Stat label="Lifetime value" value={inr(totalSpend)} />
        <Stat label="Last visit" value={stays[0]?.check_in ?? "—"} />
      </div>

      <div className="grid gap-4 md:grid-cols-3 mb-4">
        <Stat label="Total billed" value={inr(ledger?.totalBilled ?? 0)} />
        <Stat label="Total paid" value={inr(ledger?.totalPaid ?? 0)} />
        <Stat label="Total due" value={inr(ledger?.totalDue ?? 0)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader><CardTitle className="text-base">Profile</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="grid gap-3 md:grid-cols-2">
              <Field label="Name"><Input value={g.name} onChange={(e) => patch("name", e.target.value)} maxLength={120} /></Field>
              <Field label="Mobile *">
                <Input
                  value={g.mobile ?? ""}
                  onChange={(e) => patch("mobile", sanitizeMobile(e.target.value))}
                  inputMode="numeric"
                  pattern="\d{10}"
                  maxLength={10}
                  placeholder="10-digit mobile"
                  className={g.mobile && !isValidMobile(g.mobile) ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {g.mobile && !isValidMobile(g.mobile) && (
                  <p className="mt-1 text-[11px] text-red-600">{MOBILE_ERROR}</p>
                )}
              </Field>
              <Field label="Email"><Input value={g.email ?? ""} onChange={(e) => patch("email", e.target.value)} maxLength={255} /></Field>
              <Field label="Gender">
                <Select value={g.gender ?? ""} onValueChange={(v) => patch("gender", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="male">Male</SelectItem>
                    <SelectItem value="female">Female</SelectItem>
                    <SelectItem value="other">Other</SelectItem>
                  </SelectContent>
                </Select>
              </Field>
              <Field label="DOB"><Input type="date" value={g.dob ?? ""} onChange={(e) => patch("dob", e.target.value)} /></Field>
              <Field label="Nationality"><Input value={g.nationality ?? ""} onChange={(e) => patch("nationality", e.target.value)} /></Field>
              <Field label="ID type">
                <Select value={g.id_proof_type ?? ""} onValueChange={(v) => patch("id_proof_type", v)}>
                  <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                  <SelectContent>
                    {ID_PROOF_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
              <Field label="ID number"><Input value={g.id_proof_number ?? ""} onChange={(e) => patch("id_proof_number", e.target.value)} maxLength={40} /></Field>
              <Field label="Company Name">
                <Input value={g.company ?? ""} onChange={(e) => patch("company", e.target.value)} maxLength={200} placeholder="e.g. Growth Story Pvt Ltd" />
                <p className="mt-1 text-[11px] text-muted-foreground">Optional — useful for corporate / business travelers</p>
              </Field>
              <Field label="GSTIN">
                <Input
                  value={g.gst_number ?? ""}
                  onChange={(e) => patch("gst_number", e.target.value.toUpperCase())}
                  maxLength={15}
                  placeholder="e.g. 27AASFB5351R1ZM"
                  className={g.gst_number && !isValidOrEmptyGSTIN(g.gst_number) ? "border-red-500 focus-visible:ring-red-500" : ""}
                />
                {g.gst_number && !isValidOrEmptyGSTIN(g.gst_number) && (
                  <p className="mt-1 text-[11px] text-red-600">{GSTIN_ERROR}</p>
                )}
              </Field>
              <Field label="City"><CityInput value={g.city ?? ""} onChange={(v) => patch("city", v)} /></Field>
              <Field label="State">
                <StateSelect value={g.state ?? ""} onChange={(v) => patch("state", v)} />
                {!g.state && <p className="mt-1 text-[11px] text-muted-foreground">Used to decide CGST+SGST vs IGST on invoices.</p>}
              </Field>
              <Field label="Nation"><NationInput value={g.country ?? ""} onChange={(v) => patch("country", v)} /></Field>
              <Field label="Pincode"><Input value={g.pincode ?? ""} onChange={(e) => patch("pincode", e.target.value)} maxLength={12} /></Field>
              <div className="md:col-span-2"><Field label="Address Line"><Textarea rows={2} value={g.address ?? ""} onChange={(e) => patch("address", e.target.value)} maxLength={500} /></Field></div>
              <div className="md:col-span-2"><Field label="Tags (comma separated)"><Input value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} /></Field></div>
              <div className="md:col-span-2"><Field label="Notes"><Textarea rows={2} value={g.notes ?? ""} onChange={(e) => patch("notes", e.target.value)} maxLength={1000} /></Field></div>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => router.history.back()}>Back</Button>
              <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save changes"}</Button>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Stay history</CardTitle></CardHeader>
          <CardContent className="p-0 divide-y max-h-[600px] overflow-auto">
            {stays.length === 0 && <p className="p-4 text-sm text-muted-foreground">No stays yet.</p>}
            {stays.map((s) => (
              <Link key={s.id} to="/front-desk/booking/$id" params={{ id: s.id }}
                className="block px-4 py-3 text-sm hover:bg-accent">
                <div className="flex items-center justify-between">
                  <div className="font-medium">{s.booking_number}</div>
                  <Badge variant="outline" className="text-[10px]">{s.status}</Badge>
                </div>
                <div className="text-xs text-muted-foreground">
                  {s.check_in} → {s.check_out} · {inr(s.total_amount)}
                </div>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">ID Document</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {g.id_document_url ? (
              <>
                <div className="text-xs text-muted-foreground">
                  {g.id_document_name ?? "Document"}
                  {g.id_document_uploaded_at && (
                    <> · uploaded {new Date(g.id_document_uploaded_at).toLocaleString()}</>
                  )}
                </div>
                <a
                  href={g.id_document_url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-primary underline"
                >
                  View on Google Drive ↗
                </a>
              </>
            ) : g.id_document_name ? (
              <div className="text-xs text-muted-foreground">
                {g.id_document_name} (Drive not configured)
              </div>
            ) : (
              <p className="text-sm text-muted-foreground">No document uploaded</p>
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-3">
          <CardHeader><CardTitle className="text-base">Feedback & reviews</CardTitle></CardHeader>
          <CardContent className="p-0 divide-y">
            {feedback.length === 0 && <p className="p-4 text-sm text-muted-foreground">No feedback received yet.</p>}
            {feedback.map((f) => (
              <div key={f.id} className="px-4 py-3 text-sm">
                <div className="flex items-center justify-between">
                  <div className="font-medium">★ {f.overall_rating}/5</div>
                  <div className="text-xs text-muted-foreground">{f.feedback_date} · {f.source}</div>
                </div>
                {f.comments && <div className="text-xs text-muted-foreground mt-1">{f.comments}</div>}
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </AppShell>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div><Label className="mb-1 block text-xs">{label}</Label>{children}</div>;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <Card><CardContent className="p-4">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold mt-1">{value}</div>
    </CardContent></Card>
  );
}