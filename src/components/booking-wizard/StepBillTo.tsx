// Part 4 — Step 4: optional "Bill To" (company or third party).
// One Bill-To applies to the whole booking, including multi-room bookings.
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";
import { GSTIN_ERROR, isValidGSTIN, isValidOrEmptyGSTIN } from "@/lib/gstin";
import { gstinLookup } from "@/lib/gstinLookup.functions";
import { parseGstinProfile } from "@/lib/gstinProfile";
import type { WizardBillTo } from "@/lib/bookingWizard";
import { reportQueryError } from "@/lib/queryError";

const NEW_COMPANY = "__new__";

interface CompanyRow {
  id: string; name: string; gstin: string | null; gst_status: string | null; address: string | null;
  email: string | null; city: string | null; state: string | null; nation: string | null;
}

interface Props {
  propertyId: string;
  value: WizardBillTo;
  onChange: (patch: Partial<WizardBillTo>) => void;
}

export function StepBillTo({ propertyId, value, onChange }: Props) {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);
  const [looking, setLooking] = useState(false);
  const lastLookedUp = useRef<string>("");
  const runLookup = useServerFn(gstinLookup);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    (async () => {
      const { data, error: __qe1 } = await supabase
        .from("billing_companies")
        .select("id,name,gstin,gst_status,address,email,city,state,nation")
        .eq("property_id", propertyId)
        .eq("is_active", true)
        .order("name");
      if (__qe1) reportQueryError("billing companies", __qe1);
      if (!cancelled) setCompanies((data ?? []) as unknown as CompanyRow[]);
    })();
    return () => { cancelled = true; };
  }, [propertyId]);

  function pick(id: string) {
    if (id === NEW_COMPANY) {
      onChange({ companyId: "", name: "", gstin: "", gstStatus: "", address: "", email: "" });
      return;
    }
    const c = companies.find((x) => x.id === id);
    if (!c) return;
    onChange({
      companyId: c.id,
      name: c.name ?? "",
      gstin: c.gstin ?? "",
      gstStatus: c.gst_status ?? "",
      address: c.address ?? "",
      email: c.email ?? "",
      state: c.state ?? value.state,
      nation: c.nation ?? value.nation,
    });
  }

  const gstinBad = value.gstin.trim().length > 0 && !isValidOrEmptyGSTIN(value.gstin);

  async function handleGstinBlur() {
    const gstin = value.gstin.trim().toUpperCase();
    if (!isValidGSTIN(gstin) || gstin === lastLookedUp.current || looking) return;
    setLooking(true);
    try {
      const res = await runLookup({ data: { gstin } });
      if (res.status < 200 || res.status >= 300) {
        const msg =
          (res.body as { error?: string; message?: string } | null)?.error ??
          (res.body as { message?: string } | null)?.message ??
          "Could not fetch GST details.";
        toast.error(msg);
        return;
      }
      lastLookedUp.current = gstin;
      const profile = parseGstinProfile(res.body);
      const patch: Partial<WizardBillTo> = {};
      if (profile.name) patch.name = profile.name;
      if (profile.address) patch.address = profile.address;
      if (profile.state) patch.state = profile.state;
      if (profile.gstStatus) patch.gstStatus = profile.gstStatus;
      if (Object.keys(patch).length === 0) {
        toast.info("No details returned for this GSTIN.");
        return;
      }
      onChange(patch);
      toast.success("GST details fetched.");
    } catch {
      toast.error("Could not reach the GST lookup service.");
    } finally {
      setLooking(false);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-sm font-semibold">Bill to someone else</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Optional. Leave this off to bill the primary guest. One Bill-To covers every room on this booking.
        </p>
      </div>

      <label className="flex items-center gap-2 text-sm">
        <Checkbox
          checked={value.enabled}
          onCheckedChange={(c) => onChange({ enabled: c === true })}
        />
        Bill this booking to a company / third party
      </label>

      {value.enabled && (
        <div className="space-y-4 rounded-lg border p-4">
          <div className="space-y-1.5">
            <Label>Company / party</Label>
            <SearchableSelect
              value={value.companyId || NEW_COMPANY}
              onChange={pick}
              alwaysShowSearch
              searchPlaceholder="Search companies…"
              placeholder="Select or add"
              options={[
                { value: NEW_COMPANY, label: "+ Add new" },
                ...companies.map((c) => ({
                  value: c.id,
                  label: c.name,
                  hint: c.gstin ?? undefined,
                  keywords: `${c.gstin ?? ""} ${c.city ?? ""}`,
                })),
              ]}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>GSTIN</Label>
              <div className="relative">
                <Input
                  value={value.gstin}
                  onChange={(e) => onChange({ gstin: e.target.value.toUpperCase() })}
                  onBlur={handleGstinBlur}
                  placeholder="27AASFB5351R1ZM"
                />
                {looking && (
                  <Loader2 className="absolute right-2 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
                )}
              </div>
              {gstinBad && <p className="text-xs text-destructive">{GSTIN_ERROR}</p>}
            </div>
            <div className="space-y-1.5">
              <Label>GST Status</Label>
              <Select
                value={value.gstStatus || undefined}
                onValueChange={(v) => onChange({ gstStatus: v })}
              >
                <SelectTrigger>
                  <SelectValue placeholder="Select" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="cancelled">Cancelled</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Name *</Label>
              <Input
                autoTitleCase
                value={value.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="Company or party name"
              />
            </div>
            <div className="space-y-1.5 sm:col-span-2">
              <Label>Address</Label>
              <Input value={value.address} onChange={(e) => onChange({ address: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Email</Label>
              <Input type="email" value={value.email} onChange={(e) => onChange({ email: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>State</Label>
              <Input value={value.state} onChange={(e) => onChange({ state: e.target.value })} />
            </div>
            <div className="space-y-1.5">
              <Label>Country</Label>
              <Input value={value.nation} onChange={(e) => onChange({ nation: e.target.value })} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
