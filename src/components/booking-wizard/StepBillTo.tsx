// Part 4 — Step 4: optional "Bill To" (company or third party).
// One Bill-To applies to the whole booking, including multi-room bookings.
import { useEffect, useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { supabase } from "@/integrations/supabase/client";
import { GSTIN_ERROR, isValidOrEmptyGSTIN } from "@/lib/gstin";
import type { WizardBillTo } from "@/lib/bookingWizard";

const NEW_COMPANY = "__new__";

interface CompanyRow {
  id: string; name: string; gstin: string | null; address: string | null;
  email: string | null; city: string | null; state: string | null; nation: string | null;
}

interface Props {
  propertyId: string;
  value: WizardBillTo;
  onChange: (patch: Partial<WizardBillTo>) => void;
}

export function StepBillTo({ propertyId, value, onChange }: Props) {
  const [companies, setCompanies] = useState<CompanyRow[]>([]);

  useEffect(() => {
    if (!propertyId) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("billing_companies")
        .select("id,name,gstin,address,email,city,state,nation")
        .eq("property_id", propertyId)
        .eq("is_active", true)
        .order("name");
      if (!cancelled) setCompanies((data ?? []) as unknown as CompanyRow[]);
    })();
    return () => { cancelled = true; };
  }, [propertyId]);

  function pick(id: string) {
    if (id === NEW_COMPANY) {
      onChange({ companyId: "", name: "", gstin: "", address: "", email: "" });
      return;
    }
    const c = companies.find((x) => x.id === id);
    if (!c) return;
    onChange({
      companyId: c.id,
      name: c.name ?? "",
      gstin: c.gstin ?? "",
      address: c.address ?? "",
      email: c.email ?? "",
      city: c.city ?? value.city,
      state: c.state ?? value.state,
      nation: c.nation ?? value.nation,
    });
  }

  const gstinBad = value.gstin.trim().length > 0 && !isValidOrEmptyGSTIN(value.gstin);

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
              <Label>Name *</Label>
              <Input
                autoTitleCase
                value={value.name}
                onChange={(e) => onChange({ name: e.target.value })}
                placeholder="Company or party name"
              />
            </div>
            <div className="space-y-1.5">
              <Label>GSTIN</Label>
              <Input
                value={value.gstin}
                onChange={(e) => onChange({ gstin: e.target.value.toUpperCase() })}
                placeholder="27AASFB5351R1ZM"
              />
              {gstinBad && <p className="text-xs text-destructive">{GSTIN_ERROR}</p>}
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
              <Label>City</Label>
              <Input value={value.city} onChange={(e) => onChange({ city: e.target.value })} />
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
