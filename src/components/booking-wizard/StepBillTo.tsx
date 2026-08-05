// Part 4 — Step 4: optional "Bill To" (company or third party).
// One Bill-To applies to the whole booking, including multi-room bookings.
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { useServerFn } from "@tanstack/react-start";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useBillingCompanies } from "@/hooks/use-billing-companies";
import { GSTIN_ERROR, isValidGSTIN, isValidOrEmptyGSTIN } from "@/lib/gstin";
import { gstinLookup } from "@/lib/gstinLookup.functions";
import { parseGstinProfile } from "@/lib/gstinProfile";
import type { WizardBillTo } from "@/lib/bookingWizard";

const NEW_COMPANY = "__new__";

interface Props {
  propertyId: string;
  value: WizardBillTo;
  onChange: (patch: Partial<WizardBillTo>) => void;
}

export function StepBillTo({ propertyId, value, onChange }: Props) {
  // Shared cache — this list is one of the slowest reads in the app and used
  // to be re-fetched on every wizard mount.
  const { companies } = useBillingCompanies(propertyId);
  const [looking, setLooking] = useState(false);
  // Fields refreshed from the GST portal on the last automatic verification,
  // and whether that verification failed (shown as a non-blocking notice).
  const [refreshed, setRefreshed] = useState<string[]>([]);
  const [verifyFailed, setVerifyFailed] = useState<string>("");
  const lastLookedUp = useRef<string>("");
  const runLookup = useServerFn(gstinLookup);

  function pick(id: string) {
    setRefreshed([]);
    setVerifyFailed("");
    if (id === NEW_COMPANY) {
      onChange({ companyId: "", name: "", gstin: "", gstStatus: "", address: "", email: "" });
      return;
    }
    const c = companies.find((x) => x.id === id);
    if (!c) return;
    const stored: Partial<WizardBillTo> = {
      companyId: c.id,
      name: c.name ?? "",
      gstin: c.gstin ?? "",
      gstStatus: c.gst_status ?? "",
      address: c.address ?? "",
      email: c.email ?? "",
      city: c.city ?? value.city,
      state: c.state ?? value.state,
      nation: c.nation ?? value.nation,
    };
    onChange(stored);
    // Auto-verify against the GST portal so the master record is refreshed
    // without the staff member clicking anything.
    const gstin = (c.gstin ?? "").trim().toUpperCase();
    if (isValidGSTIN(gstin)) void verifyGstin(gstin, stored, true);
  }

  const gstinBad = value.gstin.trim().length > 0 && !isValidOrEmptyGSTIN(value.gstin);

  /** Fetches the latest GST-portal details and applies them to the form.
   *  `auto` = triggered by selecting a company (silent-ish, diff-annotated). */
  async function verifyGstin(
    gstin: string,
    current: Partial<WizardBillTo>,
    auto: boolean,
  ): Promise<void> {
    if (looking) return;
    setLooking(true);
    setVerifyFailed("");
    try {
      const res = await runLookup({ data: { gstin } });
      if (res.status < 200 || res.status >= 300) {
        const msg =
          (res.body as { error?: string; message?: string } | null)?.error ??
          (res.body as { message?: string } | null)?.message ??
          "Could not fetch GST details.";
        if (auto) setVerifyFailed(msg);
        else toast.error(msg);
        return;
      }
      lastLookedUp.current = gstin;
      const profile = parseGstinProfile(res.body);
      const patch: Partial<WizardBillTo> = {};
      const changed: string[] = [];
      const consider = (
        key: "name" | "address" | "state" | "gstStatus",
        label: string,
        next: string,
      ) => {
        if (!next) return;
        patch[key] = next;
        const before = (current[key] ?? "").toString().trim();
        if (before.toLowerCase() !== next.trim().toLowerCase()) changed.push(label);
      };
      consider("name", "Name", profile.name);
      consider("address", "Address", profile.address);
      consider("state", "State", profile.state);
      consider("gstStatus", "GST status", profile.gstStatus);

      if (Object.keys(patch).length === 0) {
        if (auto) setVerifyFailed("No details returned for this GSTIN.");
        else toast.info("No details returned for this GSTIN.");
        return;
      }
      onChange(patch);
      setRefreshed(changed);
      if (!auto) toast.success("GST details fetched.");
    } catch {
      if (auto) setVerifyFailed("Could not reach the GST lookup service.");
      else toast.error("Could not reach the GST lookup service.");
    } finally {
      setLooking(false);
    }
  }

  async function handleGstinBlur() {
    const gstin = value.gstin.trim().toUpperCase();
    if (!isValidGSTIN(gstin) || gstin === lastLookedUp.current || looking) return;
    await verifyGstin(gstin, value, false);
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

          {(refreshed.length > 0 || verifyFailed) && (
            <p className="text-xs text-muted-foreground">
              {refreshed.length > 0
                ? `Updated from GST records: ${refreshed.join(", ")}. Edit if needed.`
                : `GST verification unavailable — using saved details. (${verifyFailed})`}
            </p>
          )}

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
