import { createFileRoute, Link, useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useState } from "react";
import { fetchBanquetScope, isBanquetRecord } from "@/lib/banquetScope";
import { AppShell } from "@/components/AppShell";
import { CityInput, StateSelect, NationInput } from "@/components/AddressFields";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { BackButton } from "@/components/BackButton";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Ban, ShieldCheck, Pencil, Printer, FileText } from "lucide-react";
import { ID_PROOF_TYPES, guestSchema, emptyToNull } from "@/lib/guests";
import { isValidOrEmptyGSTIN, GSTIN_ERROR } from "@/lib/gstin";
import { isValidMobile, sanitizeMobile, MOBILE_ERROR } from "@/lib/mobile";
import { inr } from "@/lib/billing";
import { logActivity, userDisplayName } from "@/lib/activityLog";
import { fetchGuestLedger, type GuestLedger } from "@/lib/guestLedger";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

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
  rooms?: string[]; categories?: string[];
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
  const [editing, setEditing] = useState(false);
  const [prop, setProp] = useState<{
    name: string; address: string | null; city: string | null; state: string | null;
    phone: string | null; gstin: string | null;
  } | null>(null);

  const load = useCallback(async () => {
    const { data } = await supabase.from("guests").select("*").eq("id", id).maybeSingle();
    setG((data as Guest | null) ?? null);
    setTagsInput((data?.tags ?? []).join(", "));
    const { data: b } = await supabase.from("bookings")
      .select("id,booking_number,status,check_in,check_out,total_amount,booking_rooms(rooms!booking_rooms_room_id_fkey(room_number),room_categories(name))")
      .eq("guest_id", id).order("check_in", { ascending: false }).limit(50);
    // Hide banquet event-block stays once their 48h window has lapsed.
    const scope = await fetchBanquetScope(null);
    setStays(((b ?? []) as any[])
      .filter((s) => !isBanquetRecord(scope, { booking_id: s.id }))
      .map((s) => {
        const brs = (s.booking_rooms ?? []) as any[];
        return {
          ...s,
          rooms: Array.from(new Set(brs.map((r) => r.rooms?.room_number).filter(Boolean))).map(String),
          categories: Array.from(new Set(brs.map((r) => r.room_categories?.name).filter(Boolean))).map(String),
        };
      }) as Stay[]);
    const { data: f } = await supabase.from("guest_feedback")
      .select("id,feedback_date,overall_rating,comments,source")
      .eq("guest_id", id).order("feedback_date", { ascending: false }).limit(20);
    setFeedback((f ?? []) as Feedback[]);
    try { setLedger(await fetchGuestLedger(id)); } catch { setLedger(null); }
    if (data?.property_id) {
      const { data: p } = await supabase.from("properties")
        .select("name,address,city,state,phone,gstin")
        .eq("id", data.property_id).maybeSingle();
      setProp((p as any) ?? null);
    }
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

  // Running-balance statement rows (oldest → newest), bank-statement style.
  const statement = (() => {
    const src = [...(ledger?.rows ?? [])].sort((a, b) =>
      a.date < b.date ? -1 : a.date > b.date ? 1 : 0,
    );
    let bal = 0;
    return src.flatMap((r) => {
      const out: Array<{
        key: string; date: string; description: string;
        debit: number; credit: number; balance: number;
      }> = [];
      bal += r.total;
      out.push({
        key: `${r.type}-${r.id}-d`,
        date: r.date || "—",
        description: `${r.type} bill ${r.number}`,
        debit: r.total,
        credit: 0,
        balance: bal,
      });
      if (r.paid > 0) {
        bal -= r.paid;
        out.push({
          key: `${r.type}-${r.id}-c`,
          date: r.date || "—",
          description: `Payment received — ${r.number}`,
          debit: 0,
          credit: r.paid,
          balance: bal,
        });
      }
      return out;
    });
  })();

  function printLedger() {
    const source = document.getElementById("guest-ledger-print-area");
    if (!source) { window.print(); return; }
    const html = source.outerHTML;
    const printCss = `
      @page { size: A4 portrait; margin: 12mm; }
      html, body { background: #fff !important; margin: 0 !important; padding: 0 !important; color: #000 !important; font-family: Arial, sans-serif; }
      body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      .ledger-print { display: block !important; width: 100% !important; font-size: 10.5pt; line-height: 1.45; color: #000 !important; }
      .ledger-print table { border-collapse: collapse; width: 100%; }
      .ledger-print th, .ledger-print td { border: 1px solid #000; padding: 4px 6px; }
      .ledger-print th { background: #eee; text-align: left; font-size: 9.5pt; text-transform: uppercase; }
      .ledger-print .num { text-align: right; font-variant-numeric: tabular-nums; }
      .no-print { display: none !important; }
    `;
    // NOTE: parent stylesheets are deliberately NOT copied — the app's global
    // `@media print { body * { visibility: hidden } }` rule (scoped to
    // #invoice-print-area) would blank this page out entirely.
    const doc = `<!doctype html><html><head><meta charset="utf-8"><title>Guest Ledger — ${g?.name ?? ""}</title><style>${printCss}</style></head><body>${html}</body></html>`;
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
      try { iframe.parentNode?.removeChild(iframe); } catch { /* ignore */ }
    };
    iframe.onload = () => {
      const win = iframe.contentWindow;
      if (!win) { cleanup(); return; }
      try { win.focus(); } catch { /* ignore */ }
      try { win.addEventListener("afterprint", () => setTimeout(cleanup, 200)); } catch { /* ignore */ }
      setTimeout(() => {
        try { win.print(); } catch { cleanup(); }
        setTimeout(cleanup, 60_000);
      }, 50);
    };
    iframe.srcdoc = doc;
  }

  const ro = !editing;

  return (
    <AppShell title={g.name}>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div>
          <h1 className="text-xl font-semibold leading-tight">{g.name}</h1>
          <div className="flex flex-wrap items-center gap-2 mt-1">
            {g.company && <span className="text-sm text-muted-foreground">{g.company}</span>}
            {g.mobile && <span className="text-sm text-muted-foreground">· {g.mobile}</span>}
            {g.is_blacklisted && (
              <Badge variant="outline" className="bg-rose-100 text-rose-800 border-rose-300">
                <Ban className="h-3 w-3 mr-1" />Blacklisted
              </Badge>
            )}
            {(g.tags ?? []).map((t) => <Badge key={t} variant="secondary">{t}</Badge>)}
          </div>
        </div>
        <div className="ml-auto flex gap-2">
          <Button variant="outline" onClick={toggleBlacklist}>
            {g.is_blacklisted ? <><ShieldCheck className="h-4 w-4 mr-1" />Unblacklist</> : <><Ban className="h-4 w-4 mr-1" />Blacklist</>}
          </Button>
          {!editing && (
            <Button onClick={() => setEditing(true)}>
              <Pencil className="h-4 w-4 mr-1" />Edit Profile
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 mb-4">
        <Stat label="Total stays" value={stayCount.toString()} />
        <Stat label="Lifetime value" value={inr(totalSpend)} />
        <Stat label="Last visit" value={stays[0]?.check_in ?? "—"} />
        <Stat label="Total billed" value={inr(ledger?.totalBilled ?? 0)} />
        <Stat label="Total paid" value={inr(ledger?.totalPaid ?? 0)} />
        <Stat label="Total due" value={inr(ledger?.totalDue ?? 0)} />
      </div>

      <Card className="mb-4">
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle className="text-base">Profile</CardTitle>
          {editing && (
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => { setEditing(false); load(); }}>Cancel</Button>
              <Button size="sm" onClick={async () => { await save(); setEditing(false); }} disabled={busy}>
                {busy ? "Saving…" : "Save"}
              </Button>
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 md:grid-cols-2">
            <Field label="Name"><Input autoTitleCase readOnly={ro} value={g.name} onChange={(e) => patch("name", e.target.value)} maxLength={120} /></Field>
            <Field label="Mobile *">
              <Input
                readOnly={ro}
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
            <Field label="Email"><Input readOnly={ro} value={g.email ?? ""} onChange={(e) => patch("email", e.target.value)} maxLength={255} /></Field>
            <Field label="Gender">
              <Select disabled={ro} value={g.gender ?? ""} onValueChange={(v) => patch("gender", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="male">Male</SelectItem>
                  <SelectItem value="female">Female</SelectItem>
                  <SelectItem value="other">Other</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            <Field label="DOB"><Input readOnly={ro} type="date" value={g.dob ?? ""} onChange={(e) => patch("dob", e.target.value)} /></Field>
            <Field label="Nationality"><Input readOnly={ro} value={g.nationality ?? ""} onChange={(e) => patch("nationality", e.target.value)} /></Field>
            <Field label="ID type">
              <Select disabled={ro} value={g.id_proof_type ?? ""} onValueChange={(v) => patch("id_proof_type", v)}>
                <SelectTrigger><SelectValue placeholder="—" /></SelectTrigger>
                <SelectContent>
                  {ID_PROOF_TYPES.map((t) => <SelectItem key={t} value={t}>{t.replace("_", " ")}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="ID number"><Input readOnly={ro} value={g.id_proof_number ?? ""} onChange={(e) => patch("id_proof_number", e.target.value)} maxLength={40} /></Field>
            <Field label="Company Name">
              <Input autoTitleCase readOnly={ro} value={g.company ?? ""} onChange={(e) => patch("company", e.target.value)} maxLength={200} placeholder="e.g. Growth Story Pvt Ltd" />
              <p className="mt-1 text-[11px] text-muted-foreground">Optional — useful for corporate / business travelers</p>
            </Field>
            <Field label="GSTIN">
              <Input
                readOnly={ro}
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
            {ro ? (
              <Field label="City"><Input readOnly value={g.city ?? ""} /></Field>
            ) : (
              <Field label="City"><CityInput value={g.city ?? ""} onChange={(v) => patch("city", v)} /></Field>
            )}
            <Field label="State">
              {ro ? (
                <Input readOnly value={g.state ?? ""} />
              ) : (
                <StateSelect value={g.state ?? ""} onChange={(v) => patch("state", v)} />
              )}
              {!g.state && <p className="mt-1 text-[11px] text-muted-foreground">Used to decide CGST+SGST vs IGST on invoices.</p>}
            </Field>
            {ro ? (
              <Field label="Nation"><Input readOnly value={g.country ?? ""} /></Field>
            ) : (
              <Field label="Nation"><NationInput value={g.country ?? ""} onChange={(v) => patch("country", v)} /></Field>
            )}
            <Field label="Pincode"><Input readOnly={ro} value={g.pincode ?? ""} onChange={(e) => patch("pincode", e.target.value)} maxLength={12} /></Field>
            <div className="md:col-span-2"><Field label="Address Line"><Textarea readOnly={ro} rows={2} value={g.address ?? ""} onChange={(e) => patch("address", e.target.value)} maxLength={500} /></Field></div>
            <div className="md:col-span-2"><Field label="Tags (comma separated)"><Input readOnly={ro} value={tagsInput} onChange={(e) => setTagsInput(e.target.value)} /></Field></div>
            <div className="md:col-span-2"><Field label="Notes"><Textarea readOnly={ro} rows={2} value={g.notes ?? ""} onChange={(e) => patch("notes", e.target.value)} maxLength={1000} /></Field></div>
          </div>
          <div className="flex justify-end gap-2">
            <BackButton fallbackTo="/guests" />
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue="ledger" className="w-full">
        <TabsList>
          <TabsTrigger value="ledger">Ledger</TabsTrigger>
          <TabsTrigger value="stays">Stay History</TabsTrigger>
          <TabsTrigger value="documents">Documents</TabsTrigger>
          <TabsTrigger value="feedback">Feedback</TabsTrigger>
        </TabsList>

        <TabsContent value="ledger">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Statement of Account</CardTitle>
              <Button variant="outline" size="sm" onClick={printLedger}>
                <Printer className="h-4 w-4 mr-1" />Print Ledger
              </Button>
            </CardHeader>
            <CardContent className="p-0">
              {!ledger && <p className="p-4 text-sm text-muted-foreground">Loading ledger…</p>}
              {ledger && statement.length === 0 && (
                <p className="p-4 text-sm text-muted-foreground">No bills raised for this guest yet.</p>
              )}
              {ledger && statement.length > 0 && (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-xs uppercase tracking-wider text-muted-foreground">
                      <tr>
                        <th className="px-4 py-2 text-left">Date</th>
                        <th className="px-4 py-2 text-left">Description</th>
                        <th className="px-4 py-2 text-right">Debit</th>
                        <th className="px-4 py-2 text-right">Credit</th>
                        <th className="px-4 py-2 text-right">Balance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {statement.map((r) => (
                        <tr key={r.key}>
                          <td className="px-4 py-2 whitespace-nowrap">{r.date}</td>
                          <td className="px-4 py-2">{r.description}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.debit ? inr(r.debit) : "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums">{r.credit ? inr(r.credit) : "—"}</td>
                          <td className="px-4 py-2 text-right tabular-nums font-medium">{inr(r.balance)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot className="border-t bg-muted/30 font-medium">
                      <tr>
                        <td className="px-4 py-2" colSpan={2}>Closing balance</td>
                        <td className="px-4 py-2 text-right tabular-nums">{inr(ledger.totalBilled)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{inr(ledger.totalPaid)}</td>
                        <td className="px-4 py-2 text-right tabular-nums">{inr(ledger.totalDue)}</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="stays">
          <Card>
            <CardHeader><CardTitle className="text-base">Stay history</CardTitle></CardHeader>
            <CardContent className="p-0 divide-y">
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
        </TabsContent>

        <TabsContent value="documents">
          <Card>
            <CardHeader><CardTitle className="text-base">ID Document</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              {g.id_document_url ? (
                <div className="space-y-2">
                  <div className="text-xs text-muted-foreground">
                    {g.id_document_name ?? "Document"}
                    {g.id_document_uploaded_at && (
                      <> · uploaded {new Date(g.id_document_uploaded_at).toLocaleString()}</>
                    )}
                  </div>
                  <DrivePreview url={g.id_document_url} name={g.id_document_name ?? "Document"} />
                </div>
              ) : g.id_document_name ? (
                <div className="text-xs text-muted-foreground">
                  {g.id_document_name} (document link unavailable)
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No document uploaded</p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="feedback">
          <Card>
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
        </TabsContent>
      </Tabs>

      {/* Hidden A4 statement used by Print Ledger (hidden-iframe pattern). */}
      <div className="hidden">
        <div id="guest-ledger-print-area" className="ledger-print">
          <div style={{ textAlign: "center", marginBottom: "6mm" }}>
            <div style={{ fontSize: "14pt", fontWeight: 700 }}>{prop?.name ?? "Hotel"}</div>
            <div style={{ fontSize: "9.5pt" }}>
              {[prop?.address, prop?.city, prop?.state].filter(Boolean).join(", ")}
            </div>
            <div style={{ fontSize: "9.5pt" }}>
              {prop?.phone ? `Ph: ${prop.phone}` : ""}{prop?.gstin ? ` · GSTIN: ${prop.gstin}` : ""}
            </div>
            <div style={{ marginTop: "4mm", fontSize: "12pt", fontWeight: 700, textTransform: "uppercase" }}>
              Guest Statement of Account
            </div>
          </div>
          <table style={{ marginBottom: "4mm" }}>
            <tbody>
              <tr>
                <td><b>Guest:</b> {g.name}</td>
                <td><b>Mobile:</b> {g.mobile ?? "—"}</td>
              </tr>
              <tr>
                <td><b>Company:</b> {g.company ?? "—"}</td>
                <td><b>GSTIN:</b> {g.gst_number ?? "—"}</td>
              </tr>
              <tr>
                <td colSpan={2}>
                  <b>Address:</b>{" "}
                  {[g.address, g.city, g.state, g.pincode].filter(Boolean).join(", ") || "—"}
                </td>
              </tr>
            </tbody>
          </table>
          <table>
            <thead>
              <tr>
                <th>Date</th>
                <th>Description</th>
                <th className="num">Debit</th>
                <th className="num">Credit</th>
                <th className="num">Balance</th>
              </tr>
            </thead>
            <tbody>
              {statement.map((r) => (
                <tr key={`p-${r.key}`}>
                  <td>{r.date}</td>
                  <td>{r.description}</td>
                  <td className="num">{r.debit ? inr(r.debit) : "—"}</td>
                  <td className="num">{r.credit ? inr(r.credit) : "—"}</td>
                  <td className="num">{inr(r.balance)}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}><b>Closing balance</b></td>
                <td className="num"><b>{inr(ledger?.totalBilled ?? 0)}</b></td>
                <td className="num"><b>{inr(ledger?.totalPaid ?? 0)}</b></td>
                <td className="num"><b>{inr(ledger?.totalDue ?? 0)}</b></td>
              </tr>
            </tfoot>
          </table>
          <div style={{ marginTop: "6mm", fontSize: "9pt" }}>
            Generated on {new Date().toLocaleString("en-IN")}
          </div>
        </div>
      </div>
    </AppShell>
  );
}

function DrivePreview({ url, name }: { url: string; name: string }) {
  const [failed, setFailed] = useState(false);
  const idMatch = /\/d\/([A-Za-z0-9_-]+)/.exec(url) ?? /[?&]id=([A-Za-z0-9_-]+)/.exec(url);
  const fileId = idMatch?.[1] ?? null;
  return (
    <div className="space-y-2">
      {fileId && !failed ? (
        <iframe
          title={name}
          src={`https://drive.google.com/file/d/${fileId}/preview`}
          className="w-full h-[420px] rounded border"
          onError={() => setFailed(true)}
        />
      ) : (
        <div className="flex items-center gap-2 rounded border border-dashed p-4 text-sm text-muted-foreground">
          <FileText className="h-4 w-4" />
          Preview unavailable — open the document directly.
        </div>
      )}
      <a href={url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-primary underline">
        Open document ↗
      </a>
    </div>
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