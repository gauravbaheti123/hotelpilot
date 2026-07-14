import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { AppShell } from "@/components/AppShell";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useCurrentProperty } from "@/hooks/use-property";
import { usePermissions } from "@/hooks/use-permissions";
import { EmptyPropertyState } from "@/components/EmptyPropertyState";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { RequirePermission } from "@/components/RequirePermission";
import {
  Building2, MapPin, FileText, Image as ImageIcon, Percent,
  Receipt, Clock, Star, Save, Upload, Trash2,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/settings/hotel")({
  head: () => ({ meta: [{ title: "Hotel Settings — HotelPilot" }] }),
  component: () => (<RequirePermission module="settings_business"><HotelSettingsPage /></RequirePermission>),
});

const INDIAN_STATES: Array<{ name: string; code: string }> = [
  { name: "Andaman and Nicobar Islands", code: "35" },
  { name: "Andhra Pradesh", code: "28" },
  { name: "Arunachal Pradesh", code: "12" },
  { name: "Assam", code: "18" },
  { name: "Bihar", code: "10" },
  { name: "Chandigarh", code: "04" },
  { name: "Chhattisgarh", code: "22" },
  { name: "Dadra and Nagar Haveli and Daman and Diu", code: "26" },
  { name: "Delhi", code: "07" },
  { name: "Goa", code: "30" },
  { name: "Gujarat", code: "24" },
  { name: "Haryana", code: "06" },
  { name: "Himachal Pradesh", code: "02" },
  { name: "Jammu and Kashmir", code: "01" },
  { name: "Jharkhand", code: "20" },
  { name: "Karnataka", code: "29" },
  { name: "Kerala", code: "32" },
  { name: "Ladakh", code: "38" },
  { name: "Lakshadweep", code: "31" },
  { name: "Madhya Pradesh", code: "23" },
  { name: "Maharashtra", code: "27" },
  { name: "Manipur", code: "14" },
  { name: "Meghalaya", code: "17" },
  { name: "Mizoram", code: "15" },
  { name: "Nagaland", code: "13" },
  { name: "Odisha", code: "21" },
  { name: "Puducherry", code: "34" },
  { name: "Punjab", code: "03" },
  { name: "Rajasthan", code: "08" },
  { name: "Sikkim", code: "11" },
  { name: "Tamil Nadu", code: "33" },
  { name: "Telangana", code: "36" },
  { name: "Tripura", code: "16" },
  { name: "Uttar Pradesh", code: "09" },
  { name: "Uttarakhand", code: "05" },
  { name: "West Bengal", code: "19" },
];

const GSTIN_RE = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[0-9A-Z]{1}Z[0-9A-Z]{1}$/;
const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
const PIN_RE = /^[0-9]{6}$/;
const PHONE_RE = /^[0-9]{10}$/;

type FormState = Record<string, any>;

function HotelSettingsPage() {
  const { current, currentId: propertyId, reload: reloadProps } = useCurrentProperty();
  const { can } = usePermissions();
  const allowed = can("settings_business", "view");
  const readOnly = !can("settings_business", "edit");

  if (!propertyId) {
    return (
      <AppShell title="Hotel Settings">
        <EmptyPropertyState />
      </AppShell>
    );
  }

  if (!allowed) {
    return (
      <AppShell title="Hotel Settings">
        <Card><CardContent className="p-6 text-sm text-muted-foreground">
          You do not have permission to view hotel settings.
        </CardContent></Card>
      </AppShell>
    );
  }

  return (
    <AppShell title="Hotel Settings">
      <HotelSettingsForm propertyId={propertyId} readOnly={readOnly} reloadProps={reloadProps} />
    </AppShell>
  );
}

function HotelSettingsForm({
  propertyId, readOnly, reloadProps,
}: { propertyId: string; readOnly: boolean; reloadProps: () => void }) {
  const [form, setForm] = useState<FormState>({});
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [logoSignedUrl, setLogoSignedUrl] = useState<string | null>(null);
  const [categories, setCategories] = useState<Array<{ id: string; name: string; rate_per_night: number | null; gst_rate: number | null }>>([]);
  const [slabs, setSlabs] = useState<Array<{ id?: string; from_amount: number; to_amount: number; gst_rate: number }>>([]);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const set = (k: string, v: any) => setForm((f) => ({ ...f, [k]: v }));

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      const { data, error } = await supabase
        .from("properties")
        .select("*")
        .eq("id", propertyId)
        .maybeSingle();
      if (error) { toast.error(error.message); setLoaded(true); return; }
      setForm(data ?? {});
      if (data?.logo_url) refreshLogoSignedUrl(data.logo_url);

      const { data: cats } = await supabase
        .from("room_categories")
        .select("id,name,rate_per_night,gst_rate")
        .eq("property_id", propertyId)
        .order("name");
      setCategories((cats ?? []) as any);
      const { data: sl } = await supabase.from("gst_slabs" as any)
        .select("id,from_amount,to_amount,gst_rate")
        .eq("property_id", propertyId)
        .order("from_amount");
      setSlabs(((sl as any) ?? []) as any);
      setLoaded(true);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId]);

  async function refreshLogoSignedUrl(pathOrUrl: string) {
    // path stored as bucket-relative, e.g. {propertyId}/logo.png
    const path = pathOrUrl.startsWith("http")
      ? pathOrUrl.split("/hotel-assets/")[1] ?? null
      : pathOrUrl;
    if (!path) { setLogoSignedUrl(null); return; }
    const { data } = await supabase.storage.from("hotel-assets").createSignedUrl(path, 3600);
    setLogoSignedUrl(data?.signedUrl ?? null);
  }

  function validate(): string | null {
    if (!form.name?.trim()) return "Hotel Name is required";
    if (form.short_code && form.short_code.length > 5) return "Short Code must be ≤ 5 characters";
    if (form.pin_code && !PIN_RE.test(form.pin_code)) return "PIN Code must be 6 digits";
    if (form.phone && !PHONE_RE.test(String(form.phone).replace(/\D/g, "").slice(-10))) return "Phone must be 10 digits";
    if (form.email && !/^\S+@\S+\.\S+$/.test(form.email)) return "Invalid email";
    if (form.gstin && !GSTIN_RE.test(form.gstin.toUpperCase())) return "Invalid GSTIN format";
    if (form.pan_number && !PAN_RE.test(form.pan_number.toUpperCase())) return "Invalid PAN format (AAAAA9999A)";
    if (form.website && !/^https?:\/\//i.test(form.website)) return "Website must start with http:// or https://";
    return null;
  }

  async function onUploadLogo(file: File) {
    if (file.size > 2 * 1024 * 1024) { toast.error("Max size 2MB"); return; }
    if (!["image/jpeg", "image/png"].includes(file.type)) { toast.error("Only JPG / PNG"); return; }
    setUploading(true);
    try {
      const ext = file.type === "image/png" ? "png" : "jpg";
      const path = `${propertyId}/logo.${ext}`;
      const { error: upErr } = await supabase.storage
        .from("hotel-assets")
        .upload(path, file, { upsert: true, contentType: file.type });
      if (upErr) throw upErr;
      const { error: dbErr } = await supabase
        .from("properties").update({ logo_url: path }).eq("id", propertyId);
      if (dbErr) throw dbErr;
      set("logo_url", path);
      await refreshLogoSignedUrl(path);
      toast.success("Logo uploaded");
      reloadProps();
    } catch (e: any) { toast.error(e.message ?? "Upload failed"); }
    finally { setUploading(false); }
  }

  async function onRemoveLogo() {
    if (!form.logo_url) return;
    if (!confirm("Remove logo?")) return;
    await supabase.storage.from("hotel-assets").remove([form.logo_url]);
    await supabase.from("properties").update({ logo_url: null }).eq("id", propertyId);
    set("logo_url", null);
    setLogoSignedUrl(null);
    toast.success("Logo removed");
    reloadProps();
  }

  async function onSave() {
    const err = validate();
    if (err) { toast.error(err); return; }
    setSaving(true);
    try {
      const updates: any = {
        name: form.name,
        short_code: form.short_code?.toUpperCase() || null,
        tagline: form.tagline?.trim() || null,
        star_rating: form.star_rating ?? null,
        total_floors: form.total_floors ? Number(form.total_floors) : null,
        total_rooms: form.total_rooms ? Number(form.total_rooms) : null,
        address_line1: form.address_line1 || null,
        address_line2: form.address_line2 || null,
        city: form.city || null,
        state: form.state || null,
        pin_code: form.pin_code || null,
        phone: form.phone || null,
        email: form.email || null,
        website: form.website || null,
        gstin: form.gstin?.toUpperCase() || null,
        pan_number: form.pan_number?.toUpperCase() || null,
        state_code: form.state_code || null,
        legal_entity_name: form.legal_entity_name || null,
        invoice_prefix: form.invoice_prefix?.toUpperCase() || "INV",
        invoice_start_number: form.invoice_start_number ? Number(form.invoice_start_number) : 1,
        default_bill_type: form.default_bill_type || "cash",
        invoice_footer: form.invoice_footer || null,
        invoice_primary_color: form.invoice_primary_color || "#1D9E75",
        invoice_template: "premium",
        invoice_show_hsn: !!form.invoice_show_hsn,
        invoice_show_gst_breakup: !!form.invoice_show_gst_breakup,
        invoice_show_signature: !!form.invoice_show_signature,
        invoice_show_powered_by: !!form.invoice_show_powered_by,
        default_checkin_time: form.default_checkin_time || "12:00",
        default_checkout_time: form.default_checkout_time || "11:00",
        early_checkin_charge_per_hour: Number(form.early_checkin_charge_per_hour ?? 0),
        late_checkout_charge_per_hour: Number(form.late_checkout_charge_per_hour ?? 0),
        food_gst_rate: Number(form.food_gst_rate ?? 5),
        sundry_gst_rate: Number(form.sundry_gst_rate ?? 18),
      };
      const { error: propErr } = await supabase.from("properties").update(updates).eq("id", propertyId);
      if (propErr) throw propErr;

      for (const c of categories) {
        const { error } = await supabase
          .from("room_categories")
          .update({ gst_rate: c.gst_rate ?? 0 })
          .eq("id", c.id);
        if (error) throw error;
      }

      // GST slabs persistence
      await supabase.from("properties").update({
        use_gst_slabs: !!form.use_gst_slabs,
      } as any).eq("id", propertyId);
      if (form.use_gst_slabs) {
        // wipe & reinsert slabs (simple, small N)
        await supabase.from("gst_slabs" as any).delete().eq("property_id", propertyId);
        const valid = (slabs ?? []).filter((s) =>
          Number.isFinite(Number(s.from_amount)) && Number.isFinite(Number(s.to_amount)));
        if (valid.length > 0) {
          await supabase.from("gst_slabs" as any).insert(
            valid.map((s) => ({
              property_id: propertyId,
              from_amount: Number(s.from_amount),
              to_amount: Number(s.to_amount),
              gst_rate: Number(s.gst_rate),
              active: true,
            })),
          );
        }
      }

      toast.success("Settings saved successfully");
      reloadProps();
    } catch (e: any) { toast.error(e.message ?? "Save failed"); }
    finally { setSaving(false); }
  }

  if (!loaded) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }

  const dis = readOnly;
  const hotelInitials = (form.name || "HP").split(/\s+/).map((s: string) => s[0]).slice(0, 2).join("").toUpperCase();

  return (
    <div className="space-y-5 pb-24">
      {/* SECTION A: Basic Info */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" /> Basic Info</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <Field label="Hotel Name *"><Input disabled={dis} value={form.name ?? ""} onChange={(e) => set("name", e.target.value)} /></Field>
          <Field label="Short Code (≤5)"><Input disabled={dis} maxLength={5} value={form.short_code ?? ""} onChange={(e) => set("short_code", e.target.value.toUpperCase())} /></Field>
          <div className="md:col-span-2">
            <Field label="Hotel Tagline" hint="Shows below hotel name on invoice.">
              <Input disabled={dis} maxLength={100} placeholder="Hospitality · Experience · Comfort"
                value={form.tagline ?? ""} onChange={(e) => set("tagline", e.target.value)} />
            </Field>
          </div>
          <Field label="Star Rating">
            <div className="flex items-center gap-1">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n} type="button" disabled={dis}
                  onClick={() => set("star_rating", n)}
                  className="p-0.5 disabled:opacity-60"
                >
                  <Star className={`h-6 w-6 ${(form.star_rating ?? 0) >= n ? "fill-yellow-400 text-yellow-400" : "text-muted-foreground"}`} />
                </button>
              ))}
            </div>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Total Floors"><Input type="number" min={1} disabled={dis} value={form.total_floors ?? ""} onChange={(e) => set("total_floors", e.target.value)} /></Field>
            <Field label="Total Rooms"><Input type="number" min={1} disabled={dis} value={form.total_rooms ?? ""} onChange={(e) => set("total_rooms", e.target.value)} /></Field>
          </div>
        </CardContent>
      </Card>

      {/* SECTION B: Contact & Address */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><MapPin className="h-5 w-5" /> Contact & Address</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <Field label="Address Line 1"><Input disabled={dis} value={form.address_line1 ?? ""} onChange={(e) => set("address_line1", e.target.value)} /></Field>
          <Field label="Address Line 2"><Input disabled={dis} value={form.address_line2 ?? ""} onChange={(e) => set("address_line2", e.target.value)} /></Field>
          <Field label="City"><Input disabled={dis} value={form.city ?? ""} onChange={(e) => set("city", e.target.value)} /></Field>
          <Field label="State">
            <Select
              disabled={dis}
              value={form.state ?? ""}
              onValueChange={(v) => {
                set("state", v);
                const m = INDIAN_STATES.find((s) => s.name === v);
                if (m) set("state_code", m.code);
              }}
            >
              <SelectTrigger><SelectValue placeholder="Select state" /></SelectTrigger>
              <SelectContent>
                {INDIAN_STATES.map((s) => <SelectItem key={s.code} value={s.name}>{s.name}</SelectItem>)}
              </SelectContent>
            </Select>
          </Field>
          <Field label="PIN Code"><Input disabled={dis} maxLength={6} value={form.pin_code ?? ""} onChange={(e) => set("pin_code", e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Phone (10 digit)"><Input disabled={dis} value={form.phone ?? ""} onChange={(e) => set("phone", e.target.value)} /></Field>
          <Field label="Email"><Input type="email" disabled={dis} value={form.email ?? ""} onChange={(e) => set("email", e.target.value)} /></Field>
          <Field label="Website"><Input disabled={dis} placeholder="https://" value={form.website ?? ""} onChange={(e) => set("website", e.target.value)} /></Field>
        </CardContent>
      </Card>

      {/* SECTION C: GST & Legal */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><FileText className="h-5 w-5" /> GST & Legal</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <Field label="GSTIN (15 char)">
            <Input
              disabled={dis}
              maxLength={15}
              value={form.gstin ?? ""}
              onChange={(e) => {
                const v = e.target.value.toUpperCase();
                set("gstin", v);
                // Auto-fill state_code from first 2 chars of GSTIN (user can still override)
                if (v.length >= 2 && /^\d{2}/.test(v)) {
                  set("state_code", v.substring(0, 2));
                }
              }}
              placeholder="22AAAAA0000A1Z5"
            />
          </Field>
          <Field label="PAN Number">
            <Input disabled={dis} maxLength={10} value={form.pan_number ?? ""} onChange={(e) => set("pan_number", e.target.value.toUpperCase())} placeholder="AAAAA9999A" />
          </Field>
          <Field label="State Code" hint="Auto-derived from GSTIN; editable for corrections or unregistered dealers.">
            <Input disabled={dis} maxLength={2} value={form.state_code ?? ""} onChange={(e) => set("state_code", e.target.value.replace(/\D/g, ""))} placeholder="27" />
          </Field>
          <Field label="Legal Entity Name"><Input disabled={dis} value={form.legal_entity_name ?? ""} onChange={(e) => set("legal_entity_name", e.target.value)} /></Field>
        </CardContent>
      </Card>

      {/* SECTION D: Logo */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><ImageIcon className="h-5 w-5" /> Hotel Logo</CardTitle>
          <CardDescription>Used on invoice header and dashboard.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="w-[300px] h-[100px] rounded border bg-muted flex items-center justify-center overflow-hidden">
            {logoSignedUrl
              ? <img src={logoSignedUrl} alt="logo" className="object-contain max-h-full max-w-full" />
              : <div className="text-3xl font-bold text-muted-foreground">{hotelInitials}</div>}
          </div>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png" hidden
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onUploadLogo(f); e.currentTarget.value = ""; }} />
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" disabled={dis || uploading} onClick={() => fileRef.current?.click()}>
              <Upload className="h-4 w-4 mr-1" /> {uploading ? "Uploading…" : "Upload Logo"}
            </Button>
            {form.logo_url && (
              <Button type="button" variant="ghost" disabled={dis} onClick={onRemoveLogo}>
                <Trash2 className="h-4 w-4 mr-1" /> Remove
              </Button>
            )}
          </div>
          <p className="text-xs text-muted-foreground">JPG / PNG, max 2MB. Recommended: 600×200px (3:1 ratio).</p>
        </CardContent>
      </Card>

      {/* SECTION E: GST per category */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Percent className="h-5 w-5" /> Room Category GST Rates</CardTitle>
          <CardDescription>Set GST % per room category. Used in all billing and reports.</CardDescription>
        </CardHeader>
        <CardContent>
          {categories.length === 0 ? (
            <div className="text-sm text-muted-foreground">No room categories yet.</div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Rate / Night</TableHead>
                  <TableHead className="w-32 text-right">GST %</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {categories.map((c, i) => (
                  <TableRow key={c.id}>
                    <TableCell className="font-medium">{c.name}</TableCell>
                    <TableCell className="text-right">₹{(c.rate_per_night ?? 0).toLocaleString("en-IN")}</TableCell>
                    <TableCell className="text-right">
                      <Input type="number" min={0} max={28} step={0.5}
                        disabled={dis}
                        value={c.gst_rate ?? 0}
                        onChange={(e) => {
                          const v = Number(e.target.value);
                          setCategories((arr) => arr.map((x, idx) => idx === i ? { ...x, gst_rate: v } : x));
                        }}
                        className="w-24 ml-auto text-right" />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <p className="text-xs text-muted-foreground mt-3">
            GST slabs as per Indian law: ₹0–₹1000/night → 0% &nbsp;|&nbsp; ₹1001–₹7500 → 12% &nbsp;|&nbsp; Above ₹7500 → 18%
          </p>
          <div className="grid md:grid-cols-2 gap-4 mt-5 pt-4 border-t">
            <Field label="Food & Beverage GST %" hint="Default for food charges. Menu items may override.">
              <Input type="number" min={0} max={28} step={0.5} disabled={dis}
                value={form.food_gst_rate ?? 5}
                onChange={(e) => set("food_gst_rate", e.target.value)} />
            </Field>
            <Field label="Sundry / Other Charges GST %" hint="Default for sundry / extra charges.">
              <Input type="number" min={0} max={28} step={0.5} disabled={dis}
                value={form.sundry_gst_rate ?? 18}
                onChange={(e) => set("sundry_gst_rate", e.target.value)} />
            </Field>
          </div>
          {/* CUSTOM GST SLABS */}
          <div className="mt-6 pt-4 border-t space-y-3">
            <div className="flex items-center justify-between">
              <div>
                <div className="text-sm font-semibold">Custom GST Slabs</div>
                <p className="text-xs text-muted-foreground">
                  When ON, room GST is looked up by per-night rate instead of using the category GST.
                </p>
              </div>
              <Switch
                disabled={dis}
                checked={!!form.use_gst_slabs}
                onCheckedChange={(v) => {
                  set("use_gst_slabs", v);
                  if (v && slabs.length === 0) {
                    setSlabs([
                      { from_amount: 0, to_amount: 1000, gst_rate: 0 },
                      { from_amount: 1001, to_amount: 7500, gst_rate: 12 },
                      { from_amount: 7501, to_amount: 99999, gst_rate: 18 },
                    ]);
                  }
                }}
              />
            </div>
            {form.use_gst_slabs && (
              <div className="space-y-2">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>From (₹)</TableHead>
                      <TableHead>To (₹)</TableHead>
                      <TableHead className="w-28">GST %</TableHead>
                      <TableHead className="w-12"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {slabs.map((s, i) => (
                      <TableRow key={i}>
                        <TableCell>
                          <Input type="number" min={0} disabled={dis} value={s.from_amount}
                            onChange={(e) => setSlabs((arr) => arr.map((x, idx) => idx === i ? { ...x, from_amount: Number(e.target.value) } : x))} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} disabled={dis} value={s.to_amount}
                            onChange={(e) => setSlabs((arr) => arr.map((x, idx) => idx === i ? { ...x, to_amount: Number(e.target.value) } : x))} />
                        </TableCell>
                        <TableCell>
                          <Input type="number" min={0} max={28} step={0.5} disabled={dis} value={s.gst_rate}
                            onChange={(e) => setSlabs((arr) => arr.map((x, idx) => idx === i ? { ...x, gst_rate: Number(e.target.value) } : x))} />
                        </TableCell>
                        <TableCell>
                          <Button size="icon" variant="ghost" disabled={dis}
                            onClick={() => setSlabs((arr) => arr.filter((_, idx) => idx !== i))}>
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
                <Button size="sm" variant="outline" disabled={dis || slabs.length >= 5}
                  onClick={() => setSlabs((arr) => [...arr, { from_amount: 0, to_amount: 0, gst_rate: 0 }])}>
                  + Add Slab
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* SECTION F: Invoice */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Receipt className="h-5 w-5" /> Invoice Settings</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <Field label="Invoice Prefix">
            <Input disabled={dis} maxLength={5} value={form.invoice_prefix ?? "INV"} onChange={(e) => set("invoice_prefix", e.target.value.toUpperCase())} />
          </Field>
          <Field label="Invoice Starting Number" hint="Current counter will reset to this number.">
            <Input type="number" min={1} disabled={dis} value={form.invoice_start_number ?? 1} onChange={(e) => set("invoice_start_number", e.target.value)} />
          </Field>

          <Field label="Default Bill Type">
            <RadioGroup
              className="flex gap-6"
              disabled={dis}
              value={form.default_bill_type ?? "cash"}
              onValueChange={(v) => set("default_bill_type", v)}
            >
              <label className="flex items-center gap-2"><RadioGroupItem value="gst" /> GST Invoice</label>
              <label className="flex items-center gap-2"><RadioGroupItem value="cash" /> Cash Bill</label>
            </RadioGroup>
          </Field>

          <Field label="Invoice Primary Color">
            <div className="flex items-center gap-3">
              <input
                type="color"
                disabled={dis}
                value={form.invoice_primary_color ?? "#1D9E75"}
                onChange={(e) => set("invoice_primary_color", e.target.value)}
                className="h-10 w-14 border rounded cursor-pointer"
              />
              <code className="text-xs">{form.invoice_primary_color ?? "#1D9E75"}</code>
              <div className="h-8 w-8 rounded border" style={{ background: form.invoice_primary_color ?? "#1D9E75" }} />
            </div>
          </Field>

          <div className="md:col-span-2">
            <Field label="Invoice Footer Message">
              <Textarea disabled={dis} maxLength={200} rows={2}
                value={form.invoice_footer ?? ""}
                onChange={(e) => set("invoice_footer", e.target.value)} />
            </Field>
          </div>

          <div className="md:col-span-2">
            <Label className="text-xs">Invoice Template</Label>
            <div className="border rounded-lg p-3 mt-2 flex items-center justify-between bg-primary/5">
              <div>
                <div className="font-medium text-sm">Premium</div>
                <div className="text-xs text-muted-foreground">Full-width colored header, address bar, A4 print-ready.</div>
              </div>
              <Badge variant="secondary">Active</Badge>
            </div>
          </div>

          <ToggleRow
            label='Show HSN Codes on invoice'
            disabled={dis}
            checked={form.invoice_show_hsn ?? true}
            onChange={(v) => set("invoice_show_hsn", v)}
          />
          <ToggleRow
            label='Show GST Breakup table'
            disabled={dis}
            checked={form.invoice_show_gst_breakup ?? true}
            onChange={(v) => set("invoice_show_gst_breakup", v)}
          />
          <ToggleRow
            label='Show Signature Lines'
            disabled={dis}
            checked={form.invoice_show_signature ?? true}
            onChange={(v) => set("invoice_show_signature", v)}
          />
          <ToggleRow
            label='Show "Powered by HotelPilot.in"'
            disabled={dis}
            checked={form.invoice_show_powered_by ?? true}
            onChange={(v) => set("invoice_show_powered_by", v)}
          />
        </CardContent>
      </Card>

      {/* SECTION G: Policy */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Clock className="h-5 w-5" /> Check-in / Check-out Policy</CardTitle>
        </CardHeader>
        <CardContent className="grid md:grid-cols-2 gap-4">
          <Field label="Default Check-in Time">
            <Input type="time" disabled={dis} value={(form.default_checkin_time ?? "12:00").slice(0,5)} onChange={(e) => set("default_checkin_time", e.target.value)} />
          </Field>
          <Field label="Default Check-out Time">
            <Input type="time" disabled={dis} value={(form.default_checkout_time ?? "11:00").slice(0,5)} onChange={(e) => set("default_checkout_time", e.target.value)} />
          </Field>
          <Field label="Early Check-in Charge (₹ / hour)">
            <Input type="number" min={0} step={0.01} disabled={dis} value={form.early_checkin_charge_per_hour ?? 0} onChange={(e) => set("early_checkin_charge_per_hour", e.target.value)} />
          </Field>
          <Field label="Late Check-out Charge (₹ / hour)">
            <Input type="number" min={0} step={0.01} disabled={dis} value={form.late_checkout_charge_per_hour ?? 0} onChange={(e) => set("late_checkout_charge_per_hour", e.target.value)} />
          </Field>
          <p className="md:col-span-2 text-xs text-muted-foreground">
            These timings show on booking confirmations and invoices.
          </p>
        </CardContent>
      </Card>

      {/* Sticky save */}
      {!readOnly && (
        <div className="fixed bottom-4 right-4 z-40">
          <Button size="lg" onClick={onSave} disabled={saving} className="shadow-lg">
            <Save className="h-4 w-4 mr-2" />
            {saving ? "Saving…" : "Save All Settings"}
          </Button>
        </div>
      )}
      {readOnly && (
        <div className="fixed bottom-4 right-4 z-40">
          <div className="bg-muted text-muted-foreground text-xs px-3 py-2 rounded-md shadow">
            View only — Manager cannot edit settings.
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{label}</Label>
      {children}
      {hint && <p className="text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function ToggleRow({ label, checked, onChange, disabled }: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <div className="flex items-center justify-between border rounded-md px-3 py-2">
      <span className="text-sm">{label}</span>
      <Switch checked={!!checked} disabled={disabled} onCheckedChange={onChange} />
    </div>
  );
}